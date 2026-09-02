import { Mongoose } from "mongoose";
import { logger } from "@/config";

export const dependsOn = ["040_repair_streak_mismatch_from_longest"];

const QUESTION_TYPE_PREFIX_REGEX =
  /^\s*(?:true\s*or\s*false|fill\s*in\s*(?:the\s*)?blank|short\s*answer|essay|multiple\s*choice|mcq)\s*[:\-]\s*/i;

const OPTION_PREFIX_REGEX = /^\s*(?:\(?[A-E]\)|[A-E][\.:\)\-])\s+/i;

const stripQuestionTypePrefix = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  let sanitized = value.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = sanitized.replace(QUESTION_TYPE_PREFIX_REGEX, "").trim();
    if (next === sanitized) break;
    sanitized = next;
  }

  return sanitized;
};

const stripOptionPrefix = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  return value.trim().replace(OPTION_PREFIX_REGEX, "").trim();
};

const sanitizeOptions = (
  value: unknown,
): { options: string[]; changed: boolean } | null => {
  if (!Array.isArray(value)) return null;
  let changed = false;
  const options = value
    .map((entry) => {
      const sanitized = stripOptionPrefix(entry);
      if (sanitized === null) return "";
      if (typeof entry === "string" && sanitized !== entry) changed = true;
      return sanitized;
    })
    .filter((entry) => entry.length > 0);

  if (options.length !== value.length) changed = true;
  return { options, changed };
};

type QuizLikeQuestion = {
  text?: string;
  options?: unknown;
  correctAnswer?: string;
  [key: string]: unknown;
};

type QuizLikeTopic = {
  questions?: QuizLikeQuestion[];
  [key: string]: unknown;
};

type QuizLikeLecture = {
  topics?: QuizLikeTopic[];
  [key: string]: unknown;
};

type QuizLikeContent = {
  questions?: QuizLikeQuestion[];
  lectures?: QuizLikeLecture[];
  [key: string]: unknown;
};

type SessionArtifact = {
  type?: string;
  content?: unknown;
  [key: string]: unknown;
};

const joinPath = (base: string, key: string | number): string =>
  base ? `${base}.${String(key)}` : String(key);

