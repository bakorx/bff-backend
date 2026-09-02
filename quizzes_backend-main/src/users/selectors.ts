import { Types } from "mongoose";
import { User, Token, EmailUpdate } from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";

// --- USER SELECTORS ---
export const getUserById = (id: string | Types.ObjectId) => User.findById(id).populate('profilePicture').lean();
export const getUserByEmail = (email: string) => User.findOne({ email: email.toLowerCase() }).populate('profilePicture').lean();
export const getUserByUsername = (username: string) => User.findOne({ username }).populate('profilePicture').lean();
export const getUserByIdentifier = (identifier: string) => {
  const lowerIdentifier = identifier.toLowerCase();
  return User.findOne({
    $or: [
      { email: lowerIdentifier },
      { username: lowerIdentifier }
    ]
  }).populate('profilePicture').lean();
};
export const getUserByAuthKey = (authKey: string) => User.findOne({ authKey: authKey.toLowerCase() }).lean();
export const getUserByReferralCode = (referralCode: string) => User.findOne({ referralCode }).lean();
export const getAllUsers = (options?: IPaginationOptions) =>
  applySearchFilters(User.find().lean(), {
    searchFields: ["username", "email", "name"],
    ...options,
  });

export const countUsers = (options?: IPaginationOptions) => {
  const { page, limit, sortBy, sortOrder, ...filters } = options || {};
  return applySearchFilters(User.find(), {
    ...filters,
    searchFields: ["username", "email", "name"],
  }).countDocuments();
};

// --- TOKEN SELECTORS ---
export const getActiveTokensByUserId = (userId: string | Types.ObjectId) => Token.findOne({ userId }).lean();
export const getTokenByAccess = (accessToken: string) => Token.findOne({ accessToken }).lean();
export const getTokenByRefresh = (refreshToken: string) => Token.findOne({ refreshToken }).lean();

// --- EMAIL UPDATE SELECTORS ---
export const getEmailUpdateById = (id: string | Types.ObjectId) => EmailUpdate.findById(id).lean();
export const getPendingEmailUpdates = (options?: IPaginationOptions) => applySearchFilters(EmailUpdate.find({ status: 'approved' }).lean(), options);

