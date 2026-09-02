import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration: Rename `responseTime` → `responseTimeMs` in AiResponse.responses[]
 *
 * Why: The IAIResponse interface uses `responseTimeMs` but the old schema stored
 * the field as `responseTime`. This renames the field in every responses subdocument.
 *
 * Rollback: swap the field names in the $setField / $unsetField expressions.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "Renaming AiResponse.responses[].responseTime → responseTimeMs...",
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("No db object available. Ensure mongoose is connected.");
    return;
  }

  const aiResponsesCollection = db.collection("airesponses");

  // Use an aggregation-pipeline update so we can manipulate array subdocuments.
  // $setField / $unsetField require MongoDB 5.0+.
  const result = await aiResponsesCollection.updateMany(
    { "responses.responseTime": { $exists: true } },
    [
      {
        $set: {
          responses: {
            $map: {
              input: "$responses",
              as: "resp",
              in: {
                $setField: {
                  field: "responseTimeMs",
                  input: {
                    $unsetField: {
                      field: "responseTime",
                      input: "$$resp",
                    },
                  },
                  value: "$$resp.responseTime",
                },
              },
            },
          },
        },
      },
    ],
  );

  logger.info(`Updated ${result.modifiedCount} airesponse document(s).`);
}
