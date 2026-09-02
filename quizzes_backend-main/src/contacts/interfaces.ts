import { Document, Types } from "mongoose";

export type WaitlistStatus = "active" | "removed";
export type NewsletterStatus =
  | "pending"
  | "active"
  | "unsubscribed"
  | "bounced";
export type ContactSource =
  | "landing_hero"
  | "landing_cta"
  | "in_app"
  | "manual"
  | "import"
  | "timetable_reminder";

export interface IContact extends Document {
  email: string;
  name?: string;
  studentId?: string;
  source: ContactSource;

  // ── Waitlist lane ───────────────────────────────────────────────────────
  isWaitlist: boolean;
  waitlistStatus: WaitlistStatus;
  waitlistJoinedAt?: Date;

  // ── Newsletter lane ─────────────────────────────────────────────────────
  isNewsletter: boolean;
  newsletterStatus: NewsletterStatus;
  confirmationToken?: string;
  confirmedAt?: Date;
  unsubscribeToken: string;
  unsubscribedAt?: Date;
  bouncedAt?: Date;
  bounceReason?: string;
  subscribedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
