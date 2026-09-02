import { Types } from "mongoose";
import { Contact } from "@/contacts";
import { Upload, Migration } from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";

// --- UPLOAD SELECTORS ---
export const getUploadById = (id: string | Types.ObjectId) =>
  Upload.findById(id).lean();
export const getAllUploads = (options?: IPaginationOptions) =>
  applySearchFilters(Upload.find().lean(), {
    searchFields: ["filename"],
    ...options,
  });

// --- WAITLIST SELECTORS ---
export const getWaitlistEntryById = (id: string | Types.ObjectId) =>
  Contact.findById({ id, isWaitlist: true }).lean();
export const getWaitlistEntryByEmail = (email: string) =>
  Contact.findOne({ email: email.toLowerCase(), isWaitlist: true }).lean();
export const getAllWaitlistEntries = (options?: IPaginationOptions) =>
  applySearchFilters(Contact.find({ isWaitlist: true }).lean(), {
    searchFields: ["email", "name"],
    ...options,
  });

// --- NEWSLETTER SELECTORS ---
export const getNewsletterSubscriberByEmail = (email: string) =>
  Contact.findOne({ email: email.toLowerCase(), isNewsletter: true }).lean();
export const getNewsletterSubscriberByConfirmationToken = (token: string) =>
  Contact.findOne({ confirmationToken: token, isNewsletter: true }).lean();
export const getNewsletterSubscriberByUnsubscribeToken = (token: string) =>
  Contact.findOne({ unsubscribeToken: token }).lean();
export const getAllNewsletterSubscribers = (options?: IPaginationOptions) =>
  applySearchFilters(Contact.find({ isNewsletter: true }).lean(), {
    searchFields: ["email", "name"],
    ...options,
  });

// --- MIGRATION SELECTORS ---
export const getMigrationByName = (name: string) =>
  Migration.findOne({ name }).lean();
export const getAllMigrations = (options?: IPaginationOptions) =>
  applySearchFilters(Migration.find().sort({ runAt: -1 }).lean(), options);
