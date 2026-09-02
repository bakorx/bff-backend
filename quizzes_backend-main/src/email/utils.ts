import jwt from "jsonwebtoken";
import { CONFIG } from "@/config";
import { TokenExpiry, EmailLinkTokenPayload } from "./interfaces";

const TOKEN_EXPIRY_MAP: Record<TokenExpiry, string> = {
  transactional: "7d",
  newsletter: "90d",
  default: "30d",
  student_verify: "72h",
};

/**
 * Signs an email link token with the given payload and expiry type.
 */
export const signEmailLinkToken = (
  payload: EmailLinkTokenPayload,
  expiry: TokenExpiry = "default",
): string => {
  const secret = CONFIG.ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error("ACCESS_TOKEN_SECRET is not configured");

  return jwt.sign(payload, secret, {
    expiresIn: TOKEN_EXPIRY_MAP[expiry],
  } as jwt.SignOptions);
};

/**
 * Verifies and decodes an email link token.
 */
export const verifyEmailLinkToken = (token: string): EmailLinkTokenPayload => {
  const secret = CONFIG.ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error("ACCESS_TOKEN_SECRET is not configured");

  return jwt.verify(token, secret) as EmailLinkTokenPayload;
};
