import { z } from "zod";

// ---------------------------------------------------------------------------
// External resource submission (#14) — rec-engine.md §12.
// ---------------------------------------------------------------------------

export const SubmitExternalResourceSerializer = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url(),
  source: z.enum(["youtube", "pdf", "article", "file"]),
  topicTags: z.array(z.string().trim().min(1)).min(1),
  difficulty: z.enum(["bece", "wassce", "undergrad", "general"]),
  language: z.string().trim().min(1).default("en"),
  // Defaults to true in the schema (§12: "Defaults to true — the community
  // feel is part of the model") — only overridden if the client explicitly opts out.
  submitterOptIn: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Moderation API (#17) — rec-engine.md §12 "Moderation actions" table.
// ---------------------------------------------------------------------------

// Covers both plain "Approve" (no fields) and "Edit + Approve" ("Apply
// edits to the resource, then approve") — one endpoint, edits optional.
export const ApproveExternalResourceSerializer = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().url().optional(),
  source: z.enum(["youtube", "pdf", "article", "file"]).optional(),
  topicTags: z.array(z.string().trim().min(1)).min(1).optional(),
  difficulty: z.enum(["bece", "wassce", "undergrad", "general"]).optional(),
  language: z.string().trim().min(1).optional(),
});

export const RejectExternalResourceSerializer = z.object({
  rejectionReason: z.string().trim().min(1).max(500),
});
