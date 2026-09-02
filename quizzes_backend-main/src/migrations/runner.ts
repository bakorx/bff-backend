import mongoose from "mongoose";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { logger, CONFIG } from "@/config";
dotenv.config();
import { Migration, IMigration } from "@/system";

export interface MigrationStatus {
  executed: IMigration[];
  pending: string[];
}

type MigrationModule = {
  up?: (mongooseInstance: typeof mongoose) => Promise<void>;
  dependsOn?: string[];
};

type MigrationScript = {
  id: string;
  fileName: string;
  module: MigrationModule;
  dependsOn: string[];
};

const SCRIPTS_DIR = path.join(__dirname, "scripts");

const toMigrationId = (fileName: string): string =>
  fileName.replace(/\.(ts|js)$/i, "");

const isScriptFile = (fileName: string): boolean =>
  fileName.endsWith(".ts") || fileName.endsWith(".js");

const listMigrationScriptFiles = (): string[] => {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  return fs.readdirSync(SCRIPTS_DIR).filter(isScriptFile).sort();
};

const loadMigrationScript = (fileName: string): MigrationScript => {
  const fullPath = path.join(SCRIPTS_DIR, fileName);
  const migrationModule = require(fullPath) as MigrationModule;
  const dependsOn = Array.isArray(migrationModule.dependsOn)
    ? migrationModule.dependsOn
    : [];

  return {
    id: toMigrationId(fileName),
    fileName,
    module: migrationModule,
    dependsOn,
  };
};

const ensureDependenciesResolvable = (
  scripts: MigrationScript[],
  successfulIds: Set<string>,
): void => {
  const knownIds = new Set(scripts.map((script) => script.id));
  for (const script of scripts) {
    for (const dep of script.dependsOn) {
      if (!knownIds.has(dep) && !successfulIds.has(dep)) {
        throw new Error(
          `Migration "${script.id}" has unknown dependency "${dep}".`,
        );
      }
    }
  }
};

const ensureMigrationCollectionSupportsReruns = async (): Promise<void> => {
  const collection = Migration.collection;
  const indexes = await collection.indexes();
  const legacyUniqueNameIndex = indexes.find(
    (index: any) => index.unique === true && index.key?.name === 1,
  );

  if (legacyUniqueNameIndex?.name) {
    await collection.dropIndex(legacyUniqueNameIndex.name);
    logger.info(
      `[migrations] Dropped legacy unique index on name: ${legacyUniqueNameIndex.name}`,
    );
  }
};

/**
 * Returns the status of all migrations: executed and pending.
 */
export async function getMigrationStatus(): Promise<MigrationStatus> {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    return { executed: [], pending: [] };
  }

  const files = listMigrationScriptFiles();
  const scriptIds = files.map(toMigrationId);

  const executed = await Migration.find({ status: "success" })
    .sort({ runAt: 1 })
    .lean();
  const executedIds = new Set(
    executed.map((m: any) => (m.migrationId as string) || (m.name as string)),
  );

  const pending = scriptIds.filter((id) => !executedIds.has(id));

  return { executed: executed as unknown as IMigration[], pending };
}

export interface MigrationResult {
  success: boolean;
  executed: string[];
  error?: string;
}

export interface RunMigrationsOptions {
  rerun?: boolean;
  migrationIds?: string[];
}

/**
 * Executes all pending migrations.
 * @param externalMongoose Optional existing mongoose instance.
 * If not provided, it will connect to MONGO_URI and disconnect when finished.
 */
export async function runMigrations(
  externalMongoose?: typeof mongoose,
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> {
  const rerun = options.rerun === true;
  const targetMigrationIds = Array.isArray(options.migrationIds)
    ? options.migrationIds.filter((id): id is string => typeof id === "string")
    : [];
  const targetIdSet = new Set(targetMigrationIds);
  const m = externalMongoose || mongoose;
  const mongoUri = CONFIG.DATABASE.MONGO_URI || "mongodb://localhost:27017/quizzes";

  const result: MigrationResult = {
    success: true,
    executed: [],
  };

  let didConnect = false;
  try {
    const isConnected = m.connection.readyState >= 1;

    if (!isConnected) {
      logger.info("Connecting to database for migrations...");
      await m.connect(mongoUri);
      logger.info("Connected.");
      didConnect = true;
    }

    // Ensure older DBs with a unique `name` index can rerun migrations.
    await ensureMigrationCollectionSupportsReruns();

    const successfulMigrationDocs = await Migration.find({
      status: "success",
    })
      .select("migrationId name")
      .lean();
    const successfulIds = new Set(
      successfulMigrationDocs.map(
        (doc: any) => (doc.migrationId as string) || (doc.name as string),
      ),
    );

    const scriptFiles = listMigrationScriptFiles();
    const scripts = scriptFiles.map(loadMigrationScript);
    ensureDependenciesResolvable(scripts, successfulIds);

    if (targetIdSet.size > 0) {
      const knownScriptIds = new Set(scripts.map((script) => script.id));
      const unknownTargets = Array.from(targetIdSet).filter(
        (id) => !knownScriptIds.has(id),
      );
      if (unknownTargets.length > 0) {
        throw new Error(
          `Unknown migration target(s): ${unknownTargets.join(", ")}`,
        );
      }
    }

    const scriptsToRun = scripts.filter((script) => {
      if (targetIdSet.size > 0 && !targetIdSet.has(script.id)) {
        return false;
      }
      return rerun ? true : !successfulIds.has(script.id);
    });

    if (scriptsToRun.length === 0) {
      logger.info("No pending migrations found.");
      return result;
    }

    for (const script of scriptsToRun) {
      const unmetDependencies = script.dependsOn.filter(
        (dep) => !successfulIds.has(dep),
      );
      if (unmetDependencies.length > 0) {
        throw new Error(
          `Cannot run migration "${script.id}". Missing dependencies: ${unmetDependencies.join(", ")}`,
        );
      }

      logger.info(`Running migration: ${script.id} (${script.fileName})...`);
      const startTime = new Date();

      // Create a pending record
      const record = await Migration.create({
        name: script.id,
        migrationId: script.id,
        fileName: script.fileName,
        dependsOn: script.dependsOn,
        status: "pending",
        startTime,
      });

      try {
        if (typeof script.module.up === "function") {
          await script.module.up(m);

          record.status = "success";
          record.endTime = new Date();
          record.runAt = new Date();
          await record.save();

          successfulIds.add(script.id);
          result.executed.push(script.id);
          logger.info(`Successfully completed ${script.id}`);
        } else {
          throw new Error(
            `Migration ${script.id} must export an 'up' function.`,
          );
        }
      } catch (err: any) {
        logger.error(`Failed to run migration ${script.id}:`, err);

        record.status = "error";
        record.errorMessage = err.message;
        record.endTime = new Date();
        await record.save();

        result.success = false;
        result.error = err.message;
        throw err; // Stop on first error
      }
    }

    logger.info("All migrations completed successfully.");
  } catch (err: any) {
    logger.error("Migration framework error:", err);
    result.success = false;
    result.error = result.error || err.message;
  } finally {
    if (didConnect) {
      await m.disconnect();
      logger.info("Disconnected from database.");
    }
  }

  return result;
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
