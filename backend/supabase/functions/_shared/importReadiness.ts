export type ImportReadinessStatus = "complete" | "partial" | "failed" | "processing";

export interface ImportReadinessModule {
  name: string;
  actual: number;
  expected: number;
  inferred: boolean;
}

export interface ImportReadinessMetric {
  status: ImportReadinessStatus;
  actual: number;
  expected: 98;
  modules: ImportReadinessModule[];
  matchedQuestions?: number;
  details: string[];
}

export interface ImportReadiness {
  questions: ImportReadinessMetric;
  answer_key: ImportReadinessMetric;
}

export interface ImportReadinessDraft {
  id?: string;
  page_number: number | null;
  section: string | null;
  source_question_number: number | null;
  source_module_name: string | null;
  source_module_position: number | null;
  suggested_answer: string | null;
  created_at?: string | null;
  parser_metadata?: Record<string, unknown> | null;
  answer_keys?: Array<{
    detected_answer?: string | null;
    status?: string | null;
  }> | null;
}

interface ModuleDefinition {
  key: string;
  name: string;
  section: "reading_writing" | "math";
  position: 1 | 2;
  expected: 27 | 22;
}

const MODULES: ModuleDefinition[] = [
  { key: "rw:1", name: "Reading and Writing Module 1", section: "reading_writing", position: 1, expected: 27 },
  { key: "rw:2", name: "Reading and Writing Module 2", section: "reading_writing", position: 2, expected: 27 },
  { key: "math:1", name: "Math Module 1", section: "math", position: 1, expected: 22 },
  { key: "math:2", name: "Math Module 2", section: "math", position: 2, expected: 22 },
];

const EXPECTED_TOTAL = 98 as const;

interface Assignment {
  key: string | null;
  inferred: boolean;
  reason?: string;
}

function sectionFor(value: string | null | undefined): "reading_writing" | "math" | null {
  const normalized = String(value ?? "").toLowerCase().replaceAll("&", "and").replaceAll("_", " ");
  if (/\bmath\b/.test(normalized)) return "math";
  if (/\b(reading|writing|rw)\b/.test(normalized)) return "reading_writing";
  return null;
}

function moduleFromName(value: string | null | undefined): ModuleDefinition | null {
  const normalized = String(value ?? "").toLowerCase().replaceAll("&", "and").replace(/[–—]/g, " ");
  const math = normalized.match(/\bmath\s+(?:module|m)\s*([12])\b/);
  if (math) return MODULES.find((m) => m.section === "math" && m.position === Number(math[1])) ?? null;
  const rw = normalized.match(/\b(?:reading\s+and\s+writing|rw)\s+(?:module|m)\s*([12])\b/);
  if (rw) return MODULES.find((m) => m.section === "reading_writing" && m.position === Number(rw[1])) ?? null;
  return null;
}

function explicitModule(draft: ImportReadinessDraft): ModuleDefinition | null {
  // Position alone is not enough: bank-like parser output can assign every
  // pooled question position 1 even when no module boundary was detected.
  return moduleFromName(draft.source_module_name);
}

