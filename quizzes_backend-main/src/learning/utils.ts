import OpenAI from "openai";
import axios from "axios";
import * as cheerio from "cheerio";
import { Types } from "mongoose";
import { GOOGLE_CONFIG, OPENROUTER_CONFIG } from "@/ai/config";
import { IMaterial, TextChunk, MaterialSearchResult } from "./interfaces";
import { Material } from "./models";
import { logger } from "@/config";
import { maskId, addToSet, getSetMembers } from "@/utils";

export function estimateTokens(text: string): number {
  // Approximate: 1 token ≈ 4 chars
  return Math.ceil(text.length / 4);
}

export function chunkDocument(
  text: string,
  maxTokens = 400,
  pageNumber?: number,
): TextChunk[] {
  const MAX_CHARS = maxTokens * 4; // approximate

  const chunks: TextChunk[] = [];

  // Split into sections by markdown-style headings or double newlines
  const sections = text.split(/\n(?=#{1,6}\s)/);

  for (const section of sections) {
    const sectionTitle = section.match(/^#{1,6}\s+(.*)/m)?.[1] ?? undefined;

    // Split section into paragraphs
    const paragraphs = section
      .split(/\n\n+/)
      .filter((p) => p.trim().length >= 20);

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed.length < 20) continue;

      if (trimmed.length <= MAX_CHARS) {
        chunks.push({ text: trimmed, section: sectionTitle, pageNumber });
      } else {
        // Split by sentences
        const sentences = trimmed.split(/(?<=[.!?])\s+/);
        let current = "";
        for (const sentence of sentences) {
          if (
            (current + " " + sentence).length > MAX_CHARS &&
            current.length > 0
          ) {
            if (current.trim().length >= 20)
              chunks.push({
                text: current.trim(),
                section: sectionTitle,
                pageNumber,
              });
            current = sentence;
          } else {
            current = current ? `${current} ${sentence}` : sentence;
          }
        }
        if (current.trim().length >= 20) {
          chunks.push({
            text: current.trim(),
            section: sectionTitle,
            pageNumber,
          });
        }
      }
    }
  }

  return chunks;
}

export function chunkDocumentPages(
  pages: { pageNumber: number; text: string }[],
  maxTokens = 400,
): TextChunk[] {
  const allChunks: TextChunk[] = [];
  for (const page of pages) {
    const pageChunks = chunkDocument(page.text, maxTokens, page.pageNumber);
    allChunks.push(...pageChunks);
  }
  return allChunks;
}

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const BATCH_SIZE = 100;
const MAX_RETRIES = 3;

function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: OPENROUTER_CONFIG.API_KEY ?? "",
    baseURL: OPENROUTER_CONFIG.BASE_URL,
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delayMs = 500,
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) =>
        setTimeout(r, delayMs * Math.pow(2, attempt - 1)),
      );
    }
  }
  throw new Error("Max retries exceeded");
}

export interface EmbeddedChunk extends TextChunk {
  embedding: number[];
}

async function embedWithGoogleGenAI(texts: string[]): Promise<number[][] | null> {
  if (!GOOGLE_CONFIG.API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${GOOGLE_CONFIG.API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: "models/text-embedding-004",
          content: { parts: [{ text: t }] },
        })),
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (Array.isArray(data.embeddings)) {
      return data.embeddings.map((e: any) => e.values || []);
    }
  } catch (err) {
    logger.warn(`[Embeddings] Google GenAI batch embed warning: ${err}`);
  }
  return null;
}

export async function embedChunks(
  chunks: TextChunk[],
): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    // 1. Primary: Free Google GenAI text-embedding-004
    const googleEmbeddings = await embedWithGoogleGenAI(texts);
    if (googleEmbeddings && googleEmbeddings.length === batch.length) {
      for (let j = 0; j < batch.length; j++) {
        results.push({
          ...batch[j],
          embedding: googleEmbeddings[j],
        });
      }
      continue;
    }

    // 2. Secondary: OpenAI / OpenRouter client fallback
    try {
      const client = getOpenAIClient();
      const response = await withRetry(() =>
        client.embeddings.create({ model: EMBEDDING_MODEL, input: texts }),
      );

      for (let j = 0; j < batch.length; j++) {
        results.push({
          ...batch[j],
          embedding: (response as any).data[j].embedding,
        });
      }
    } catch (err) {
      logger.warn(
        `[embedChunks] Embedding failed for batch (${err instanceof Error ? err.message : err}), saving text chunks for keyword search`,
      );
      for (let j = 0; j < batch.length; j++) {
        results.push({
          ...batch[j],
          embedding: [],
        });
      }
    }
  }

  return results;
}