const collectGlobalOptionPatches = (
  node: unknown,
  path: string,
  patches: Record<string, unknown>,
): number => {
  let fieldsUpdated = 0;

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      fieldsUpdated += collectGlobalOptionPatches(
        item,
        joinPath(path, index),
        patches,
      );
    });
    return fieldsUpdated;
  }

  if (!node || typeof node !== "object") return fieldsUpdated;

  const record = node as Record<string, unknown>;

  if (Array.isArray(record.options)) {
    const optionsResult = sanitizeOptions(record.options);
    if (optionsResult?.changed) {
      patches[joinPath(path, "options")] = optionsResult.options;
      fieldsUpdated += 1;

      const nextCorrectAnswer = stripOptionPrefix(record.correctAnswer);
      if (
        nextCorrectAnswer !== null &&
        nextCorrectAnswer !== record.correctAnswer
      ) {
        patches[joinPath(path, "correctAnswer")] = nextCorrectAnswer;
        fieldsUpdated += 1;
      }

      const nextAnswer = stripOptionPrefix(record.answer);
      if (nextAnswer !== null && nextAnswer !== record.answer) {
        patches[joinPath(path, "answer")] = nextAnswer;
        fieldsUpdated += 1;
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    fieldsUpdated += collectGlobalOptionPatches(
      value,
      joinPath(path, key),
      patches,
    );
  }

  return fieldsUpdated;
};

const sanitizeQuizContent = (
  content: unknown,
): {
  content: unknown;
  changed: boolean;
  fieldsUpdated: number;
} => {
  if (!content || typeof content !== "object") {
    return { content, changed: false, fieldsUpdated: 0 };
  }

  let changed = false;
  let fieldsUpdated = 0;
  const root = content as QuizLikeContent;

  const questions = Array.isArray(root.questions) ? root.questions : undefined;
  const sanitizedQuestions = questions?.map((question) => {
    if (!question || typeof question !== "object") return question;

    let questionChanged = false;
    const nextText = stripQuestionTypePrefix(question.text);
    if (nextText !== null && nextText !== question.text) {
      changed = true;
      fieldsUpdated += 1;
      questionChanged = true;
    }

    const optionsResult = sanitizeOptions(question.options);
    if (optionsResult?.changed) {
      changed = true;
      fieldsUpdated += 1;
      questionChanged = true;
    }

    const nextCorrectAnswer = stripOptionPrefix(question.correctAnswer);
    if (
      nextCorrectAnswer !== null &&
      nextCorrectAnswer !== question.correctAnswer
    ) {
      changed = true;
      fieldsUpdated += 1;
      questionChanged = true;
    }

    if (!questionChanged) return question;

    return {
      ...question,
      ...(nextText !== null ? { text: nextText } : {}),
      ...(optionsResult ? { options: optionsResult.options } : {}),
      ...(nextCorrectAnswer !== null
        ? { correctAnswer: nextCorrectAnswer }
        : {}),
    };
  });

  const lectures = Array.isArray(root.lectures) ? root.lectures : undefined;
  const sanitizedLectures = lectures?.map((lecture) => {
    if (!lecture || typeof lecture !== "object") return lecture;
    const topics = Array.isArray(lecture.topics) ? lecture.topics : [];
    const sanitizedTopics = topics.map((topic) => {
      if (!topic || typeof topic !== "object") return topic;
      const topicQuestions = Array.isArray(topic.questions)
        ? topic.questions
        : [];

      const sanitizedTopicQuestions = topicQuestions.map((question) => {
        if (!question || typeof question !== "object") return question;

        let questionChanged = false;
        const nextText = stripQuestionTypePrefix(question.text);
        if (nextText !== null && nextText !== question.text) {
          changed = true;
          fieldsUpdated += 1;
          questionChanged = true;
        }

        const optionsResult = sanitizeOptions(question.options);
        if (optionsResult?.changed) {
          changed = true;
          fieldsUpdated += 1;
          questionChanged = true;
        }

        const nextCorrectAnswer = stripOptionPrefix(question.correctAnswer);
        if (
          nextCorrectAnswer !== null &&
          nextCorrectAnswer !== question.correctAnswer
        ) {
          changed = true;
          fieldsUpdated += 1;
          questionChanged = true;
        }

        if (!questionChanged) return question;

        return {
          ...question,
          ...(nextText !== null ? { text: nextText } : {}),
          ...(optionsResult ? { options: optionsResult.options } : {}),
          ...(nextCorrectAnswer !== null
            ? { correctAnswer: nextCorrectAnswer }
            : {}),
        };
      });

      return { ...topic, questions: sanitizedTopicQuestions };
    });

    return { ...lecture, topics: sanitizedTopics };
  });

  return {
    content: {
      ...root,
      ...(sanitizedQuestions ? { questions: sanitizedQuestions } : {}),
      ...(sanitizedLectures ? { lectures: sanitizedLectures } : {}),
    },
    changed,
    fieldsUpdated,
  };
};

export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 041_remove_question_type_prefixes...");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("[041] No db connection");
  }

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  let questionDocsUpdated = 0;
  let artifactDocsUpdated = 0;
  let artifactQuestionFieldsUpdated = 0;
  let globalOptionDocsUpdated = 0;
  let globalOptionFieldsUpdated = 0;

  if (collections.includes("questions")) {
    const questionsCollection = db.collection("questions");
    const cursor = questionsCollection.find({});

    for await (const doc of cursor) {
      const nextQuestion = stripQuestionTypePrefix(doc.question);
      const optionsResult = sanitizeOptions(doc.options);
      const nextAnswer = stripOptionPrefix(doc.answer);

      if (
        (nextQuestion !== null && nextQuestion !== doc.question) ||
        optionsResult?.changed ||
        (nextAnswer !== null && nextAnswer !== doc.answer)
      ) {
        const nextDoc: Record<string, unknown> = {};
        if (nextQuestion !== null) nextDoc.question = nextQuestion;
        if (optionsResult) nextDoc.options = optionsResult.options;
        if (nextAnswer !== null) nextDoc.answer = nextAnswer;

        await questionsCollection.updateOne(
          { _id: doc._id },
          { $set: nextDoc },
        );
        questionDocsUpdated += 1;
      }
    }
  } else {
    logger.info(
      "[041] questions collection not found; skipping question bank cleanup.",
    );
  }

  // Global cleanup: sanitize prefixed options in ALL documents/collections,
  // including nested objects/arrays, not only quiz artifacts.
  for (const collectionName of collections) {
    const collection = db.collection(collectionName);
    const cursor = collection.find({});

    for await (const doc of cursor) {
      if (!doc || typeof doc !== "object" || !doc._id) continue;

      const patches: Record<string, unknown> = {};
      const updatedFields = collectGlobalOptionPatches(doc, "", patches);
      if (updatedFields === 0) continue;

      await collection.updateOne({ _id: doc._id }, { $set: patches });
      globalOptionDocsUpdated += 1;
      globalOptionFieldsUpdated += updatedFields;
    }
  }

  if (collections.includes("studysessions")) {
    const sessionsCollection = db.collection("studysessions");
    const cursor = sessionsCollection.find({ "artifacts.type": "quiz" });

    for await (const doc of cursor) {
      const artifacts = Array.isArray(doc.artifacts) ? doc.artifacts : [];
      let docChanged = false;
      let docFieldUpdates = 0;

      const sanitizedArtifacts = artifacts.map((artifact: SessionArtifact) => {
        if (!artifact || artifact.type !== "quiz") return artifact;

        const sanitized = sanitizeQuizContent(artifact.content);
        if (sanitized.changed) {
          docChanged = true;
          docFieldUpdates += sanitized.fieldsUpdated;
          return { ...artifact, content: sanitized.content };
        }

        return artifact;
      });

      if (docChanged) {
        await sessionsCollection.updateOne(
          { _id: doc._id },
          { $set: { artifacts: sanitizedArtifacts } },
        );
        artifactDocsUpdated += 1;
        artifactQuestionFieldsUpdated += docFieldUpdates;
      }
    }
  } else {
    logger.info(
      "[041] studysessions collection not found; skipping artifact cleanup.",
    );
  }

  logger.info(
    `[041] Migration complete. questionDocsUpdated=${questionDocsUpdated}, artifactDocsUpdated=${artifactDocsUpdated}, artifactQuestionFieldsUpdated=${artifactQuestionFieldsUpdated}, globalOptionDocsUpdated=${globalOptionDocsUpdated}, globalOptionFieldsUpdated=${globalOptionFieldsUpdated}`,
  );
}

export async function down(_mongoose: Mongoose) {
  logger.info(
    "Down migration for 041: No-op (removed prefixes cannot be reconstructed safely).",
  );
}
