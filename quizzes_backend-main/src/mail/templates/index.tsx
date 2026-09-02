import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Preview,
  Heading,
  Hr,
  Markdown,
  Link,
  Img,
} from "@react-email/components";
import { CONFIG } from "@/config";
import { ENV } from "@/config/env";
import { EmailTemplateProps } from "../interfaces";

const COLORS = {
  // Surface
  background: "#f8fafc",
  surface: "#ffffff",
  surfaceMuted: "#f1f5f9",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  // Text
  text: "#0f172a",
  textMuted: "#475569",
  textSubtle: "#64748b",
  textFaint: "#94a3b8",
  // Brand
  brand: "#0C60FC",
  brandDeep: "#0a4fd0",
  emerald: "#16a34a",
  rose: "#ef4444",
  amber: "#f59e0b",
  slate: "#0f172a",
} as const;

const STRIPE_COLORS = [COLORS.brand, COLORS.slate, COLORS.emerald] as const;

const CATEGORY_LABELS: Record<string, string> = {
  waitlist: "WAITLIST",
  newsletter: "NEWSLETTER",
  system: "SYSTEM",
  auth: "AUTHENTICATION",
  security: "SECURITY",
  transactional: "TRANSACTIONAL",
};

// Qubi mascot URL — falls back to none if Cloudinary URL isn't configured.
const QUBI_PEEK_URL = ENV.EMAIL_QUBI_PEEK_URL;
const QUBI_STUDY_URL = ENV.EMAIL_QUBI_STUDY_URL;
const QUBI_WAVE_URL = ENV.EMAIL_QUBI_WAVE_URL;