export async function embedQuery(query: string): Promise<number[]> {
  // 1. Primary: Free Google GenAI text-embedding-004
  if (GOOGLE_CONFIG.API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GOOGLE_CONFIG.API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text: query }] },
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.embedding?.values)) {
          return data.embedding.values;
        }
      }
    } catch {
      // ignore, fall through to OpenRouter or keyword search
    }
  }

  // 2. Secondary: OpenRouter/OpenAI embeddings
  try {
    const client = getOpenAIClient();
    const response = await withRetry(() =>
      client.embeddings.create({ model: EMBEDDING_MODEL, input: [query] }),
    );
    return (response as any).data[0].embedding;
  } catch {
    // 3. Fallback: Return empty array to trigger MongoDB regex keyword search
    return [];
  }
}

export async function attachFilenames(
  chunks: {
    chunkId: string;
    materialId: string;
    text: string;
    section?: string;
    pageNumber?: number;
    score?: number;
  }[],
  context: { sessionId?: string; materialIds?: string[] },
): Promise<MaterialSearchResult[]> {
  const filter: any = {};
  if (context.sessionId) {
    filter.sessionId = context.sessionId;
  } else if (context.materialIds && context.materialIds.length > 0) {
    filter._id = { $in: context.materialIds };
  } else {
    // Fallback: fetch materials for the specific chunks provided
    const materialIds = [...new Set(chunks.map((c) => c.materialId))];
    filter._id = { $in: materialIds };
  }

  const materials = await Material.find(filter).lean();
  const filenameMap = new Map<string, string>(
    materials.map((m: IMaterial) => [String(m._id), m.filename]),
  );

  return chunks.map((c) => ({
    chunkId: c.chunkId,
    materialId: c.materialId,
    filename: filenameMap.get(String(c.materialId)) ?? "Unknown File",
    text: c.text,
    section: c.section,
    pageNumber: c.pageNumber,
    score: c.score ?? 0,
  }));
}

export function normalizeQuiz(
  quiz: any,
  options: { stripQuestions?: boolean } = {},
): any {
  if (!quiz) return null;

  // Handle mongoose document vs lean object
  const raw = quiz.toObject ? quiz.toObject() : quiz;

  const lectures = (raw.lectures || []).map((l: any) => ({
    ...l,
    lectureId: String(l.lectureId || l._id || ""),
    lectureTitle: l.lectureTitle || l.title,
    topics: (l.topics || []).map((t: any) => {
      // Flatten questionGroups if they exist (System Quiz format)
      let questions = t.questions || [];
      if (t.questionTypes && t.questionTypes.length > 0) {
        questions = t.questionTypes.flatMap((qt: any) => qt.questions || []);
      }

      const qCount = questions.length;

      // Normalize each question if we aren't stripping them
      const normalizedQuestions = options.stripQuestions
        ? []
        : questions.map((q: any) => {
            if (!q || typeof q === "string" || q instanceof Types.ObjectId) {
              return q; // Still an ID
            }
            return {
              ...q,
              id: String(q._id || q.id),
              correctAnswer: q.correctAnswer || q.answer,
              // Normalize type (e.g. "true-false" -> "true_false")
              type: (q.type || "mcq").toLowerCase().replace(/-/g, "_"),
            };
          });

      return {
        ...t,
        topicTitle: t.topicTitle || t.title,
        questions: normalizedQuestions,
        questionCount: qCount,
      };
    }),
  }));

  return {
    ...raw,
    id: String(raw._id || raw.id),
    lectures,
  };
}