function compareDrafts(a: ImportReadinessDraft, b: ImportReadinessDraft): number {
  const pageDiff = (a.page_number ?? Number.MAX_SAFE_INTEGER) - (b.page_number ?? Number.MAX_SAFE_INTEGER);
  if (pageDiff) return pageDiff;
  if (a.source_question_number != null && b.source_question_number != null && a.source_question_number !== b.source_question_number) {
    return a.source_question_number - b.source_question_number;
  }
  const createdDiff = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  if (createdDiff) return createdDiff;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function hasAmbiguousOrder(rows: ImportReadinessDraft[]): boolean {
  const byPageAndNumber = new Set<string>();
  const unknownByPage = new Set<number>();
  for (const row of rows) {
    if (row.page_number == null) return true;
    if (row.source_question_number == null) {
      if (unknownByPage.has(row.page_number)) return true;
      unknownByPage.add(row.page_number);
      continue;
    }
    const key = `${row.page_number}:${row.source_question_number}`;
    if (byPageAndNumber.has(key)) return true;
    byPageAndNumber.add(key);
  }
  return false;
}

function assignmentsFor(rows: ImportReadinessDraft[]): { assignments: Assignment[]; details: string[] } {
  const explicit = rows.map(explicitModule);
  const details: string[] = [];
  if (rows.length > 0 && explicit.every((module) => module !== null)) {
    return { assignments: explicit.map((module) => ({ key: module!.key, inferred: false })), details };
  }

  // The full-test upload flow has a fixed SAT sequence. When module headings
  // are absent, the 98-question sequence itself is sufficient to infer all
  // four canonical module boundaries.
  if (rows.length === EXPECTED_TOTAL) {
    const positional = rows.map((_, index) =>
      index < 27 ? MODULES[0]!
        : index < 54 ? MODULES[1]!
          : index < 76 ? MODULES[2]!
            : MODULES[3]!,
    );
    let conflicts = 0;
    const assignments = positional.map((module, index) => {
      const declared = explicit[index];
      if (declared && declared.key !== module.key) conflicts++;
      return { key: module.key, inferred: !declared };
    });
    if (conflicts > 0) details.push(`${conflicts} question(s) have explicit module labels that conflict with the inferred SAT sequence.`);
    if (hasAmbiguousOrder(rows)) details.push("Question order is ambiguous; inferred module boundaries need review.");
    return { assignments, details };
  }

  // For a partial import, use each question's section and source order to
  // divide its questions into 27-question RW or 22-question Math modules.
  const sectionOffsets = { reading_writing: 0, math: 0 };
  const assignments: Assignment[] = [];
  let inferredAny = false;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const declared = explicit[index];
    const section = sectionFor(row.section) ?? declared?.section ?? null;
    if (declared) {
      assignments.push({ key: declared.key, inferred: false });
      continue;
    }
    inferredAny = true;
    if (!section) {
      assignments.push({ key: null, inferred: true, reason: "Module could not be inferred from section or count." });
      continue;
    }
    const target = section === "math" ? 22 : 27;
    const position = Math.floor(sectionOffsets[section] / target) + 1;
    sectionOffsets[section]++;
    const module = MODULES.find((m) => m.section === section && m.position === position);
    if (module) assignments.push({ key: module.key, inferred: true });
    else assignments.push({ key: null, inferred: true, reason: `More than two ${section === "math" ? "Math" : "Reading and Writing"} modules were detected.` });
  }
  if (inferredAny && hasAmbiguousOrder(rows)) details.push("Question order is ambiguous; inferred module boundaries need review.");
  return { assignments, details };
}

function moduleSummaries(counts: Map<string, number>, inferred: Set<string>, extras: Map<string, number>): ImportReadinessModule[] {
  const result: ImportReadinessModule[] = MODULES.map((module) => ({
    name: module.name,
    actual: counts.get(module.key) ?? 0,
    expected: module.expected,
    inferred: inferred.has(module.key),
  }));
  for (const [name, actual] of extras) result.push({ name, actual, expected: 0, inferred: true });
  return result;
}

function duplicateQuestionIds(rows: ImportReadinessDraft[], assignments: Assignment[]): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const assignment = assignments[i]!;
    const number = row.source_question_number;
    if (!assignment.key || number == null || number <= 0) continue;
    const key = `${assignment.key}:${number}`;
    if (seen.has(key)) return true;
    seen.add(key);
    const flags = row.parser_metadata?.parse_flags;
    if (Array.isArray(flags) && flags.includes("duplicate_source_number_conflict")) return true;
  }
  return false;
}

