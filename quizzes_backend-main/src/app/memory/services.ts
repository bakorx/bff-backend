import { SessionMemory } from "../models";
import { ISessionMemory } from "../interfaces";
import { runInTransaction } from "@/utils";

export const MemoryServices = {
  async getOrCreate(userId: string, courseId?: string) {
    return runInTransaction(async (session) => {
      return SessionMemory.findOneAndUpdate(
        { userId, courseId: courseId ?? null },
        { $setOnInsert: { userId, courseId: courseId ?? null } },
        {
          upsert: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
          session,
        },
      );
    });
  },

  async snapshot(userId: string, courseId?: string) {
    return SessionMemory.findOne({ userId, courseId: courseId ?? null }).lean();
  },

  async update(
    userId: string,
    courseId: string | undefined,
    updates: {
      addKnownConcepts?: string[];
      addGaps?: string[];
      removeGaps?: string[];
      addMasteredGoals?: string[];
      updateStudyPatterns?: Partial<ISessionMemory["studyPatterns"]>;
      lastSessionId?: string;
    },
  ) {
    return runInTransaction(async (session) => {
      const addToSetUpdate: Record<string, { $each: string[] }> = {};
      if (updates.addKnownConcepts?.length)
        addToSetUpdate["knownConcepts"] = { $each: updates.addKnownConcepts };
      if (updates.addGaps?.length)
        addToSetUpdate["gaps"] = { $each: updates.addGaps };
      if (updates.addMasteredGoals?.length)
        addToSetUpdate["masteredGoals"] = { $each: updates.addMasteredGoals };

      const setUpdate: Record<string, unknown> = { lastUpdatedAt: new Date() };

      if (updates.lastSessionId)
        setUpdate["lastSessionId"] = updates.lastSessionId;

      if (updates.updateStudyPatterns) {
        const sp = updates.updateStudyPatterns;
        if (sp.preferredMode !== undefined)
          setUpdate["studyPatterns.preferredMode"] = sp.preferredMode;
        if (sp.averageSessionMins !== undefined)
          setUpdate["studyPatterns.averageSessionMins"] = sp.averageSessionMins;
        if (sp.strongTopics !== undefined)
          setUpdate["studyPatterns.strongTopics"] = sp.strongTopics;
        if (sp.weakTopics !== undefined)
          setUpdate["studyPatterns.weakTopics"] = sp.weakTopics;
      }

      const updateOp: Record<string, unknown> = { $set: setUpdate };
      if (Object.keys(addToSetUpdate).length)
        updateOp["$addToSet"] = addToSetUpdate;
      if (updates.removeGaps?.length)
        updateOp["$pull"] = { gaps: { $in: updates.removeGaps } };

      return SessionMemory.findOneAndUpdate(
        { userId, courseId: courseId ?? null },
        updateOp,
        { returnDocument: "after", session },
      );
    });
  },

  async updateFromRecommender(
    userId: string,
    courseId: string | undefined,
    weakTopics: string[],
    strongTopics: string[],
  ) {
    return runInTransaction(async (session) => {
      return SessionMemory.findOneAndUpdate(
        { userId, courseId: courseId ?? null },
        {
          $addToSet: {
            "studyPatterns.weakTopics": { $each: weakTopics },
            "studyPatterns.strongTopics": { $each: strongTopics },
          },
        },
        { returnDocument: "after", session },
      );
    });
  },
};
