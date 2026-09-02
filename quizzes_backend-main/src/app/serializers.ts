import { z } from "zod";
import { IStudySession, ISessionMemory, IArtifact, ITask } from "./interfaces";

// ─── Request validation schemas ──────────────────────────────────────────────

export const StudySessionSerializer = z.object({
  name: z.string().min(1).optional(),
  courseId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  mode: z.enum(["free", "structured"]).default("structured"),
  planningMode: z.enum(["planning", "fast"]).default("planning"),
});

export const SteerSessionSerializer = z.object({
  instruction: z.string().min(1, "Steering instruction is required"),
});

export const CreateMaterialSerializer = z.object({
  title: z.string().min(1, "Title is required"),
  uploadId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid upload ID"),
  url: z.string().optional(),
  type: z.enum(["pdf", "doc", "slides", "text", "img", "link", "data"]).optional(),
  courseId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
    .optional(),
  sessionId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid session ID")
    .optional(),
});

export const GenerateAIContentSerializer = z.object({
  materialId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid material ID"),
  courseId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
    .optional(),
  settings: z.record(z.string(), z.any()).optional(),
});

export const GradeQuizSerializer = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        question: z.string().min(1),
        answer: z.string(),
        correctAnswer: z.string().optional(),
      }),
    )
    .min(1, "At least one answer is required"),
});

export const CreateTaskSerializer = z.object({
  title: z.string().min(1, "Title is required"),
  subject: z.string().optional(),
});

export const UpdateTaskSerializer = z.object({
  title: z.string().min(1).optional(),
  subject: z.string().optional(),
  status: z.enum(["active", "completed"]).optional(),
});

// ─── Response shaping schemas ────────────────────────────────────────────────

export const SessionResponseSchema = z.object({
  id: z.string(),
  name: z.string().nullish().default("Study Session"),
  userId: z.string().nullish(),
  courseId: z.any().nullish(),
  mode: z.string().nullish().default("structured"),
  planningMode: z.string().nullish().default("planning"),
  status: z.string().nullish().default("active"),
  currentPhase: z.string().nullish().default("analysis"),
  previousPhase: z.string().nullish(),
  studyPlan: z.any().nullish(),
  courseSummary: z.any().nullish(),
  totalBlocks: z.number().nullish().default(0),
  completedBlocks: z.number().nullish().default(0),
  completedBlockIds: z.array(z.string()).nullish().default([]),
  activeChapterId: z.string().nullish(),
  activeStepId: z.string().nullish(),
  activeBlockId: z.string().nullish(),
  goals: z.array(z.any()).nullish().default([]),
  artifacts: z.array(z.any()).nullish().default([]),
  zMessages: z.array(z.any()).nullish().default([]),
  citations: z.array(z.any()).nullish().default([]),
  studio: z.any().nullish().default({}),
  peers: z.array(z.any()).nullish().default([]),
  materialIds: z.array(z.string()).nullish().default([]),
  startedAt: z.any().nullish(),
  completedAt: z.any().nullish(),
  durationMinutes: z.number().nullish(),
  createdAt: z.any().nullish(),
  updatedAt: z.any().nullish(),
  highlights: z.array(z.any()).nullish().default([]),
});

export const SessionSummaryResponseSchema = z.object({
  id: z.string(),
  name: z.string().nullish().default("Study Session"),
  courseId: z.any().nullish(),
  mode: z.string().nullish().default("structured"),
  planningMode: z.string().nullish().default("planning"),
  status: z.string().nullish().default("active"),
  currentPhase: z.string().nullish().default("analysis"),
  goals: z.array(
    z.object({
      goalId: z.string().nullish().default(""),
      title: z.string().nullish().default(""),
      status: z.string().nullish().default("pending"),
    }),
  ).nullish().default([]),
  artifactCount: z.number().nullish().default(0),
  messageCount: z.number().nullish().default(0),
  lastMessage: z.string().nullish(),
  studio: z.any().nullish().default({}),
  activeChapterId: z.string().nullish(),
  activeStepId: z.string().nullish(),
  activeBlockId: z.string().nullish(),
  totalBlocks: z.number().nullish().default(0),
  completedBlocks: z.number().nullish().default(0),
  hasStudyPlan: z.boolean().nullish().default(false),
  hasCourseSummary: z.boolean().nullish().default(false),
  startedAt: z.any().nullish(),
  completedAt: z.any().nullish(),
  createdAt: z.any().nullish(),
  updatedAt: z.any().nullish(),
});

