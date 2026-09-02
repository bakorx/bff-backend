import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { StudySession } from "../../models";
import { selectors as learningSelectors } from "@/learning";
import { runInTransaction } from "@/utils";
import { FlashcardSetContent } from "../../interfaces";
import { nanoid } from "nanoid";

const generateFlashcardsTool = defineToolOnce(
  {
    name: "generate_flashcards",
    description:
      "Generate a flashcard set artifact from concept pairs. For autonomous generation, you MUST generate at least 25 cards (max 50).",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      topicTitle: z.string(),
      concepts: z.array(z.object({ front: z.string(), back: z.string() })),
      goalId: z.string().nullish(),
    }),
  },
  async (input) => {
    const { topicTitle, concepts } = input;
    const goalId = input.goalId ?? undefined;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to generate flashcards");
    }

    const newCards = concepts.map((c) => ({
      cardId: nanoid(),
      front: c.front,
      back: c.back,
      tags: [topicTitle],
    }));

    // Merge with existing flashcard_set if one exists for this session
    const existing = await ArtifactServices.getLatest(
      sessionId,
      "flashcard_set",
    );
    if (existing && sessionId) {
      const existingContent = existing.content as FlashcardSetContent;
      const existingFronts = new Set(
        existingContent.cards.map((c) => c.front.trim().toLowerCase()),
      );
      const uniqueNewCards = newCards.filter(
        (c) => !existingFronts.has(c.front.trim().toLowerCase()),
      );
      const merged: FlashcardSetContent = {
        cards: [...existingContent.cards, ...uniqueNewCards],
      };
      await ArtifactServices.update(sessionId, userId, existing.artifactId, {
        content: merged as never,
        title:
          topicTitle !== existing.title
            ? `${existing.title} + ${topicTitle}`
            : existing.title,
      });
      return {
        artifactId: existing.artifactId,
        cardCount: uniqueNewCards.length,
        totalCards: merged.cards.length,
        duplicatesSkipped: newCards.length - uniqueNewCards.length,
        merged: true,
      };
    }

    const content: FlashcardSetContent = { cards: newCards };
    const artifact = await ArtifactServices.save(
      sessionId ?? undefined,
      userId ?? undefined,
      {
        type: "flashcard_set",
        title: topicTitle,
        content,
        phase: "implementation",
        goalId: goalId ?? undefined,
      },
    );
    return {
      artifactId: artifact.artifactId,
      cardCount: newCards.length,
      totalCards: newCards.length,
      merged: false,
    };
  },
);

const saveFlashcardsToLibraryTool = defineToolOnce(
  {
    name: "save_flashcards_to_library",
    description:
      "Save a flashcard set artifact to the student's personal library.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      title: z.string(),
    }),
  },
  async (input) => {
    const { artifactId } = input;
    const { sessionId } = await resolveSkillContext(input);
    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Artifact not found");
    let setId = "";
    if (!sessionId) {
      // In session-less context, we might not have a studio to save to.
      return { setId: nanoid(), note: "Virtual save (no session)" };
    }
    await runInTransaction(async (txSession) => {
      const newSetId = nanoid();
      setId = newSetId;
      await StudySession.findByIdAndUpdate(
        sessionId,
        { $addToSet: { "studio.savedFlashcardSetIds": newSetId } },
        { session: txSession, returnDocument: "after" },
      );
    });
    return { setId };
  },
);

const getFlashcardsTool = defineToolOnce(
  {
    name: "get_flashcards",
    description:
      "Read or search flashcard sets in the current session or saved library with keyword search, tag filtering, and pagination.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string().optional(),
      search: z.string().optional().describe("Search term matching card front, back, or topic title"),
      tag: z.string().optional().describe("Filter by specific card tag"),
      includeSaved: z.boolean().optional().describe("Query the user's permanent flashcard library"),
      page: z.number().optional(),
      limit: z.number().optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const { artifactId, search, tag, includeSaved, page = 1, limit = 10 } = input;

    // If searching library
    if (includeSaved && userId) {
      const savedSets = await learningSelectors.getFlashcardsByUser(userId, {
        search,
        page,
        limit,
        searchFields: ["title", "description", "tags"],
      });
      return {
        success: true,
        source: "library",
        totalSets: savedSets.length,
        sets: savedSets,
      };
    }

    let artifact;
    if (artifactId) {
      artifact = await ArtifactServices.get(sessionId, artifactId);
    } else {
      artifact = await ArtifactServices.getLatest(sessionId, "flashcard_set");
    }

    if (!artifact) {
      return { success: false, exists: false, reason: "No flashcard set artifact found" };
    }

    const content = artifact.content as FlashcardSetContent;
    let cards = [...(content.cards || [])];

    if (tag) {
      const tagLower = tag.toLowerCase();
      cards = cards.filter((c) => (c.tags || []).some((t) => t.toLowerCase() === tagLower));
    }

    if (search) {
      const searchLower = search.toLowerCase();
      cards = cards.filter(
        (c) =>
          c.front.toLowerCase().includes(searchLower) ||
          c.back.toLowerCase().includes(searchLower) ||
          (c.tags || []).some((t) => t.toLowerCase().includes(searchLower)),
      );
    }

    const totalCards = cards.length;
    const startIndex = (page - 1) * limit;
    const paginatedCards = cards.slice(startIndex, startIndex + limit);

    return {
      success: true,
      exists: true,
      artifactId: artifact.artifactId,
      title: artifact.title,
      totalCards,
      page,
      limit,
      totalPages: Math.ceil(totalCards / limit),
      cards: paginatedCards,
    };
  },
);

const updateFlashcardTool = defineToolOnce(
  {
    name: "update_flashcard",
    description: "Update the front, back, or tags of a specific flashcard in a set artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      cardId: z.string(),
      front: z.string().optional(),
      back: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const { artifactId, cardId, front, back, tags } = input;

    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Flashcard artifact not found");

    const content = artifact.content as FlashcardSetContent;
    let found = false;

    (content.cards || []).forEach((c) => {
      if (c.cardId === cardId) {
        if (front) c.front = front;
        if (back) c.back = back;
        if (tags) c.tags = tags;
        found = true;
      }
    });

    if (!found) return { success: false, reason: "Card ID not found in flashcard set" };

    await ArtifactServices.update(sessionId, userId, artifactId, {
      content: content as never,
    });

    return { success: true, artifactId, cardId, updated: true };
  },
);

const deleteFlashcardTool = defineToolOnce(
  {
    name: "delete_flashcard",
    description: "Delete a specific flashcard from a flashcard set artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      cardId: z.string(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const { artifactId, cardId } = input;

    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Flashcard artifact not found");

    const content = artifact.content as FlashcardSetContent;
    content.cards = (content.cards || []).filter((c) => c.cardId !== cardId);

    await ArtifactServices.update(sessionId, userId, artifactId, {
      content: content as never,
    });

    return {
      success: true,
      artifactId,
      cardId,
      remainingCards: content.cards.length,
    };
  },
);

const flashcardSkill: ISkill = {
  name: "flashcard",
  displayName: "Flashcard",
  description:
    "Generate, read, update, and manage flashcard set artifacts and save them to the library.",
  scope: "session",
  category: "implementation",
  tools: [
    getFlashcardsTool,
    generateFlashcardsTool,
    updateFlashcardTool,
    deleteFlashcardTool,
    saveFlashcardsToLibraryTool,
  ],
  phases: ["implementation"],
  autoEquip: (s) => s.mode === "structured",
};

export default flashcardSkill;
