import { Types } from "mongoose";
import * as fs from "fs";
import * as path from "path";
import {
  Contact,
  services as contactServices,
  ContactSource,
} from "@/contacts";
import { getPaginatedMetadata, IPaginationOptions } from "@/utils";
import { Upload, Migration } from "./models";
import * as selectors from "./selectors";
import { logger } from "@/config";

export const processAndSaveUpload = async (
  file: Express.Multer.File,
  folder: string,
  uploadedBy?: string | Types.ObjectId,
) => {
  const url = file.path;
  logger.info(`[System:Upload] File uploaded to: ${url}`);

  const uploadDoc = await Upload.create({
    url,
    originalFilename: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    folder,
    uploadedBy,
  });

  return uploadDoc;
};

type WaitlistInput = {
  email?: string;
  name?: string;
};

// ---------------------------------------------------------------------------
// Waitlist — delegates to contacts domain
// ---------------------------------------------------------------------------

export const createWaitlistEntry = async (data: Partial<WaitlistInput>) => {
  const { contact } = await contactServices.joinWaitlist({
    email: data.email!,
    name: data.name,
    source: "landing_hero",
  });
  return contact;
};

export const joinWaitlistSafely = async (data: Partial<WaitlistInput>) => {
  const { contact, isNew } = await contactServices.joinWaitlist({
    email: data.email!,
    name: data.name,
    source: "landing_hero",
  });
  return { entry: contact, isNew };
};

export const updateWaitlistEntry = async (
  id: string | Types.ObjectId,
  data: Partial<WaitlistInput>,
) => {
  return await Contact.findByIdAndUpdate(id, data, { returnDocument: "after" });
};

export const deleteWaitlistEntry = async (id: string | Types.ObjectId) => {
  return await contactServices.removeFromWaitlist(id.toString());
};

// ---------------------------------------------------------------------------
// Newsletter — delegates to contacts domain
// ---------------------------------------------------------------------------

export const subscribeToNewsletter = async (data: {
  email: string;
  source: ContactSource;
  name?: string;
}) => {
  const { contact, alreadyActive } =
    await contactServices.subscribeToNewsletter({
      email: data.email,
      name: data.name,
      source: data.source,
    });
  return { subscriber: contact, alreadyActive };
};

export const confirmNewsletterSubscription = async (token: string) => {
  return await contactServices.confirmNewsletter(token);
};

export const unsubscribeFromNewsletter = async (token: string) => {
  return await contactServices.unsubscribeNewsletter(token);
};

// ---------------------------------------------------------------------------
// Database Migrations
// ---------------------------------------------------------------------------

/**
 * Returns the status of all migrations: paginated history and all pending scripts.
 */
export const getMigrationStatus = async (options: IPaginationOptions = {}) => {
  const { page = 1, limit = 10 } = options;

  // 1. Get paginated history from DB
  const history = await selectors.getAllMigrations(options);
  const total = await Migration.countDocuments(
    options.search ? { name: new RegExp(options.search, "i") } : {},
  );
  const meta = getPaginatedMetadata(total, page, limit);

  // 2. Identify pending scripts from filesystem
  const scriptsDir = path.join(__dirname, "..", "migrations", "scripts");
  let pending: string[] = [];

  if (fs.existsSync(scriptsDir)) {
    const files = fs
      .readdirSync(scriptsDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .sort();
    const fileToMigrationId = (fileName: string) =>
      fileName.replace(/\.(ts|js)$/i, "");
    const scriptIds = files.map(fileToMigrationId);

    // To accurately find pending, we check all successful migrations in DB
    const executed = await Migration.find({ status: "success" })
      .select("migrationId name")
      .lean();
    const executedIds = new Set(
      executed.map((m: any) => m.migrationId || m.name),
    );
    pending = scriptIds.filter((id) => !executedIds.has(id));
  }

  return {
    history: history.map((m) => ({
      ...m,
      startTime:
        m.startTime || (m as any).runAt || (m as any).createdAt || new Date(),
    })),
    pending,
    pagination: meta,
  };
};

export const updateMigrationRecord = async (
  id: string,
  data: Partial<{ status: string; errorMessage: string }>,
) => {
  return await Migration.findByIdAndUpdate(id, data, {
    returnDocument: "after",
  });
};
