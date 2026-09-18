/**
 * Duplicate detection for parsed SAT questions (flag-for-review only).
 *
 * Exact-match fingerprint over normalized content. Source identity (test
 * name, module name, question number, page) is deliberately excluded so the
 * same question surfacing in 2-3 tests lands in one group. Near matches are
 * NOT auto-grouped — they surface as review candidates via stem buckets.
 */
import { createHash } from "node:crypto";

export interface FingerprintableQuestion {
  section: string;
  questionType: string;
  passageText: string | null;
  prompt: string;
  choices: Array<{ label: string; text: string }>;
  suggestedAnswer?: string | null;
}

/** Normalize OCR text for comparison: lowercase, unify punctuation/space. */
export function normalizeContentText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”«»„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[—–―]/g, "-")
    .replace(/\.{2,}/g, " ")
    .replace(/_{2,}/g, " ____ ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

/**
 * Exact-match fingerprint. Ordered choices matter (reordered choices change
 * answer labels, so those stay separate). Suggested answer included when
 * present — same stem with a different key is suspicious, not identical.
 */
export function fingerprintQuestion(q: FingerprintableQuestion): string {
  const parts = [
    q.section,
    q.questionType,
    normalizeContentText(q.passageText ?? ""),
    normalizeContentText(q.prompt),
    ...q.choices.map((c) => `${c.label.toUpperCase()}=${normalizeContentText(c.text)}`),
  ];
  if (q.suggestedAnswer) parts.push(`key=${normalizeContentText(q.suggestedAnswer)}`);
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

/**
 * Coarse stem bucket for near-duplicate review: first 10 significant words
 * of the normalized prompt, prefixed by section + choice count.
 */
export function stemBucket(q: FingerprintableQuestion): string {
  const words = normalizeContentText(q.prompt)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 10)
    .join(" ");
  return `${q.section}|mc${q.choices.length}|${words}`;
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "which", "what",
  "choice", "best", "most", "text", "based", "according", "following",
]);

export interface DuplicateOccurrence {
  file: string;
  moduleName: string | null;
  questionNumber: number;
  pageNumber: number;
}

export interface DuplicateGroup {
  fingerprint: string;
  size: number;
  occurrences: DuplicateOccurrence[];
}

/** Group exact duplicates (size >= 2). Deterministic order. */
export function groupExactDuplicates(
  items: Array<{ fingerprint: string; occurrence: DuplicateOccurrence }>,
): DuplicateGroup[] {
  const byFp = new Map<string, DuplicateOccurrence[]>();
  for (const it of items) {
    if (!byFp.has(it.fingerprint)) byFp.set(it.fingerprint, []);
    byFp.get(it.fingerprint)!.push(it.occurrence);
  }
  const groups: DuplicateGroup[] = [];
  for (const [fp, occ] of byFp) {
    if (occ.length < 2) continue;
    occ.sort((a, b) => a.file.localeCompare(b.file) || (a.questionNumber - b.questionNumber));
    groups.push({ fingerprint: fp, size: occ.length, occurrences: occ });
  }
  groups.sort((a, b) => b.size - a.size || a.fingerprint.localeCompare(b.fingerprint));
  return groups;
}
