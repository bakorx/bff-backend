import Jwt, { JwtPayload } from "jsonwebtoken";
import bcrypt from "bcrypt";
import axios from "axios";
import { CONFIG } from "@/config";
import { TokenUser } from "./interfaces";
import { PlatformRole, OAuthProvider } from "@/users";

export async function generateAccessToken(user: TokenUser) {
  if (!user || Object.keys(user).length === 0) {
    throw new Error("Invalid user object for access token generation");
  }

  return Jwt.sign(
    {
      id:           user.id,
      name:         user.name,
      username:     user.username,
      email:        user.email,
      role:         user.role ?? "student",
      studentId:    user.studentId,
      isBanned:     user.isBanned,
      isSubscribed: user.isSubscribed,
      profilePicture: user.profilePicture,
      notificationSettings: user.notificationSettings,
    },
    CONFIG.ACCESS_TOKEN_SECRET,
    { expiresIn: "60m" }
  );
}

export async function generateRefreshToken(user: TokenUser, expiresIn: string = "15m") {
  if (!user || Object.keys(user).length === 0) {
    throw new Error("Invalid user object for refresh token generation");
  }

  return Jwt.sign(
    { id: user.id, isBanned: user.isBanned },
    CONFIG.REFRESH_TOKEN_SECRET,
    { expiresIn: expiresIn } as any
  );
}

export async function verifyToken(token: string): Promise<TokenUser | null> {
  try {
    const decoded = (await Jwt.verify(
      token,
      CONFIG.ACCESS_TOKEN_SECRET
    )) as JwtPayload;

    if (!decoded || !decoded.id) {
      throw new Error("Invalid token format");
    }

    return {
      id:           decoded.id,
      name:         decoded.name,
      username:     decoded.username,
      email:        decoded.email,
      role:         decoded.role,
      studentId:    decoded.studentId,
      isBanned:     decoded.isBanned,
      isSubscribed: decoded.isSubscribed,
      profilePicture: decoded.profilePicture,
      notificationSettings: decoded.notificationSettings,
      exp:          decoded.exp,
    };
  } catch (err: any) {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<Pick<TokenUser, "id" | "isBanned"> | null> {
  try {
    const decoded = (await Jwt.verify(
      token,
      CONFIG.REFRESH_TOKEN_SECRET
    )) as JwtPayload;

    if (!decoded || !decoded.id) {
      throw new Error("Invalid token format");
    }

    return { id: decoded.id, isBanned: decoded.isBanned };
  } catch (err: any) {
    return null;
  }
}

/**
 * Generates a JWT link for a specific action (e.g., reset-password).
 * The token typically expires in 24 hours for security.
 */
export async function buildEmailLink(
  action: string,
  data: Record<string, any>,
  expiry: "transactional" | "newsletter" | "default" = "transactional"
) {
  const expiresIn = expiry === "transactional" ? "24h" : "7d";
  const token = Jwt.sign(
    { ...data, action },
    CONFIG.ACCESS_TOKEN_SECRET,
    { expiresIn }
  );

  return `${CONFIG.FRONTEND_URL}/verify-action?t=${token}`;
}

/**
 * Verifies a link-based action token.
 */
export async function verifyEmailLinkToken(token: string) {
  return Jwt.verify(token, CONFIG.ACCESS_TOKEN_SECRET) as JwtPayload & { action: string };
}

export async function hashPassword(password: string) {
  return await bcrypt.hash(password, CONFIG.SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashedPassword: string) {
  return await bcrypt.compare(password, hashedPassword);
}

// ---------------------------------------------------------------------------
// Google id_token verification
//
// We hit Google's `tokeninfo` endpoint with the raw id_token. Google validates
// the JWT signature against its JWKS, then returns the decoded claims. This is
// the documented public endpoint for one-off verification (no library needed).
//
// We additionally enforce:
//   - audience (`aud`) matches our `GOOGLE_CLIENT_ID` — prevents token reuse
//     against a different app's client_id.
//   - `email_verified` is true — Google-issued assertions for unverified
//     emails are not trustworthy for account linking.
//
// See: https://developers.google.com/identity/sign-in/web/devconsole-project
// ---------------------------------------------------------------------------

export interface GoogleProfile {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

interface GoogleTokenInfo {
  sub: string;
  email: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!idToken || typeof idToken !== "string") {
    throw Object.assign(new Error("Missing Google id_token"), { status: 400 });
  }

  let info: GoogleTokenInfo;
  try {
    const res = await axios.get<GoogleTokenInfo>(
      "https://oauth2.googleapis.com/tokeninfo",
      { params: { id_token: idToken }, timeout: 8000 },
    );
    info = res.data;
  } catch {
    throw Object.assign(new Error("Google id_token could not be verified"), {
      status: 401,
    });
  }

  // Issuer must be Google's token-issuing endpoint — anything else is suspect.
  if (!info.iss || !info.iss.startsWith("https://accounts.google.com")) {
    throw Object.assign(new Error("Google id_token issuer is not Google"), {
      status: 401,
    });
  }

  // Audience binding: the token must have been minted for our client_id.
  // CONFIG.GOOGLE_CLIENT_ID is optional in dev so the app still boots; if it's
  // unset, skip the audience check (the route handler will surface a clearer
  // error elsewhere if a login is attempted).
  const expectedAud = CONFIG.GOOGLE.CLIENT_ID;
  if (expectedAud && info.aud !== expectedAud) {
    throw Object.assign(new Error("Google id_token audience mismatch"), {
      status: 401,
    });
  }

  if (!info.email) {
    throw Object.assign(new Error("Google id_token missing email claim"), {
      status: 400,
    });
  }

  // Google returns "true" / "false" strings (not booleans).
  const emailVerified =
    info.email_verified === true || info.email_verified === "true";
  if (!emailVerified) {
    throw Object.assign(
      new Error("Google account email is not verified by Google"),
      { status: 400 },
    );
  }

  return {
    providerUserId: info.sub,
    email: info.email.toLowerCase(),
    emailVerified: true,
    name: info.name,
    picture: info.picture,
  };
}

// ---------------------------------------------------------------------------
// Provider registry — keeps provider names centrally resolvable without
// hard-coding strings across the module.
// ---------------------------------------------------------------------------

export const OAUTH_PROVIDERS: Record<OAuthProvider, true> = {
  google: true,
  github: true, // Phase B — declared so the type system stays forward-compatible
};
