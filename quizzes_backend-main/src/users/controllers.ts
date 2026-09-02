import { Request, Response } from "express";
import { Types } from "mongoose";
import * as services from "./services";
import { services as learningServices } from "@/learning";
import * as selectors from "./selectors";
import { sendSuccess, sendError, getPaginatedMetadata } from "@/utils";
import { services as authServices, TokenUser } from "@/auth";
import { User as UserModel } from "./models";
import { IUpload } from "@/system";
import { services as emailServices } from "@/email";
import { shortQueue, longQueue } from "@/schedulers";
import { emit as emitEvent } from "@/events/services";

// --- USERS ---

export const createUser = async (req: Request, res: Response) => {
  try {
    if (req.body.password) {
      req.body.password = await authServices.hashPassword(req.body.password);
    }
    const user = await services.createUser(req.body);
    sendSuccess(res, "User created successfully", user, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const user = await selectors.getUserById(req.params.id as string);
    if (!user) return sendError(res, "User not found", 404);
    sendSuccess(res, "User retrieved successfully", user);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// Resolves the caller from req.user (set by authGuard/authenticateUser), rather
// than trusting a client-supplied id — the frontend's login/quiz/payment flows
// use this to fetch full profile fields (e.g. quizCredits) not present in the
// slimmer JWT payload returned by /auth/login.
export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, "Unauthorized", 401);

    const user = await selectors.getUserById(userId);
    if (!user) return sendError(res, "User not found", 404);

    // getUserById has no field projection and the User schema doesn't mark
    // password select:false (see the codebase audit), so strip it here rather
    // than ship a new endpoint that leaks the hash.
    const { password: _password, ...safeUser } = user as any;
    sendSuccess(res, "Profile retrieved successfully", safeUser);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const { page, limit, search, role, isSubscribed, isBanned } = req.query;

    const options: any = {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 20,
      search: search as string,
      searchFields: ["name", "email", "username"],
    };

    if (role && role !== "all") options.role = role;
    if (isSubscribed !== undefined) options.isSubscribed = isSubscribed === "true";
    if (isBanned !== undefined) options.isBanned = isBanned === "true";

    const [users, total] = await Promise.all([
      selectors.getAllUsers(options),
      selectors.countUsers(options),
    ]);

    const pagination = getPaginatedMetadata(
      total,
      options.page,
      options.limit,
    );

    sendSuccess(res, "Users retrieved successfully", users, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    if (req.body.password) {
      req.body.password = await authServices.hashPassword(req.body.password);
    }
    const previousUser = await selectors.getUserById(req.params.id as string);
    if (!previousUser) return sendError(res, "User not found", 404);

    // Extract banReason before passing to the DB update — it's email-only, not persisted.
    const { banReason, ...updatePayload } = req.body;

    const user = await services.updateUser(req.params.id as string, updatePayload);
    if (!user) return sendError(res, "User not found", 404);

    // Filter changes and send notifications.
    // Ban takes priority: if a ban is happening, send only the ban email even
    // if the role also changed in the same request (the ban email includes role info).
    const isBanning = updatePayload.isBanned === true && previousUser.isBanned !== true;
    const roleChanged = updatePayload.role && updatePayload.role !== previousUser.role;

    if (isBanning) {
      const templateVariables: Record<string, any> = {
        name: user.name,
        reason: (typeof banReason === "string" && banReason.trim())
          ? banReason.trim()
          : "Violation of platform policies",
      };
      if (roleChanged) {
        templateVariables.newRole = updatePayload.role;
        templateVariables.previousRole = previousUser.role;
      }

      const campaign = await emailServices.sendTransactional({
        campaignType: "account_banned",
        subject: "Your Qz account has been suspended",
        recipient: {
          recipientId: user._id as any,
          email: user.email,
          name: user.name,
        },
        templateVariables,
      });

      await shortQueue.enqueue("email:transactional:send", {
        campaignId: campaign._id.toString(),
        recipientId: user._id.toString(),
        email: user.email,
        templateVariables,
      });
    } else if (roleChanged) {
      const campaign = await emailServices.sendTransactional({
        campaignType: "role_update",
        subject: "Your Qz role has been updated",
        recipient: {
          recipientId: user._id as any,
          email: user.email,
          name: user.name,
        },
        templateVariables: {
          name: user.name,
          newRole: updatePayload.role,
          previousRole: previousUser.role,
        },
      });

      await shortQueue.enqueue("email:transactional:send", {
        campaignId: campaign._id.toString(),
        recipientId: user._id.toString(),
        email: user.email,
        templateVariables: {
          name: user.name,
          newRole: updatePayload.role,
          previousRole: previousUser.role,
        },
      });
    }

    sendSuccess(res, "User updated successfully", user);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const user = await services.deleteUser(req.params.id as string);
    if (!user) return sendError(res, "User not found", 404);
    sendSuccess(res, "User deleted successfully");
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const checkProfile = async (req: Request, res: Response) => {
  try {
    const { username, email, currentPassword } = req.body;
    const userId = req.user?.id;

    const results: any = {};

    if (username) {
      // For general checks, we search for any user with this username excluding the current one if logged in
      const query: any = { username };
      if (userId) query._id = { $ne: userId };

      const existingUser = await UserModel.findOne(query);
      results.username = {
        exists: !!existingUser,
        message: existingUser ? "Username already taken" : "Username available",
      };
    }

    if (email) {
      const query: any = { email: email.toLowerCase() };
      if (userId) query._id = { $ne: userId };

      const existingUser = await UserModel.findOne(query);
      results.email = {
        exists: !!existingUser,
        message: existingUser ? "Email already registered" : "Email available",
      };
    }

    if (currentPassword) {
      if (!userId) {
        results.password = { valid: false, message: "Authentication required" };
      } else {
        const user = await UserModel.findById(userId).select("+password");
        if (!user || !user.password) {
          results.password = {
            valid: false,
            message: "User security record not found",
          };
        } else {
          const isValid = await authServices.verifyPassword(
            currentPassword,
            user.password,
          );
          results.password = {
            valid: isValid,
            message: isValid
              ? "Password verified"
              : "Incorrect current password",
          };
        }
      }
    }

    sendSuccess(res, "Check completed", results);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updateMyProfile = async (req: Request, res: Response) => {
  try {
    const { username, password, currentPassword, profilePicture } = req.body;
    const userId = req.user?.id;

    if (!userId) return sendError(res, "Unauthorized", 401);

    const user = await UserModel.findById(userId).select("+password");
    if (!user || !user.password) return sendError(res, "User not found", 404);

    // Verify current password first
    const isPasswordValid = await authServices.verifyPassword(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid)
      return sendError(res, "Incorrect current password", 400);

    const updateData: any = {};
    if (username) {
      // Check if username taken
      const existingUser = await UserModel.findOne({
        username,
        _id: { $ne: userId },
      });
      if (existingUser) return sendError(res, "Username already taken", 400);
      updateData.username = username;
    }

    if (password) {
      // Logic to hash password is in services but we use it here because services.updateUser is generic
      updateData.password = await authServices.hashPassword(password);
    }

    if (profilePicture) {
      updateData.profilePicture = profilePicture;
    }

    if (req.body.studentId !== undefined) {
      updateData.studentId = req.body.studentId;
      if (
        typeof req.body.studentId === "string" &&
        req.body.studentId.trim().length > 0
      ) {
        longQueue.enqueue("timetable:enroll_user_courses_from_timetable", {
          userId: String(userId),
          studentId: req.body.studentId.trim(),
        });
      }
    }

    if (req.body.bio !== undefined) {
      updateData.bio = req.body.bio;
    }

    if (Object.keys(updateData).length === 0) {
      return sendError(res, "No changes provided", 400);
    }

    const updatedUser = await services.updateUser(userId, updateData);
    if (!updatedUser) return sendError(res, "Update failed", 500);

    // Re-populate and prepare new payload/tokens so frontend is immediately updated
    const populatedUser = await selectors.getUserById(userId);
    if (!populatedUser) return sendError(res, "User record lost", 500);

    const payload: TokenUser = {
      id: (populatedUser._id as any).toString(),
      name: populatedUser.name as string,
      username: populatedUser.username,
      email: populatedUser.email,
      studentId: populatedUser.studentId,
      role: (populatedUser.role as any) || "student",
      isBanned: populatedUser.isBanned as boolean,
      isSubscribed: populatedUser.isSubscribed as boolean,
      profilePicture: (populatedUser.profilePicture as any)?.url,
    };

    const accessToken = await authServices.generateAccessToken(payload);
    // Profile updates usually don't need a 30d refresh token change, but we'll provide a standard one.
    const refreshToken = await authServices.generateRefreshToken(payload);

    await services.updateToken(userId as unknown as string, {
      accessToken,
      refreshToken,
      userId: userId as any,
    });

    sendSuccess(res, "Profile updated successfully", {
      user: payload,
      accessToken,
      refreshToken,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getMyNotificationSettings = async (
  req: Request,
  res: Response,
) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return sendError(res, "Unauthorized", 401);

    const user = await UserModel.findById(userId).select("notificationSettings");
    if (!user) return sendError(res, "User not found", 404);

    sendSuccess(
      res,
      "Notification settings retrieved",
      user.notificationSettings ?? null,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updateMyNotificationSettings = async (
  req: Request,
  res: Response,
) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return sendError(res, "Unauthorized", 401);

    const updatedUser = await services.updateUser(userId, {
      notificationSettings: req.body,
    });

    if (!updatedUser) return sendError(res, "User not found", 404);

    sendSuccess(
      res,
      "Notification settings updated",
      updatedUser.notificationSettings ?? null,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- ONBOARDING ---

export const getOnboardingStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return sendError(res, "Unauthorized", 401);

    const user = await selectors.getUserById(userId);
    if (!user) return sendError(res, "User not found", 404);

    sendSuccess(res, "Onboarding status retrieved", user.onboarding);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updateOnboardingStep = async (req: Request, res: Response) => {
  const { step, data } = req.body;
  const userId = (req as any).user?.id;

  try {
    if (!userId) return sendError(res, "Unauthorized", 401);

    const user = await services.updateOnboardingStep(userId, step, data);
    if (!user) return sendError(res, "Failed to update onboarding step", 500);

    sendSuccess(res, "Onboarding step updated", user.onboarding);
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

// --- ENROLLMENTS ---

export const getMyEnrollments = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { semester, academicYear } = req.query;
    const enrollments = await learningServices.getUserEnrollments(
      userId,
      semester as string,
      academicYear as string,
    );
    sendSuccess(res, "Enrollments retrieved successfully", enrollments);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const enrollMe = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { courseId, semester, academicYear } = req.body;
    if (!courseId || !semester || !academicYear) {
      return sendError(
        res,
        "courseId, semester, and academicYear are required",
        400,
      );
    }
    const enrollment = await learningServices.enrollUserInCourse(
      userId,
      courseId,
      semester,
      academicYear,
    );

    emitEvent(
      "course:enrolled",
      userId,
      { type: "course", id: courseId },
      { semester, academicYear },
    );

    sendSuccess(res, "Enrolled in course successfully", enrollment, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const unenrollMe = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { courseId } = req.params;
    const { semester, academicYear } = req.query;
    if (!semester || !academicYear) {
      return sendError(
        res,
        "semester and academicYear are required in query",
        400,
      );
    }
    await learningServices.unenrollUserFromCourse(
      userId,
      courseId as string,
      semester as string,
      academicYear as string,
    );

    emitEvent(
      "course:unenrolled",
      userId,
      { type: "course", id: courseId as string },
      { semester, academicYear },
    );

    sendSuccess(res, "Unenrolled from course successfully");
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
