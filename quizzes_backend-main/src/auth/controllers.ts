import { Request, Response } from "express";
import { CONFIG, STATUS_CODES, logger } from "@/config";
import * as services from "./services";
import { selectors as userSelectors, services as userServices, User, IUser, OAuthProvider } from "@/users";
import { services as pushServices } from "@/push";
import { services as emailServices } from "@/email";
import { IUpload } from "@/system";
import { shortQueue } from "@/schedulers";
import { recordStudyActivity } from "@/subscriptions/streak/services";
import { sendError, sendSuccess } from "@/utils";
import { TokenUser } from "./interfaces";

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, username, password, rememberMe } = req.body;
    const loginId = identifier || username;

    if (!loginId) {
      res
        .status(STATUS_CODES.BAD_REQUEST)
        .json({ message: "Identifier (email or username) is required" });
      return;
    }

    const user = await userSelectors.getUserByIdentifier(loginId);

    if (!user) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "User does not exist" });
      return;
    }

    const isValidPassword = await services.verifyPassword(
      password,
      user.password as string,
    );
    if (!isValidPassword) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "Invalid password" });
      return;
    }

    if (user.isBanned) {
      res
        .status(STATUS_CODES.FORBIDDEN)
        .json({ message: "Account has been suspended" });
      return;
    }

    const payload: TokenUser = {
      id: (user._id as any).toString(),
      name: user.name,
      username: user.username,
      email: user.email,
      role: (user.role as any) || "student",
      studentId: user.studentId,
      isBanned: user.isBanned as boolean,
      isSubscribed: user.isSubscribed as boolean,
      profilePicture: user.profilePicture
        ? (user.profilePicture as IUpload).url
        : undefined,
      oauthPicture: user.oauthPicture,
    };

    const refreshTokenExpiry = rememberMe ? "30d" : "7d";
    const accessToken = await services.generateAccessToken(payload);
    const refreshToken = await services.generateRefreshToken(
      payload,
      refreshTokenExpiry,
    );

    await userServices.updateToken(user._id as unknown as string, {
      accessToken,
      refreshToken,
      userId: user._id,
    });
    await userServices.updateUser(user._id as unknown as string, {
      lastLogin: new Date(),
    });

    // Record study activity for streak (fire-and-forget)
    recordStudyActivity(user._id as unknown as string).catch((err) =>
      logger.error("[streak] recordStudyActivity on login error:", err.message),
    );

    if (req.body.endpoint) {
      await pushServices.linkSubscriptionToUser(
        req.body.endpoint,
        (user._id as any).toString(),
      );
    }

    res
      .status(STATUS_CODES.OK)
      .json({ user: payload, accessToken, refreshToken });
  } catch (error) {
    logger.error("Login error:", error);
    res
      .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: "Login process failed" });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.body?.refreshToken;

    if (!refreshToken) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "Refresh token required" });
      return;
    }

    const decoded = await services.verifyRefreshToken(refreshToken);
    if (!decoded) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "Invalid refresh token" });
      return;
    }

    const user = await userSelectors.getUserById(decoded.id);
    if (!user) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "User account not found" });
      return;
    }

    const payload: TokenUser = {
      id: (user._id as any).toString(),
      name: user.name,
      username: user.username,
      email: user.email,
      role: (user.role as any) || "student",
      studentId: user.studentId,
      isBanned: user.isBanned as boolean,
      isSubscribed: user.isSubscribed as boolean,
      profilePicture: user.profilePicture
        ? (user.profilePicture as IUpload).url
        : undefined,
      oauthPicture: user.oauthPicture,
    };

    const accessToken = await services.generateAccessToken(payload);
    await userServices.updateToken(user._id as unknown as string, {
      accessToken,
      refreshToken,
      userId: user._id,
    });

    res
      .status(STATUS_CODES.OK)
      .json({ user: payload, accessToken, refreshToken });
  } catch (error) {
    logger.error("Token refresh error:", error);
    res
      .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: "Token refresh failed" });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  res.status(STATUS_CODES.OK).json({ message: "Logged out successfully" });
};

