import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 018: Remove institution-hierarchy coupling and normalize roles.
 *
 * What this migration does:
 * 1) Normalizes legacy role values to the new platform roles:
 *    - uni_admin/admin/staff -> creator
 *    - super_admin/moderator/student stay unchanged
 * 2) Removes institution lineage fields from memberships.
 * 3) Removes institution-based audience fields from email campaigns.
 *
 * Safety notes:
 * - This migration is idempotent and safe to re-run.
 * - Role normalization preserves authorization intent by mapping elevated
 *   institution roles to the new creator role.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "[018] Removing institution hierarchy coupling and normalizing roles...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("[018] No db connection");

  const usersCol = db.collection("users");
  const membershipsCol = db.collection("memberships");
  const emailCampaignsCol = db.collection("emailcampaigns");

  const roleMapFilter = { role: { $in: ["uni_admin", "admin", "staff"] } };

  const userRoleResult = await usersCol.updateMany(roleMapFilter, {
    $set: { role: "creator" },
  });

  const membershipRoleResult = await membershipsCol.updateMany(roleMapFilter, {
    $set: { role: "creator" },
  });

  const membershipCleanupResult = await membershipsCol.updateMany(
    {},
    {
      $unset: {
        nodeId: "",
        nodeLevel: "",
        universityId: "",
        campusId: "",
        collegeId: "",
        schoolId: "",
        departmentId: "",
      },
    },
  );

  const emailAudienceCleanupResult = await emailCampaignsCol.updateMany(
    {},
    {
      $unset: {
        universityId: "",
        "audienceFilter.universityId": "",
        "audienceFilter.campusId": "",
        "audienceFilter.collegeId": "",
        "audienceFilter.schoolId": "",
        "audienceFilter.departmentId": "",
        "audienceFilter.contactUniversityId": "",
      },
    },
  );

  await emailCampaignsCol.updateMany(
    { "audienceFilter.roles": { $exists: true, $type: "array" } },
    [
      {
        $set: {
          "audienceFilter.roles": {
            $map: {
              input: "$audienceFilter.roles",
              as: "role",
              in: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $in: ["$$role", ["uni_admin", "admin", "staff"]],
                      },
                      then: "creator",
                    },
                  ],
                  default: "$$role",
                },
              },
            },
          },
        },
      },
      {
        $set: {
          "audienceFilter.roles": {
            $setUnion: ["$audienceFilter.roles", []],
          },
        },
      },
    ],
  );

  logger.info(
    `[018] Users role updates: ${userRoleResult.modifiedCount}, memberships role updates: ${membershipRoleResult.modifiedCount}`,
  );
  logger.info(
    `[018] Membership hierarchy cleanup updates: ${membershipCleanupResult.modifiedCount}`,
  );
  logger.info(
    `[018] Email audience cleanup updates: ${emailAudienceCleanupResult.modifiedCount}`,
  );
  logger.info("[018] Migration complete.");
}
