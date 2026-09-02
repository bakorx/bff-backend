import { z } from "zod";

const FlashcardCardSerializer = z
  .object({
    front: z
      .string()
      .min(1, "Front text is required")
      .describe("The prompt/question on the front of the card"),
    back: z
      .string()
      .min(1, "Back text is required")
      .describe("The answer/explanation on the back of the card"),
    tags: z
      .array(z.string())
      .default([])
      .describe("Card-level categorization tags"),
    difficulty: z
      .enum(["easy", "medium", "hard"])
      .default("medium")
      .describe("Spaced repetition difficulty"),
    lastReviewed: z
      .date()
      .optional()
      .describe("When this card was last studied"),
    reviewCount: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Total number of times this card has been reviewed"),
    masteryLevel: z
      .number()
      .min(0)
      .max(100)
      .default(0)
      .describe("Mastery score from 0–100"),
  })
  .describe("A single flashcard embedded inside a set");

export const FlashcardSerializer = z
  .object({
    title: z
      .string()
      .min(1, "Title is required")
      .describe("Name of the flashcard set"),
    description: z
      .string()
      .optional()
      .describe("Optional description of the set"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("The course this set belongs to"),
    materialId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid material ID")
      .optional()
      .describe("The source material"),
    createdBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("User who created the set"),
    isPublic: z
      .boolean()
      .default(false)
      .describe("Whether the set is publicly visible"),
    cards: z
      .array(FlashcardCardSerializer)
      .max(50, "A flashcard set cannot exceed 50 cards")
      .default([])
      .describe("Embedded flashcard cards (max 50)"),
  })
  .describe("Serializer for a flashcard set");

export const MaterialSerializer = z
  .object({
    title: z
      .string()
      .min(1, "Title is required")
      .describe("Title of the uploaded material"),
    url: z
      .string()
      .min(1, "URL is required")
      .describe("Cloud storage endpoint URL"),
    type: z
      .enum(["pdf", "doc", "slides", "text", "img", "link", "data"])
      .describe("File or data type"),
    questionRefType: z
      .string()
      .min(1)
      .describe("Reference to how questions map to this document"),
    isProcessed: z
      .boolean()
      .default(false)
      .describe("Whether AI background processing is done"),
    uploadedBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("Teacher or student uploader"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("Target course"),
  })
  .describe("Serializer for lecture notes and source materials");

export const PersonalQuizSerializer = z
  .object({
    title: z
      .string()
      .min(1, "Title is required")
      .describe("Title of the personal quiz instance"),
    description: z.string().optional().describe("Description or instructions"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("The subject context"),
    materialId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid material ID")
      .describe("The source document parsed to make this"),
    createdBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("The user who generated it"),
    questions: z
      .array(
        z.object({
          question: z.string().min(1).describe("The question prompt"),
          options: z.array(z.string()).describe("Available answer choices"),
          answer: z.string().min(1).describe("The correct answer"),
          explanation: z
            .string()
            .optional()
            .describe("Explanation of the correct answer"),
          type: z
            .enum(["mcq", "true-false", "fill-in", "short-answer"])
            .default("mcq")
            .describe("Type of question format"),
          difficulty: z
            .enum(["basic", "intermediate", "advanced", "critical"])
            .default("intermediate")
            .describe("Difficulty level"),
          lectureNumber: z
            .string()
            .optional()
            .describe("Associated lecture number"),
          hint: z.string().optional().describe("Partial guidance hint"),
        }),
      )
      .describe("The generated quiz questions array"),
    settings: z
      .object({
        timeLimit: z
          .number()
          .min(0)
          .optional()
          .describe("Time limit in minutes"),
        shuffleQuestions: z
          .boolean()
          .default(true)
          .describe("Whether to shuffle question order"),
        showHints: z
          .boolean()
          .default(true)
          .describe("Whether hints are shown during the quiz"),
        showExplanations: z
          .boolean()
          .default(true)
          .describe("Whether explanations are revealed after answering"),
        allowRetakes: z
          .boolean()
          .default(true)
          .describe("Whether the student can retake the quiz"),
        passingScore: z
          .number()
          .min(0)
          .max(100)
          .default(70)
          .describe("Minimum score to pass"),
      })
      .describe("Configured rules for the quiz run"),
    stats: z
      .object({
        totalAttempts: z
          .number()
          .int()
          .default(0)
          .describe("Total number of attempts"),
        averageScore: z
          .number()
          .default(0)
          .describe("Running average score across attempts"),
        bestScore: z.number().default(0).describe("Highest score achieved"),
        lastAttempted: z
          .date()
          .optional()
          .describe("Timestamp of the last attempt"),
      })
      .describe("Running performance stats"),
    isPublic: z
      .boolean()
      .default(false)
      .describe("Whether other students can take it"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Categorization and search tags"),
  })
  .describe("Serializer for user-generated personal quizzes");

export const ProgressSerializer = z
  .object({
    userId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("Student ID"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("Course they are tracking"),
    quizId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid quiz ID")
      .describe("Latest active quiz context"),
    lectureProgress: z
      .array(
        z.object({
          name: z.string().describe("Name of the lecture or module"),
          completed: z
            .number()
            .default(0)
            .describe("Number of items completed in this lecture"),
          total: z.number().describe("Total number of items in this lecture"),
          date: z
            .date()
            .default(new Date())
            .describe("Date when progress was last recorded"),
        }),
      )
      .describe("Timeline of completion states across lessons"),
  })
  .describe("Serializer for gamified student progress");

export const QuestionSerializer = z
  .object({
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("Course bucket"),
    question: z
      .string()
      .min(1, "Question text required")
      .describe("The main prompt"),
    options: z.array(z.string()).describe("Possible answers (for MCQ)"),
    answer: z
      .string()
      .min(1, "Answer string required")
      .describe("The correct answer choice exactly"),
    type: z
      .enum(["mcq", "fill-in", "true-false"])
      .describe("Type of question format"),
    explanation: z
      .string()
      .optional()
      .describe("Contextual correct explanation"),
    lectureNumber: z.string().optional().describe("Lesson number grouping"),
    hint: z.string().optional().describe("Partial guidance string"),
    author: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("Teacher/User who created it"),
    isModerated: z
      .boolean()
      .default(false)
      .describe("Whether a human reviewer approved it"),
    moderatedBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional()
      .describe("The moderator ID"),
    year: z
      .number()
      .int()
      .default(new Date().getFullYear())
      .describe("The academic year this applies to"),
    aiGeneratedExplanation: z
      .string()
      .optional()
      .describe("AI fallback explanation"),
    aiConfidenceScore: z
      .number()
      .min(0)
      .max(100)
      .default(0)
      .describe("Confidence in AI generation logic"),
  })
  .describe("Serializer for standard Question model");

export const QuizQuestionSerializer = z
  .object({
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("The owning course ID"),
    name: z.string().min(1).describe("The name of this overall Quiz bucket"),
    isApproved: z
      .boolean()
      .default(false)
      .describe("Whether this quiz bundle is approved for students"),
    quizQuestions: z
      .array(
        z.object({
          name: z
            .string()
            .describe("Label of the block (like 'Midterm' or 'Lecture 5')"),
          questions: z
            .array(z.string().regex(/^[0-9a-fA-F]{24}$/))
            .describe("References to actual Question models"),
        }),
      )
      .describe("Groupings of questions inside this bundle"),
    creditHours: z.number().min(0).describe("Course credit hours impact"),
  })
  .describe("Serializer for the main Quiz bundles (Quizzes)");

export const CourseSerializer = z
  .object({
    code: z
      .string()
      .min(1, "Course code is required")
      .describe("Unique course code"),
    title: z.string().optional().describe("Full title of the course"),
    about: z
      .string()
      .min(1, "About is required")
      .describe("Description of the course"),
    numberOfLectures: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Total number of structured lectures"),
    approvedQuestionsCount: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Current cache of approved questions"),
    semester: z.number().int().min(1).describe("Semester offered"),
    creditHours: z
      .number()
      .int()
      .min(0)
      .default(3)
      .describe("Academic credit hours"),
    year: z
      .number()
      .int()
      .default(new Date().getFullYear())
      .describe("The academic year"),
    isDeleted: z.boolean().default(false).describe("Soft delete marker"),
    createdBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("The ID of the staff member who created this"),
    schoolId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid school ID")
      .optional()
      .describe("Reference to the parent school"),
    campusId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid campus ID")
      .describe("Reference to the parent campus"),
    isShared: z
      .boolean()
      .default(false)
      .describe("Whether this course is shared externally"),
    sharedAcrossSchools: z
      .boolean()
      .default(false)
      .optional()
      .describe("Shared across all schools logic"),
    tags: z.array(z.string()).optional().describe("Search metadata tags"),
  })
  .describe("Serializer for Course model");

// Editable fields only, per issues #181/#75 — title, about (description), code,
// creditHours (credits), semester. `courseCode` and `credits` are legacy/dead
// duplicates of `code`/`creditHours` and are intentionally not exposed here.
export const UpdateCourseSerializer = z
  .object({
    title: z
      .string()
      .min(1, "must not be empty")
      .optional()
      .describe("Full title of the course"),
    about: z
      .string()
      .min(1, "must not be empty")
      .optional()
      .describe("Description of the course"),
    code: z
      .string()
      .min(1, "must not be empty")
      .optional()
      .describe("Unique course code"),
    creditHours: z
      .number()
      .int("must be a whole number")
      .min(1, "must be a number 1–6")
      .max(6, "must be a number 1–6")
      .optional()
      .describe("Academic credit hours"),
    semester: z
      .number()
      .int("must be a whole number")
      .min(1, "must be 1 or greater")
      .optional()
      .describe("Semester offered"),
  })
  .strict()
  .describe("Editable fields for PATCH /admin/learning/courses/:id");

export const CourseEnrollmentSerializer = z
  .object({
    userId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("Student or academic member ID"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("The course they are enrolled in"),
    status: z
      .enum(["active", "dropped", "completed"])
      .default("active")
      .describe("Current enrollment state"),
  })
  .describe("Serializer for Course Enrolment relations");

// ─── Quiz (system) serializers ────────────────────────────────────────────────

const QuizQuestionGroupItemSerializer = z.object({
  type: z.enum(["mcq", "true-false", "fill-in", "short-answer"]).describe("Question type"),
  questions: z
    .array(z.string().regex(/^[0-9a-fA-F]{24}$/))
    .describe("Question IDs in this group"),
});

const QuizTopicItemSerializer = z.object({
  title: z.string().min(1).describe("Topic title"),
  description: z.string().optional(),
  order: z.number().int().min(0).default(0),
  questionTypes: z.array(QuizQuestionGroupItemSerializer).default([]),
});

const QuizLectureItemSerializer = z.object({
  title: z.string().min(1).describe("Lecture title"),
  description: z.string().optional(),
  order: z.number().int().min(0).default(0),
  topics: z.array(QuizTopicItemSerializer).default([]),
});

export const QuizSerializer = z
  .object({
    title: z.string().min(1, "Title is required").describe("Quiz title"),
    description: z.string().optional().describe("Quiz description"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("Associated course"),
    createdBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .optional()
      .describe("Admin who created it"),
    status: z
      .enum(["draft", "published", "archived"])
      .default("draft")
      .describe("Publication status"),
    isAvailable: z.boolean().default(false).describe("Whether students can take it"),
    availableFrom: z.string().datetime().optional().describe("Availability window start"),
    availableTo: z.string().datetime().optional().describe("Availability window end"),
    passingScore: z.number().min(0).max(100).default(70).describe("Passing threshold (%)"),
    settings: z
      .object({
        timeLimit: z.number().min(0).optional().describe("Time limit in minutes"),
        shuffleQuestions: z.boolean().default(true),
        showHints: z.boolean().default(true),
        showExplanations: z.boolean().default(true),
      })
      .default({ shuffleQuestions: true, showHints: true, showExplanations: true }),
    tags: z.array(z.string()).default([]).describe("Search tags"),
    lectures: z.array(QuizLectureItemSerializer).default([]),
  })
  .describe("Serializer for system-wide Quiz model");

const VenueMappingSerializer = z.object({
  venue: z.string().min(1),
  indexStart: z.string().optional(),
  indexEnd: z.string().optional(),
  label: z.string().optional(),
});

const ExamSessionSerializer = z.object({
  sessionId: z.string().optional(),
  label: z.string().optional(),
  scheduledAt: z.string().datetime(),
  venues: z.array(VenueMappingSerializer).default([]),
  durationMinutes: z.number().int().min(1).default(120),
});

export const TimetableEntrySerializer = z.object({
  courseId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID"),
  courseName: z.string().min(1, "Course name is required"),
  courseCode: z.string().min(1, "Course code is required"),
  examType: z.enum(["midterm", "final", "resit", "supplementary", "viva", "practical"]),
  sessions: z.array(ExamSessionSerializer).default([]),
  isAutoSynced: z.boolean().default(false),
});

export const TimetableSerializer = z.object({
  semester: z.string().min(1, "Semester is required"),
  academicYear: z.string().min(1, "Academic year is required"),
  isPublished: z.boolean().default(false),
  entries: z.array(TimetableEntrySerializer).default([]),
});

export const GenerateQuizAISerializer = z
  .object({
    quizId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid quiz ID")
      .optional()
      .describe("Existing quiz to append questions to (omit to create new)"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("Course context for question generation"),
    topic: z.string().min(1).describe("Topic or subject to generate questions about"),
    numberOfQuestions: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Total questions to generate"),
    questionTypes: z
      .array(z.enum(["mcq", "true-false", "fill-in", "short-answer"]))
      .default(["mcq"])
      .describe("Question types to generate"),
    difficulty: z
      .enum(["basic", "intermediate", "advanced", "mixed"])
      .default("mixed")
      .describe("Difficulty level"),
    lectureTitle: z
      .string()
      .optional()
      .describe("Lecture grouping for generated questions"),
  })
  .describe("Payload for AI bulk quiz question generation");

export const BatchQuizQuestionsSerializer = z
  .object({
    questions: z
      .array(
        z.object({
          lectureIndex: z.number().int().min(0).describe("Zero-based lecture index"),
          topicIndex: z.number().int().min(0).describe("Zero-based topic index within the lecture"),
          type: z
            .enum(["mcq", "true-false", "fill-in", "short-answer"])
            .describe("Question format type"),
          question: z.string().min(1).describe("The question prompt"),
          options: z.array(z.string()).default([]).describe("Answer choices (required for mcq)"),
          answer: z.string().min(1).describe("The correct answer"),
          explanation: z.string().optional().describe("Explanation of the correct answer"),
          hint: z.string().optional().describe("Optional hint"),
        }),
      )
      .min(1, "At least one question is required"),
  })
  .describe("Payload for batch uploading questions into a quiz via insertMany");

// Partial shape for editing an inner Question document via PATCH
// /admin/learning/quizzes/:id/questions/:questionId. Every field optional so the
// admin can update any subset of the question's editable fields. `lectureIndex`
// and `topicIndex` are intentionally not exposed here — the controller strips
// them, since moving a question between topics is a different operation.
export const QuizQuestionUpdateSerializer = z
  .object({
    type: z
      .enum(["mcq", "true-false", "fill-in", "short-answer"])
      .optional()
      .describe("Question format type"),
    question: z.string().min(1).optional().describe("The question prompt"),
    options: z
      .array(z.string())
      .optional()
      .describe("Answer choices (required for mcq)"),
    answer: z.string().min(1).optional().describe("The correct answer"),
    explanation: z
      .string()
      .optional()
      .describe("Explanation of the correct answer"),
    hint: z.string().optional().describe("Optional hint"),
  })
  .describe("Partial-update payload for an inner Question in a quiz");

export const SyncTimetableSerializer = z.object({
  startDate: z.string().datetime().optional().describe("Date to start scraping from"),
  days: z.number().int().min(1).max(30).default(7).describe("Number of days to scrape"),
  semester: z.string().default("Semester 1").describe("Semester context"),
  academicYear: z.string().default("2025-2026").describe("Academic year context"),
});

export const TriggerPublicQuizGenerationSerializer = z.object({
  courseId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
    .describe("Course ID to generate quizzes for"),
  numberOfQuestions: z
    .number()
    .int()
    .min(35)
    .max(45)
    .default(40)
    .describe("Number of questions per lecture (35-45)"),
});

export const TriggerPublicQuizGenerationForMaterialSerializer = z.object({
  numberOfQuestions: z
    .number()
    .int()
    .min(35)
    .max(45)
    .default(40)
    .describe("Number of questions to generate (35-45)"),
});