export const forgotPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res
        .status(STATUS_CODES.BAD_REQUEST)
        .json({ message: "Email is required" });
      return;
    }

    // Silent failure: Always return 200 OK even if user not found to prevent email discovery
    const user = await userSelectors.getUserByEmail(email);
    if (!user) {
      res
        .status(STATUS_CODES.OK)
        .json({ message: "If that email exists, a reset link has been sent" });
      return;
    }

    const resetLink = await services.buildEmailLink(
      "reset-password",
      {
        userId: (user._id as any).toString(),
        email: user.email,
      },
      "transactional",
    );

    const campaign = await emailServices.sendTransactional({
      campaignType: "password_reset",
      recipient: { recipientId: user._id, email: user.email, name: user.name },
      templateVariables: {
        name: user.name || user.username,
        resetLink,
        expiryLabel: "24 hours",
      },
      subject: "Reset your password",
    });

    await shortQueue.enqueue(
      "email:transactional:send",
      {
        campaignId: campaign._id.toString(),
        recipientId: user._id.toString(),
        email: user.email,
        templateVariables: {
          name: user.name || user.username,
          resetLink,
          expiryLabel: "24 hours",
        },
      },
      3,
    );

    res
      .status(STATUS_CODES.OK)
      .json({ message: "If that email exists, a reset link has been sent" });
  } catch (error) {
    logger.error("Forgot password error:", error);
    res
      .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: "Process failed" });
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res
        .status(STATUS_CODES.BAD_REQUEST)
        .json({ message: "Token and new password are required" });
      return;
    }

    let decoded;
    try {
      decoded = await services.verifyEmailLinkToken(token);
    } catch (err) {
      res
        .status(STATUS_CODES.BAD_REQUEST)
        .json({ message: "Invalid or expired reset link" });
      return;
    }

    if (decoded.action !== "reset-password") {
      res
        .status(STATUS_CODES.BAD_REQUEST)
        .json({ message: "Invalid token action" });
      return;
    }

    const user = await userSelectors.getUserById(decoded.userId);
    if (!user) {
      res.status(STATUS_CODES.NOT_FOUND).json({ message: "User not found" });
      return;
    }

    if (
      user.passwordChangedAt &&
      decoded.iat &&
      new Date(decoded.iat * 1000) < user.passwordChangedAt
    ) {
      res
        .status(STATUS_CODES.BAD_REQUEST)
        .json({ message: "This link has already been used or is now invalid" });
      return;
    }

    const hashedPassword = await services.hashPassword(newPassword);
    await userServices.updateUser((user._id as any).toString(), {
      password: hashedPassword,
      passwordChangedAt: new Date(),
    });

    const alertCampaign = await emailServices.sendTransactional({
      campaignType: "security_alert",
      recipient: { recipientId: user._id, email: user.email, name: user.name },
      templateVariables: {
        name: user.name || user.username,
        actionName: "Password Change",
        deviceInfo: req.headers["user-agent"] || "Unknown Device",
      },
      subject: "Security Alert: Your password has been changed",
    });

    await shortQueue.enqueue(
      "email:transactional:send",
      {
        campaignId: alertCampaign._id.toString(),
        recipientId: user._id.toString(),
        email: user.email,
        templateVariables: {
          name: user.name || user.username,
          actionName: "Password Change",
          deviceInfo: req.headers["user-agent"] || "Unknown Device",
        },
      },
      3,
    );

    res.status(STATUS_CODES.OK).json({ message: "Password reset successful" });
  } catch (error) {
    logger.error("Reset password error:", error);
    res
      .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: "Process failed" });
  }
};

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, username, password, referralCode } = req.body;

    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = username.toLowerCase();

    const [existingUserByEmail, existingUserByUsername] = await Promise.all([
      userSelectors.getUserByEmail(normalizedEmail),
      userSelectors.getUserByUsername(normalizedUsername),
    ]);

    if (existingUserByEmail) {
      res
        .status(STATUS_CODES.CONFLICT)
        .json({ message: "An account with this email already exists" });
      return;
    }

    if (existingUserByUsername) {
      res
        .status(STATUS_CODES.CONFLICT)
        .json({ message: "That username is already taken" });
      return;
    }

    // Handle referral linking
    let referredById = null;
    if (referralCode) {
      const referrer = await userSelectors.getUserByReferralCode(
        String(referralCode).toUpperCase(),
      );
      if (referrer) {
        referredById = referrer._id;
      }
    }

    const hashedPassword = await services.hashPassword(password);
    const user = await userServices.createUser({
      name,
      email: normalizedEmail,
      username: normalizedUsername,
      password: hashedPassword,
      referredBy: referredById,
      role: "student",
    } as any);

    const payload: TokenUser = {
      id: (user._id as any).toString(),
      name: user.name,
      username: user.username,
      email: user.email,
      role: "student",
      studentId: user.studentId,
      isBanned: false,
      isSubscribed: false,
    };

    const accessToken = await services.generateAccessToken(payload);
    const refreshToken = await services.generateRefreshToken(payload, "7d");

    await userServices.updateToken((user._id as any).toString(), {
      accessToken,
      refreshToken,
      userId: user._id,
    });

    const campaign = await emailServices.sendTransactional({
      campaignType: "welcome",
      recipient: { recipientId: user._id, email: user.email, name: user.name },
      templateVariables: {
        name: user.name || user.username,
        appUrl: `${CONFIG.FRONTEND_URL}/onboarding`,
      },
      subject: "Welcome to Qz.",
    });

    await shortQueue.enqueue(
      "email:transactional:send",
      {
        campaignId: campaign._id.toString(),
        recipientId: user._id.toString(),
        email: user.email,
        templateVariables: {
          name: user.name || user.username,
          appUrl: `${CONFIG.FRONTEND_URL}/onboarding`,
        },
      },
      3,
    );

    res
      .status(STATUS_CODES.CREATED)
      .json({ user: payload, accessToken, refreshToken });
  } catch (error) {
    logger.error("Signup error:", error);
    res
      .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
      .json({ message: "Signup process failed" });
  }
};