const pickQubiFor = (type: EmailTemplateProps["type"]): string | null => {
  if (!QUBI_PEEK_URL && !QUBI_STUDY_URL && !QUBI_WAVE_URL) return null;
  if (type === "payment_receipt" || type === "donation_thank_you") {
    return QUBI_WAVE_URL || QUBI_STUDY_URL || QUBI_PEEK_URL || null;
  }
  if (
    type === "reset_password" ||
    type === "alert" ||
    type === "security"
  ) {
    return QUBI_PEEK_URL || QUBI_STUDY_URL || null;
  }
  if (type === "confirmation" || type === "welcome") {
    return QUBI_STUDY_URL || QUBI_WAVE_URL || null;
  }
  return QUBI_WAVE_URL || QUBI_STUDY_URL || null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EmailTemplate = ({
  category,
  type,
  title,
  content,
  markdownBody,
  email,
  unsubscribeToken,
  links = [],
  name,
  variables = {},
}: EmailTemplateProps) => {
  const unsubscribeUrl = unsubscribeToken
    ? `${CONFIG.FRONTEND_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`
    : "";

  const categoryLabel =
    CATEGORY_LABELS[category] ?? category.toUpperCase();

  const qubiUrl = pickQubiFor(type);

  const markdownCustomStyles = {
    h1: {
      fontSize: "22px",
      fontWeight: "800" as const,
      lineHeight: "1.25",
      letterSpacing: "-0.025em",
      color: COLORS.text,
      margin: "16px 0 10px",
    },
    h2: {
      fontSize: "17px",
      fontWeight: "700" as const,
      lineHeight: "1.35",
      color: COLORS.text,
      margin: "14px 0 8px",
    },
    h3: {
      fontSize: "15px",
      fontWeight: "700" as const,
      lineHeight: "1.4",
      color: COLORS.text,
      margin: "12px 0 6px",
    },
    p: {
      margin: "0 0 12px",
      fontSize: "14px",
      lineHeight: "1.6",
      color: COLORS.textMuted,
    },
    ul: { margin: "0 0 12px", paddingLeft: "20px" },
    ol: { margin: "0 0 12px", paddingLeft: "20px" },
    li: {
      marginBottom: "6px",
      fontSize: "14px",
      color: COLORS.textMuted,
    },
    a: {
      color: COLORS.brand,
      fontWeight: "600" as const,
      textDecoration: "underline",
    },
    strong: { color: COLORS.text, fontWeight: "700" as const },
    hr: { borderColor: COLORS.border, margin: "20px 0" },
  };

  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={mainBodyStyle}>
        <Container style={containerStyle}>
          {/* Top accent stripe */}
          <div style={stripeBarStyle}>
            {STRIPE_COLORS.map((c, i) => (
              <div
                key={i}
                style={{ flex: 1, backgroundColor: c, height: "4px" }}
              />
            ))}
          </div>

          <div style={contentPaddingStyle}>
            {/* Header: Qubi + wordmark */}
            <div style={logoBlockStyle}>
              {qubiUrl && (
                <Img
                  src={qubiUrl}
                  alt="Qubi — Qz mascot"
                  width="36"
                  height="36"
                  style={qubiImageStyle}
                />
              )}
              <div style={logoTextStackStyle}>
                <Text style={logoTextStyle}>
                  Qz<span style={logoAccentStyle}>·</span>
                </Text>
                <Text style={logoSubtextStyle}>
                  BETA<span style={{ color: COLORS.textFaint }}>FORGE</span>{" "}
                  LABS
                </Text>
              </div>
            </div>

            <Hr style={headerDividerStyle} />

            {/* Title block */}
            <div style={titleBlockStyle}>
              <Heading style={titleStyle}>{title}</Heading>
            </div>

            {/* Greeting */}
            <Text style={greetingStyle}>
              Hello{" "}
              <span style={{ color: COLORS.brand, fontWeight: "700" }}>
                {name || "there"}
              </span>
              ,
            </Text>

            {/* Receipt / donation branch */}
            {(type === "payment_receipt" ||
              type === "donation_thank_you") && (
              <ReceiptCard variables={variables} type={type} />
            )}

            {/* Token / OTP branch */}
            {(type === "reset_password" || type === "alert") &&
              (variables?.token || variables?.otpCode) && (
                <TokenBox
                  token={variables.token ?? variables.otpCode}
                  kind={
                    type === "reset_password"
                      ? "PASSWORD_RESET_TOKEN"
                      : "VERIFICATION_CODE"
                  }
                  hint={
                    type === "reset_password"
                      ? `Valid for ${variables.expiryLabel || "15 minutes"}. If you did not request this, please ignore this email.`
                      : `Expires in ${variables.expiryLabel || "10 minutes"}. Do not share this code.`
                  }
                  tone={
                    type === "reset_password" ? "rose" : "emerald"
                  }
                />
              )}

            {/* Generic body / markdown branch */}
            {!(
              (type === "payment_receipt" ||
                type === "donation_thank_you") &&
              variables?.itemName
            ) &&
              !(
                (type === "reset_password" || type === "alert") &&
                (variables?.token || variables?.otpCode)
              ) && (
                <div style={contentBoxStyle}>
                  <Markdown
                    markdownContainerStyles={markdownContainerStyle}
                    markdownCustomStyles={markdownCustomStyles}
                  >
                    {markdownBody ||
                      (type === "reset_password"
                        ? `We received a request to reset your password. Use the link below to set a new one. This link will expire in **${variables.expiryLabel || "24 hours"}**.\n\nIf you didn't request this, you can safely ignore this email.`
                        : type === "alert"
                          ? `A security-sensitive action (**${variables.actionName || "on your account"}**) was detected.\n\n**Device:** ${variables.deviceInfo || "Unknown"}\n**Time:** ${new Date().toUTCString()}\n\nIf this wasn't you, please secure your account immediately.`
                          : content)}
                  </Markdown>
                </div>
              )}

            {/* Action buttons */}
            {links && links.length > 0 && (
              <div style={linksContainerStyle}>
                {links.map((link, idx) => (
                  <Link key={idx} href={link.url} style={buttonStyle}>
                    {link.label} →
                  </Link>
                ))}
              </div>
            )}

            <Hr style={footerHrStyle} />

            {/* Footer */}
            <div style={footerContainerStyle}>
              <div style={stripeBarFooterStyle}>
                {STRIPE_COLORS.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      backgroundColor: c,
                      height: "3px",
                      borderRadius:
                        i === 0
                          ? "2px 0 0 2px"
                          : i === STRIPE_COLORS.length - 1
                            ? "0 2px 2px 0"
                            : "0",
                    }}
                  />
                ))}
              </div>

              <Text style={footerNoteStyle}>
                <strong style={{ color: COLORS.text }}>
                  QZ // {categoryLabel}
                </strong>
                <br />
                This message was sent to {email}. You are receiving this
                because your account is registered on Qz.
              </Text>

              <div style={subFooterStyle}>
                <Text style={subFooterTextStyle}>
                  © {new Date().getFullYear()} BetaForge Labs. All rights
                  reserved.
                </Text>
                <div style={subFooterLinksStyle}>
                  <Link href={CONFIG.FRONTEND_URL} style={subFooterLinkStyle}>
                    Visit Qz
                  </Link>
                  {unsubscribeUrl && (
                    <>
                      {" • "}
                      <Link href={unsubscribeUrl} style={subFooterLinkStyle}>
                        Unsubscribe
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Body>
    </Html>
  );
};

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ReceiptCardProps {
  variables: Record<string, any>;
  type: "payment_receipt" | "donation_thank_you";
}

