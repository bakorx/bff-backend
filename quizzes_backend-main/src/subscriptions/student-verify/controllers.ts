import { Request, Response } from "express";
import { sendSuccess, sendError } from "@/utils";
import {
  initiateStudentVerification,
  confirmStudentVerification,
  getStudentVerificationStatus,
} from "./services";

export const initiateVerification = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { studentEmail } = req.body;

    if (!studentEmail) return sendError(res, "studentEmail is required", 400);

    await initiateStudentVerification(userId, studentEmail);
    sendSuccess(res, "Verification email sent. Check your student inbox.");
  } catch (error: any) {
    sendError(res, error.message, error.status ?? 500);
  }
};

export const confirmVerification = async (req: Request, res: Response) => {
  try {
    const { token } = req.query as { token?: string };
    if (!token) return sendError(res, "token is required", 400);

    await confirmStudentVerification(token);
    sendSuccess(
      res,
      "Student status verified. 10% discount applied to your account.",
    );
  } catch (error: any) {
    sendError(res, error.message, error.status ?? 500);
  }
};

export const getVerificationStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const status = await getStudentVerificationStatus(userId);
    sendSuccess(res, "Student verification status", status);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
