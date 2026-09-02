import * as fs from "fs";
import * as path from "path";
import { logger } from "@/config";

const args = process.argv.slice(2);
const command = args[0];

if (command === "migrate") {
  const rerun = args.includes("--rerun");
  // Any remaining non-flag args are specific migration ids to run, e.g.
  // `npm run manage -- migrate 061_migrate_active_timetable_bugs --rerun`.
  // With no ids given, all pending migrations run (or all with --rerun).
  const migrationIds = args.slice(1).filter((a) => !a.startsWith("--"));
  require("./migrations/runner")
    .runMigrations(undefined, {
      rerun,
      migrationIds: migrationIds.length > 0 ? migrationIds : undefined,
    })
    .then(() => process.exit(0))
    .catch((err: any) => {
      logger.error(err);
      process.exit(1);
    });
} else if (command === "cleanup-redis") {
  require("./schedulers")
    .longQueue.enqueue("system:redis_cleanup", {})
    .then(() => {
      logger.info("[manage] Successfully enqueued system:redis_cleanup");
      process.exit(0);
    })
    .catch((err: any) => {
      logger.error("[manage] Failed to enqueue cleanup:", err);
      process.exit(1);
    });
} else if (command === "seed:ug") {
  require("./seeds/seed-ug")
    .seedUG()
    .then(() => process.exit(0))
    .catch((err: any) => {
      logger.error(err);
      process.exit(1);
    });
} else if (command === "startapp") {
  const appName = args[1];

  if (!appName) {
    logger.error("Usage: npm run manage startapp <appname>");
    process.exit(1);
  }

  const srcDir = __dirname;
  const appDir = path.join(srcDir, appName);

  if (fs.existsSync(appDir)) {
    logger.error(`Error: Directory 'src/${appName}' already exists.`);
    process.exit(1);
  }

  // Create the main app directory
  fs.mkdirSync(appDir, { recursive: true });

  function capitalize(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  const appNameCap = capitalize(appName);

  // Create basic files with boilerplates
  const files = [
    {
      path: `interfaces.ts`,
      content: `export interface I${appNameCap} {\n  id?: string;\n  // Add your properties here\n}\n`,
    },
    {
      path: `models.ts`,
      content: `import mongoose, { Schema, Document } from 'mongoose';\nimport { I${appNameCap} } from './interface';\n\nexport interface ${appNameCap}Document extends I${appNameCap}, Document {}\n\nconst ${appNameCap}Schema: Schema = new Schema({\n  // Add schema definitions here\n}, { timestamps: true });\n\nexport const ${appNameCap}Model = mongoose.model<${appNameCap}Document>('${appNameCap}', ${appNameCap}Schema);\n`,
    },
    {
      path: `serializers.ts`,
      content: `import {z} from 'zod';\nimport { ${appNameCap}Model } from './models';`,
    },
    {
      path: `selectors.ts`,
      content: `import { ${appNameCap}Model } from './models';\n\nexport class ${appNameCap}Selectors {\n  // Add selector methods here (e.g., to fetch data from DB)\n}\n`,
    },
    {
      path: `services.ts`,
      content: `import { ${appNameCap}Selectors } from './selectors';\n\nexport class ${appNameCap}Service {\n  // Add business logic methods here\n}\n`,
    },
    {
      path: `controllers.ts`,
      content: `import { Request, Response, NextFunction } from 'express';\nimport { ${appNameCap}Service } from './service';\n\nexport class ${appNameCap}Controller {\n  // Add controller methods here\n}\n`,
    },
    {
      path: `routes.ts`,
      content: `import { Router } from 'express';\nimport { ${appNameCap}Controller } from './controller';\n\nconst router = Router();\nconst controller = new ${appNameCap}Controller();\n\n// Define routes here\n// router.get('/', controller.getAll);\n\nexport default router;\n`,
    },
    {
      path: `index.ts`,
      content: `export * from './interfaces';\nexport * from './models';\nexport * from './selectors';\nexport * from './services';\nexport * from './controllers';\nexport * from './routes';\n`,
    },
  ];

  files.forEach((file) => {
    fs.writeFileSync(path.join(appDir, file.path), file.content);
  });

  logger.info(
    `\x1b[32mSuccessfully created app '${appName}' in src/${appName}\x1b[0m`,
  );
}
