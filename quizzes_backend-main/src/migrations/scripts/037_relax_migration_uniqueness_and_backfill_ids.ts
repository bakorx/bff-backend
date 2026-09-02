import { Mongoose } from "mongoose";
import { logger } from "@/config";

export const dependsOn = ["036_normalize_study_room_host_role"];

const toMigrationId = (name: string): string =>
  String(name || "").replace(/\.(ts|js)$/i, "");

export async function up(mongoose: Mongoose) {
  logger.info(
    "Starting migration: 037_relax_migration_uniqueness_and_backfill_ids...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const migrationsCollection = db.collection("migrations");

  const indexes = await migrationsCollection.indexes();
  const uniqueNameIndex = indexes.find(
    (index) => index.unique === true && index.key?.name === 1,
  );
  if (uniqueNameIndex?.name) {
    await migrationsCollection.dropIndex(uniqueNameIndex.name);
    logger.info(`[037] Dropped unique index: ${uniqueNameIndex.name}`);
  }

  const docs = await migrationsCollection.find({}).toArray();
  for (const doc of docs) {
    const migrationId = toMigrationId(doc.migrationId || doc.name);
    const fileName =
      typeof doc.fileName === "string" && doc.fileName.length > 0
        ? doc.fileName
        : typeof doc.name === "string" &&
            (doc.name.endsWith(".ts") || doc.name.endsWith(".js"))
          ? doc.name
          : undefined;

    await migrationsCollection.updateOne(
      { _id: doc._id },
      {
        $set: {
          name: migrationId,
          migrationId,
          ...(fileName ? { fileName } : {}),
        },
      },
    );
  }

  logger.info("[037] Completed migration records normalization.");
}

export async function down(_mongoose: Mongoose) {
  logger.info(
    "Down migration for 037: No-op (cannot safely restore unique name index).",
  );
}
