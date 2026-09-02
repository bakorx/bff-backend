import { Request, Response } from "express";
import { sendSuccess, sendError } from "@/utils";
import { getStreakStatus, useStreakFreeze } from "./services";

export const getStreak = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const data = await getStreakStatus(userId);
    sendSuccess(res, "Streak status", data);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const freezeStreak = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    await useStreakFreeze(userId);
    sendSuccess(res, "Streak freeze used. Today counts as a study day.");
  } catch (error: any) {
    sendError(res, error.message, error.status ?? 500);
  }
};
