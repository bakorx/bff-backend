import axios from "axios";
import { z } from "genkit";
import { Job, longQueue } from "../queues";
import {
  Material,
  MaterialChunk,
  chunkDocument,
  embedChunks,
} from "@/learning";
import { ai, Z_MODEL } from "@/ai";
import { PUBLISHERS } from "../utils";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import { logger } from "@/config";
import { emit as emitEvent } from "@/events/services";

// -----------------------------------------------------------------//--------
// Material Processing & AI Generation Handlers (App)
// -------------------------------------------------------------------------

export function registerHandlers(): void {
  // Material: Process dispatcher
  logger.info("[Material] Registering Material queue handlers...");
  longQueue.register("material:process", async (job: Job) => {
    const { materialId, userId } = job.payload as {
      materialId: string;
      userId?: string;
    };
    try {
      const material = await Material.findById(materialId).populate("upload");
      if (!material) throw new Error(`Material not found: ${materialId}`);

      // Set status to processing
      material.processingStatus = "processing";
      await material.save();

      if (userId) {
        emitEvent(
          "material:processing_started",
          userId,
          { type: "material", id: materialId },
          { mimeType: material.mimeType },
        );
      }

      const upload = material.upload as any;
      const url = upload?.url;

      if (!url) {
        throw new Error(`Upload URL not found for material ${materialId}`);
      }

      const type = material.mimeType;

      // Dispatch sub-jobs based on mimeType
      if (
        type.startsWith("application/pdf") ||
        type.includes("msword") ||
        type.includes("officedocument")
      ) {
        // PDF, DOCX, etc: extract text and images
        await longQueue.enqueue("material:process_text", {
          materialId,
          url,
          type,
          userId,
        });
        await longQueue.enqueue("material:extract_embedded_images", {
          materialId,
          url,
          type,
          userId,
        });
      } else if (type.startsWith("text/")) {
        // Plain text, markdown, csv, etc
        await longQueue.enqueue("material:process_text", {
          materialId,
          url,
          type,
          userId,
        });
      } else if (type.startsWith("image/")) {
        // Image: OCR
        await longQueue.enqueue("material:process_image", {
          materialId,
          url,
          userId,
        });
      } else {
        // Unknown or unsupported type: mark as failed
        material.processingStatus = "failed";
        material.failureReason = `Unsupported file type: ${type}`;
        await material.save();
        throw new Error(`Unsupported file type: ${type}`);
      }

      // Optionally: publish event
      await PUBLISHERS.publishAppEvent("material:process:dispatched", {
        materialId,
        type,
        userId,
      });
    } catch (err: any) {
      // Mark as failed
      await Material.findByIdAndUpdate(job.payload.materialId, {
        processingStatus: "failed",
        failureReason: err?.message || "Unknown error in material:process",
      });
      await PUBLISHERS.publishAppEvent("material:process:failed", {
        materialId: job.payload.materialId,
        userId: job.payload.userId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // Material: Process text
  // --- Top-level imports for material:process_text handler ---

  longQueue.register("material:process_text", async (job: Job) => {
    const { materialId, url, type, userId } = job.payload as {
      materialId: string;
      url: string;
      type: string;
      userId?: string;
    };
    try {
      // Download file
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {}, // Clear headers to avoid 401 from global defaults
      });
      const buffer = Buffer.from(response.data);
      const uint8Array = new Uint8Array(buffer);
      let extractedText = "";
      if (type.startsWith("application/pdf")) {
        const parser = new PDFParse(uint8Array);
        const data = await parser.getText();
        await parser.destroy();
        extractedText = data.text;
      } else if (type.includes("officedocument.wordprocessingml")) {
        const data = await mammoth.extractRawText({ buffer: buffer });
        extractedText = data.value;
      } else if (type.startsWith("text/")) {
        extractedText = buffer.toString("utf-8");
      } else {
        throw new Error(`Unsupported file type for text extraction: ${type}`);
      }

      // Detect whether this looks like a pre-existing question/exam paper
      const isQuestionFile = (text: string): boolean => {
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        const questionLineRegex = /^(?:Q(?:uestion)?\s*)?\d+[\.\)]\s+\S/i;
        const optionLineRegex =
          /^(?:[(\[]?[A-Ea-e][\.\)\]]\s+|\([A-Ea-e]\)\s+)/;
        let questionCount = 0;
        let optionCount = 0;
        for (const line of lines) {
          if (questionLineRegex.test(line)) questionCount++;
          if (optionLineRegex.test(line)) optionCount++;
        }
        const tfMatches = (
          text.match(/\b(true\s*or\s*false|t\s*\/\s*f)\b/gi) || []
        ).length;
        return (
          (questionCount >= 3 && optionCount >= questionCount * 2) ||
          (questionCount >= 5 && tfMatches >= 3)
        );
      };

      // Chunk and embed
      const chunks = chunkDocument(extractedText);
      const embeddedChunks = await embedChunks(chunks);

      // Save chunks to MaterialChunk collection
      await MaterialChunk.deleteMany({ materialId });
      await MaterialChunk.insertMany(
        embeddedChunks.map((chunk, i) => ({
          chunkId: `${materialId}_${i}`,
          materialId,
          text: chunk.text,
          embedding: chunk.embedding,
          section: chunk.section,
          tokenCount: chunk.text.length / 4,
        })),
      );

      // Parse questions if this is a question/exam paper file
      let detectedContentType: "material" | "questions" = "material";
      let parsedQuestions: any[] | undefined;
      let generatedSummary: any | undefined;

      if (isQuestionFile(extractedText)) {
        try {
          const parsedQuestionsSchema = z.object({
            questions: z.array(
              z.object({
                question: z.string(),
                options: z.array(z.string()).default([]),
                answer: z.string(),
                type: z.enum([
                  "mcq",
                  "true_false",
                  "short_answer",
                  "fill_in_blank",
                ]),
                explanation: z.string().optional(),
                hint: z.string().optional(),
                difficulty: z
                  .enum(["easy", "medium", "hard"])
                  .default("medium"),
              }),
            ),
          });

          const { output: parseOutput } = await ai.generate({
            system:
              "You are an exam question parser. Extract all questions from the document and return them as structured JSON. Output ONLY valid JSON — no markdown, no extra text.",
            prompt:
              `Parse every question from this exam/question paper into our structured format.\n\n` +
              `For each question identify:\n` +
              `- question: the question text (clean, no numbering prefix)\n` +
              `- type: "mcq", "true_false", "short_answer", or "fill_in_blank"\n` +
              `- options: array of answer choices for MCQ (empty array otherwise)\n` +
              `- answer: the correct answer text (use the answer key if present; otherwise the best inference)\n` +
              `- difficulty: "easy", "medium", or "hard"\n` +
              `- explanation: a brief explanation of why the answer is correct\n\n` +
              `DOCUMENT:\n${extractedText.slice(0, 25_000)}\n\nReturn raw JSON only.`,
            output: { format: "json", schema: parsedQuestionsSchema },
          });

          const rawParsed = parseOutput?.questions || [];
          if (rawParsed.length > 0) {
            parsedQuestions = rawParsed;
            detectedContentType = "questions";
            logger.info(
              `[Worker] Detected question file for material ${materialId}: parsed ${rawParsed.length} questions`,
            );
          }
        } catch (parseErr: any) {
          logger.error(
            `[Worker] Question file parsing failed for ${materialId}, treating as regular material:`,
            parseErr?.message,
          );
        }
      }

      // If document is a study material, generate comprehensive AI summary & knowledge blocks
      if (detectedContentType === "material" && extractedText.length > 100) {
        try {
          const materialSummarySchema = z.object({
            overview: z
              .string()
              .describe("Comprehensive 2-3 paragraph summary of the document"),
            logicalOverview: z
              .array(
                z.object({
                  pillarNumber: z.number(),
                  title: z.string(),
                  topics: z.array(z.string()),
                }),
              )
              .default([]),
            topicDeepDives: z
              .array(
                z.object({
                  title: z.string(),
                  description: z.string(),
                }),
              )
              .default([]),
            knowledgeBlocks: z
              .array(
                z.object({
                  title: z
                    .string()
                    .describe("Discrete, bite-sized concept or fact"),
                  summary: z
                    .string()
                    .describe("Clear, self-contained explanation with context"),
                  pageReferences: z.array(z.number()).default([]),
                }),
              )
              .default([]),
          });

          const { output: summaryOutput } = await ai.generate({
            system:
              "You are an academic knowledge extraction AI. Analyze the study material and generate a clear overview, structural pillars, topic deep dives, and fine-grained knowledge blocks. Return raw JSON matching the schema.",
            prompt:
              `Analyze this study material and produce an editorial summary and atomic knowledge blocks:\n\n` +
              `1. Overview: 2-3 paragraphs explaining the core premise, importance, and practical application.\n` +
              `2. Logical Overview: Major pillars/sections (1, 2, 3...) and key concepts under each.\n` +
              `3. Topic Deep Dives: Concise paragraphs exploring the key themes.\n` +
              `4. Knowledge Blocks: 4-10 atomic, bite-sized concepts or key facts extracted directly from the text.\n\n` +
              `DOCUMENT:\n${extractedText.slice(0, 30_000)}\n\nReturn JSON only.`,
            output: { format: "json", schema: materialSummarySchema },
          });

          if (summaryOutput) {
            const rawBlocks = summaryOutput.knowledgeBlocks || [];
            generatedSummary = {
              overview: summaryOutput.overview || "",
              logicalOverview: summaryOutput.logicalOverview || [],
              topicDeepDives: summaryOutput.topicDeepDives || [],
              knowledgeBlocks: rawBlocks.map((b: any, idx: number) => ({
                blockId: `kb-${materialId.slice(-4)}-${idx + 1}`,
                title: b.title,
                summary: b.summary,
                pageReferences: b.pageReferences || [],
                isActive: true,
                order: idx + 1,
              })),
              totalBlocks: rawBlocks.length,
              generatedAt: new Date(),
              generatedBy: Z_MODEL,
            };
            logger.info(
              `[Worker] Generated summary & ${rawBlocks.length} knowledge blocks for material ${materialId}`,
            );
          }
        } catch (sumErr: any) {
          logger.error(
            `[Worker] Summary generation failed for material ${materialId}:`,
            sumErr?.message,
          );
        }
      }

      // Update Material doc
      await Material.findByIdAndUpdate(materialId, {
        extractedText,
        chunkCount: embeddedChunks.length,
        wordCount: extractedText.split(/\s+/).length,
        processingStatus: "ready",
        processedAt: new Date(),
        failureReason: undefined,
        contentType: detectedContentType,
        ...(parsedQuestions ? { parsedQuestions } : {}),
        ...(generatedSummary ? { summary: generatedSummary } : {}),
      });
      await PUBLISHERS.publishAppEvent("material:process_text:completed", {
        materialId,
        userId,
      });
      // NOTE: for PDF/DOCX, material:extract_embedded_images runs in
      // parallel and can append OCR text from embedded images AFTER this
      // fires — processingStatus is already "ready" here, but that merge
      // may still be in flight. Known limitation, not blocking.
      if (userId) {
        emitEvent(
          "material:processing_completed",
          userId,
          { type: "material", id: materialId },
          { chunkCount: embeddedChunks.length, contentType: detectedContentType },
        );
      }
      if (generatedSummary) {
        await PUBLISHERS.publishAppEvent("material:summary:ready", {
          materialId,
          userId,
          totalBlocks: generatedSummary.totalBlocks,
        });
      }
    } catch (err: any) {
      logger.error(
        `[Worker] material:process_text failed for ${materialId}: ${err.message}`,
      );
      if (err.response) {
        logger.error(`[Worker] Axios error status: ${err.response.status}`);
        logger.error(
          `[Worker] Axios error headers: ${JSON.stringify(err.response.headers)}`,
        );
      }
      await Material.findByIdAndUpdate(materialId, {
        processingStatus: "failed",
        failureReason: err?.message || "Unknown error in material:process_text",
      });
      await PUBLISHERS.publishAppEvent("material:process_text:failed", {
        materialId,
        userId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // Material: Process image (OCR)

  longQueue.register("material:process_image", async (job: Job) => {
    const { materialId, url, userId } = job.payload as {
      materialId: string;
      url: string;
      userId?: string;
    };
    try {
      // Download image
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {}, // Clear headers to avoid 401 from global defaults
      });
      const imageBuffer = Buffer.from(response.data);
      // Run OCR
      const {
        data: { text: ocrText },
      } = await Tesseract.recognize(imageBuffer, "eng");

      // Update Material doc
      await Material.findByIdAndUpdate(materialId, {
        extractedText: ocrText,
        processingStatus: "ready",
        processedAt: new Date(),
        failureReason: undefined,
        contentType: "material",
      });
      await PUBLISHERS.publishAppEvent("material:process_image:completed", {
        materialId,
        userId,
      });
      if (userId) {
        emitEvent(
          "material:processing_completed",
          userId,
          { type: "material", id: materialId },
          { contentType: "material" },
        );
      }
    } catch (err: any) {
      await Material.findByIdAndUpdate(materialId, {
        processingStatus: "failed",
        failureReason:
          err?.message || "Unknown error in material:process_image",
      });
      await PUBLISHERS.publishAppEvent("material:process_image:failed", {
        materialId,
        userId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // Material: Extract embedded images (PDF/DOCX)
  // Top-level import for Tesseract already present

  longQueue.register("material:extract_embedded_images", async (job: Job) => {
    const { materialId, url, type, userId } = job.payload as {
      materialId: string;
      url: string;
      type: string;
      userId?: string;
    };
    try {
      // Download file
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {}, // Clear headers to avoid 401 from global defaults
      });
      const buffer = Buffer.from(response.data);
      const uint8Array = new Uint8Array(buffer);
      let images: Buffer[] = [];
      if (type.startsWith("application/pdf")) {
        // Use pdf-parse to extract images (pseudo, actual extraction may require pdfjs or similar)
        // Placeholder: images = await extractImagesFromPdf(buffer);
        images = [];
      } else if (type.includes("officedocument.wordprocessingml")) {
        // Use mammoth to extract images from DOCX
        // Placeholder: images = await extractImagesFromDocx(buffer);
        images = [];
      } else {
        throw new Error(
          `Unsupported file type for embedded image extraction: ${type}`,
        );
      }
      // Run OCR on each image
      const ocrTexts: string[] = [];
      for (const img of images) {
        const {
          data: { text },
        } = await Tesseract.recognize(img, "eng");
        ocrTexts.push(text);
      }

      // Append OCR text to existing extractedText
      const material = await Material.findById(materialId);
      let newText =
        (material?.extractedText || "") +
        (ocrTexts.length ? "\n" + ocrTexts.join("\n") : "");
      await Material.findByIdAndUpdate(materialId, {
        extractedText: newText,
        failureReason: undefined,
      });
      await PUBLISHERS.publishAppEvent(
        "material:extract_embedded_images:completed",
        {
          materialId,
          userId,
        },
      );
    } catch (err: any) {
      logger.error(
        `[Worker] material:extract_embedded_images failed for ${materialId}: ${err.message}`,
      );
      if (err.response) {
        logger.error(`[Worker] Axios error status: ${err.response.status}`);
        logger.error(
          `[Worker] Axios error headers: ${JSON.stringify(err.response.headers)}`,
        );
      }
      await Material.findByIdAndUpdate(materialId, {
        processingStatus: "failed",
        failureReason:
          err?.message || "Unknown error in material:extract_embedded_images",
      });
      await PUBLISHERS.publishAppEvent(
        "material:extract_embedded_images:failed",
        {
          materialId,
          userId,
          reason: err?.message,
        },
      );
      throw err;
    }
  });
}