const ReceiptCard = ({ variables, type }: ReceiptCardProps) => {
  const amountFormatted =
    variables.amountFormatted ||
    (variables.amount ? `GHS ${Number(variables.amount).toFixed(2)}` : "");
  const itemName = variables.itemName || variables.planName || "Your order";
  const invoiceId =
    variables.invoiceId || variables.reference || "N/A";
  const dateFormatted =
    variables.dateFormatted ||
    new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const rows: Array<{ label: string; value: string }> = [
    { label: "INVOICE / REF", value: invoiceId },
    { label: "DATE", value: dateFormatted },
    {
      label: "PAYMENT METHOD",
      value: variables.method || variables.paymentMethod || "Mobile Money",
    },
    ...(variables.promoCode
      ? [{ label: "PROMO CODE", value: String(variables.promoCode) }]
      : []),
    ...(variables.reference && variables.reference !== invoiceId
      ? [{ label: "REFERENCE", value: String(variables.reference) }]
      : []),
  ];

  return (
    <div style={receiptCardStyle}>
      <div style={paidBadgeStyle}>
        <Text style={paidBadgeTextStyle}>
          ✓ {type === "donation_thank_you" ? "THANK YOU" : "PAID"}
        </Text>
      </div>

      <div style={receiptHeroStyle}>
        <Text style={receiptItemNameStyle}>{itemName}</Text>
        {amountFormatted && (
          <Text style={receiptAmountStyle}>{amountFormatted}</Text>
        )}
      </div>

      <Hr style={receiptDividerStyle} />

      <div style={receiptTableStyle}>
        {rows.map((row) => (
          <div key={row.label} style={receiptRowStyle}>
            <Text style={receiptLabelStyle}>{row.label}</Text>
            <Text style={receiptValueStyle}>{row.value}</Text>
          </div>
        ))}
      </div>

      <Hr style={receiptDividerStyle} />

      {variables.activationNote ? (
        <Text style={receiptNoteStyle}>{variables.activationNote}</Text>
      ) : (
        <Text style={receiptNoteStyle}>
          {type === "donation_thank_you"
            ? "Every contribution — big or small — goes directly toward keeping Qz accessible for students across Ghana."
            : "Keep this email as your receipt. For any questions, contact us at support@qz.app and quote your Invoice ID."}
        </Text>
      )}
    </div>
  );
};

interface TokenBoxProps {
  token: string;
  kind: string;
  hint: string;
  tone: "rose" | "emerald";
}

