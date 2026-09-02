import { Types, isValidObjectId } from "mongoose";
import { z } from "genkit";
import { nanoid } from "nanoid";
import { User, Token, EmailUpdate } from "./models";
import { IUser, IToken, IEmailUpdate, ILinkedProvider } from "./interfaces";
import { runInTransaction } from "@/utils";
import { Course } from "@/learning";
import { ai } from "@/ai/config";

// --- USER SERVICES ---
export const createUser = async (data: Partial<IUser>) => {
  return await runInTransaction(async (session) => {
    const user = new User({ role: "student", ...data });
    return await user.save({ session });
  });
};

export const updateUser = async (
  id: string | Types.ObjectId,
  data: Partial<IUser>,
) => {
  return await runInTransaction(async (session) => {
    return await User.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteUser = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await User.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { returnDocument: "after", session },
    );
  });
};

export const incrementUserCredits = async (
  id: string | Types.ObjectId,
  amount: number,
) => {
  return await runInTransaction(async (session) => {
    return await User.findByIdAndUpdate(
      id,
      { $inc: { quizCredits: amount } },
      { returnDocument: "after", session },
    );
  });
};

export const updateOnboardingStep = async (
  userId: string | Types.ObjectId,
  step: string,
  data: any,
) => {
  return await runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    if (!user.onboarding.steps.hasOwnProperty(step)) {
      throw new Error(`Invalid onboarding step: ${step}`);
    }

    // Atomic update of user fields based on data
    if (data && !data.skipped) {
      if (data.name) user.name = data.name;
      if (data.bio) user.bio = data.bio;
      if (data.username) user.username = data.username;
      if (data.yearOfStudy) user.yearOfStudy = data.yearOfStudy;
    }

    // Mark step complete
    (user.onboarding.steps as any)[step] = true;
    user.onboarding.currentStep = user.onboarding.currentStep + 1;

    // Evaluate completion
    const requiredSteps = ["profile", "yearOfStudy", "pushOptIn"];
    const allRequiredDone = requiredSteps.every(
      (s) => (user.onboarding.steps as any)[s],
    );

    if (allRequiredDone && !user.onboarding.completed) {
      user.onboarding.completed = true;
      user.onboarding.completedAt = new Date();
    }

    return await user.save({ session });
  });
};

// --- TOKEN SERVICES ---
export const createToken = async (data: Partial<IToken>) => {
  return await runInTransaction(async (session) => {
    const token = new Token(data);
    return await token.save({ session });
  });
};

export const updateToken = async (
  id: string | Types.ObjectId,
  data: Partial<IToken>,
) => {
  return await runInTransaction(async (session) => {
    return await Token.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteToken = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Token.findByIdAndDelete(id, { session });
  });
};

// --- EMAIL UPDATE SERVICES ---
export const createEmailUpdate = async (data: Partial<IEmailUpdate>) => {
  return await runInTransaction(async (session) => {
    const emailUpdate = new EmailUpdate(data);
    return await emailUpdate.save({ session });
  });
};

export const updateEmailUpdate = async (
  id: string | Types.ObjectId,
  data: Partial<IEmailUpdate>,
) => {
  return await runInTransaction(async (session) => {
    return await EmailUpdate.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteEmailUpdate = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await EmailUpdate.findByIdAndDelete(id, { session });
  });
};

// ---------------------------------------------------------------------------
// Markdown → HTML renderer
//
// A lightweight inline converter for BBF email content.  Supports the most
// common Markdown constructs: headings (h1–h3), bold, italic, links,
// unordered / ordered lists, blockquotes, horizontal rules, and paragraphs.
//
// No external library is required; this keeps the service self-contained.
// ---------------------------------------------------------------------------

/**
 * Converts a Markdown string to an HTML string suitable for email bodies.
 *
 * Block-level elements (headings, lists, blockquotes, HR) are never wrapped
 * in `<p>` tags — only plain text paragraphs are.  Consecutive list items
 * are automatically grouped into `<ul>` or `<ol>` containers.
 *
 * @param markdown  Raw Markdown text.
 * @returns         HTML string wrapped in a root `<div>` element.
 */
