import { Job, shortQueue } from "../queues";
import { StudyRoom, services } from "@/study_rooms";
import { ai } from "@/ai";
import { z } from "genkit";
import { Types } from "mongoose";
import { logger } from "@/config";

// -------------------------------------------------------------------------
// Study Room Handlers
// -------------------------------------------------------------------------

export function registerRoomHandlers(): void {
  logger.info("[System Handler] Registering System queue handlers...");
  shortQueue.register("study_room:game:generate", async (job: Job) => {
    const { roomCode, actorId, type, topic } = job.payload as {
      roomCode: string;
      actorId: string;
      type: "word_guess" | "qa";
      topic: string;
    };

    try {
      const room = await StudyRoom.findOne({
        roomCode: roomCode.toUpperCase(),
      });
      if (!room) return;

      const promptContext = (topic || room.topic || "General Knowledge").trim();

      let generatedData: any;
      if (type === "word_guess") {
        const { output: result } = await ai.generate({
          system:
            'You are a Word Guess game generator. Return ONLY a JSON object: { "word": "UPPERCASE_WORD", "hint": "Short educational hint" }',
          prompt: `Generate a relevant academic word and hint for the topic: ${promptContext}`,
          output: {
            format: "json",
            schema: z.object({ word: z.string(), hint: z.string() }),
          },
        });
        generatedData = result;
      } else {
        const { output: result } = await ai.generate({
          system:
            'You are a Q&A game generator. Return ONLY a JSON object: { "question": "...", "options": ["opt1", "opt2", "opt3", "opt4"], "correctOption": 0, "explanation": "..." }',
          prompt: `Generate a difficult but fair multiple choice question for the topic: ${promptContext}`,
          output: {
            format: "json",
            schema: z.object({
              question: z.string(),
              options: z.array(z.string()).length(4),
              correctOption: z.number().min(0).max(3),
              explanation: z.string(),
            }),
          },
        });
        generatedData = result;
      }

      if (!generatedData) throw new Error("AI failed to generate game content");

      const word =
        type === "word_guess"
          ? generatedData.word.trim().toUpperCase()
          : undefined;

      room.activeGame = {
        type,
        source: "ai",
        topic: promptContext,
        status: "ready", // Ready for host to broadcast
        isActive: false,
        prompt:
          type === "word_guess"
            ? `AI Word Guess (${promptContext}): ${generatedData.hint}`
            : generatedData.question,
        answer:
          type === "word_guess" ? word : String(generatedData.correctOption),
        options: type === "qa" ? generatedData.options : [],
        correctOption: type === "qa" ? generatedData.correctOption : undefined,
        maskedWord:
          type === "word_guess" && word
            ? services.toMaskedWord(word, [])
            : undefined,
        responses: [],
        startedByUserId: new Types.ObjectId(actorId),
        startedAt: new Date(),
      } as any;

      await room.save();

      services.emitRoomEvent(room.roomCode, "study_room:game:state_updated", {
        roomCode: room.roomCode,
        game: room.activeGame,
      });
    } catch (err: any) {
      logger.error(
        `[Worker] study_room:game:generate failed for ${roomCode}: ${err.message}`,
      );
      services.emitRoomEvent(roomCode, "study_room:game:state_updated", {
        roomCode,
        error: "AI Generation failed. Please try again.",
      });
    }
  });

  shortQueue.register("study_room:qa:round_expire", async (job: Job) => {
    const { roomCode } = job.payload as { roomCode: string };
    try {
      await services.endQaRound(roomCode);
    } catch (err: any) {
      logger.error(
        `[Worker] study_room:qa:round_expire failed for ${roomCode}: ${err.message}`,
      );
    }
  });
}