const TokenBox = ({ token, kind, hint, tone }: TokenBoxProps) => {
  const palette =
    tone === "rose"
      ? { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b" }
      : { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" };

  return (
    <div
      style={{
        ...tokenBoxStyle,
        backgroundColor: palette.bg,
        borderColor: palette.border,
      }}
    >
      <Text
        style={{
          ...tokenBoxLabelStyle,
          color: palette.text,
        }}
      >
        {kind}
      </Text>
      <Text
        style={{
          ...tokenCodeStyle,
          color: palette.text,
        }}
      >
        {token}
      </Text>
      <Text style={tokenBoxHintStyle}>{hint}</Text>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const mainBodyStyle = {
  backgroundColor: COLORS.background,
  fontFamily:
    '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: "32px 16px",
  WebkitFontSmoothing: "antialiased" as const,
  color: COLORS.text,
};

const containerStyle = {
  margin: "0 auto",
  backgroundColor: COLORS.surface,
  width: "100%",
  maxWidth: "580px",
  borderRadius: "14px",
  overflow: "hidden" as const,
  border: `1px solid ${COLORS.border}`,
  boxShadow: "0 4px 24px rgba(13, 18, 32, 0.06)",
};

const stripeBarStyle = {
  display: "flex" as const,
  height: "4px",
  width: "100%",
};

const stripeBarFooterStyle = {
  ...stripeBarStyle,
  height: "3px",
  marginBottom: "14px",
};

const contentPaddingStyle = {
  padding: "28px 28px 24px",
};

const logoBlockStyle = {
  display: "flex" as const,
  alignItems: "center" as const,
  gap: "10px",
  marginBottom: "12px",
};

const qubiImageStyle = {
  display: "block" as const,
  borderRadius: "8px",
  objectFit: "contain" as const,
};

const logoTextStackStyle = {
  display: "inline-block" as const,
};

const logoTextStyle = {
  fontSize: "20px",
  fontWeight: "800" as const,
  letterSpacing: "-0.03em",
  color: COLORS.text,
  margin: "0",
  lineHeight: "1.1",
};

const logoAccentStyle = {
  color: COLORS.brand,
  fontWeight: "900" as const,
};

const logoSubtextStyle = {
  fontSize: "7.5px",
  fontWeight: "700" as const,
  letterSpacing: "0.14em",
  color: COLORS.textSubtle,
  margin: "2px 0 0",
};

const headerDividerStyle = {
  borderColor: COLORS.border,
  margin: "12px 0 20px",
};

const titleBlockStyle = {
  marginBottom: "16px",
};

const titleStyle = {
  fontSize: "24px",
  fontWeight: "800" as const,
  lineHeight: "1.25",
  letterSpacing: "-0.025em",
  color: COLORS.text,
  margin: "0",
};

const greetingStyle = {
  fontSize: "15px",
  fontWeight: "600" as const,
  color: COLORS.text,
  margin: "0 0 16px",
};

const contentBoxStyle = {
  margin: "0 0 20px",
};

const markdownContainerStyle = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: COLORS.textMuted,
};

// ── Receipt card ────────────────────────────────────────────────────────────

const receiptCardStyle = {
  backgroundColor: COLORS.surfaceMuted,
  border: `1px solid ${COLORS.border}`,
  borderRadius: "12px",
  padding: "20px",
  margin: "16px 0 24px",
};

const paidBadgeStyle = {
  display: "inline-block" as const,
  border: `1px solid ${COLORS.emerald}`,
  borderRadius: "9999px",
  padding: "4px 10px",
  backgroundColor: "#ecfdf5",
  marginBottom: "14px",
};

const paidBadgeTextStyle = {
  fontSize: "10px",
  fontFamily:
    '"IBM Plex Mono", "Geist Mono", ui-monospace, monospace',
  fontWeight: "700" as const,
  letterSpacing: "0.1em",
  color: COLORS.emerald,
  margin: "0",
};

const receiptHeroStyle = {
  marginBottom: "8px",
};

const receiptItemNameStyle = {
  fontSize: "16px",
  fontWeight: "700" as const,
  color: COLORS.text,
  margin: "0 0 4px",
};

const receiptAmountStyle = {
  fontSize: "28px",
  fontWeight: "800" as const,
  letterSpacing: "-0.03em",
  color: COLORS.text,
  margin: "0",
};

const receiptDividerStyle = {
  borderColor: COLORS.border,
  margin: "14px 0",
};

const receiptTableStyle = {
  margin: "0 0 4px",
};

const receiptRowStyle = {
  display: "flex" as const,
  justifyContent: "space-between" as const,
  alignItems: "center" as const,
  padding: "6px 0",
};

const receiptLabelStyle = {
  fontSize: "11px",
  fontFamily:
    '"IBM Plex Mono", "Geist Mono", ui-monospace, monospace',
  fontWeight: "600" as const,
  color: COLORS.textSubtle,
  margin: "0",
};

const receiptValueStyle = {
  fontSize: "12px",
  fontWeight: "600" as const,
  color: COLORS.text,
  margin: "0",
};

const receiptNoteStyle = {
  fontSize: "12px",
  lineHeight: "1.5",
  color: COLORS.textSubtle,
  margin: "0",
};

// ── Token box ───────────────────────────────────────────────────────────────

const tokenBoxStyle = {
  border: "1px dashed",
  borderRadius: "12px",
  padding: "22px",
  textAlign: "center" as const,
  margin: "20px 0",
};

const tokenBoxLabelStyle = {
  fontSize: "10px",
  fontWeight: "800" as const,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  fontFamily:
    '"IBM Plex Mono", "Geist Mono", ui-monospace, monospace',
  margin: "0 0 6px",
};

const tokenCodeStyle = {
  fontSize: "32px",
  fontWeight: "800" as const,
  letterSpacing: "0.22em",
  fontFamily:
    '"IBM Plex Mono", "Geist Mono", ui-monospace, monospace',
  margin: "4px 0 8px",
};

const tokenBoxHintStyle = {
  fontSize: "11px",
  color: COLORS.textSubtle,
  margin: "0",
};

// ── Buttons ─────────────────────────────────────────────────────────────────

const linksContainerStyle = {
  margin: "20px 0 12px",
};

const buttonStyle = {
  backgroundColor: COLORS.brand,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "700" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block" as const,
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "13px 18px",
  borderRadius: "10px",
  marginBottom: "10px",
  letterSpacing: "0.01em",
  border: `1px solid ${COLORS.brandDeep}`,
};

// ── Footer ──────────────────────────────────────────────────────────────────

const footerHrStyle = {
  borderColor: COLORS.border,
  margin: "24px 0 16px",
};

const footerContainerStyle = {
  margin: "0",
};

const footerNoteStyle = {
  fontSize: "11px",
  lineHeight: "1.55",
  color: COLORS.textFaint,
  margin: "0 0 14px",
};

const subFooterStyle = {
  borderTop: `1px solid ${COLORS.border}`,
  paddingTop: "12px",
};

const subFooterTextStyle = {
  fontSize: "11px",
  color: COLORS.textFaint,
  margin: "0 0 4px",
};

const subFooterLinksStyle = {
  fontSize: "11px",
  color: COLORS.textFaint,
};

const subFooterLinkStyle = {
  color: COLORS.textMuted,
  textDecoration: "underline",
};
