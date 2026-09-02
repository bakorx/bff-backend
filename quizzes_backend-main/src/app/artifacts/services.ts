import { IArtifact, IStudySession, ArtifactType } from "../interfaces";
import { StudySession } from "../models";
import { nanoid } from "nanoid";
import { runInTransaction } from "@/utils";
import { isValidObjectId } from "mongoose";
import publisher from "@/socket/publishers";
import { emit as emitEvent } from "@/events/services";

// §6a maps three session-artifact event types onto this module's own
// ArtifactType enum. "syllabus" has no dedicated artifact type — study_plan
// is the closest real analog (syllabus_research.skill.ts only analyzes
// materials/gaps, it never saves an artifact of its own).
const ARTIFACT_TYPE_TO_EVENT: Partial<Record<ArtifactType, string>> = {
  lesson: "session:lesson_generated",
  walkthrough: "session:walkthrough_generated",
  mini_walkthrough: "session:walkthrough_generated",
  study_plan: "session:syllabus_generated",
};

export const ArtifactServices = {
  async save(
    sessionId: string | undefined,
    userId: string,
    artifact: Omit<IArtifact, "artifactId" | "createdAt" | "updatedAt">,
  ): Promise<IArtifact> {
    const fullArtifact: IArtifact = {
      artifactId: nanoid(),
      ...artifact,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (sessionId && isValidObjectId(sessionId)) {
      const messageId = nanoid();
      await runInTransaction(async (session) => {
        await StudySession.findByIdAndUpdate(
          sessionId,
          {
            $push: {
              artifacts: fullArtifact,
              messages: {
                messageId,
                role: "z",
                type: "artifact",
                content: "",
                artifactId: fullArtifact.artifactId,
                artifact: fullArtifact,
                phase: fullArtifact.phase || "implementation",
                timestamp: new Date(),
              },
            },
          },
          { session, returnDocument: "after" },
        );
      });

      publisher.appSignal(sessionId, userId, {
        type: "artifact_saved",
        payload: {
          artifactId: fullArtifact.artifactId,
          artifactType: artifact.type,
          title: artifact.title,
          artifact: fullArtifact,
        },
        timestamp: new Date(),
      });

      // NOTE: approvePlan() in ../services.ts has a fallback path that
      // pushes a study_plan artifact directly via StudySession update,
      // bypassing this function entirely when the AI skips the
      // save_artifact tool call — that path won't fire
      // session:syllabus_generated. Low-traffic edge case, not covered here.
      //
      // artifactId is a nanoid, not a Mongo ObjectId — artifacts are
      // embedded subdocuments on StudySession, not their own top-level
      // collection, so sourceRef points at the session instead.
      const eventType = ARTIFACT_TYPE_TO_EVENT[artifact.type];
      if (eventType) {
        emitEvent(
          eventType,
          userId,
          { type: "session", id: sessionId },
          {
            artifactId: fullArtifact.artifactId,
            artifactType: artifact.type,
            title: artifact.title,
          },
        );
      }
    }

    return fullArtifact;
  },

  async update(
    sessionId: string | undefined,
    userId: string,
    artifactId: string,
    updates: Partial<Pick<IArtifact, "content" | "title">>,
  ): Promise<IArtifact | null> {
    if (!sessionId || !isValidObjectId(sessionId)) {
      return null;
    }

    const updatedSession = await runInTransaction(async (session) => {
      return StudySession.findOneAndUpdate(
        { _id: sessionId, "artifacts.artifactId": artifactId },
        {
          $set: {
            "artifacts.$.title": updates.title,
            "artifacts.$.content": updates.content,
            "artifacts.$.updatedAt": new Date(),
          },
        },
        { returnDocument: "after", session },
      );
    });

    publisher.appSignal(sessionId, userId, {
      type: "artifact_updated",
      payload: { artifactId, title: updates.title },
      timestamp: new Date(),
    });

    if (!updatedSession) return null;
    return (
      (updatedSession as IStudySession).artifacts.find(
        (a) => a.artifactId === artifactId,
      ) ?? null
    );
  },

  async get(
    sessionId: string | undefined,
    artifactId: string,
  ): Promise<IArtifact | null> {
    if (!sessionId || !isValidObjectId(sessionId)) return null;
    const session = await StudySession.findById(sessionId).lean();
    if (!session) return null;
    return (
      (session as IStudySession).artifacts.find(
        (a) => a.artifactId === artifactId,
      ) ?? null
    );
  },

  async getByType(
    sessionId: string | undefined,
    type: ArtifactType,
  ): Promise<IArtifact[]> {
    if (!sessionId || !isValidObjectId(sessionId)) return [];
    const session = await StudySession.findById(sessionId).lean();
    if (!session) return [];
    return (session as IStudySession).artifacts.filter((a) => a.type === type);
  },

  async getLatest(
    sessionId: string | undefined,
    type: ArtifactType,
  ): Promise<IArtifact | null> {
    if (!sessionId || !isValidObjectId(sessionId)) return null;
    const session = await StudySession.findById(sessionId).lean();
    if (!session) return null;
    const filtered = (session as IStudySession).artifacts
      .filter((a) => a.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return filtered[0] ?? null;
  },
};
