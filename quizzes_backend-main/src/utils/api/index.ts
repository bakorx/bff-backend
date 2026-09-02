import e, { Request, Response, NextFunction } from "express";
import { ZodObject, ZodRawShape, ZodError } from "zod";
import { STATUS_CODES } from "@/config/constants";
import { logger } from "@/config/logger";
import { Query } from "mongoose";

interface IApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  meta?: any;
}

export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  meta?: any,
  statusCode = STATUS_CODES.OK,
) => {
  const response: IApiResponse<T> = {
    success: true,
    message,
    ...(data !== undefined && { data }),
    ...(meta !== undefined && { meta }),
  };
  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  message: string,
  statusCode = STATUS_CODES.BAD_REQUEST,
  errors?: any,
) => {
  const response = {
    success: false,
    message,
    ...(errors !== undefined && { errors }),
  };
  return res.status(statusCode).json(response);
};

export interface IPaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  searchFields?: string[];
  [key: string]: any;
};

export const getPaginationMeta = (
  totalDocuments: number,
  page: number,
  limit: number,
) => {
  return {
    total: totalDocuments,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(totalDocuments / limit),
  };
};

export const validate = (schema: ZodObject<ZodRawShape>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.body = validated;
      return next();
    } catch (error: any) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((issue) => ({
          message: `${issue.path.join(".")} is ${issue.message}`,
        }));
        logger.error(`[Validation] ${errorMessages.map((e) => e.message)}`);
        return sendError(res, "Validation failed", 400, errorMessages);
      }
      logger.error("[Validation] ", error.message);
      return sendError(res, "Internal Server Error", 500);
    }
  };
};

export const applySearchFilters = <Q extends Query<any, any>>(
  mongooseQuery: Q,
  options: IPaginationOptions = {},
) => {
  let query: Query<any, any> = mongooseQuery;
  const {
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
    searchFields = [],
    ...filters
  } = options;

  // Apply specific search
  if (search && searchFields.length > 0) {
    const searchRegex = new RegExp(
      search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    const searchConditions = searchFields.map((field) => ({
      [field]: searchRegex,
    }));
    query = query.find({ $or: searchConditions } as any);
  }

  // Apply custom filters
  // Convert typical string booleans to actual booleans if needed, or rely on caller to pass clean filters
  if (Object.keys(filters).length > 0) {
    query = query.find(filters as any);
  }

  // Apply sorting
  const sortObject: { [key: string]: any } = {};
  sortObject[sortBy] = sortOrder === "desc" ? -1 : 1;
  query = query.sort(sortObject);

  // Apply pagination
  const skip = (page - 1) * limit;
  query = query.skip(skip).limit(Number(limit));

  return query as Q;
};

// Also return total count for full pagination responses
export const getPaginatedMetadata = (
  totalDocuments: number,
  page: number,
  limit: number,
) => {
  return {
    total: totalDocuments,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(totalDocuments / limit),
  };
};
