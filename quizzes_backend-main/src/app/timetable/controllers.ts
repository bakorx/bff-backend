import { Request, Response } from "express";
import { sendSuccess, sendError } from "@/utils";
import * as services from "./services";

export const getTimetableOverview = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { semester, academicYear, date } = req.query;

    const result = await services.getTimetableOverview(userId, {
      semester: typeof semester === "string" ? semester : undefined,
      academicYear: typeof academicYear === "string" ? academicYear : undefined,
      date: typeof date === "string" ? date : undefined,
    });

    sendSuccess(
      res,
      "Timetable overview retrieved successfully.",
      result.payload,
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get timetable overview",
      500,
    );
  }
};