export const ArtifactResponseSchema = z.object({
  artifactId: z.string(),
  type: z.string(),
  title: z.string().nullish(),
  content: z.any(),
  phase: z.string().nullish(),
  goalId: z.string().nullish(),
  createdAt: z.any().nullish(),
  updatedAt: z.any().nullish(),
});

export const MemoryResponseSchema = z.object({
  knownConcepts: z.array(z.any()).nullish().default([]),
  gaps: z.array(z.any()).nullish().default([]),
  masteredGoals: z.array(z.any()).nullish().default([]),
  studyPatterns: z.array(z.any()).nullish().default([]),
  lastUpdatedAt: z.any().nullish(),
});

export const MaterialResponseSchema = z.object({
  id: z.any(),
  title: z.string().optional().default("Untitled"),
  filename: z.string().optional().default("Unknown"),
  originalName: z.string().optional().default("Unknown"),
  mimeType: z.string().optional().default("application/octet-stream"),
  size: z.number().optional().default(0),
  processingStatus: z.string().optional().default("pending"),
  materialType: z.string().optional().default("learning_material"),
  contentType: z.string().optional().default("material"),
  summary: z
    .object({
      overview: z.string().optional().default(""),
      logicalOverview: z
        .array(
          z.object({
            pillarNumber: z.number().optional(),
            title: z.string().optional(),
            topics: z.array(z.string()).optional().default([]),
          }),
        )
        .optional()
        .default([]),
      topicDeepDives: z
        .array(
          z.object({
            title: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional()
        .default([]),
      knowledgeBlocks: z
        .array(
          z.object({
            blockId: z.string(),
            title: z.string(),
            summary: z.string(),
            pageReferences: z.array(z.number()).optional().default([]),
            isActive: z.boolean().optional().default(true),
            order: z.number().optional().default(0),
          }),
        )
        .optional()
        .default([]),
      totalBlocks: z.number().optional().default(0),
      generatedAt: z.any().optional(),
      generatedBy: z.string().optional(),
    })
    .optional(),
  chunkCount: z.number().optional().default(0),
  wordCount: z.number().optional().default(0),
  pageCount: z.number().optional().default(0),
  failureReason: z.string().optional(),
  uploadedAt: z.date().optional(),
  processedAt: z.date().optional(),
  createdAt: z.date().optional(),
  flashcardsGenerated: z.boolean().optional().default(false),
  quizGenerated: z.boolean().optional().default(false),
});

// ─── Response shaping ────────────────────────────────────────────────────────

export const AppSerializers = {
  task(t: ITask) {
    return {
      id: t._id.toString(),
      title: t.title,
      subject: t.subject,
      status: t.status,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  },

  session(s: IStudySession) {
    const studyPlan = (s as any).studyPlan;
    const courseSummary = (s as any).courseSummary;

    const transformed = {
      id: s._id?.toString() || (s as any).id,
      name: s.name || "Study Session",
      userId: s.userId?.toString(),
      courseId: s.courseId?.toString(),
      mode: s.mode || "structured",
      planningMode: s.planningMode || "planning",
      status: s.status || "active",
      currentPhase: s.currentPhase || "analysis",
      previousPhase: s.previousPhase,
      studyPlan,
      courseSummary,
      totalBlocks: s.totalBlocks || studyPlan?.totalBlocks || 0,
      completedBlocks: s.completedBlocks || studyPlan?.completedBlocks || 0,
      completedBlockIds: s.completedBlockIds || [],
      activeChapterId: s.activeChapterId,
      activeStepId: s.activeStepId,
      activeBlockId: s.activeBlockId,
      goals: s.goals || [],
      artifacts: s.artifacts || [],
      zMessages: (() => {
        const rawMessages = (s.messages || []) as any[];

        // ── Step 1: build artifact lookup from session.artifacts ──────────────
        const artifactById: Record<string, any> = {};
        if (Array.isArray(s.artifacts)) {
          for (const a of s.artifacts as any[]) {
            if (a?.artifactId) artifactById[a.artifactId] = a;
          }
        }

        // ── Step 2: filter down to user-visible messages ──────────────────────
        const visible = rawMessages.filter((m) => {
          const raw = typeof m.toObject === "function" ? m.toObject() : m;
          const type = raw.type || "text";
          const role = raw.role;
          const content = typeof raw.content === "string" ? raw.content.trim() : "";

          // Drop internal plumbing
          if (
            type === "tool_call" ||
            type === "tool_result" ||
            type === "system_action" ||
            role === "tool" ||
            (role === "system" && type !== "directive" && !raw.directive)
          ) return false;

          // Drop raw automated journey prompts and intro greetings
          if (
            content.startsWith("[STUDY JOURNEY:") ||
            /^Give a very short.*intro welcoming me/i.test(content)
          ) return false;

          // Drop empty non-artifact/non-directive messages
          if (
            type !== "artifact" &&
            type !== "directive" &&
            !raw.artifact &&
            !raw.directive &&
            content.length === 0
          ) return false;

          return true;
        });

        // ── Step 3: fold artifact messages into companion Z text messages ────
        const output: any[] = [];
        const absorbedArtifactIndices = new Set<number>();

        for (let i = 0; i < visible.length; i++) {
          const m = visible[i];
          const raw = typeof m.toObject === "function" ? m.toObject() : m;
          const type = raw.type || "text";

          if (raw.role === "z" && (type === "text" || !type)) {
            let artifactPayload = raw.artifact;
            let artifactId = raw.artifactId;

            if (!artifactPayload && artifactId) {
              artifactPayload = artifactById[artifactId];
            }

            // Look in immediate turn boundaries for unabsorbed artifact
            if (!artifactPayload) {
              // Look backward before this text message
              for (let j = i - 1; j >= 0; j--) {
                const prev = typeof visible[j].toObject === "function" ? visible[j].toObject() : visible[j];
                if (prev.role === "user") break;
                if (prev.type === "artifact" && !absorbedArtifactIndices.has(j)) {
                  artifactPayload = prev.artifact || (prev.artifactId ? artifactById[prev.artifactId] : null);
                  artifactId = prev.artifactId || artifactPayload?.artifactId;
                  if (artifactPayload) {
                    absorbedArtifactIndices.add(j);
                    break;
                  }
                }
              }

              // Look forward after this text message
              if (!artifactPayload) {
                for (let j = i + 1; j < visible.length; j++) {
                  const next = typeof visible[j].toObject === "function" ? visible[j].toObject() : visible[j];
                  if (next.role === "user") break;
                  if (next.type === "artifact" && !absorbedArtifactIndices.has(j)) {
                    artifactPayload = next.artifact || (next.artifactId ? artifactById[next.artifactId] : null);
                    artifactId = next.artifactId || artifactPayload?.artifactId;
                    if (artifactPayload) {
                      absorbedArtifactIndices.add(j);
                      break;
                    }
                  }
                }
              }
            }

            output.push({
              id: raw._id?.toString() || raw.id || raw.messageId,
              messageId: raw.messageId || raw._id?.toString() || raw.id,
              replyToMessageId: raw.replyToMessageId,
              timestamp: raw.timestamp,
              role: raw.role,
              authorId: raw.authorId,
              authorName: raw.authorName,
              type: raw.type,
              content: raw.content,
              status: raw.status,
              directive: raw.directive,
              artifactId: artifactId || undefined,
              artifact: artifactPayload || undefined,
            });
          } else if (type === "artifact") {
            if (absorbedArtifactIndices.has(i)) {
              continue; // Absorbed into text message
            }

            // Check if there is a companion Z text message in the same turn that will absorb this
            let willBeAbsorbed = false;
            for (let j = i + 1; j < visible.length; j++) {
              const next = typeof visible[j].toObject === "function" ? visible[j].toObject() : visible[j];
              if (next.role === "user") break;
              if (next.role === "z" && (next.type === "text" || !next.type)) {
                willBeAbsorbed = true;
                break;
              }
            }
            if (!willBeAbsorbed) {
              for (let j = i - 1; j >= 0; j--) {
                const prev = typeof visible[j].toObject === "function" ? visible[j].toObject() : visible[j];
                if (prev.role === "user") break;
                if (prev.role === "z" && (prev.type === "text" || !prev.type)) {
                  willBeAbsorbed = true;
                  break;
                }
              }
            }

            if (!willBeAbsorbed) {
              let artifactPayload = raw.artifact;
              if (!artifactPayload && raw.artifactId) {
                artifactPayload = artifactById[raw.artifactId];
              }

              output.push({
                id: raw._id?.toString() || raw.id || raw.messageId,
                messageId: raw.messageId || raw._id?.toString() || raw.id,
                replyToMessageId: raw.replyToMessageId,
                timestamp: raw.timestamp,
                role: raw.role || "z",
                authorId: raw.authorId,
                authorName: raw.authorName,
                type: "artifact",
                content: raw.content || "",
                status: raw.status,
                directive: raw.directive,
                artifactId: raw.artifactId || artifactPayload?.artifactId,
                artifact: artifactPayload,
              });
            }
          } else {
            let artifactPayload = raw.artifact;
            if (!artifactPayload && raw.artifactId) {
              artifactPayload = artifactById[raw.artifactId];
            }

            output.push({
              id: raw._id?.toString() || raw.id || raw.messageId,
              messageId: raw.messageId || raw._id?.toString() || raw.id,
              replyToMessageId: raw.replyToMessageId,
              timestamp: raw.timestamp,
              role: raw.role,
              authorId: raw.authorId,
              authorName: raw.authorName,
              type: raw.type,
              content: raw.content,
              status: raw.status,
              directive: raw.directive,
              artifactId: raw.artifactId,
              artifact: artifactPayload,
            });
          }
        }

        return output.slice(-50);
      })(),
      citations: s.citations || [],
      studio: s.studio || {},
      peers: s.peers || [],
      materialIds: (s.materialIds || []).map((id: any) => id?.toString()),
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      durationMinutes: s.durationMinutes,
      createdAt: (s as any).createdAt,
      updatedAt: (s as any).updatedAt,
      highlights: s.highlights || [],
    };
    return SessionResponseSchema.parse(transformed);
  },

  sessionSummary(s: IStudySession) {
    const messages = s.messages || [];
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

    const transformed = {
      id: s._id?.toString() || (s as any).id,
      name: s.name || "Study Session",
      courseId: s.courseId?.toString(),
      mode: s.mode || "structured",
      planningMode: s.planningMode || "planning",
      status: s.status || "active",
      currentPhase: s.currentPhase || "analysis",
      goals: (s.goals || []).map((g) => ({
        goalId: g.goalId || "",
        title: g.title || "",
        status: g.status || "pending",
      })),
      artifactCount: (s.artifacts || []).length,
      messageCount: messages.length,
      lastMessage: lastMsg?.content ? String(lastMsg.content).slice(0, 100) : undefined,
      studio: s.studio || {},
      activeChapterId: s.activeChapterId,
      activeStepId: s.activeStepId,
      activeBlockId: s.activeBlockId,
      totalBlocks: s.totalBlocks || (s as any).studyPlan?.totalBlocks || 0,
      completedBlocks: s.completedBlocks || (s as any).studyPlan?.completedBlocks || 0,
      hasStudyPlan: Boolean((s as any).studyPlan),
      hasCourseSummary: Boolean((s as any).courseSummary),
      createdAt: (s as any).createdAt,
      updatedAt: (s as any).updatedAt,
    };
    return SessionSummaryResponseSchema.parse(transformed);
  },

  artifact(a: IArtifact) {
    return ArtifactResponseSchema.parse({
      artifactId: a.artifactId,
      type: a.type,
      title: a.title,
      content: a.content,
      phase: a.phase,
      goalId: a.goalId,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });
  },

  memory(m: ISessionMemory) {
    return MemoryResponseSchema.parse({
      knownConcepts: m.knownConcepts,
      gaps: m.gaps,
      masteredGoals: m.masteredGoals,
      studyPatterns: m.studyPatterns,
      lastUpdatedAt: m.lastUpdatedAt,
    });
  },

  materialSerializer(m: any) {
    return MaterialResponseSchema.parse({
      id: m._id || m.id,
      title: m.originalName || m.filename || "Untitled",
      filename: m.filename,
      originalName: m.originalName,
      mimeType: m.mimeType,
      size: m.size,
      processingStatus: m.processingStatus,
      materialType: m.materialType,
      contentType: m.contentType,
      summary: m.summary,
      chunkCount: m.chunkCount,
      wordCount: m.wordCount,
      pageCount: m.pageCount,
      failureReason: m.failureReason,
      uploadedAt: m.uploadedAt,
      processedAt: m.processedAt,
      createdAt: m.createdAt || m.uploadedAt,
      flashcardsGenerated: m.flashcardsGenerated ?? false,
      quizGenerated: m.quizGenerated ?? false,
    });
  },
};
