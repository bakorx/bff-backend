/**
 * Masks an email for safe logging.
 * e.g. "john.doe@example.com" -> "j...e@example.com"
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "unknown";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `*@${domain}`;
  return `${local[0]}...${local[local.length - 1]}@${domain}`;
}

/**
 * Masks IDs/tokens for safe logging.
 * e.g. "67915944632b5101b7ab86ed" -> "6791...86ed"
 */
export function maskId(value?: string | null): string {
  if (!value) return "unknown";
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `${trimmed[0] ?? "*"}***`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Normalizes a name string for use in emails.
 * e.g. "john doe" -> "John Doe", "jane" -> "Jane", "" -> "Subscriber"
 */
export function normalizeName(
  name?: string,
  fallback: string = "Subscriber",
): string {
  if (!name || name.trim().length === 0) return fallback;

  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}


const QUESTION_TYPE_PREFIX_REGEX =
  /^\s*(?:true\s*or\s*false|fill\s*in\s*(?:the\s*)?blank|short\s*answer|essay|multiple\s*choice|mcq)\s*[:\-]\s*/i;

const OPTION_PREFIX_REGEX = /^\s*(?:\(?[A-E]\)|[A-E][\.:\)\-])\s+/i;

/**
 * Removes type labels (e.g. "True or False:", "Essay:") from question text.
 */
export function stripQuestionTypePrefix(text?: string | null): string {
  if (!text) return "";

  let sanitized = text.trim();
  // Guard against stacked prefixes like "Essay: True or False: ...".
  for (let i = 0; i < 3; i += 1) {
    const next = sanitized.replace(QUESTION_TYPE_PREFIX_REGEX, "").trim();
    if (next === sanitized) break;
    sanitized = next;
  }

  return sanitized;
}

/**
 * Removes leading alphabetical choice markers from option text.
 * Examples: "A. Option", "(B) Option", "C) Option", "D - Option".
 */
export function stripOptionPrefix(text?: string | null): string {
  if (!text) return "";
  return text.trim().replace(OPTION_PREFIX_REGEX, "").trim();
}

/**
 * Sanitizes an option array by removing leading choice markers from each option.
 */
export function stripOptionPrefixes(
  options?: Array<string | null | undefined>,
): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => stripOptionPrefix(option ?? ""))
    .filter((option) => option.length > 0);
}
