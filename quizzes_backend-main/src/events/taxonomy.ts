import { EventPrivacy, EventTier } from "./interfaces";

// ---------------------------------------------------------------------------
// Event taxonomy — the allow-list. docs/rec-engine.md §6a.
//
// "Events not in the table are not emitted at all — there is no
// 'general-purpose event' type. This is the cost-control lever: the
// controller boundary decides what crosses into the bus." (§6)
//
// This is the full taxonomy across all 4 slices, not just Slice 1 — the
// table in §6a is one unified list with a "slice" column, not four separate
// tables. Slice only controls when controllers actually call emit() with a
// given type (#25 wires Slice 1 only); the allow-list itself is exhaustive
// by design so later slices don't need this file rebuilt.
//
// Note: the doc's own "Slice 1 total: 13 + 5 + 7 + 5 + 4 = 34" arithmetic
// undercounts the Study sessions (14, not 13) and Learning (6, not 5)
// domains by one each against its own enumerated lists below — the literal
// event-type lists are treated as the source of truth here, not the sum.
// ---------------------------------------------------------------------------

export interface EventTaxonomyEntry {
  domain: string;
  defaultPrivacy: EventPrivacy;
  slice: 1 | 2 | 3 | 4;
}

export const EVENT_TAXONOMY: Record<string, EventTaxonomyEntry> = {
  // --- Slice 1: Study sessions ---------------------------------------------
  "session:started": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:joined": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:phase_changed": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:finished": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:abandoned": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  // Content-bearing — private per §6's "Sessions (message content,
  // highlights)" row. (§6a's own footnote only names session:message_sent
  // explicitly and omits highlight_added — treated as an omission there,
  // since §6's defaults table groups them together.)
  "session:message_sent": { domain: "study_sessions", defaultPrivacy: "private", slice: 1 },
  "session:highlight_added": { domain: "study_sessions", defaultPrivacy: "private", slice: 1 },
  "session:lesson_generated": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:walkthrough_generated": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:syllabus_generated": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:verification_completed": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:citation_added": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:memory_artifact_saved": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },
  "session:rollup": { domain: "study_sessions", defaultPrivacy: "public", slice: 1 },

  // --- Slice 1: Learning (materials, courses) ------------------------------
  "material:uploaded": { domain: "learning", defaultPrivacy: "public", slice: 1 },
  "material:processing_started": { domain: "learning", defaultPrivacy: "public", slice: 1 },
  "material:processing_completed": { domain: "learning", defaultPrivacy: "public", slice: 1 },
  "course:enrolled": { domain: "learning", defaultPrivacy: "public", slice: 1 },
  "course:unenrolled": { domain: "learning", defaultPrivacy: "public", slice: 1 },
  "course:completed": { domain: "learning", defaultPrivacy: "public", slice: 1 },

  // --- Slice 1: Quizzes (private + public) ---------------------------------
  "quiz:private_created": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },
  "quiz:public_created": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },
  "quiz:question_answered": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },
  "quiz:private_submitted": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },
  "quiz:public_submitted": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },
  "quiz:private_graded": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },
  "quiz:public_graded": { domain: "quizzes", defaultPrivacy: "public", slice: 1 },

  // --- Slice 1: Notes & highlights (all content-bearing → private) --------
  "note:saved": { domain: "notes_highlights", defaultPrivacy: "private", slice: 1 },
  "note:tag_added": { domain: "notes_highlights", defaultPrivacy: "private", slice: 1 },
  "note:tag_removed": { domain: "notes_highlights", defaultPrivacy: "private", slice: 1 },
  "highlight:saved": { domain: "notes_highlights", defaultPrivacy: "private", slice: 1 },
  "highlight:updated": { domain: "notes_highlights", defaultPrivacy: "private", slice: 1 },

  // --- Slice 1: Recommendations feedback -----------------------------------
  "rec:shown": { domain: "recommendations_feedback", defaultPrivacy: "public", slice: 1 },
  "rec:clicked": { domain: "recommendations_feedback", defaultPrivacy: "public", slice: 1 },
  "rec:dismissed": { domain: "recommendations_feedback", defaultPrivacy: "public", slice: 1 },
  "rec:refreshed": { domain: "recommendations_feedback", defaultPrivacy: "public", slice: 1 },

  // --- Slice 2: Flashcards --------------------------------------------------
  "session:flashcard_set_generated": { domain: "flashcards", defaultPrivacy: "public", slice: 2 },
  "session:flashcard_card_added": { domain: "flashcards", defaultPrivacy: "public", slice: 2 },
  "flashcard:set_created": { domain: "flashcards", defaultPrivacy: "public", slice: 2 },
  "flashcard:card_added": { domain: "flashcards", defaultPrivacy: "public", slice: 2 },
  "flashcard:card_reviewed": { domain: "flashcards", defaultPrivacy: "public", slice: 2 },
  "flashcard:card_marked_hard": { domain: "flashcards", defaultPrivacy: "public", slice: 2 },

  // --- Slice 3: Mindmaps, timetables, study rooms ---------------------------
  "session:mindmap_generated": { domain: "mindmaps", defaultPrivacy: "public", slice: 3 },
  "mindmap:exported": { domain: "mindmaps", defaultPrivacy: "public", slice: 3 },
  "timetable:entry_added": { domain: "timetables", defaultPrivacy: "public", slice: 3 },
  "timetable:entry_removed": { domain: "timetables", defaultPrivacy: "public", slice: 3 },
  "timetable:synced": { domain: "timetables", defaultPrivacy: "public", slice: 3 },
  "study_room:joined": { domain: "study_rooms", defaultPrivacy: "public", slice: 3 },
  "study_room:left": { domain: "study_rooms", defaultPrivacy: "public", slice: 3 },
  "study_room:peer_joined": { domain: "study_rooms", defaultPrivacy: "public", slice: 3 },
  "study_room:message_sent": { domain: "study_rooms", defaultPrivacy: "private", slice: 3 },

  // --- Slice 4: App heartbeats + engagement signals (cut from v1) ----------
  "app:session_start": { domain: "app_heartbeats", defaultPrivacy: "public", slice: 4 },
  "app:page_dwell": { domain: "app_heartbeats", defaultPrivacy: "public", slice: 4 },
  "app:idle_threshold": { domain: "app_heartbeats", defaultPrivacy: "public", slice: 4 },
  "push:notification_received": { domain: "engagement_signals", defaultPrivacy: "public", slice: 4 },
  "push:notification_clicked": { domain: "engagement_signals", defaultPrivacy: "public", slice: 4 },
  "email:opened": { domain: "engagement_signals", defaultPrivacy: "public", slice: 4 },
  "email:clicked": { domain: "engagement_signals", defaultPrivacy: "public", slice: 4 },
  "donation:completed": { domain: "engagement_signals", defaultPrivacy: "public", slice: 4 },
  "streak:rolled_over": { domain: "engagement_signals", defaultPrivacy: "public", slice: 4 },
};

export function isAllowedEventType(eventType: string): boolean {
  return eventType in EVENT_TAXONOMY;
}

export function resolveDefaultPrivacy(eventType: string): EventPrivacy | undefined {
  return EVENT_TAXONOMY[eventType]?.defaultPrivacy;
}

// ---------------------------------------------------------------------------
// Per-tier extraction eligibility — rec-engine.md §3a. NOT consumed yet;
// this is ready-made config for #26 (the nightly extraction cron / real
// memory write pipeline), which filters events to this allow-list before
// running LLM extraction. Emission itself is NOT tier-gated — §3a is
// explicit that "free users get the same event stream as paid users."
// ---------------------------------------------------------------------------

export const EXTRACTION_ELIGIBLE_EVENTS: Record<EventTier, string[]> = {
  free: [],
  cooked: [
    "session:finished",
    "quiz:private_graded",
    "quiz:public_graded",
    "session:rollup",
  ],
  cruising: [
    "session:finished",
    "quiz:private_graded",
    "quiz:public_graded",
    "session:rollup",
    "material:processing_completed",
  ],
  locked_in: [
    "session:finished",
    "quiz:private_graded",
    "quiz:public_graded",
    "session:rollup",
    "material:processing_completed",
    "session:phase_changed",
  ],
};