// ---------------------------------------------------------------------------
// OAuth controllers (Phase A: Google)
//
// All responses use the canonical `sendSuccess` / `sendError` envelope from
// `utils/response.util.ts` — see the plan: do NOT also refactor the legacy
// auth controllers in this PR.
//
// Flow:
//   1. Verify the Google id_token (signature, audience, email_verified).
//   2. If a user already owns this (provider, providerUserId) pair, log them in.
//   3. If a user shares the email but no Google link, AUTO-LINK the provider
//      and log them in. Send a notification email so the account owner can
//      detect a takeover from settings. The (provider, providerUserId)
//      uniqueness guard inside `linkProvider` prevents cross-account abuse.
//   4. Brand-new user — create via the OAuth helper and log them in.
// ---------------------------------------------------------------------------

async function buildOAuthTokenPayload(
  user: IUser,
): Promise<TokenUser> {
  return {
    id: (user._id as any).toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    role: (user.role as any) || "student",
    studentId: user.studentId,
    isBanned: user.isBanned as boolean,
    isSubscribed: user.isSubscribed as boolean,
    profilePicture: user.profilePicture
      ? (user.profilePicture as IUpload).url
      : undefined,
    oauthPicture: user.oauthPicture,
  };
}

async function issueAndPersistOAuthTokens(
  userId: string,
  user: IUser,
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = await buildOAuthTokenPayload(user);
  const accessToken = await services.generateAccessToken(payload);
  const refreshToken = await services.generateRefreshToken(payload, "7d");

  await userServices.updateToken(userId, {
    accessToken,
    refreshToken,
    userId: user._id,
  });

  await userServices.updateUser(userId, { lastLogin: new Date() });

  return { accessToken, refreshToken };
}

async function sendAccountLinkedNotificationEmail(opts: {
  user: IUser;
  provider: OAuthProvider;
  providerEmail: string;
}) {
  const { user, provider, providerEmail } = opts;

  const campaign = await emailServices.sendTransactional({
    campaignType: "account_linked",
    subject: `Your Qz account was just signed in with ${provider === "google" ? "Google" : "GitHub"}`,
    recipient: {
      recipientId: user._id,
      email: user.email,
      name: user.name,
    },
    templateVariables: {
      name: user.name || user.username,
      provider: provider === "google" ? "Google" : "GitHub",
      providerEmail,
      accountUrl: `${CONFIG.FRONTEND_URL}/app/settings`,
    },
  });

  await shortQueue.enqueue("email:transactional:send", {
    campaignId: campaign._id.toString(),
    recipientId: user._id.toString(),
    email: user.email,
    templateVariables: {
      name: user.name || user.username,
      provider: provider === "google" ? "Google" : "GitHub",
      providerEmail,
      accountUrl: `${CONFIG.FRONTEND_URL}/app/settings`,
    },
  });
}

