export interface MailOptions {
  to: string;
  subject: string;
  template: React.ReactElement;
  fromName?: string;
  fromEmail?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface EmailTemplateProps {
  category:
    | "waitlist"
    | "newsletter"
    | "system"
    | "auth"
    | "security"
    | "transactional";
  type:
    | "update"
    | "promotional"
    | "security"
    | "general"
    | "welcome"
    | "confirmation"
    | "reset_password"
    | "alert"
    | "notification"
    | "payment_receipt"
    | "donation_thank_you"
    | "billing_cycle_summary";
  title: string;
  content: string;
  /** AI-generated Markdown body. When present, replaces the content field. */
  markdownBody?: string;
  email: string;
  unsubscribeToken?: string;
  links?: { label: string; url: string }[];
  name?: string;
  variables?: Record<string, any>;
}