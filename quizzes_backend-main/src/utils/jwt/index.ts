import jwt, { SignOptions } from "jsonwebtoken";
import { ENV } from "@/config/env";

/**
 * Sign an Access Token (default 1d)
 */
export function signAccessToken(
  payload: Record<string, any>,
  options: SignOptions = {},
): string {
  return jwt.sign(payload, ENV.ACCESS_TOKEN_SECRET, {
    expiresIn: "1d",
    ...options,
  });
}

/**
 * Sign a Refresh Token (default 7d)
 */
export function signRefreshToken(
  payload: Record<string, any>,
  options: SignOptions = {},
): string {
  return jwt.sign(payload, ENV.REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
    ...options,
  });
}


/**
 * Verify a JWT token. Defaults to Access Secret if no custom secret is provided.
 */
export function verifyJwtToken<T = any>(
  token: string,
  customSecret?: string,
): T | null {
  try {
    const secret = customSecret || ENV.ACCESS_TOKEN_SECRET;
    return jwt.verify(token, secret) as T;
  } catch (error) {
    return null;
  }
}

/**
 * Decode a JWT token without signature verification.
 */
export function decodeJwtToken<T = any>(token: string): T | null {
  try {
    return jwt.decode(token) as T;
  } catch (error) {
    return null;
  }
}
