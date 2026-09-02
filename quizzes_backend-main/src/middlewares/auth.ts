import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { STATUS_CODES } from "@/config";
import { ENV } from "@/config/env";
import { JWTPayload } from "./interfaces";  
import { PlatformRole } from "@/users";
import { getUserById } from "@/users/selectors";


/**
 * Basic authentication check - verifies the token is valid and decodes it.
 * Does not make a DB call. Use authenticateUser for routes that need
 * fresh user state from the database.
 */
export const authGuard = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Check for token in Authorization header first (preferred, used by axios/fetch)
    let token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null;

    // Fallback: httpOnly cookie (used by browser clients with withCredentials)
    if (!token && (req as any).cookies?.auth_access) {
      token = (req as any).cookies.auth_access;
    }

    // Fallback: check for token in query parameter (used by EventSource for SSE)
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "Authentication token required" });
      return;
    }

    const decoded = jwt.verify(token, ENV.ACCESS_TOKEN_SECRET) as JWTPayload;

    req.user = {
      id: decoded.id,
      name: decoded.name,
      role: decoded.role,
      isBanned: decoded.isBanned,
      isSubscribed: decoded.isSubscribed || false,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(STATUS_CODES.UNAUTHORIZED).json({ message: "Token expired" });
      return;
    }
    res.status(STATUS_CODES.UNAUTHORIZED).json({ message: "Invalid token" });
  }
};

export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if ((req as any).cookies?.auth_access) {
      token = (req as any).cookies.auth_access;
    }

    if (!token) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "Authentication token required" });
      return;
    }
    const decoded = jwt.verify(token, ENV.ACCESS_TOKEN_SECRET) as JWTPayload;

    const userDoc = await getUserById(decoded.id);
    if (!userDoc) {
      res
        .status(STATUS_CODES.UNAUTHORIZED)
        .json({ message: "User account not found" });
      return;
    }

    if (userDoc.isBanned) {
      res
        .status(STATUS_CODES.FORBIDDEN)
        .json({ message: "Account has been suspended" });
      return;
    }

    // await invalidateMultipleSessions(token);

    req.user = {
      id: (userDoc._id as any).toString(),
      name: userDoc.name,
      role: userDoc.role as PlatformRole,
      isBanned: userDoc.isBanned as boolean,
      isSubscribed: userDoc.isSubscribed,
    };

    next();
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(STATUS_CODES.UNAUTHORIZED).json({ message: "Token expired" });
      return;
    }
    res
      .status(STATUS_CODES.UNAUTHORIZED)
      .json({ message: error.message || "Invalid token" });
  }
};

/**
 * Optional authentication - populates req.user if a valid token is provided,
 * but does not error if it is missing or invalid.
 */
export const attachUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, ENV.ACCESS_TOKEN_SECRET) as JWTPayload;

      req.user = {
        id: decoded.id,
        name: decoded.name,
        role: decoded.role,
        isBanned: decoded.isBanned,
        isSubscribed: decoded.isSubscribed || false,
      };
    }
  } catch (error) {
    // Silently ignore token errors for optional auth
  } finally {
    next();
  }
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res
          .status(STATUS_CODES.UNAUTHORIZED)
          .json({ message: "Authentication required" });
        return;
      }

      if (req.user.role === "super_admin") {
        return next();
      }

      const hasRole = !!req.user.role && allowedRoles.includes(req.user.role);

      if (!hasRole) {
        res
          .status(STATUS_CODES.FORBIDDEN)
          .json({ message: "Insufficient permissions to access this route" });
        return;
      }

      next();
    } catch (error) {
      res
        .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Authorization process failed" });
    }
  };
};

/**
 * Middleware to verify the requesting user has access to institution-scoped routes.
 * Institution hierarchy has been removed; this middleware is now a compatibility no-op.
 */
export const authorizeInstitution = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res
          .status(STATUS_CODES.UNAUTHORIZED)
          .json({ message: "Authentication required" });
        return;
      }

      if (req.user.role === "super_admin") {
        return next();
      }
      return next();
    } catch (error) {
      res.status(500).json({ message: "Institution authorization failed" });
    }
  };
};