// --- ACADEMIC TERM NORMALIZATION ---

/**
 * Standardizes semester strings across the application.
 * Returns either "Semester 1" or "Semester 2".
 */
export const normalizeSemester = (raw?: string | null): string => {
  if (!raw) return "Semester 1";
  const str = String(raw).trim().toLowerCase();

  if (str === "1" || str.includes("sem 1") || str.includes("semester 1") || str.includes("first")) {
    return "Semester 1";
  }
  if (str === "2" || str.includes("sem 2") || str.includes("semester 2") || str.includes("second")) {
    return "Semester 2";
  }

  if (str.startsWith("sem")) {
    return str.replace(/^sem(ester)?\s*/i, "Semester ");
  }

  return "Semester 1";
};

/**
 * Standardizes academic year strings across the application to "YYYY-YYYY" format (hyphenated).
 * Example inputs: "2025/2026", "2025 - 2026", "2026", "2025-2026"
 * Output: "2025-2026"
 */
export const normalizeAcademicYear = (raw?: string | null): string => {
  if (!raw) return "2025-2026";
  const str = String(raw).trim();

  if (/^\d{4}-\d{4}$/.test(str)) {
    return str;
  }

  const slashMatch = str.match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2]}`;
  }

  if (/^\d{4}$/.test(str)) {
    const endYear = Number(str);
    return `${endYear - 1}-${endYear}`;
  }

  const hyphenMatch = str.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (hyphenMatch) {
    return `${hyphenMatch[1]}-${hyphenMatch[2]}`;
  }

  return "2025-2026";
};

// --- TIMETABLE SCRAPER & PARSER UTILITIES ---

export interface ScrapedVenueMapping {
  venue: string;
  indexStart?: string;
  indexEnd?: string;
}

export interface ScrapedTimetableEntry {
  courseCode: string;
  courseTitle: string;
  campus: string;
  label?: string;
  semester: string;
  academicYear: string;
  date: string;
  time: string;
  venues: ScrapedVenueMapping[];
  assignedVenue?: string;
  college?: string;
  examMode?: string;
  // New fields for richer inspection and change detection
  venueStatus?: string;        // e.g. "PENDING", "Pending Schedule"
  scheduleStatus?: string;     // e.g. "Scheduled", "Not Scheduled"
  venueVisible?: boolean;      // e.g. true/false from VENUE_VISIBLE
}

export const normalizeCourseCode = (code: string) => {
  const normalized = code.replace(/\s+/g, "").toUpperCase();
  const match = normalized.match(/^([A-Z]+)(\d+.*)$/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return normalized;
};

/**
 * Extracts the index range (XXXX-XXXX) from a venue string.
 * Returns null if no range is found.
 */
const extractIndexRange = (venue: string): { start: string; end: string } | null => {
  // Match patterns like (11329893-11329893) or (11329893)
  const rangeMatch = venue.match(/\((\d+)\s*-\s*(\d+)\)/);
  if (rangeMatch) {
    return { start: rangeMatch[1], end: rangeMatch[2] };
  }

  // Also try matching patterns like (11329893) which is a single number
  const singleMatch = venue.match(/\((\d+)\)/);
  if (singleMatch) {
    return { start: singleMatch[1], end: singleMatch[1] };
  }

  return null;
};

/**
 * Strips the index range from a venue string.
 * "CENTRAL CAFETERIA (11329893-11329893)" -> "CENTRAL CAFETERIA"
 */
const stripIndexRange = (venue: string): string => {
  return venue.replace(/\s*\(\d+(?:\s*-\s*\d+)?\)\s*$/, '').trim();
};

/**
 * Extracts the student IDs embedded in a venue name's index-range suffix,
 * e.g. "CENTRAL CAFETERIA (11329893-11329893)" → ["11329893"], or a real
 * range "(11014444-11318179)" → ["11014444", "11318179"]. These endpoint IDs
 * are valid probe targets for the per-student timetable API.
 */
export const extractEmbeddedVenueIds = (venue: string): string[] => {
  const range = extractIndexRange(String(venue ?? ""));
  if (!range) return [];
  return range.start === range.end
    ? [range.start]
    : [range.start, range.end];
};

/**
 * Deduplicates venues that have the same index range.
 * When duplicates are found, keeps the longer (more descriptive) venue name.
 * Also strips the index range from the final venue name.
 */
export const deduplicateVenues = (venues: ScrapedVenueMapping[]): ScrapedVenueMapping[] => {
  if (!venues || venues.length === 0) return [];

  // Group venues by their index range
  const groupsByRange = new Map<string, ScrapedVenueMapping[]>();
  const noRangeVenues: ScrapedVenueMapping[] = [];

  for (const v of venues) {
    const range = extractIndexRange(v.venue);
    if (range) {
      const key = `${range.start}-${range.end}`;
      if (!groupsByRange.has(key)) {
        groupsByRange.set(key, []);
      }
      groupsByRange.get(key)!.push(v);
    } else {
      noRangeVenues.push(v);
    }
  }

  // For each group, pick the venue with the longer name (more descriptive)
  const deduplicated: ScrapedVenueMapping[] = [];

  for (const [rangeKey, group] of groupsByRange.entries()) {
    if (group.length === 1) {
      // Only one venue in this range, just strip the range
      const v = group[0];
      deduplicated.push({
        ...v,
        venue: stripIndexRange(v.venue),
      });
    } else {
      // Multiple venues with the same range, pick the longer name
      const longest = group.reduce((a, b) =>
        a.venue.length >= b.venue.length ? a : b
      );

      // Extract the start/end from the range key
      const [start, end] = rangeKey.split('-');

      deduplicated.push({
        venue: stripIndexRange(longest.venue),
        indexStart: start,
        indexEnd: end,
      });
    }
  }

  // Add venues without ranges
  for (const v of noRangeVenues) {
    deduplicated.push({
      ...v,
      venue: stripIndexRange(v.venue),
    });
  }

  return deduplicated;
};

/**
 * Parses date string (e.g. "2026-08-30" or "August 30, 2026") and time string (e.g. "11:30 AM" or "7:30 am") into a valid Date object.
 *
 * Returns null when there is no usable exam date. Callers must skip such
 * entries rather than fabricate a date — falling back to "now" here used to
 * create a fresh duplicate session on every sync for courses whose exam date
 * is still TBD at the university (e.g. take-home exams).
 */
export const parseScheduledDateTime = (
  dateStr: string,
  timeStr: string,
): Date | null => {
  if (!dateStr || !dateStr.trim()) return null;

  const dateParts = dateStr.split("-").map(Number);
  let year: number | null = null;
  let month = 0;
  let day = 1;
  let hours = 8;
  let minutes = 0;

  if (dateParts.length === 3 && !dateParts.some(isNaN)) {
    year = dateParts[0];
    month = dateParts[1] - 1;
    day = dateParts[2];
  } else {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      year = parsed.getFullYear();
      month = parsed.getMonth();
      day = parsed.getDate();
    }
  }

  // Date string was present but could not be parsed — treat it the same as a
  // missing date instead of inventing one.
  if (year === null) return null;

  const timeMatch = (timeStr || "").match(/(\d{1,2})[:.](\d{2})\s*([ap]m)?/i);
  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    const meridiem = (timeMatch[3] || "").toLowerCase();
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  }

  return new Date(Date.UTC(year, month, day, hours, minutes, 0));
};

/**
 * Splits and standardizes combined course codes like PHIL310/314 or PAHS303/HSMA303.
 */
export const expandCourseCodes = (rawCode: string): string[] => {
  if (!rawCode) return [];

  const segments = rawCode.split("/");
  const results: string[] = [];
  let lastPrefix = "";

  for (const segment of segments) {
    const trimmed = segment.trim().toUpperCase().replace(/\s+/g, "");
    if (!trimmed) continue;

    const match = trimmed.match(/^([A-Z]+)?(\d+.*)$/);
    if (match) {
      const prefix = match[1] || lastPrefix;
      const number = match[2];

      if (prefix) {
        results.push(`${prefix} ${number}`);
        lastPrefix = prefix;
      } else {
        results.push(trimmed);
      }
    } else {
      results.push(trimmed);
    }
  }

  return [...new Set(results)];
};

const extractDateAndTimeFromBody = (bodyText: string) => {
  const normalizedText = bodyText.replace(/\s+/g, " ").trim();

  const examLabelDateMatch = normalizedText.match(
    /Exam\s+Date\s*[:|]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
  );
  const examLabelTimeMatch = normalizedText.match(
    /Exams?\s+Time\s*[:|]?\s*(\d{1,2}[:.]\d{2}\s*[ap]m)/i,
  );

  if (examLabelDateMatch && examLabelTimeMatch) {
    return {
      date: examLabelDateMatch[1].trim(),
      time: examLabelTimeMatch[1].replace(/\s+/g, " ").trim().toLowerCase(),
    };
  }

  const strictMatch = normalizedText.match(
    /(?:Exam\s+Date|Date):\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\|\s*(?:Exams?\s+Time|Time):\s*(\d{1,2}[:.]\d{2}\s*[ap]m)/i,
  );

  if (strictMatch) {
    return {
      date: strictMatch[1].trim(),
      time: strictMatch[2].replace(/\s+/g, " ").trim().toLowerCase(),
    };
  }

  const fallbackMatch = normalizedText.match(
    /(?:Exam\s+Date|Date):\s*([^|]+?)\s*\|\s*(?:Exams?\s+Time|Time):\s*(\d{1,2}[:.]\d{2}\s*[ap]m)(?=\s+(?:Campus|Venue|Venues)\s*:|\s*$)/i,
  );

  return {
    date: fallbackMatch?.[1].trim() ?? "",
    time: fallbackMatch?.[2].replace(/\s+/g, " ").trim().toLowerCase() ?? "",
  };
};

const extractVenueBlockFromBody = (bodyText: string) => {
  const normalizedText = bodyText.replace(/\s+/g, " ").trim();
  const venueBlockMatch = normalizedText.match(
    /Venue\(s\)\s*\/\s*Index\s*Range\s*(.+?)\s*(?:No\.\s*of\s*Student|University\s+Of\s+Ghana|Additional\s+Links|$)/i,
  );

  return venueBlockMatch?.[1]?.trim() ?? "";
};

const NOISE_LABELS = [
  "course level",
  "exams status",
  "exam date",
  "exams time",
  "campus",
  "no. of student",
  "additional links",
  "exams calender",
  "search schedules",
  "schedule generator",
];

const extractRowMap = ($: ReturnType<typeof cheerio.load>) => {
  const rows: Record<string, string> = {};

  $("tr").each((_, tr) => {
    const cells = $(tr).find("th, td").toArray();
    if (cells.length < 2) return;

    const label = $(cells[0]).text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $(cells[cells.length - 1])
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (
      label &&
      value &&
      !NOISE_LABELS.some((noise) => label.includes(noise))
    ) {
      rows[label] = value;
    }
  });

  return rows;
};

export const getScheduledDates = async (): Promise<string[]> => {
  const url = `https://sts.ug.edu.gh/timetable/getdates`;
  logger.info(`[Scraper] Fetching all scheduled dates from STS`);

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!Array.isArray(response.data)) return [];

    const dates = response.data
      .map((event: any) => {
        if (event.exam_date) return event.exam_date;
        if (event.start && event.title?.toLowerCase().includes("scheduled")) {
          return event.start;
        }
        return null;
      })
      .filter((date: string) => !!date);

    const uniqueSortedDates = [...new Set(dates)].sort() as string[];
    logger.info(
      `[Scraper] Successfully discovered ${uniqueSortedDates.length} scheduled dates.`,
    );
    return uniqueSortedDates;
  } catch (error: any) {
    logger.error(`[Scraper] Error fetching scheduled dates: ${error.message}`);
    return [];
  }
};

