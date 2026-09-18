import type { PageText } from "./extractor";

/**
 * Fix badly spaced / garbled text produced by OCR or PDF text extraction.
 *
 * Handles patterns observed in real corpus:
 * - "Q u e st i on" → "Question"
 * - "R eading and W riting" → "Reading and Writing"
 * - "M ath" → "Math"
 * - "A)" / "A )" / "A ." → normalized choice markers
 * - "1 . A" → "1. A" (key entries with spaces around period)
 */
export function normalizeText(pages: PageText[]): PageText[] {
  return pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: normalizeTextString(p.text),
  }));
}

/**
 * Collapse repeated escaped-underscore blank runs ("\_\_\_\_\_\_" →
 * "_____"), preserving the blank length. Only runs of 3+ escaped
 * underscores are touched: a standalone "\_" is kept as-is, and other
 * backslashes (LaTeX "\frac", "\sqrt", …) are never affected.
 */
export function normalizeEscapedBlanks(text: string): string {
  return text.replace(/(?:\\_){3,}/g, (m) => "_".repeat(m.length / 2));
}

/** Normalize a single block of text. */
export function normalizeTextString(text: string): string {
  let out = text;

  // Fix escaped blank runs from OCR/markdown ("\_\_\_\_" → "____").
  out = normalizeEscapedBlanks(out);

  // Fix spaced-out words. Two patterns:
  //  1) runs of 1-2 letter clusters separated by spaces: "Q u e st i on"
  //  2) a single leading letter + long fragment: "R eading", "M ath"
  // After collapsing, only apply when the result is a known SAT word.
  out = collapseKnownSpacedWords(out);

  // Normalize choice markers: "A)" "A )" "A." "A ." → "A."
  // Only when at the start of a line (actual choice lines).
  out = out.replace(/^(\s*)([A-H])\s*[.)]\s*/gm, "$1$2. ");

  // Normalize answer-key entries: "1 . A" → "1. A" (space around period in keys).
  out = out.replace(/^(\s*\d{1,3})\s+\.\s+([A-Ha-h]|[+-]?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*$/gm, "$1. $2");

  // Normalize "Module 1: Reading and Writing Question 1" format
  // to separate the heading from the question marker.
  out = out.replace(
    /^(\s*)(Module\s+\d)\s*:\s*(Reading and Writing|Math)\s+(Question\s+\d)\s*$/gm,
    "$1$3 $2\n$1$4",
  );
  // Also handle "Module 1: Reading and Writing" without "Question N"
  out = out.replace(
    /^(\s*)(Module\s+\d)\s*:\s*(Reading and Writing|Math)\s*$/gm,
    "$1$3 $2",
  );

  return out;
}

const KNOWN_SPACED_WORDS = new Set([
  "question",
  "questions",
  "reading",
  "writing",
  "math",
  "module",
  "choice",
  "choices",
  "answer",
  "answers",
  "key",
  "passage",
  "passages",
  "section",
  "test",
  "continue",
  "which",
  "used",
]);

/**
 * Collapse spaced-out runs into contiguous words when the result is a known
 * SAT vocabulary word. Leaves everything else untouched.
 */
function collapseKnownSpacedWords(text: string): string {
  const lines = text.split(/(\n)/);
  return lines
    .map((line) => {
      if (line === "\n") return line;

      // Pattern 1: alternating 1-2 letter clusters: "Q u e st i on"
      // A fallback for single-letter runs: "W h i c h c h o i c e"
      let out = line.replace(/\b(?:[A-Za-z](\s+[A-Za-z]{1,2})+)\b/g, (match) => {
        const collapsed = match.replace(/\s+/g, "");
        if (KNOWN_SPACED_WORDS.has(collapsed.toLowerCase())) return collapsed;
        return match;
      });

      // Pattern 2: leading single letter + 3+ letter fragment: "R eading", "M ath"
      out = out.replace(/\b([A-Za-z])\s+([A-Za-z]{3,})\b/g, (match, a: string, b: string) => {
        const collapsed = a + b;
        if (KNOWN_SPACED_WORDS.has(collapsed.toLowerCase())) return collapsed;
        return match;
      });

      return out;
    })
    .join("");
}

/** Detect if text has badly spaced / garbled words (needs normalization). */
export function hasSpacedText(text: string): boolean {
  // Look for runs of single letters separated by spaces
  return /\b[A-Za-z]\s[A-Za-z]\s[A-Za-z]\b/.test(text);
}