export function renderMarkdown(markdown: string): string {
  /** Escape only the characters that are not yet HTML */
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** Apply inline-level formatting to an already-escaped string. */
  const applyInline = (s: string): string =>
    s
      // Bold + italic (order matters: triple → double → single)
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      // Inline code
      .replace(/`(.+?)`/g, "<code>$1</code>")
      // Links — unescape &amp; inside URLs after escaping the rest
      .replace(
        /\[(.+?)\]\((.+?)\)/g,
        (_, label, url) =>
          `<a href="${url.replace(/&amp;/g, "&")}">${label}</a>`,
      );

  const lines = markdown.split("\n");
  const htmlParts: string[] = [];

  let ulBuffer: string[] = [];
  let olBuffer: string[] = [];
  let bqBuffer: string[] = [];
  let paraBuffer: string[] = [];

  const flushUl = () => {
    if (ulBuffer.length) {
      htmlParts.push(`<ul>${ulBuffer.join("")}</ul>`);
      ulBuffer = [];
    }
  };
  const flushOl = () => {
    if (olBuffer.length) {
      htmlParts.push(`<ol>${olBuffer.join("")}</ol>`);
      olBuffer = [];
    }
  };
  const flushBq = () => {
    if (bqBuffer.length) {
      htmlParts.push(`<blockquote>${bqBuffer.join("<br>")}</blockquote>`);
      bqBuffer = [];
    }
  };
  const flushPara = () => {
    if (paraBuffer.length) {
      htmlParts.push(`<p>${paraBuffer.join("<br>")}</p>`);
      paraBuffer = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Headings
    const h3 = line.match(/^### (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h1 = line.match(/^# (.+)$/);
    if (h3 || h2 || h1) {
      flushUl();
      flushOl();
      flushBq();
      flushPara();
      const [, text] = (h3 ?? h2 ?? h1)!;
      const tag = h3 ? "h3" : h2 ? "h2" : "h1";
      htmlParts.push(`<${tag}>${applyInline(esc(text))}</${tag}>`);
      continue;
    }

    // Horizontal rule
    if (/^---$/.test(line)) {
      flushUl();
      flushOl();
      flushBq();
      flushPara();
      htmlParts.push("<hr>");
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[*\-] (.+)$/);
    if (ulMatch) {
      flushOl();
      flushBq();
      flushPara();
      ulBuffer.push(`<li>${applyInline(esc(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\. (.+)$/);
    if (olMatch) {
      flushUl();
      flushBq();
      flushPara();
      olBuffer.push(`<li>${applyInline(esc(olMatch[1]))}</li>`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^> (.+)$/);
    if (bqMatch) {
      flushUl();
      flushOl();
      flushPara();
      bqBuffer.push(applyInline(esc(bqMatch[1])));
      continue;
    }

    // Blank line — flush all buffers and start new paragraph
    if (!line.trim()) {
      flushUl();
      flushOl();
      flushBq();
      flushPara();
      continue;
    }

    // Plain text — accumulate into paragraph buffer
    flushUl();
    flushOl();
    flushBq();
    paraBuffer.push(applyInline(esc(line)));
  }

  // Flush any remaining buffers
  flushUl();
  flushOl();
  flushBq();
  flushPara();

  return `<div>${htmlParts.join("\n")}</div>`;
}

// ---------------------------------------------------------------------------
// Entity ref resolver
//
// Resolves URL-style entity references (e.g. "/universities/64abc") into a
// human-readable text block that can be injected into the AI prompt as
// context.  Supported patterns:
//   /universities/<id>   → University name + settings summary
//   /campuses/<id>       → Campus name + university link
//   /institutions/<id>   → alias for /campuses/<id>
//   /courses/<id>        → Course name + code + description
//   /departments/<id>    → Department name
//   /schools/<id>        → School name
//   /colleges/<id>       → College name
// ---------------------------------------------------------------------------

async function resolveContextRefs(refs: string[]): Promise<string> {
  if (!refs.length) return "";

  const lines: string[] = [];

  for (const ref of refs) {
    const match = ref.match(
      /^\/(universities|campuses|institutions|courses|departments|schools|colleges)\/([a-f0-9]{24})$/i,
    );
    if (!match) {
      lines.push(`Reference "${ref}": unrecognised format`);
      continue;
    }

    const [, collection, id] = match;
    try {
      let doc: any = null;
      switch (collection.toLowerCase()) {
        case "courses":
          doc = await Course.findById(id)
            .select("name code description")
            .lean();
          if (doc)
            lines.push(
              `Course "${doc.name}" (${doc.code ?? ""}): ${doc.description ?? ""}`,
            );
          break;
        default:
          lines.push(
            `Reference "${ref}": collection removed in current backend`,
          );
          continue;
      }
      if (!doc) lines.push(`Reference "${ref}": document not found`);
    } catch {
      lines.push(`Reference "${ref}": resolution failed`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// AI-powered email draft generation
// ---------------------------------------------------------------------------

export interface GenerateEmailDraftOptions {
  /** Desired email type. */
  type: IEmailUpdate["type"];
  /**
   * Optional entity reference strings to resolve as context for the AI.
   * Format: "/<collection>/<ObjectId>", e.g. "/universities/64abc123".
   */
  contextRefs?: string[];
  /** Any additional free-form context to feed the AI (e.g. announcement text). */
  freeFormContext?: string;
  /**
   * Optional subject hint — if omitted the AI is asked to generate one.
   * The function will parse it from the first line of the response if absent.
   */
  subjectHint?: string;
  /** User _id of the staff/admin who requested the draft. */
  requestedBy: Types.ObjectId | string;
}

/**
 * Generates an AI-written email draft and persists it as an EmailUpdate
 * document with `status = 'draft'` and `isAiGenerated = true`.
 *
 * The AI is instructed to respond in Markdown.  The markdown content is
 * rendered to HTML via `renderMarkdown` and stored alongside the raw content
 * so the sender can choose either format.
 *
 * Every generated email starts as a draft and **requires approval** before
 * it can be dispatched.
 *
 * @param opts  Generation options.
 * @returns     The saved (draft) EmailUpdate document.
 */
export async function generateEmailDraft(
  opts: GenerateEmailDraftOptions,
): Promise<IEmailUpdate> {
  const {
    type,
    contextRefs = [],
    freeFormContext,
    subjectHint,
    requestedBy,
  } = opts;

  // 1. Resolve entity refs into human-readable context lines
  const resolvedContext = await resolveContextRefs(contextRefs);
  const contextBlock = [resolvedContext, freeFormContext]
    .filter(Boolean)
    .join("\n\n");

  // 2. Build the AI prompt
  const subjectHintLine = subjectHint
    ? `Subject hint: "${subjectHint}"`
    : "Generate an appropriate subject line for this email.";

  const prompt = `You are writing an institutional email for the BBF Labs platform.

Email type: ${type}
${subjectHintLine}

${contextBlock ? `Context:\n${contextBlock}\n` : ""}
Instructions:
- Write the full email body in Markdown.
- Use clear headings, bullet points where appropriate, and a professional tone.
- Keep it concise (aim for under 400 words).
- Do NOT include meta-commentary or explanations outside the email itself.`;

  // 3. Call the AI with a structured output schema
  const result = await ai.generate({
    system:
      "You are a professional communications writer for a university technology platform. You write clear, helpful, and well-structured institutional emails.",
    prompt,
    output: {
      schema: z.object({
        subject: z.string().describe("The email subject line"),
        body: z.string().describe("The full email body in Markdown"),
      }),
    },
  });

  const { subject: generatedSubject, body: markdownBody } = result.output!;
  const subject = subjectHint ?? generatedSubject;
  const renderedHtml = renderMarkdown(markdownBody);

  // 4. Persist as draft — every AI-generated email starts in draft status
  return await runInTransaction(async (session) => {
    const draft = new EmailUpdate({
      subject,
      content: markdownBody,
      renderedHtml,
      type,
      status: "draft",
      isAiGenerated: true,
      aiContextRefs: contextRefs.length ? contextRefs : undefined,
      context: contextBlock || undefined,
      requestedBy:
        requestedBy instanceof Types.ObjectId
          ? requestedBy
          : new Types.ObjectId(String(requestedBy)),
    });
    return await draft.save({ session });
  });
}

/**
 * Approves a draft email update, marking it ready for dispatch.
 *
 * @param id         EmailUpdate document _id.
 * @param approverId User _id of the approving admin/moderator.
 * @returns          Updated document, or null if not found.
 */
export async function approveEmailDraft(
  id: string | Types.ObjectId,
  approverId: string | Types.ObjectId,
): Promise<IEmailUpdate | null> {
  return await runInTransaction(async (session) => {
    return await EmailUpdate.findOneAndUpdate(
      { _id: id, status: "draft" },
      {
        status: "approved",
        approvedBy:
          approverId instanceof Types.ObjectId
            ? approverId
            : new Types.ObjectId(String(approverId)),
        approvedAt: new Date(),
      },
      { returnDocument: "after", session },
    );
  });
}

/**
 * Rejects a draft email update, returning it to the creator with a reason.
 *
 * @param id            EmailUpdate document _id.
 * @param rejectorId    User _id of the rejecting admin/moderator.
 * @param reason        Human-readable rejection reason.
 * @returns             Updated document, or null if not found.
 */
export async function rejectEmailDraft(
  id: string | Types.ObjectId,
  rejectorId: string | Types.ObjectId,
  reason: string,
): Promise<IEmailUpdate | null> {
  return await runInTransaction(async (session) => {
    return await EmailUpdate.findOneAndUpdate(
      { _id: id, status: "draft" },
      {
        status: "rejected",
        rejectedBy:
          rejectorId instanceof Types.ObjectId
            ? rejectorId
            : new Types.ObjectId(String(rejectorId)),
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
      { returnDocument: "after", session },
    );
  });
}

// ---------------------------------------------------------------------------
// OAuth-linked-provider management
//
// `linkProvider` appends an entry to a user's `linkedProviders[]`. Idempotent
// on (provider, providerUserId); throws `ProviderAlreadyLinkedError` if the
// same provider account is already linked to a *different* user. If `picture`
// is provided and the user has no custom `profilePicture`, the URL is saved
// on `oauthPicture` as a fallback avatar — custom uploads always win.
// ---------------------------------------------------------------------------

export class ProviderAlreadyLinkedError extends Error {
  readonly status = 409;
  constructor(public readonly otherUserId: string) {
    super("This OAuth account is already linked to a different user");
  }
}

export async function findUserByProvider(
  provider: ILinkedProvider["provider"],
  providerUserId: string,
): Promise<{ userId: string } | null> {
  const existing = await User.findOne({
    linkedProviders: {
      $elemMatch: { provider, providerUserId },
    },
  })
    .select("_id")
    .lean();
  return existing ? { userId: (existing._id as any).toString() } : null;
}

export async function linkProvider(
  userId: string,
  entry: Omit<ILinkedProvider, "linkedAt"> & { picture?: string },
): Promise<void> {
  // Pre-check outside the transaction — cheap and gives a cleaner error.
  const conflict = await User.findOne({
    _id: { $ne: userId },
    linkedProviders: {
      $elemMatch: {
        provider: entry.provider,
        providerUserId: entry.providerUserId,
      },
    },
  })
    .select("_id")
    .lean();

  if (conflict) {
    throw new ProviderAlreadyLinkedError((conflict._id as any).toString());
  }

  await runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const alreadyLinked = user.linkedProviders.some(
      (p) =>
        p.provider === entry.provider &&
        p.providerUserId === entry.providerUserId,
    );
    if (!alreadyLinked) {
      user.linkedProviders.push({
        provider: entry.provider,
        providerUserId: entry.providerUserId,
        email: entry.email,
        linkedAt: new Date(),
      } as ILinkedProvider);
    }

    // Apply the provider's picture only as a fallback — never overwrite a
    // custom upload. Idempotent: re-linking the same provider does not
    // re-clobber an oauthPicture that was already set.
    if (entry.picture && !user.profilePicture && !user.oauthPicture) {
      user.oauthPicture = entry.picture;
    }

    await user.save({ session });
  });
}

// ---------------------------------------------------------------------------
// OAuth signup helper
//
// Creates a user from an OAuth-verified profile rather than a password signup.
// Differs from `createUser` in:
//   - no password (passwordless OAuth account)
//   - emailVerified = true (asserted by the provider)
//   - linkedProviders seeded with the provider we just verified
//   - name defaults to the email local-part if the provider gave no name
//   - username derived from the email local-part, with a random suffix on collision
//   - optional referral code applied (same as password signup)
//
// Always wraps in `runInTransaction` per the project's CUD rule.
// ---------------------------------------------------------------------------

export interface OAuthCreateUserInput {
  provider: ILinkedProvider["provider"];
  providerUserId: string;
  email: string;
  name?: string;
  profilePicture?: string;
  oauthPicture?: string;
  referralCode?: string;
}

const OAUTH_USERNAME_FALLBACK_PREFIX = "user";

/** Strip non-`[a-z0-9_]` and clamp to Mongo's username length cap. */
export function deriveUsernameBase(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 24);
  // Pad short leftovers so we still meet the 3-char minimum.
  return (cleaned + OAUTH_USERNAME_FALLBACK_PREFIX).slice(0, 24);
}

async function uniqueUsername(base: string): Promise<string> {
  // First try the base itself — common case is "first-time Google login".
  const exists = await User.findOne({ username: base }).select("_id").lean();
  if (!exists) return base;

  // Otherwise append a 4-char suffix and retry up to 5 times.
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}_${nanoid(4).toLowerCase()}`;
    const collision = await User.findOne({ username: candidate })
      .select("_id")
      .lean();
    if (!collision) return candidate;
  }

  // Extremely unlikely — fall back to a longer suffix.
  return `${base}_${nanoid(8).toLowerCase()}`;
}

export async function oauthCreateUser(input: OAuthCreateUserInput) {
  const email = input.email.toLowerCase();
  const baseName = input.name?.trim() || email.split("@")[0] || "New User";
  const username = await uniqueUsername(deriveUsernameBase(email));

  // Resolve referrer if the caller supplied a referral code.
  let referredById: Types.ObjectId | null = null;
  if (input.referralCode) {
    const referrer = await User.findOne({
      referralCode: String(input.referralCode).toUpperCase(),
    })
      .select("_id")
      .lean();
    if (referrer) referredById = referrer._id as Types.ObjectId;
  }

  const linkedProvider: ILinkedProvider = {
    provider: input.provider,
    providerUserId: input.providerUserId,
    email,
    linkedAt: new Date(),
  };

  return await runInTransaction(async (session) => {
    const user = new User({
      name: baseName,
      username,
      email,
      role: "student",
      emailVerified: true,
      linkedProviders: [linkedProvider],
      referredBy: referredById ?? undefined,
      oauthPicture: input.oauthPicture,
    });

    await user.save({ session });
    return user;
  });
}

/**
 * Resolves a user by ID or Student ID using an $or query.
 */
export const resolveStudentUser = async (
  studentId?: string,
  userId?: string | Types.ObjectId,
) => {
  const conditions: any[] = [];
  if (userId && isValidObjectId(userId)) {
    conditions.push({ _id: userId });
  }
  if (studentId) {
    const clean = studentId.trim().replace(/\D/g, "");
    if (clean) {
      conditions.push({ studentId: clean });
    }
  }
  if (conditions.length === 0) return null;
  return await User.findOne({ $or: conditions }).lean();
};