function isImportFailure(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

function baseStatus(status: string, zeroCount: boolean): ImportReadinessStatus | null {
  if (isImportFailure(status)) return "failed";
  if (status !== "completed") return "processing";
  return zeroCount ? "failed" : null;
}

export function summarizePdfImportReadiness(args: {
  importStatus: string;
  drafts: ImportReadinessDraft[];
  rawKeyEntries?: number | null;
}): ImportReadiness {
  const ordered = args.drafts.map((draft, index) => ({ draft, index })).sort((a, b) =>
    compareDrafts(a.draft, b.draft) || a.index - b.index,
  );
  const rows = ordered.map(({ draft }) => draft);
  const { assignments, details: inferenceDetails } = assignmentsFor(rows);
  const questionCounts = new Map(MODULES.map((module) => [module.key, 0]));
  const keyCounts = new Map(MODULES.map((module) => [module.key, 0]));
  const inferredModules = new Set<string>();
  const questionExtras = new Map<string, number>();
  const keyExtras = new Map<string, number>();
  const questionDetails = [...inferenceDetails];
  const keyDetails = [...inferenceDetails];
  let matchedKeyQuestions = 0;
  let mappedKeys = 0;
  let duplicateKeys = false;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const assignment = assignments[index]!;
    if (assignment.key) {
      questionCounts.set(assignment.key, (questionCounts.get(assignment.key) ?? 0) + 1);
      if (assignment.inferred) inferredModules.add(assignment.key);
    } else {
      const extraName = assignment.reason ?? "Unclassified questions";
      questionExtras.set(extraName, (questionExtras.get(extraName) ?? 0) + 1);
      questionDetails.push(assignment.reason ?? "Question module could not be determined.");
    }

    const activeKeys = (row.answer_keys ?? []).filter((key) =>
      key.status !== "rejected" && String(key.detected_answer ?? "").trim().length > 0,
    );
    const hasSuggestedAnswer = String(row.suggested_answer ?? "").trim().length > 0;
    const countForQuestion = Math.max(activeKeys.length, hasSuggestedAnswer ? 1 : 0);
    if (countForQuestion > 1) duplicateKeys = true;
    if (countForQuestion > 0) matchedKeyQuestions++;
    mappedKeys += countForQuestion;
    if (assignment.key) keyCounts.set(assignment.key, (keyCounts.get(assignment.key) ?? 0) + countForQuestion);
    else if (countForQuestion > 0) {
      const extraName = assignment.reason ?? "Unclassified answer keys";
      keyExtras.set(extraName, (keyExtras.get(extraName) ?? 0) + countForQuestion);
    }
  }

  if (duplicateQuestionIds(rows, assignments)) questionDetails.push("Duplicate question numbers were detected within a module.");
  if (duplicateKeys) keyDetails.push("More than one non-rejected answer key is attached to a question.");

  const questionModules = moduleSummaries(questionCounts, inferredModules, questionExtras);
  const keyModules = moduleSummaries(keyCounts, inferredModules, keyExtras);
  const exactQuestionModules = MODULES.every((module) => questionCounts.get(module.key) === module.expected) && questionExtras.size === 0;
  const questionStructureIssue = inferenceDetails.length > 0 || duplicateQuestionIds(rows, assignments);
  const questionState = baseStatus(args.importStatus, rows.length === 0);
  const questionStatus: ImportReadinessStatus = questionState ?? (
    rows.length === EXPECTED_TOTAL && exactQuestionModules && !questionStructureIssue ? "complete" : "partial"
  );

  const rawKeyEntries = Number.isFinite(args.rawKeyEntries) ? Math.max(0, Number(args.rawKeyEntries)) : null;
  const detectedKeys = Math.max(mappedKeys, rawKeyEntries ?? 0);
  const keyState = baseStatus(args.importStatus, detectedKeys === 0);
  const exactKeyModules = MODULES.every((module) => keyCounts.get(module.key) === module.expected) && keyExtras.size === 0;
  const hasUnmatchedRawKeys = rawKeyEntries != null && rawKeyEntries > mappedKeys;
  if (hasUnmatchedRawKeys) keyDetails.push(`${rawKeyEntries! - mappedKeys} detected key entry/entries were not matched to a saved question.`);
  const answerKeyStatus: ImportReadinessStatus = keyState ?? (
    questionStatus === "complete" &&
    mappedKeys === EXPECTED_TOTAL &&
    exactKeyModules &&
    !duplicateKeys &&
    !hasUnmatchedRawKeys &&
    inferenceDetails.length === 0
      ? "complete"
      : "partial"
  );

  return {
    questions: {
      status: questionStatus,
      actual: rows.length,
      expected: EXPECTED_TOTAL,
      modules: questionModules,
      matchedQuestions: rows.length,
      details: [...new Set(questionDetails)],
    },
    answer_key: {
      status: answerKeyStatus,
      actual: mappedKeys,
      expected: EXPECTED_TOTAL,
      modules: keyModules,
      matchedQuestions: matchedKeyQuestions,
      details: [...new Set(keyDetails)],
    },
  };
}