const parseVenueMappings = (venueText: string): ScrapedVenueMapping[] => {
  const normalizedVenueText = venueText.replace(/\s+/g, " ").trim();
  const mappings: ScrapedVenueMapping[] = [];

  const rangePattern = /(.+?)\s*\|\s*\[\s*(\d+)\s*-\s*(\d+)\s*\]/g;
  for (const match of normalizedVenueText.matchAll(rangePattern)) {
    const venue = match[1].trim().replace(/\s*\|\s*$/, "");
    if (!venue) continue;

    mappings.push({
      venue,
      indexStart: match[2],
      indexEnd: match[3],
    });
  }

  if (mappings.length > 0) {
    return mappings;
  }

  return normalizedVenueText
    .split(",")
    .map((text) => text.trim())
    .filter(
      (text) =>
        text.length > 0 &&
        !/Exams\s+Calender|Search\s+Schedules|Schedule\s+Generator/i.test(text),
    )
    .map((venue) => ({ venue }));
};

/**
 * Deduplicates venue mappings so repeated syncs don't accumulate duplicates.
 *
 * Two venues are duplicates when they resolve to the same student index range,
 * or — when a venue carries no range — when they share the same normalized
 * name. The range is read from `indexStart`/`indexEnd` first (the runtime
 * source of truth, see resolveVenueForStudentId), falling back to a
 * `(XXXX-XXXX)` suffix embedded in the venue name. One venue is kept per key;
 * when several share a key the longest (most descriptive) name wins. Any
 * embedded range suffix is stripped from the surviving name, and the range is
 * preserved in `indexStart`/`indexEnd` so stripping never loses it. First-seen
 * order is preserved.
 */
