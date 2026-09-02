// Legacy Waitlist and NewsletterSubscriber models have been removed.
// All contact data is now managed by src/contacts/ (Contact model).
// Run migration 013 to backfill existing data into contacts.
// Run migration 014 to drop the legacy collections from the database.

import { Schema, model, Model } from "mongoose";
import { IUpload, IMigration } from "./interfaces";

const UploadSchema = new Schema<IUpload>(
  {
    url: { type: String, required: true },
    originalFilename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    folder: { type: String, required: true, default: "others" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

UploadSchema.index({ uploadedBy: 1 });
UploadSchema.index({ folder: 1 });
UploadSchema.index({ createdAt: -1 });

export const Upload: Model<IUpload> = model<IUpload>("Upload", UploadSchema);

const MigrationSchema = new Schema<IMigration>(
  {
    name: { type: String, required: true },
    migrationId: { type: String },
    fileName: { type: String },
    dependsOn: [{ type: String }],
    status: {
      type: String,
      required: true,
      enum: ["pending", "success", "error"],
      default: "pending",
    },
    errorMessage: { type: String },
    startTime: { type: Date, required: true, default: Date.now },
    endTime: { type: Date },
    runAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

MigrationSchema.index({ status: 1 });
MigrationSchema.index({ runAt: -1 });
MigrationSchema.index({ migrationId: 1 });
MigrationSchema.index({ name: 1 });

export const Migration: Model<IMigration> = model<IMigration>(
  "Migration",
  MigrationSchema
);
