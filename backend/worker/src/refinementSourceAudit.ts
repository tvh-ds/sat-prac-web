export interface SourceAuditPage {
  pageNumber: number;
  text: string;
}

export const SOURCE_KEY_MODULES = [
  { name: "Reading and Writing Module 1", expected: 27 },
  { name: "Reading and Writing Module 2", expected: 27 },
  { name: "Math Module 1", expected: 22 },
  { name: "Math Module 2", expected: 22 },
] as const;

export interface ScopedKeyEntry { n: number; answer: string }

export function extractModuleScopedAnswerKeys(pages: SourceAuditPage[]): {
  columns: number[];
  exact: boolean;
  answersByModule: Map<string, string[]>;
  sequencesByModule: Map<string, number[]>;
  firstRow: Array<ScopedKeyEntry | undefined>;
  lastRow: Array<ScopedKeyEntry | undefined>;
} {
  const answersByModule = new Map<string, string[]>();
  const entriesByModule = new Map<string, ScopedKeyEntry[]>();
  let current: (typeof SOURCE_KEY_MODULES)[number]["name"] | null = null;
  const moduleByHeading = new Map<string, (typeof SOURCE_KEY_MODULES)[number]["name"]>(
    SOURCE_KEY_MODULES.map((module) => [module.name.toLowerCase(), module.name]),
  );

  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const heading = line.trim().replace(/^#+\s*/, "").match(/^(Reading and Writing|Math)\s+Module\s+([12])\s+Answers?\s*$/i);
      if (heading) {
        current = moduleByHeading.get(`${heading[1]} Module ${heading[2]}`.toLowerCase()) ?? null;
        if (current && !entriesByModule.has(current)) entriesByModule.set(current, []);
        continue;
      }
      if (!current) continue;
      const match = line.trim().match(/^\*{0,2}(\d{1,2})[.)]\*{0,2}\s+(.+?)\s*$/);
      if (!match) continue;
      const answer = match[2]!.replace(/\*+\s*$/, "").trim();
      if (!answer) continue;
      const n = Number(match[1]);
      const currentIndex = SOURCE_KEY_MODULES.findIndex((module) => module.name === current);
      const currentModule = SOURCE_KEY_MODULES[currentIndex];
      const previousModule = currentIndex > 0 ? SOURCE_KEY_MODULES[currentIndex - 1] : undefined;
      const previousEntries = previousModule ? entriesByModule.get(previousModule.name) : undefined;
      // OCR sometimes places the next module heading just above the final
      // one or two keys of the preceding 27-question module. Preserve the
      // printed sequence when an out-of-range number is exactly the next
      // missing slot in that prior module.
      if (currentModule && previousModule && previousEntries &&
        n > currentModule.expected && n === previousEntries.length + 1 && n <= previousModule.expected) {
        previousEntries.push({ n, answer });
      } else {
        entriesByModule.get(current)!.push({ n, answer });
      }
    }
  }

  const columns: number[] = [];
  const sequencesByModule = new Map<string, number[]>();
  let exact = true;
  for (const module of SOURCE_KEY_MODULES) {
    const entries = entriesByModule.get(module.name) ?? [];
    columns.push(entries.length);
    answersByModule.set(module.name, entries.map((entry) => entry.answer));
    sequencesByModule.set(module.name, entries.map((entry) => entry.n));
    if (entries.length !== module.expected || entries.some((entry, index) => entry.n !== index + 1)) exact = false;
  }
  if (SOURCE_KEY_MODULES.some((module) => !entriesByModule.has(module.name))) exact = false;
  const firstRow = SOURCE_KEY_MODULES.map((module) => entriesByModule.get(module.name)?.[0]);
  const lastRow = SOURCE_KEY_MODULES.map((module) => entriesByModule.get(module.name)?.at(-1));
  return { columns, exact, answersByModule, sequencesByModule, firstRow, lastRow };
}

export function normalizeSourceEvidence(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\*+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Normalize all source spans together so words split at a page boundary match. */
export function sourceEvidenceIncludes(spans: string[], candidate: string): boolean {
  return normalizeSourceEvidence(spans.join("\n")).includes(normalizeSourceEvidence(candidate));
}

export function sourceAnswersEquivalent(left: string, right: string): boolean {
  const normalizeAnswer = (value: string) => normalizeSourceEvidence(
    value.normalize("NFKC").replace(/\\(?:mid|cdot|times|div|text|mathrm)\b/g, " "),
  );
  return normalizeAnswer(left) === normalizeAnswer(right);
}

export function normalizeChoiceForPreservation(value: string): string {
  return value.normalize("NFKC").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    // Saved OCR sometimes wraps math/table choices with visual arrow separators.
    .replace(/[\u2190-\u21ff\u27f0-\u27ff]+/g, "")
    .replace(/\s+/g, " ").trim();
}

export function oldChoiceTextsPreserved(
  oldChoices: Array<{ label: string; text: string }>,
  currentChoices: Array<{ label: string; text: string }>,
): boolean {
  return oldChoices.filter((choice) => choice.text.trim().length > 0).every(({ label, text }) => {
    const original = normalizeChoiceForPreservation(text);
    const current = normalizeChoiceForPreservation(
      currentChoices.find((choice) => choice.label === label)?.text ?? "",
    );
    return current === original || (original.length >= 12 && current.startsWith(original));
  });
}
