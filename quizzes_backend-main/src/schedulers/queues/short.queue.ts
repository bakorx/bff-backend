import { BaseQueue } from "./base.queue";

/**
 * Short Queue — fast, latency-sensitive background tasks.
 *
 * Flushed every minute by the scheduler.
 * Concurrency: 5 concurrent jobs.
 *
 * --- Registered job types (handlers to be implemented) ---
 *
 * "email:waitlist_joined"
 *   Trigger: user successfully joins the waitlist.
 *   Payload: { email, name }
 *   Action:  Render WaitlistWelcomeEmail template and send via nodemailer.
 *
 * "email:welcome"
 *   Trigger: new user signs up (auth/controllers.ts register handler).
 *   Payload: { userId, email, name }
 *   Action:  Render WelcomeEmail template and send via nodemailer.
 *
 * "email:verification"
 *   Trigger: user requests email verification / OTP.
 *   Payload: { userId, email, otp, expiresAt }
 *   Action:  Send OTP / verification link email.
 *
 * "email:newsletter_single"
 *   Trigger: admin approves and dispatches an EmailUpdate document.
 *   Payload: { emailUpdateId, recipientEmail, recipientName }
 *   Action:  Render NewsletterEmail template and send to one recipient.
 *
 * "email:subscription_expiry_warning"
 *   Trigger: daily sweep finds subscriptions expiring within 3 days.
 *   Payload: { userId, email, name, expiresAt }
 *   Action:  Send subscription expiry warning email.
 *
 * "email:payment_confirmation"
 *   Trigger: Paystack webhook confirms a successful payment.
 *   Payload: { userId, email, name, amount, currency, reference }
 *   Action:  Send payment receipt / subscription activated email.
 *
 * "email:ai_draft_review_notify"
 *   Trigger: dispatched by "email:ai_draft_generate" (long queue) once the
 *            draft is saved.
 *   Payload: { emailUpdateId, requestedBy, subject }
 *   Action:  Send an in-app notification (and optionally an email) to the
 *            requestedBy user indicating their AI-generated draft is ready
 *            for review in the admin panel.
 *
 * "email:draft_state_change"
 *   Trigger: admin approves or rejects a draft email update.
 *   Payload: { emailUpdateId, requestedBy, status: 'approved' | 'rejected', rejectionReason? }
 *   Action:  Notify the requestedBy user of the decision.  If approved,
 *            also enqueue "email:newsletter_bulk" on the long queue so the
 *            email is dispatched to recipients.
 *
 * "token:cleanup_user"
 *   Trigger: user logs out, or token refresh is called.
 *   Payload: { userId }
 *   Action:  Delete all expired Token documents for the user.
 *
 * "notification:ai_credits_low"
 *   Trigger: after every AI query, if creditsRemaining drops below threshold.
 *   Payload: { userId, email, creditsRemaining }
 *   Action:  Send low-credit warning notification email.
 */
export const shortQueue = new BaseQueue("short-queue", 5);
