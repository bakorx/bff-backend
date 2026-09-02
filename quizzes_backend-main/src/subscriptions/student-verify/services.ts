import { User } from "@/users";
import { runInTransaction } from "@/utils";
import { signEmailLinkToken, verifyEmailLinkToken } from "@/email/utils";
import { CONFIG } from "@/config";
import { services as emailServices } from "@/email";
import { shortQueue } from "@/schedulers/queues";
import React from "react";

// ---------------------------------------------------------------------------
// University domain registry
// ---------------------------------------------------------------------------

const GHANA_UNIVERSITY_DOMAINS = new Set([
  "st.ug.edu.gh",
  "ug.edu.gh",
  "knust.edu.gh",
  "st.knust.edu.gh",
  "ucc.edu.gh",
  "uhas.edu.gh",
  "gimpa.edu.gh",
  "uenr.edu.gh",
  "uds.edu.gh",
  "umat.edu.gh",
  "uew.edu.gh",
  "gtuc.edu.gh",
  "pentvars.edu.gh",
  "gctu.edu.gh",
  "aucc.edu.gh",
  "central.edu.gh",
  "regent.edu.gh",
  "ashesi.edu.gh",
  "upsa.edu.gh",
  "tttu.edu.gh",
]);

export function isKnownUniversityDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return GHANA_UNIVERSITY_DOMAINS.has(domain);
}

// ---------------------------------------------------------------------------
// Semester calendar helpers
// ---------------------------------------------------------------------------

/**
 * Returns the expiry date for student verification based on the current date.
 * Ghana academic calendar approximation:
 *   Semester 1: Aug–Dec  → expiry Jan 15
 *   Semester 2: Jan–May  → expiry Jun 15
 *   Off-peak:   Jun–Jul  → expiry Aug 31
 */
export function computeSemesterExpiry(): Date {
  const now = new Date();
  const month = now.getUTCMonth() + 1; // 1–12

  let year = now.getUTCFullYear();
  let expiryMonth: number;
  let expiryDay: number;

  if (month >= 8 && month <= 12) {
    // Semester 1
    expiryMonth = 1;
    expiryDay = 15;
    year += 1;
  } else if (month >= 1 && month <= 5) {
    // Semester 2
    expiryMonth = 6;
    expiryDay = 15;
  } else {
    // June–July off-peak
    expiryMonth = 8;
    expiryDay = 31;
  }

  return new Date(Date.UTC(year, expiryMonth - 1, expiryDay, 23, 59, 59));
}

// ---------------------------------------------------------------------------
// Core services
// ---------------------------------------------------------------------------

const TOKEN_RESEND_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function initiateStudentVerification(
  userId: string,
  studentEmail: string,
): Promise<void> {
  const normalizedEmail = studentEmail.trim().toLowerCase();

  if (!isKnownUniversityDomain(normalizedEmail)) {
    throw Object.assign(
      new Error("Email domain is not a recognised Ghanaian university"),
      { status: 400 },
    );
  }

  // Abuse check: is this email already verified on another account?
  const existingVerified = await User.findOne({
    _id: { $ne: userId },
    "studentVerification.studentEmail": normalizedEmail,
    "studentVerification.status": "verified",
  }).lean();

  if (existingVerified) {
    // Flag the requester and reject
    await User.updateOne(
      { _id: userId },
      { $set: { "studentVerification.abuseFlagged": true } },
    );
    throw Object.assign(
      new Error("This student email is already linked to another account"),
      { status: 409 },
    );
  }

  // Throttle re-sends
  const user = await User.findById(userId).select("studentVerification").lean();
  if (user?.studentVerification?.lastTokenSentAt) {
    const elapsed =
      Date.now() - new Date(user.studentVerification.lastTokenSentAt).getTime();
    if (elapsed < TOKEN_RESEND_COOLDOWN_MS) {
      throw Object.assign(
        new Error("Please wait before requesting another verification email"),
        { status: 429 },
      );
    }
  }

  // 72-hour verification link
  const token = signEmailLinkToken(
    {
      action: "student_verify",
      userId,
      email: normalizedEmail,
    },
    "student_verify",
  );

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "studentVerification.status": "pending",
        "studentVerification.studentEmail": normalizedEmail,
        "studentVerification.lastTokenSentAt": new Date(),
        "studentVerification.verifiedAt": null,
        "studentVerification.expiresAt": null,
      },
    },
  );

  const verifyUrl = `${CONFIG.FRONTEND_URL}/verify?type=student-verify&token=${token}`;

  // Create a transactional campaign and enqueue for delivery
  const campaign = await emailServices.sendTransactional({
    campaignType: "student_verification",
    recipient: {
      recipientId: userId,
      email: normalizedEmail,
    },
    subject: "Verify your student status on Qz",
    markdownBody: `Click the button below to verify your student status. This link expires in 72 hours.\n\nNote: If you didn't request this, you can safely ignore this email.`,
    templateVariables: {
      appUrl: verifyUrl,
    },
  });

  await shortQueue.enqueue("email:transactional:send", {
    campaignId: campaign._id.toString(),
    recipientId: userId,
    email: normalizedEmail,
    templateVariables: {
      appUrl: verifyUrl,
    },
  });
}

export async function confirmStudentVerification(token: string): Promise<void> {
  let payload: ReturnType<typeof verifyEmailLinkToken>;
  try {
    payload = verifyEmailLinkToken(token);
  } catch {
    throw Object.assign(new Error("Verification link is invalid or expired"), {
      status: 400,
    });
  }

  if (
    payload.action !== "student_verify" ||
    !payload.userId ||
    !payload.email
  ) {
    throw Object.assign(new Error("Invalid verification token"), {
      status: 400,
    });
  }

  await runInTransaction(async (session) => {
    const user = await User.findById(payload.userId).session(session);
    if (!user) throw new Error("User not found");

    if (user.studentVerification?.status !== "pending") {
      throw Object.assign(
        new Error("No pending verification for this account"),
        { status: 400 },
      );
    }

    if (user.studentVerification.studentEmail !== payload.email) {
      throw Object.assign(new Error("Token email mismatch"), { status: 400 });
    }

    const now = new Date();
    const expiresAt = computeSemesterExpiry();

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "studentVerification.status": "verified",
          "studentVerification.verifiedAt": now,
          "studentVerification.expiresAt": expiresAt,
        },
      },
      { session },
    );
  });
}

export async function getStudentVerificationStatus(userId: string) {
  const user = await User.findById(userId).select("studentVerification").lean();
  return user?.studentVerification ?? null;
}

export async function revokeStudentVerification(userId: string): Promise<void> {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "studentVerification.status": "revoked",
        "studentVerification.abuseFlagged": true,
      },
    },
  );
}