export const dedupeVenueMappings = <
  T extends { venue: string; indexStart?: string; indexEnd?: string },
>(
  venues: T[],
): T[] => {
  if (!venues || venues.length <= 1) return venues ?? [];

  const normDigits = (value: unknown): string =>
    String(value ?? "").replace(/\D/g, "");

  const rangeOf = (
    v: T,
  ): { start: string; end: string } | null => {
    const start = normDigits(v.indexStart);
    const end = normDigits(v.indexEnd);
    if (start && end) return { start, end };

    const nameMatch = String(v.venue ?? "").match(/\((\d+)\s*-\s*(\d+)\)/);
    if (nameMatch) {
      return { start: normDigits(nameMatch[1]), end: normDigits(nameMatch[2]) };
    }
    return null;
  };

  const stripRange = (name: string): string =>
    name.replace(/\s*\(\d+(?:\s*-\s*\d+)?\)\s*$/, "").trim();

  const kept = new Map<string, T>();
  const order: string[] = [];

  for (const v of venues) {
    const range = rangeOf(v);
    const cleanName = stripRange(String(v.venue ?? "")).trim();
    const cleaned = {
      ...v,
      venue: cleanName,
      ...(range
        ? {
            indexStart: v.indexStart || range.start,
            indexEnd: v.indexEnd || range.end,
          }
        : {}),
    } as T;

    const key = range
      ? `range:${range.start}-${range.end}`
      : `name:${cleanName.toUpperCase()}`;

    if (!kept.has(key)) {
      kept.set(key, cleaned);
      order.push(key);
      continue;
    }

    const existing = kept.get(key)!;
    if (cleanName.length > String(existing.venue ?? "").length) {
      kept.set(key, cleaned);
    }
  }

  return order.map((key) => kept.get(key)!);
};