async function sendWelcomeEmail(opts: { user: IUser }) {
  const { user } = opts;
  const campaign = await emailServices.sendTransactional({
    campaignType: "welcome",
    recipient: {
      recipientId: user._id,
      email: user.email,
      name: user.name,
    },
    templateVariables: {
      name: user.name || user.username,
      appUrl: `${CONFIG.FRONTEND_URL}/onboarding`,
    },
    subject: "Welcome to Qz.",
  });

  await shortQueue.enqueue("email:transactional:send", {
    campaignId: campaign._id.toString(),
    recipientId: user._id.toString(),
    email: user.email,
    templateVariables: {
      name: user.name || user.username,
      appUrl: `${CONFIG.FRONTEND_URL}/onboarding`,
    },
  });
}

export const oauthGoogleLogin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { idToken, referralCode } = req.body;

    // 1. Verify the Google id_token (signature, audience, email_verified).
    const profile = await services.verifyGoogleIdToken(idToken);

    // 2. If a user already owns this (provider, providerUserId) pair, log them in directly.
    const linkedUser = await User.findOne({
      linkedProviders: {
        $elemMatch: {
          provider: "google" as const,
          providerUserId: profile.providerUserId,
        },
      },
    }).lean<IUser | null>();

    if (linkedUser) {
      const { accessToken, refreshToken } = await issueAndPersistOAuthTokens(
        (linkedUser._id as any).toString(),
        linkedUser,
      );
      sendSuccess(res, "Logged in via Google", {
        user: await buildOAuthTokenPayload(linkedUser),
        accessToken,
        refreshToken,
        status: "logged_in",
      });
      return;
    }

    // 3. If a user shares the email but no Google link, auto-link the provider
    //    and log them in. The (provider, providerUserId) uniqueness guard inside
    //    `linkProvider` is the only thing stopping cross-account abuse here.
    const existingByEmail = await userSelectors.getUserByEmail(profile.email);
    if (existingByEmail) {
      try {
        await userServices.linkProvider(
          (existingByEmail._id as any).toString(),
          {
            provider: "google",
            providerUserId: profile.providerUserId,
            email: profile.email,
            picture: profile.picture,
          },
        );
      } catch (err) {
        if (err instanceof userServices.ProviderAlreadyLinkedError) {
          // The Google account is already linked to a *different* Qz user.
          // Don't link silently — require the user to resolve it.
          sendError(
            res,
            "This Google account is already linked to a different Qz account. Sign in to that account and unlink it first.",
            409,
          );
          return;
        }
        throw err;
      }

      await sendAccountLinkedNotificationEmail({
        user: existingByEmail,
        provider: "google",
        providerEmail: profile.email,
      });

      const refreshed = await userSelectors.getUserById(
        (existingByEmail._id as any).toString(),
      );
      if (!refreshed) {
        sendError(res, "Failed to load linked user", 500);
        return;
      }

      const { accessToken, refreshToken } = await issueAndPersistOAuthTokens(
        (refreshed._id as any).toString(),
        refreshed,
      );

      sendSuccess(res, "Google account linked and logged in", {
        user: await buildOAuthTokenPayload(refreshed),
        accessToken,
        refreshToken,
        status: "logged_in",
      });
      return;
    }

    // 4. Brand-new user — create via the OAuth helper, send welcome, log in.
    const newUser = await userServices.oauthCreateUser({
      provider: "google",
      providerUserId: profile.providerUserId,
      email: profile.email,
      name: profile.name,
      oauthPicture: profile.picture,
      referralCode,
    });

    const refreshed = await userSelectors.getUserById(
      (newUser._id as any).toString(),
    );
    if (!refreshed) {
      sendError(res, "Failed to load newly created user", 500);
      return;
    }

    const { accessToken, refreshToken } = await issueAndPersistOAuthTokens(
      (refreshed._id as any).toString(),
      refreshed,
    );

    await sendWelcomeEmail({ user: refreshed });

    sendSuccess(
      res,
      "Account created via Google",
      {
        user: await buildOAuthTokenPayload(refreshed),
        accessToken,
        refreshToken,
        status: "logged_in",
      },
      null,
      201,
    );
  } catch (err: any) {
    const status = err?.status ?? 500;
    const message = err?.message ?? "OAuth login failed";
    if (status >= 500) {
      logger.error("OAuth Google login error:", err);
    }
    sendError(res, message, status);
  }
};
