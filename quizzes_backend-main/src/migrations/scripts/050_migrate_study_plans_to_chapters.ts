import { Mongoose } from "mongoose";
import { nanoid } from "nanoid";
import { logger } from "@/config";

/**
 * Migration 050: Migrate Study Plans to Chapter & Knowledge Block Hierarchy.
 *
 * Converts legacy flat tasks[] inside study_plan artifacts into the new
 * hierarchical chapters[].steps[].knowledgeBlocks[] format.
 *
 * Preserves all user progress:
 * - Maps completed tasks to completed knowledge blocks.
 * - Denormalizes totalBlocks and completedBlocks onto the session.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 050_migrate_study_plans_to_chapters...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const sessionsCollection = db.collection("studysessions");
  const studyPlansCollection = db.collection("studyplans");

  const cursor = sessionsCollection.find({
    "artifacts.type": "study_plan",
  });

  let migratedCount = 0;

  while (await cursor.hasNext()) {
    const session = await cursor.next();
    if (!session || !session.artifacts) continue;

    let modified = false;

    const updatedArtifacts = session.artifacts.map((art: any) => {
      if (art.type !== "study_plan" || !art.content) return art;

      const content = art.content;
      // If already migrated to chapters, skip content conversion
      if (Array.isArray(content.chapters) && content.chapters.length > 0) {
        return art;
      }

      const legacyTasks = Array.isArray(content.tasks) ? content.tasks : [];

      const knowledgeBlocks = legacyTasks.map((t: any, idx: number) => ({
        blockId: t.taskId || nanoid(),
        title: t.label || t.title || `Concept ${idx + 1}`,
        summary: t.description || t.type || "",
        completed: t.status === "completed",
        completedAt: t.status === "completed" ? new Date() : undefined,
        order: t.order || idx + 1,
      }));

      const completedCount = knowledgeBlocks.filter((b: any) => b.completed).length;
      const totalCount = knowledgeBlocks.length;

      const chapterId = nanoid();
      const stepId = nanoid();

      const newContent = {
        goal: content.goal || session.name || "Study Plan",
        courseId: session.courseId ? String(session.courseId) : undefined,
        chapters: [
          {
            chapterId,
            number: 1,
            title: session.name || "Chapter 1",
            description: "Core concepts and learning path",
            isRecommended: true,
            goals: [
              {
                goalId: nanoid(),
                title: content.goal || "Master all concepts in this chapter",
                status: completedCount >= totalCount && totalCount > 0 ? "completed" : "pending",
              },
            ],
            steps: [
              {
                stepId,
                label: "Step 1",
                order: 1,
                knowledgeBlocks,
                completedBlocks: completedCount,
                totalBlocks: totalCount,
              },
            ],
            completedBlocks: completedCount,
            totalBlocks: totalCount,
          },
        ],
        totalChapters: 1,
        totalBlocks: totalCount,
        completedBlocks: completedCount,
        estimatedMinutes: content.estimatedMinutes || Math.max(totalCount * 15, 30),
        approvedAt: content.approvedAt,
        editedByUser: !!content.editedByUser,
      };

      modified = true;
      return {
        ...art,
        content: newContent,
        updatedAt: new Date(),
      };
    });

    const planArtifact = (updatedArtifacts || session.artifacts).find((a: any) => a.type === "study_plan");
    if (planArtifact?.content) {
      const firstChapter = planArtifact.content.chapters?.[0];
      const firstStep = firstChapter?.steps?.[0];
      const firstBlock = firstStep?.knowledgeBlocks?.[0];
      const firstGoal = firstChapter?.goals?.[0];
      const totalBlocks = planArtifact.content.totalBlocks || 0;
      const completedBlocks = planArtifact.content.completedBlocks || 0;
      const completedBlockIds = (firstStep?.knowledgeBlocks || [])
        .filter((b: any) => b.completed)
        .map((b: any) => b.blockId);

      // Upsert into studyplans collection as standalone model
      const studyPlanDoc = {
        sessionId: session._id,
        userId: session.userId,
        courseId: session.courseId,
        goal: planArtifact.content.goal || session.name || "Study Plan",
        chapters: planArtifact.content.chapters || [],
        totalChapters: planArtifact.content.totalChapters || 1,
        totalBlocks,
        completedBlocks,
        estimatedMinutes: planArtifact.content.estimatedMinutes || 30,
        approvedAt: planArtifact.content.approvedAt,
        editedByUser: !!planArtifact.content.editedByUser,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const upsertResult = await studyPlansCollection.findOneAndUpdate(
        { sessionId: session._id },
        { $set: studyPlanDoc },
        { upsert: true, returnDocument: "after" },
      );

      const studyPlanId = upsertResult?._id || (upsertResult as any)?.value?._id;

      await sessionsCollection.updateOne(
        { _id: session._id },
        {
          $set: {
            studyPlan: studyPlanId,
            artifacts: updatedArtifacts,
            totalBlocks,
            completedBlocks,
            completedBlockIds,
            activeChapterId: session.activeChapterId || firstChapter?.chapterId,
            activeStepId: session.activeStepId || firstStep?.stepId,
            activeBlockId: session.activeBlockId || firstBlock?.blockId,
            activeChapterGoalId: session.activeChapterGoalId || firstGoal?.goalId,
          },
        },
      );
      migratedCount++;
    }
  }

  logger.info(`Migration 050 complete. Migrated ${migratedCount} study sessions.`);
}

export async function down(mongoose: Mongoose) {
  logger.info("Rollback 050: Keeping chapter hierarchy in place.");
}