export const scrapeDailyTimetable = async (
  dateStr: string,
): Promise<ScrapedTimetableEntry[]> => {
  const url = `https://sts.ug.edu.gh/timetable/thedate/${dateStr}`;
  logger.info(`[Scraper] Fetching daily list for ${dateStr}`);

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(response.data);
    const entries: ScrapedTimetableEntry[] = [];

    const courseLinks = $('a[href*="/timetable/details/"]');
    for (const link of courseLinks.toArray()) {
      const $link = $(link);
      const detailUrlPath = $link.attr("href");
      if (!detailUrlPath) continue;

      const fullDetailUrl = detailUrlPath.startsWith("http")
        ? detailUrlPath
        : `https://sts.ug.edu.gh${detailUrlPath}`;

      const headerText = $link.text().trim();
      const parts = headerText.split("-");

      const rawCode = parts[0]?.trim() || "UNKNOWN";
      const campusOrLabel = parts[1]?.trim() || "";
      const courseTitleBase = parts.slice(2).join("-").trim();

      const courses = expandCourseCodes(rawCode);

      try {
        const details = await scrapeCourseDetails(fullDetailUrl);
        for (const courseCode of courses) {
          entries.push({
            courseCode,
            courseTitle: courseTitleBase || courseCode,
            campus: details.campus || "Main Campus",
            label: campusOrLabel,
            semester: details.semester,
            academicYear: details.academicYear,
            date: details.date,
            time: details.time,
            venues: details.venues,
          });
        }
      } catch (err: any) {
        logger.error(
          `[Scraper] Failed details for ${headerText}: ${err.message}`,
        );
      }
    }

    return entries;
  } catch (error: any) {
    logger.error(`[Scraper] Error fetching daily list: ${error.message}`);
    throw error;
  }
};

