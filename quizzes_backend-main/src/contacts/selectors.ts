import { Types } from "mongoose";
import { Contact } from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";

export const getContactByEmail = (email: string) =>
  Contact.findOne({ email: email.toLowerCase() }).lean();

export const getContactById = (id: string | Types.ObjectId) =>
  Contact.findById(id).lean();

/** Active waitlist contacts only */
export const getWaitlistContacts = (options?: IPaginationOptions) =>
  applySearchFilters(
    Contact.find({ isWaitlist: true, waitlistStatus: "active" }).lean(),
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      searchFields: ["email", "name"],
      ...options,
    },
  );

/** Active newsletter subscribers only */
export const getNewsletterContacts = (options?: IPaginationOptions) =>
  applySearchFilters(
    Contact.find({ isNewsletter: true, newsletterStatus: "active" }).lean(),
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      searchFields: ["email", "name"],
      ...options,
    },
  );

/**
 * All contacts who are active on EITHER lane — used for "all" campaign audience.
 * Because a contact is a single document, each email is fetched exactly once —
 * no duplicate sends possible.
 */
export const getAllActiveContacts = (options?: IPaginationOptions) =>
  applySearchFilters(
    Contact.find({
      $or: [
        { isWaitlist: true, waitlistStatus: "active" },
        { isNewsletter: true, newsletterStatus: "active" },
      ],
    }).lean(),
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      searchFields: ["email", "name"],
      ...options,
    },
  );

export const getAllContacts = (options?: IPaginationOptions) =>
  applySearchFilters(Contact.find().lean(), {
    sortBy: "createdAt",
    sortOrder: "desc",
    searchFields: ["email", "name"],
    ...options,
  });
