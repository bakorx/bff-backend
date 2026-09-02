import { BaseQueue } from "./base.queue";

/**
 * Long Queue — resource-heavy, deferred background tasks.
 *
 * Flushed every 5 minutes by the scheduler.
 * Concurrency: 2 concurrent jobs (to avoid overwhelming CPU / AI APIs).
 *
 * --- Registered job types (handlers to be implemented) ---
 *
 * "material:process"
 *   Trigger: a Material document is created with isProcessed = false.
 *            This is the dispatcher job — it inspects the material type and
 *            enqueues the appropriate processing sub-job(s) below.
 *   Payload: { materialId, url, type }
 *   Action:  Route by type:
 *              "text" | "data"          → enqueue "material:process_text"
 *              "pdf" | "doc" | "slides" → enqueue "material:process_text"
 *                                         AND "material:extract_embedded_images"
 *              "img"                    → enqueue "material:process_image"
 *              "link"                   → no-op (no server-side content to extract)
 *
 * "material:process_text"
 *   Trigger: dispatched from "material:process" for text-bearing file types
 *            (pdf, doc, slides, text, data).
 *   Payload: { materialId, url, type }
 *   Action:  Download the file; extract plain text using pdfjs-dist (pdf) 
 *            or other parsers; store the extracted text on
 *            the Material document; set isProcessed = true.
 *
 * "material:process_image"
 *   Trigger: dispatched from "material:process" for IMaterial.type = "img".
 *   Payload: { materialId, url }
 *   Action:  Download the image file; run OCR via tesseract.js (eng language
 *            pack) to extract any text content; store the OCR result on the
 *            Material document; set isProcessed = true.
 *
 * "material:extract_embedded_images"
 *   Trigger: dispatched from "material:process" for pdf / doc / slides types
 *            that may contain embedded diagrams, figures, or scanned pages.
 *   Payload: { materialId, url, type }
 *   Action:  Extract all embedded images from the file (pdfjs-dist for PDFs,
 *            mammoth for docx); for each extracted
 *            image run tesseract.js OCR; append the OCR text to the material's
 *            extracted content so the AI generation jobs receive the full
 *            picture (diagrams, captions, scanned text).
 *
 * "ai:generate_quiz"
 *   Trigger: staff/admin requests AI quiz generation from a material.
 *   Payload: { materialId, courseId, createdBy, settings }
 *   Action:  Call Genkit AI to generate quiz questions from the material's
 *            extracted text; persist resulting IPersonalQuiz document.
 *
 * "ai:generate_personal_quiz"
 *   Trigger: Student requests a personal quiz from studio materials.
 *   Payload: { materialId, courseId, userId, createdBy, settings }
 *   Action:  Autonomous generation of a personal study quiz.
 *
 * "ai:generate_flashcards"
 *   Trigger: user requests AI flashcard generation from a material.
 *   Payload: { materialId, courseId, createdBy }
 *   Action:  Call Genkit AI to generate flashcard pairs from the material;
 *            persist resulting IFlashcardSet documents.
 *
 * "ai:generate_explanation"
 *   Trigger: a Question is created with aiGeneratedExplanation empty.
 *   Payload: { questionId, question, options, answer }
 *   Action:  Call Genkit AI to generate a plain-English explanation and
 *            confidence score; update the IQuestion document.
 *
 * "subscription:expire_sweep"
 *   Trigger: daily cron (midnight UTC).
 *   Payload: {}
 *   Action:  Find all Subscription documents where endDate < now AND
 *            status = "active"; update them to status = "expired" and
 *            set IUser.isSubscribed = false.
 *
 * "credits:monthly_recharge"
 *   Trigger: monthly cron (1st of month, 00:05 UTC).
 *   Payload: {}
 *   Action:  Reset IUser.aiUsageStats.creditsRemaining to the plan quota
 *            for all active subscribers; record lastRechargeDate.
 *
 * "email:ai_draft_generate"
 *   Trigger: staff/admin requests an AI-generated email via
 *            POST /users/email-updates/generate.
 *   Payload: { requestedBy, type, contextRefs?, freeFormContext?, subjectHint? }
 *   Action:  Call generateEmailDraft() from users/services.ts; resolve any
 *            entity refs; call the AI (sendChatMessage); persist the result
 *            as an EmailUpdate with status = 'draft'; enqueue
 *            "email:ai_draft_review_notify" on the short queue so the
 *            requestedBy user is informed.
 *
 * "email:newsletter_bulk"
 *   Trigger: admin approves an EmailUpdate; bulk send queued.
 *   Payload: { emailUpdateId }
 *   Action:  Paginate through all waitlist / user emails, enqueue one
 *            "email:newsletter_single" per recipient on the short queue,
 *            then mark the EmailUpdate as status = "sent".
 *
 * "tokens:global_cleanup"
 *   Trigger: nightly cron (02:00 UTC).
 *   Payload: {}
 *   Action:  Delete all Token documents older than 30 days to keep the
 *            tokens collection from growing unbounded.
 *
 * The recommendation:rebuild_profiles, recommendation:generate, and
 * recommendation:notify jobs previously documented here were removed
 * (issue #220) — the v0 pipeline they described was never actually wired up
 * (rebuild_profiles had no registered handler at all; generate fanned out
 * into a stub that did nothing). The rec-engine.md rebuild will document
 * its real jobs here once they exist.
 *
 * "ai:chat_moderation"
 *   Trigger: after any AI chat turn, if the response contains a flagged content
 *            signal from Gemini (finishReason = "SAFETY").
 *   Payload: { sessionId?, userId, message, responseText, finishReason }
 *   Action:  Log the moderation event; notify a staff moderator;
 *            optionally suspend the user if threshold is exceeded.
 */
export const longQueue = new BaseQueue("long-queue", 2);