export const scrapeCourseDetails = async (
  url: string,
): Promise<{
  date: string;
  time: string;
  venues: ScrapedVenueMapping[];
  semester: string;
  academicYear: string;
  campus: string;
}> => {
  const response = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const $ = cheerio.load(response.data);
  const rowMap = extractRowMap($);

  const bodyText = $("body").text();
  const bodyDateTime = extractDateAndTimeFromBody(bodyText);

  const academyInfo = bodyText.match(
    /Exam\s+Schedule\s+For\s+([^,]+),\s+(.+?)(?=\s+Exam|$)/i,
  );
  const semester = normalizeSemester(academyInfo?.[1]?.trim() || "Semester 2");
  const academicYear = normalizeAcademicYear(academyInfo?.[2]?.trim() || "2025-2026");

  const date = rowMap["exam date"] || rowMap["date"] || bodyDateTime.date;
  const time = (
    rowMap["exams time"] ||
    rowMap["exam time"] ||
    rowMap["time"] ||
    bodyDateTime.time
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!date || !time) {
    throw new Error(`Unable to extract exam date/time from ${url}`);
  }

  const campus = rowMap["campus"] || "Main Campus";
  const venues: ScrapedVenueMapping[] = [];

  $("tr, div.row").each((_, row) => {
    const text = $(row).text();
    if (/Venue\(s\)\s*\/\s*Index\s*Range/i.test(text)) {
      $(row)
        .find("li")
        .each((__, li) => {
          const liText = $(li).text().trim();
          const parts = liText.split("|");
          const venueName = parts[0]?.trim();
          const rangePart = parts[1]?.trim();

          if (venueName) {
            const rangeMatch = rangePart?.match(/\[\s*(\d+)\s*-\s*(\d+)\s*\]/);
            if (rangeMatch) {
              venues.push({
                venue: venueName,
                indexStart: rangeMatch[1],
                indexEnd: rangeMatch[2],
              });
            } else {
              venues.push({ venue: venueName });
            }
          }
        });
    }
  });

  if (venues.length === 0) {
    const venueRow =
      rowMap["venue(s) / index range"] || rowMap["venue(s)"] || "";
    if (venueRow) {
      venues.push(...parseVenueMappings(venueRow));
    }
  }

  if (venues.length === 0) {
    const venueBlock = extractVenueBlockFromBody(bodyText);
    if (venueBlock) {
      venues.push(...parseVenueMappings(venueBlock));
    }
  }

  return { date, time, venues, semester, academicYear, campus };
};

/**
 * Fetches official exam timetable records for a specific student from the university REST endpoint.
 */
