import { randomBytes } from "crypto";
import { Contact } from "./models";
import { IContact, ContactSource } from "./interfaces";
import { runInTransaction } from "@/utils";

const generateToken = () => randomBytes(32).toString("hex");

// ---------------------------------------------------------------------------
// Waitlist Lane
// ---------------------------------------------------------------------------

/**
 * Join the waitlist. Idempotent — if already active, returns existing doc.
 * If previously removed, re-activates.
 */
export const joinWaitlist = async (data: {
  email: string;
  name?: string;
  source?: ContactSource;
}): Promise<{ contact: IContact; isNew: boolean }> => {
  const email = data.email.toLowerCase().trim();
  const existing = await Contact.findOne({ email });

  if (existing) {
    if (existing.isWaitlist && existing.waitlistStatus === "active") {
      return { contact: existing, isNew: false };
    }
    // Re-join or first-time waitlist enrollment on existing newsletter contact
    return await runInTransaction(async (session) => {
      existing.isWaitlist = true;
      existing.waitlistStatus = "active";
      existing.waitlistJoinedAt = new Date();
      if (data.name) existing.name = data.name;
      const saved = await existing.save({ session });
      return { contact: saved, isNew: true };
    });
  }

  return await runInTransaction(async (session) => {
    const contact = new Contact({
      email,
      name: data.name,
      source: data.source ?? "landing_hero",
      isWaitlist: true,
      waitlistStatus: "active",
      waitlistJoinedAt: new Date(),
      isNewsletter: false,
      unsubscribeToken: generateToken(),
    });
    const saved = await contact.save({ session });
    return { contact: saved, isNew: true };
  });
};

export const removeFromWaitlist = async (id: string) => {
  return await runInTransaction(async (session) => {
    return await Contact.findByIdAndUpdate(
      id,
      { waitlistStatus: "removed", isWaitlist: false },
      { returnDocument: "after", session },
    );
  });
};

// ---------------------------------------------------------------------------
// Newsletter Lane
// ---------------------------------------------------------------------------

/**
 * Subscribe to the newsletter. Idempotent.
 * - Already active → return as-is (alreadyActive: true).
 * - Pending or unsubscribed → reset to pending, re-issue confirmation token.
 * - New contact → create with newsletter lane only.
 */
export const subscribeToNewsletter = async (data: {
  email: string;
  name?: string;
  source?: ContactSource;
}): Promise<{ contact: IContact; alreadyActive: boolean }> => {
  const email = data.email.toLowerCase().trim();
  const existing = await Contact.findOne({ email });

  if (existing) {
    // Already confirmed — do not send another email regardless of isNewsletter flag
    if (existing.newsletterStatus === "active") {
      return { contact: existing, alreadyActive: true };
    }
    // Already awaiting confirmation — do not regenerate the token so the
    // existing confirmation link remains valid; the controller will resend it
    if (existing.isNewsletter && existing.newsletterStatus === "pending") {
      return { contact: existing, alreadyActive: false };
    }
    // Unsubscribed, bounced, or waitlist-only contact re-subscribing — issue a fresh token
    return await runInTransaction(async (session) => {
      existing.isNewsletter = true;
      existing.newsletterStatus = "pending";
      existing.confirmationToken = generateToken();
      existing.subscribedAt = new Date();
      if (data.name && !existing.name) existing.name = data.name;
      const saved = await existing.save({ session });
      return { contact: saved, alreadyActive: false };
    });
  }

  return await runInTransaction(async (session) => {
    const contact = new Contact({
      email,
      name: data.name,
      source: data.source ?? "landing_hero",
      isWaitlist: false,
      isNewsletter: true,
      newsletterStatus: "pending",
      confirmationToken: generateToken(),
      unsubscribeToken: generateToken(),
      subscribedAt: new Date(),
    });
    const saved = await contact.save({ session });
    return { contact: saved, alreadyActive: false };
  });
};

export const confirmNewsletter = async (token: string) => {
  return await runInTransaction(async (session) => {
    const contact = await Contact.findOne({ confirmationToken: token });
    if (!contact) throw new Error("Invalid or expired confirmation token");
    contact.newsletterStatus = "active";
    contact.confirmedAt = new Date();
    contact.confirmationToken = undefined;
    return await contact.save({ session });
  });
};

/**
 * Unsubscribe from the newsletter. Waitlist lane is completely unaffected.
 */
export const unsubscribeNewsletter = async (token: string) => {
  return await runInTransaction(async (session) => {
    const contact = await Contact.findOne({ unsubscribeToken: token });
    if (!contact) throw new Error("Invalid unsubscribe token");
    contact.newsletterStatus = "unsubscribed";
    contact.isNewsletter = false;
    contact.unsubscribedAt = new Date();
    return await contact.save({ session });
  });
};