export const fetchUgStudentTimetable = async (
  studentId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    acadYear?: string;
    semester?: string;
    courseCode?: string;
  },
): Promise<ScrapedTimetableEntry[]> => {
  const cleanStudentId = studentId.trim().replace(/\D/g, "");
  if (!cleanStudentId) {
    throw new Error("A valid numeric Student ID is required.");
  }

  const queryParams = new URLSearchParams({
    mode: "exam",
    studid: cleanStudentId,
    acadyear: options?.acadYear || "",
    semester: options?.semester || "",
    startdate: options?.startDate || "",
    enddate: options?.endDate || "",
    coursecode: options?.courseCode || "",
  });

  const url = `https://graduation.ug.edu.gh/uggraduation/graduationbackend/api/attendanceMgt/student_timetable.php?${queryParams.toString()}`;

  logger.info(
    `[Timetable] Fetching official timetable for student ${maskId(cleanStudentId)}`,
  );

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
      },
    });

    const records = response.data?.records;
    if (!Array.isArray(records) || records.length === 0) {
      logger.info(
        `[Timetable] No exam records returned for student ${maskId(cleanStudentId)}`,
      );
      return [];
    }

    const entries: ScrapedTimetableEntry[] = [];

    for (const rec of records) {
      if (!rec || !rec.COURSECODE) continue;

      const rawCode = String(rec.COURSECODE).trim();
      const courseCode = normalizeCourseCode(rawCode);
      const courseTitle = String(rec.COURSETITLE || rawCode).trim();

      const rawYear = String(rec.ACADEMIC_YEAR || "").trim();
      const academicYear = normalizeAcademicYear(rawYear);

      const rawSem = String(rec.SEMESTER || "2").trim();
      const semester = normalizeSemester(rawSem);

      const date = String(rec.EXAMDATE || "").trim();
      const time = String(
        rec.EXAMTIME_DISPLAY || rec.EXAMTIME || "7:30 AM",
      ).trim();

      const venueName = String(
        rec.VENUE || rec.ASSIGNED_VENUE || "Assigned by Department",
      ).trim();
      const assignedVenue = String(rec.ASSIGNED_VENUE || rec.VENUE || "").trim();

      // Process venues with deduplication
      let venues: ScrapedVenueMapping[] = venueName
        ? [{ venue: venueName }]
        : [];

      // Apply venue deduplication to remove duplicates like "CENTRAL CAFETERIA (11329893-11329893)" vs "CC (11329893-11329893)"
      venues = deduplicateVenues(venues);

      entries.push({
        courseCode,
        courseTitle,
        campus: "Main Campus",
        label: rec.EXAMSESSION || "MAIN",
        semester,
        academicYear,
        date,
        time,
        venues,
        assignedVenue: assignedVenue || undefined,
        college: rec.COLLEGE || undefined,
        examMode: rec.EXAMMODE || undefined,
        // New fields from the API
        venueStatus: rec.VENUE_STATUS || undefined,
        scheduleStatus: rec.SCHEDULE_STATUS || undefined,
        venueVisible: typeof rec.VENUE_VISIBLE === "boolean" ? rec.VENUE_VISIBLE : undefined,
      });
    }

    logger.info(
      `[Timetable] Successfully parsed ${entries.length} official exam entries for student ${maskId(cleanStudentId)}`,
    );
    return entries;
  } catch (error: any) {
    logger.error(
      `[Timetable] Error fetching official timetable for student ${maskId(cleanStudentId)}: ${error.message}`,
    );
    throw error;
  }
};

// ─── Crowd-Sourced Student ID Pool ──────────────────────────────────────────

const CROWDSOURCED_IDS_KEY = "timetable:crowdsourced_student_ids";

const isValidStudentId = (cleanId: string): boolean =>
  cleanId.length >= 7 && cleanId.length <= 10;

export const rememberCrowdsourcedStudentId = async (
  studentId: string,
): Promise<void> => {
  const cleanId = (studentId || "").trim().replace(/\D/g, "");
  if (!isValidStudentId(cleanId)) return;
  await addToSet(CROWDSOURCED_IDS_KEY, cleanId);
};

export const rememberCrowdsourcedStudentIds = async (
  studentIds: string[],
): Promise<void> => {
  const cleanIds = studentIds
    .map((id) => (id || "").trim().replace(/\D/g, ""))
    .filter(isValidStudentId);
  if (cleanIds.length === 0) return;
  await addToSet(CROWDSOURCED_IDS_KEY, ...cleanIds);
};

export const getCrowdsourcedStudentIds = async (): Promise<string[]> => {
  return await getSetMembers(CROWDSOURCED_IDS_KEY);
};



