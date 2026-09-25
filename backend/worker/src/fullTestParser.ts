import type { PageText } from "./extractor";
import {
  parseScraperQuestions,
  looksBluebook,
  expectedQuestionsForSection,
  type ScraperParseResult,
  type ScraperKeyEntry,
} from "./scraperParser";
import { parseAnswerKey, answerMap, parseKeyRow, type ParsedKeyEntry } from "./answerKey";

/**
 * Printed number prefix on bank prompts ("**317** Circle …", "23 Which …",
 * "32. What …"). Prompts starting with data ("18, 18, …", "18qrt …",
 * "3.5 …", "$x …") never match: digits must be followed by a space and a
 * letter opener.
 */
const BANK_PRINTED_RE = /^\*{0,2}(\d{1,4})[.)]?\*{0,2}\s+(?=[A-Za-z$\\(\[])/;

export type ContentScope = "full_test" | "reading_writing" | "math" | "single_module";
export type TargetModule = "rw1" | "rw2" | "math1" | "math2";

export interface FullTestParseOptions {
  contentScope: ContentScope;
  targetModule?: TargetModule | null;
}

export interface FullTestQuestion {
  sourceQuestionNumber: number;
  sourceQuestionNumberOrigin: "observed" | "inferred";
  parseFlags: string[];
  sourceModuleName: string;
  sourceModulePosition: number;
  sourceQuestionId: string | null;
  /** Printed bank/global badge retained when a verified test is renumbered by slot. */
  sourceGlobalQuestionId?: string | null;
  pageNumber: number;
  section: "reading_writing" | "math";
  questionType: "multiple_choice" | "student_produced";
  prompt: string;
  passageText: string | null;
  choices: Array<{ label: string; text: string; position: number }>;
  confidence: number;
  correctAnswer: string | null;
  explanation: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  hasVisualStimulus: boolean;
  /** Number of visual marker spans (passed through from the scraper). */
  visualMarkerCount: number;
}

export interface FullTestParseResult {
  questions: FullTestQuestion[];
  /** Module-scoped key map: "ModuleName|qNum" → { answer, pageNumber, sourceText } */
  keyMap: Map<string, { answer: string; pageNumber: number; sourceText: string }>;
  /** Raw key entries (including global + inferred-module attribution). */
  keyEntries: ParsedKeyEntry[];
  keyConfidence: number;
  modules: ScraperParseResult["modules"];
  method: string;
  scope: ContentScope;
  targetModule: TargetModule | null;
  documentFamily: "full_test" | "section_test" | "question_bank" | "screenshot_compilation";
}

function looksLikeScreenshotCompilation(pages: PageText[], parsed: ScraperParseResult): boolean {
  return pages.length >= 40 && parsed.questions.length >= 40 && parsed.modules.length <= 1 && looksBluebook(pages);
}

function isStrongMathQuestion(q: ScraperParseResult["questions"][number]): boolean {
  const text = q.prompt + " " + q.choices.map((c) => c.text).join(" ");
  return /\b(equation|expression|solution|slope|function|triangle|circle|radius|diameter|quadratic|perpendicular|coordinate|xy-plane|kilograms?|joules?|inches?|centimeters?|area|perimeter|percent|system of equations)\b/i.test(text) ||
    /\$[^$]*(?:=|\\frac|\\sqrt|\^|[<>])[^$]*\$/.test(text);
}

function recoverScreenshotIds(questions: FullTestQuestion[]): void {
  // A screenshot badge can lose its last digit ("321" → "32"). If both
  // neighboring IDs agree on the single missing value, restore it and keep
  // the correction visible for review.
  for (let i = 1; i < questions.length - 1; i++) {
    const q = questions[i]!;
    const prev = questions[i - 1]!;
    const next = questions[i + 1]!;
    if (q.sourceQuestionNumber <= 0 || prev.sourceQuestionNumber <= 0 || next.sourceQuestionNumber <= 0) continue;
    const expected = prev.sourceQuestionNumber + 1;
    if (
      next.sourceQuestionNumber === expected + 1 &&
      q.sourceQuestionNumber !== expected &&
      String(expected).startsWith(String(q.sourceQuestionNumber))
    ) {
      q.sourceQuestionNumber = expected;
      q.sourceQuestionNumberOrigin = "inferred";
      q.parseFlags = [...new Set([...q.parseFlags, "question_id_recovered_from_neighbors"])];
    }
  }
}

const POSITIONAL_NAMES = [
  "Reading and Writing Module 1", "Reading and Writing Module 2",
  "Math Module 1", "Math Module 2",
] as const;
const POSITIONAL_LENGTHS = [27, 27, 22, 22] as const;

/**
 * One-page screenshot exports often lose the global-number badge on Math
 * grid-ins. Isolate each source page so a choice-less question cannot absorb
 * the next page. Never create a question from the synthetic marker alone.
 */
export function recoverScreenshotPages(pages: PageText[], keyPage: number): ScraperParseResult["questions"] | null {
  const candidates: ScraperParseResult["questions"] = [];
  for (const page of pages.filter((item) => item.pageNumber < keyPage)) {
    const raw = parseScraperQuestions([page]).questions;
    const marker = /^\s*(?:\*{0,2}\d{3,4}[.)]?\*{0,2})\s+(?=[A-Z])/;
    const lines = page.text.split("\n");
    const starts = lines.flatMap((line, index) => marker.test(line) ? [index] : []);
    let splitQuestions: ScraperParseResult["questions"] | null = null;
    if (starts.length >= 2 && raw.length < starts.length) {
      const split = starts.map((start, index) => {
        const body = lines.slice(start, starts[index + 1] ?? lines.length).join("\n");
        return parseScraperQuestions([{ pageNumber: page.pageNumber,
          text: `# Math Module 1\n1 Mark for Review\n${body}` }]).questions;
      });
      if (split.every((group) => group.length === 1 && group[0]!.prompt.length >= 20 &&
          (group[0]!.choices.length >= 2 || /\?/.test(group[0]!.prompt)))) {
        splitQuestions = split.map((group) => group[0]!);
      }
    }
    const replay = splitQuestions ?? (raw.some((q) => q.choices.length >= 2 ||
      (q.questionType === "student_produced" && /\?\s*$/.test(q.prompt)))
      && !raw.some((q) => /^Note: Figure not drawn to scale/i.test(q.prompt))
      ? raw
      : parseScraperQuestions([{ ...page, text: `# Math Module 1\n1 Mark for Review\n${page.text}` }]).questions);
    const complete = replay.filter((q) => q.prompt.length >= 20 &&
      (q.choices.length >= 2 || (q.questionType === "student_produced" && /\?\s*$/.test(q.prompt))));
    if (complete.length === 0) return null;
    const mergedStems = new Set<ScraperParseResult["questions"][number]>();
    for (const q of complete) {
      // A figure caption can split a single question into a stem-only block
      // followed by a choice block. Rejoin only the unmistakable same-page
      // form; this does not merge two fully formed questions.
      if (/^Note: Figure not drawn to scale\.?/i.test(q.prompt)) {
        const before = replay[replay.indexOf(q) - 1];
        if (before?.choices.length === 0 && /\?\s*$/.test(before.prompt)) {
          q.prompt = `${before.prompt} ${q.prompt}`.trim();
          q.hasVisualStimulus = q.hasVisualStimulus || before.hasVisualStimulus;
          q.visualMarkerCount += before.visualMarkerCount;
          mergedStems.add(before);
        }
      }
    }
    for (const q of complete) {
      if (mergedStems.has(q)) continue;
      const emptyChoices = q.choices.filter((choice) => !choice.text.trim());
      for (const choice of emptyChoices) {
        const markerIndex = lines.findIndex((line) =>
          new RegExp(`^\\s*\\*{0,2}${choice.label}[.)]\\*{0,2}\\s*$`, "i").test(line));
        if (markerIndex < 0) continue;
        const evidence: string[] = [];
        for (const line of lines.slice(markerIndex + 1)) {
          if (/^\s*(?:\*{0,2}[A-D][.)]\*{0,2}|\*{0,2}\d{2,4}[.)]?\*{0,2}\s+[A-Z])/.test(line)) break;
          if (line.trim()) evidence.push(line.trim());
        }
        if (evidence.length) choice.text = evidence.join(" ");
      }
      if (emptyChoices.length) {
        q.hasVisualStimulus = true;
        q.visualMarkerCount = Math.max(1, q.visualMarkerCount);
        q.parseFlags = [...new Set([...q.parseFlags, "source_choice_table_truncated_review_required"])];
      }
      q.parseFlags = [...new Set([...q.parseFlags, "recovered_from_page_replay"])];
      candidates.push(q);
    }
  }
  return candidates;
}

/** Exact visual table shape, independent of unreliable printed global IDs. */
function positionalFourColumnKey(page: PageText | undefined): ParsedKeyEntry[] | null {
  if (!page) return null;
  const rows = page.text.split("\n").map((line) => ({ line, pairs: parseKeyRow(line) }))
    .filter((row): row is { line: string; pairs: NonNullable<ReturnType<typeof parseKeyRow>> } => row.pairs !== null);
  if (rows.length !== 27 || rows.some((row, index) => row.pairs.length !== (index < 22 ? 4 : 2))) return null;
  const entries: ParsedKeyEntry[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [column, pair] of row.pairs.entries()) {
      entries.push({
        questionNumber: rowIndex + 1,
        answer: pair.answer,
        pageNumber: page.pageNumber,
        sourceText: row.line,
        moduleName: POSITIONAL_NAMES[column],
        column,
      });
    }
  }
  return entries.length === 98 ? entries : null;
}

/** Split OCR HTML exports at their printed global-ID badges, not at page ends. */
export function recoverGlobalMarkerBlocks(pages: PageText[]): Array<{ question: ScraperParseResult["questions"][number]; globalId: string }> | null {
  const marker = /^\s*(?:\*\*)?(\d{3,4})[.)](?:\*\*)?\s*/;
  const blocks: Array<{ globalId: string; pageNumber: number; lines: string[] }> = [];
  let active: (typeof blocks)[number] | null = null;
  for (const page of pages) {
    for (const line of page.text.split("\n")) {
      const match = line.match(marker);
      if (match) {
        active = { globalId: match[1]!, pageNumber: page.pageNumber, lines: [line.slice(match[0].length).replace(/\*\*\s*$/, "")] };
        blocks.push(active);
      } else if (active) {
        active.lines.push(line);
      }
    }
  }
  if (blocks.length < 80 || blocks.length > 110) return null;
  const mathJumps = blocks.flatMap((block, index) => {
    if (index < 40 || index > 70) return [];
    const gap = Number(block.globalId) - Number(blocks[index - 1]!.globalId);
    return Math.abs(gap) >= 20 ? [index] : [];
  });
  const mathBlockStart = mathJumps.length === 1 ? mathJumps[0]! : 54;
  const recovered: Array<{ question: ScraperParseResult["questions"][number]; globalId: string }> = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const cleanLines = block.lines.filter((line) => !/^\s*(?:file:\/\/|\d+\/\d+\s*$|---\s*$|Document\s*$|\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/i.test(line))
      .map((line) => line.trimEnd()
        .replace(/^(\s*\*{0,2}[A-D][.)]\*{0,2})\s+file:\/\/.*$/i, "$1")
        .replace(/^(\s*\*{0,2}[A-D][.)]\*{0,2})\s+\[figure:\s*(.*?)\]\s*$/i, "$1 $2"));
    // Image-only A–D answers may put the figure description on the next PDF
    // page. Join a bare choice label to that source description so the choice
    // is retained, while its visual still remains pending manual crop review.
    for (let index = 0; index < cleanLines.length; index++) {
      const choice = cleanLines[index]!.match(/^\s*(?:\*\*)?([A-D])[.)](?:\*\*)?\s*$/);
      if (!choice) continue;
      const next = cleanLines.findIndex((line, nextIndex) => nextIndex > index && line.trim());
      if (next < 0 || !/^\s*\[figure:/i.test(cleanLines[next]!)) continue;
      cleanLines[index] = `${choice[1]}. ${cleanLines[next]!.trim().replace(/^\[figure:\s*/i, "").replace(/\]$/, "")}`;
      cleanLines[next] = "";
    }
    const body = cleanLines.join("\n");
    const parsed = parseScraperQuestions([{
      pageNumber: block.pageNumber,
      text: `# ${blockIndex < mathBlockStart ? "Reading and Writing" : "Math"} Module 1\n1 Mark for Review\n${body}`,
    }]);
    const complete = parsed.questions.filter((q) => q.prompt.length >= 18 &&
      (q.choices.length >= 2 || (q.questionType === "student_produced" && /\?/.test(q.prompt))));
    if (complete.length !== 1) continue;
    const question = complete[0]!;
    question.pageNumber = block.pageNumber;
    if (block.lines.some((line) => /\[figure:/i.test(line))) {
      question.hasVisualStimulus = true;
      question.visualMarkerCount = Math.max(1, question.visualMarkerCount);
    }
    question.parseFlags = [...new Set([...question.parseFlags, "recovered_from_global_marker_block"])];
    recovered.push({ question, globalId: block.globalId });
  }
  return recovered.length > 0 ? recovered : null;
}

function globalIdMathTransition(recovered: NonNullable<ReturnType<typeof recoverGlobalMarkerBlocks>>): number {
  const mathSignal = (q: ScraperParseResult["questions"][number]) =>
    /\$[^$]*(?:=|\\frac|\\sqrt|\^|[<>])[^$]*\$|\b(?:equation|function|triangle|circle|radius|slope|area|perimeter|percent)\b/i.test(q.prompt);
  const candidates: number[] = [];
  for (let index = 40; index < Math.min(70, recovered.length - 10); index++) {
    const gap = Number(recovered[index]!.globalId) - Number(recovered[index - 1]!.globalId);
    if (Math.abs(gap) < 20) continue;
    if (recovered.slice(index - 10, index).filter((item) => mathSignal(item.question)).length > 2) continue;
    if (recovered.slice(index, index + 10).filter((item) => mathSignal(item.question)).length < 4) continue;
    candidates.push(index);
  }
  return candidates.length === 1 ? candidates[0]! : -1;
}

/**
 * The streaming parser assigns an ordinal to unnumbered blocks. Keep those
 * provisional IDs only when the observed neighbors and canonical module
 * boundary leave exactly one possible assignment for every inferred block.
 * Never rewrite printed IDs or guess among multiple available slots.
 */
function repairInferredQuestionIds(questions: FullTestQuestion[]): void {
  const byModule = new Map<string, FullTestQuestion[]>();
  for (const q of questions) {
    const group = byModule.get(q.sourceModuleName) ?? [];
    group.push(q);
    byModule.set(q.sourceModuleName, group);
  }

  for (const group of byModule.values()) {
    const reserved = new Set(
      group
        .filter((q) => q.sourceQuestionNumberOrigin === "observed" && q.sourceQuestionNumber > 0)
        .map((q) => q.sourceQuestionNumber),
    );
    let previousObserved = 0;
    let i = 0;
    while (i < group.length) {
      const current = group[i]!;
      if (current.sourceQuestionNumberOrigin === "observed") {
        if (current.sourceQuestionNumber > previousObserved) previousObserved = current.sourceQuestionNumber;
        i++;
        continue;
      }

      const start = i;
      while (i < group.length && group[i]!.sourceQuestionNumberOrigin === "inferred") i++;
      const inferred = group.slice(start, i);
      const nextObserved = group
        .slice(i)
        .find((candidate) => candidate.sourceQuestionNumberOrigin === "observed")?.sourceQuestionNumber;
      const upperBound = nextObserved !== undefined
        ? nextObserved - 1
        : expectedQuestionsForSection(inferred[0]!.section);
      const available: number[] = [];
      for (let number = previousObserved + 1; number <= upperBound; number++) {
        if (!reserved.has(number)) available.push(number);
      }

      if (available.length === inferred.length) {
        inferred.forEach((q, offset) => {
          const chosen = available[offset]!;
          if (q.sourceQuestionNumber !== chosen) {
            q.parseFlags = [...new Set([...q.parseFlags, "question_id_recovered_from_neighbors"])];
            q.sourceQuestionNumber = chosen;
          }
        });
        previousObserved = available.at(-1) ?? previousObserved;
      } else {
        for (const q of inferred) {
          q.sourceQuestionNumber = -1;
          q.parseFlags = [...new Set([...q.parseFlags, "source_question_id_unresolved"])];
        }
      }
    }
  }
}

/** Map ContentScope + TargetModule to a set of module name substrings to keep. */
function moduleFilter(scope: ContentScope, targetModule: TargetModule | null): (name: string) => boolean {
  switch (scope) {
    case "full_test":
      return () => true;
    case "reading_writing":
      return (name) => /reading\s*(?:and|&)?\s*writing/i.test(name);
    case "math":
      return (name) => /math/i.test(name);
    case "single_module": {
      const map: Record<TargetModule, RegExp> = {
        rw1: /reading\s*(?:and|&)?\s*writing\s+module\s+1/i,
        rw2: /reading\s*(?:and|&)?\s*writing\s+module\s+2/i,
        math1: /math\s+module\s+1/i,
        math2: /math\s+module\s+2/i,
      };
      const re = targetModule ? map[targetModule] : /./;
      return (name) => re.test(name);
    }
  }
}

/**
 * Full-test parser: runs the scraper parser, applies module-scoped answer
 * key matching, filters by content scope, and returns structured results.
 */
export function parseFullTest(
  pages: PageText[],
  options: FullTestParseOptions,
): FullTestParseResult {
  // 1. Run the base parser
  let base: ScraperParseResult = parseScraperQuestions(pages);
  const screenshotCompilation = looksLikeScreenshotCompilation(pages, base);
  let positionalScreenshot = false;
  const sourceGlobalIds = new Map<ScraperParseResult["questions"][number], string>();
  let globalMarkerMathStart = -1;

  // OCR of the March HTML printouts has several questions per page and a
  // global badge for each. The streaming parser can merge neighboring blocks
  // across page breaks; badge-bounded replay retains their original order.
  if (!screenshotCompilation && pages.length >= 30 && pages.length <= 50 &&
      base.questions.length >= 80 && base.modules.length <= 1) {
    const recovered = recoverGlobalMarkerBlocks(pages);
    if (recovered && recovered.length > base.questions.length) {
      const mathStart = globalIdMathTransition(recovered);
      globalMarkerMathStart = mathStart;
      base.questions.splice(0, base.questions.length, ...recovered.map(({ question, globalId }, index) => {
        sourceGlobalIds.set(question, globalId);
        question.sourceQuestionNumber = Number(globalId);
        question.sourceQuestionNumberOrigin = "observed";
        if (mathStart >= 0 && index >= mathStart) {
          question.section = "math";
          question.sourceModuleName = "Math Module 1";
        }
        return question;
      }));
      base.modules.splice(0, base.modules.length, {
        name: "Reading and Writing Module 1", section: "reading_writing",
        questionCount: mathStart >= 0 ? mathStart : recovered.length,
        startPage: recovered[0]!.question.pageNumber,
        endPage: recovered[Math.max(0, (mathStart >= 0 ? mathStart : recovered.length) - 1)]!.question.pageNumber,
      });
      if (mathStart >= 0) base.modules.push({
        name: "Math Module 1", section: "math", questionCount: recovered.length - mathStart,
        startPage: recovered[mathStart]!.question.pageNumber,
        endPage: recovered.at(-1)!.question.pageNumber,
      });
    }
  }

  if (screenshotCompilation) {
    // Replay pages with a visible question marker that the streaming parser
    // did not emit. Screenshot collections usually place one question on a
    // page; page replay recovers a block that was accidentally absorbed as a
    // continuation of the preceding page's last choice.
    const emittedPages = new Set(base.questions.filter((q) => q.choices.length >= 2).map((q) => q.pageNumber));
    for (const page of pages) {
      if (emittedPages.has(page.pageNumber)) continue;
      if (!/^\s*(?:\*{0,2}\d{1,4}\*{0,2}[.)]?\s+\S|\d{1,3}\s+mark\s+for\s+review)/im.test(page.text)) continue;
      const replay = parseScraperQuestions([{ pageNumber: page.pageNumber, text: page.text }]);
      const recovered = replay.questions.find((q) => q.prompt.length >= 20 && q.choices.length >= 2);
      if (recovered) {
        recovered.parseFlags = [...new Set([...recovered.parseFlags, "recovered_from_page_replay"])];
        base.questions.push(recovered);
        emittedPages.add(page.pageNumber);
      }
    }

    // These compilations often omit module headings. Detect the contiguous
    // transition to math from a short run of strong SAT-math signals.
    let mathStart = -1;
    for (let i = 20; i <= base.questions.length - 5; i++) {
      const window = base.questions.slice(i, i + 5);
      if (window.filter(isStrongMathQuestion).length >= 3) {
        mathStart = i;
        break;
      }
    }
    if (mathStart >= 0) {
      base.questions.forEach((q, i) => {
        q.section = i >= mathStart ? "math" : "reading_writing";
        q.sourceModuleName = i >= mathStart ? "Math Module 1" : "Reading and Writing Module 1";
        q.sourceModulePosition = 1;
      });
      const grouped = new Map<string, ScraperParseResult["modules"][number]>();
      for (const q of base.questions) {
        const existing = grouped.get(q.sourceModuleName);
        if (existing) {
          existing.questionCount++;
          existing.startPage = Math.min(existing.startPage, q.pageNumber);
          existing.endPage = Math.max(existing.endPage, q.pageNumber);
        } else {
          grouped.set(q.sourceModuleName, {
            name: q.sourceModuleName,
            section: q.section,
            questionCount: 1,
            startPage: q.pageNumber,
            endPage: q.pageNumber,
          });
        }
      }
      base.modules.splice(0, base.modules.length, ...grouped.values());
    } else {
      for (const q of base.questions) {
        q.parseFlags = [...new Set([...q.parseFlags, "screenshot_section_unresolved"])];
      }
    }
  }

  // 2. Parse answer keys with module support
  const parsedKey = parseAnswerKey(pages, base.questions.length);

  // Global-ID screenshots can be a whole test even though printed badges do
  // not restart at module boundaries. Source-page isolation must first prove
  // 98 distinct questions in order. The four-column table is independent
  // evidence of the 27/27/22/22 layout; neither signal alone is sufficient.
  if (pages.length >= 85 && base.questions.length >= 80 && base.modules.length <= 1) {
    const keyPage = pages.at(-1);
    const positionalKeys = positionalFourColumnKey(keyPage);
    const recovered = positionalKeys && keyPage
      ? recoverScreenshotPages(pages, keyPage.pageNumber)
      : null;
    const mathTransition = recovered?.length === 98 &&
      recovered.slice(0, 54).filter(isStrongMathQuestion).length <= 15 &&
      recovered.slice(54).filter(isStrongMathQuestion).length >= 20;
    if (recovered?.length === 98 && mathTransition && positionalKeys) {
      base.questions.splice(0, base.questions.length, ...recovered);
      base.modules.length = 0;
      const pageQuestionIndex = new Map<number, number>();
      const pageGlobalIds = new Map(pages.map((page) => [page.pageNumber,
        page.text.split("\n").flatMap((line) => {
          const marker = line.match(/^\s*\*{0,2}(\d{3,4})[.)]?\*{0,2}(?:\s+|$)/);
          return marker && Number(marker[1]) > 150 ? [marker[1]!] : [];
        }),
      ]));
      let start = 0;
      POSITIONAL_NAMES.forEach((name, moduleIndex) => {
        const group = recovered.slice(start, start + POSITIONAL_LENGTHS[moduleIndex]!);
        const section = moduleIndex < 2 ? "reading_writing" : "math";
        base.modules.push({
          name, section, questionCount: group.length,
          startPage: Math.min(...group.map((q) => q.pageNumber)),
          endPage: Math.max(...group.map((q) => q.pageNumber)),
        });
        group.forEach((q, index) => {
          const pageIndex = pageQuestionIndex.get(q.pageNumber) ?? 0;
          pageQuestionIndex.set(q.pageNumber, pageIndex + 1);
          const promptBadge = q.prompt.match(BANK_PRINTED_RE)?.[1] ??
            q.passageText?.match(BANK_PRINTED_RE)?.[1];
          const global = (promptBadge && Number(promptBadge) > 150 ? promptBadge : null) ??
            pageGlobalIds.get(q.pageNumber)?.[pageIndex] ??
            (q.sourceQuestionNumber > 150 ? String(q.sourceQuestionNumber) : null);
          if (global) sourceGlobalIds.set(q, global);
          else q.parseFlags = [...new Set([...q.parseFlags, "source_global_id_ocr_unresolved"])];
          q.sourceQuestionNumber = index + 1;
          q.sourceQuestionNumberOrigin = "inferred";
          q.sourceModuleName = name;
          q.sourceModulePosition = moduleIndex % 2 + 1;
          q.section = section;
          q.parseFlags = [...new Set([...q.parseFlags, "source_global_id_positional_slot", "positional_answer_review_required"])];
        });
        start += group.length;
      });
      parsedKey.entries.splice(0, parsedKey.entries.length, ...positionalKeys);
      parsedKey.confidence = Math.min(parsedKey.confidence, 0.6);
      positionalScreenshot = true;
    }
  }

  // The March printouts have several globally numbered questions per page.
  // Only an exact, distinct 98-block sequence with an independently detected
  // RW→Math source transition at 54 can be assigned SAT module slots. Their
  // one/two-column RW keys remain partial; source IDs identify which RW slot
  // each printed answer belongs to, with no Math answers synthesized.
  if (!positionalScreenshot && base.questions.length === 98 &&
      sourceGlobalIds.size === 98 && globalMarkerMathStart === 54 &&
      new Set([...sourceGlobalIds.values()]).size === 98) {
    const globalToSlot = new Map<string, { moduleName: string; localNumber: number }>();
    base.modules.length = 0;
    let start = 0;
    POSITIONAL_NAMES.forEach((name, moduleIndex) => {
      const group = base.questions.slice(start, start + POSITIONAL_LENGTHS[moduleIndex]!);
      const section = moduleIndex < 2 ? "reading_writing" : "math";
      base.modules.push({ name, section, questionCount: group.length,
        startPage: Math.min(...group.map((q) => q.pageNumber)),
        endPage: Math.max(...group.map((q) => q.pageNumber)) });
      group.forEach((q, index) => {
        const globalId = sourceGlobalIds.get(q)!;
        globalToSlot.set(globalId, { moduleName: name, localNumber: index + 1 });
        q.sourceModuleName = name;
        q.sourceModulePosition = moduleIndex % 2 + 1;
        q.section = section;
        q.sourceQuestionNumber = index + 1;
        q.sourceQuestionNumberOrigin = "inferred";
        q.parseFlags = [...new Set([...q.parseFlags, "source_global_id_positional_slot", "positional_answer_review_required"])];
      });
      start += group.length;
    });
    for (const entry of parsedKey.entries) {
      const slot = globalToSlot.get(String(entry.questionNumber));
      if (!slot) continue;
      entry.questionNumber = slot.localNumber;
      entry.moduleName = slot.moduleName;
    }
    parsedKey.confidence = Math.min(parsedKey.confidence, 0.6);
    positionalScreenshot = true;
  }

  if (sourceGlobalIds.size > 0 && !positionalScreenshot) {
    for (const entry of parsedKey.entries) {
      const owners = base.questions.filter((q) => sourceGlobalIds.get(q) === String(entry.questionNumber));
      if (owners.length === 1) entry.moduleName = owners[0]!.sourceModuleName;
    }
  }

  // A four-module source may repeat "Question 1" at each module start while
  // omitting the intervening module titles. Require the *entire* 98-marker
  // sequence and an independent exact local key grid before restoring those
  // headings. Global-ID banks cannot satisfy this identity check.
  if (!screenshotCompilation && parsedKey.entries.length === 98 && base.questions.length >= 60) {
    const lengths = [27, 27, 22, 22];
    const expected = lengths.flatMap((length) => Array.from({ length }, (_, i) => i + 1));
    const columns = lengths.map((_, column) => parsedKey.entries.filter((entry) => entry.column === column));
    const exactGrid = columns.every((entries, column) => entries.length === lengths[column] &&
      entries.every((entry, i) => entry.questionNumber === i + 1));
    const markers = pages.flatMap((page, pageIndex) => page.text.split("\n").flatMap((line, lineIndex) => {
      const match = line.match(/^\s*#{1,3}\s*Question\s+(\d{1,2})\s*$/i);
      return match ? [{ pageIndex, lineIndex, number: Number(match[1]) }] : [];
    }));
    const mathEvidence = base.questions.filter(isStrongMathQuestion).length >= 20 &&
      base.questions.slice(0, 27).filter(isStrongMathQuestion).length <= 10;
    if (exactGrid && mathEvidence && markers.length === 98 &&
        markers.every((marker, i) => marker.number === expected[i])) {
      const names = ["Reading and Writing Module 1", "Reading and Writing Module 2", "Math Module 1", "Math Module 2"];
      const starts = new Map([0, 27, 54, 76].map((index, moduleIndex) => [index, names[moduleIndex]!]));
      let markerIndex = 0;
      const segmentedPages = pages.map((page) => ({ ...page, text: page.text.split("\n").flatMap((line) => {
        if (!/^\s*#{1,3}\s*Question\s+\d{1,2}\s*$/i.test(line)) return [line];
        const heading = starts.get(markerIndex++);
        return heading ? [`# ${heading}`, line] : [line];
      }).join("\n") }));
      const segmented = parseScraperQuestions(segmentedPages);
      if (segmented.questions.length >= base.questions.length && segmented.questions.length <= 98) base = segmented;
    }
  }

  // Some compact full-test PDFs use the misleading running title
  // "Reading&Writing Modules" even over the Math pages. Four exact runs of
  // standalone printed question numbers, together with an independent exact
  // four-column key grid, give stronger boundaries than that title. Replay
  // with synthetic headings only when both source signals agree, and accept
  // the replay only if every emitted question retains its observed identity.
  if (!screenshotCompilation && base.modules.length === 1 && parsedKey.entries.length === 98) {
    const lengths = [27, 27, 22, 22];
    const names = [
      "Reading and Writing Module 1", "Reading and Writing Module 2",
      "Math Module 1", "Math Module 2",
    ];
    const expectedNumbers = lengths.flatMap((length) => Array.from({ length }, (_, index) => index + 1));
    const keyColumns = lengths.map((_, column) => parsedKey.entries.filter((entry) => entry.column === column));
    const exactGrid = keyColumns.every((entries, column) =>
      entries.length === lengths[column] && entries.every((entry, index) => entry.questionNumber === index + 1));
    const markers = pages.flatMap((page, pageIndex) => page.text.split("\n").flatMap((line, lineIndex) => {
      const match = line.match(/^\s*(\d{1,2})\.\s*$/);
      return match ? [{ pageIndex, lineIndex, number: Number(match[1]) }] : [];
    }));
    if (exactGrid && markers.length === 98 && markers.every((marker, index) => marker.number === expectedNumbers[index])) {
      const starts = new Map([0, 27, 54, 76].map((start, index) => [start, names[index]!]));
      let markerIndex = 0;
      const segmentedPages = pages.map((page) => ({
        ...page,
        text: page.text.split("\n").flatMap((line) => {
          if (!/^\s*\d{1,2}\.\s*$/.test(line)) return [line];
          const heading = starts.get(markerIndex++);
          return heading ? [`# ${heading}`, line] : [line];
        }).join("\n"),
      }));
      const segmented = parseScraperQuestions(segmentedPages);
      const exactRw = segmented.questions.slice(0, 54).every((question, index) =>
        question.sourceModuleName === names[Math.floor(index / 27)] &&
        question.sourceQuestionNumberOrigin === "observed" && question.sourceQuestionNumber === index % 27 + 1);
      // The streaming parser can hold a choice-less Math response until the
      // following numbered block, then attach the following number to it.
      // Replay only the 44 Math spans in isolation, anchored by their printed
      // markers, so grid-ins cannot steal the next question's identity.
      const pageLines = pages.map((page) => page.text.split("\n"));
      const firstKeyPage = Math.min(...parsedKey.entries.map((entry) => entry.pageNumber));
      const mathQuestions = markers.slice(54).map((marker, offset) => {
        const next = markers[55 + offset];
        const endPageIndex = next?.pageIndex ?? pages.findIndex((page) => page.pageNumber >= firstKeyPage);
        const blockPages = [];
        for (let pageIndex = marker.pageIndex; pageIndex <= endPageIndex; pageIndex++) {
          const from = pageIndex === marker.pageIndex ? marker.lineIndex + 1 : 0;
          const to = next && pageIndex === next.pageIndex ? next.lineIndex :
            !next && pageIndex === endPageIndex ? 0 : pageLines[pageIndex]!.length;
          if (to < from) continue;
          const content = pageLines[pageIndex]!.slice(from, to).join("\n");
          blockPages.push({ pageNumber: pages[pageIndex]!.pageNumber,
            text: pageIndex === marker.pageIndex ? `# ${names[offset < 22 ? 2 : 3]}\n1\n${content}` : content });
        }
        const isolated = parseScraperQuestions(blockPages);
        if (isolated.questions.length !== 1 || isolated.questions[0]!.prompt.length < 15) return null;
        const question = isolated.questions[0]!;
        question.sourceQuestionNumber = marker.number;
        question.sourceQuestionNumberOrigin = "observed";
        question.sourceModuleName = names[offset < 22 ? 2 : 3]!;
        question.sourceModulePosition = offset < 22 ? 1 : 2;
        question.section = "math";
        question.pageNumber = pages[marker.pageIndex]!.pageNumber;
        return question;
      });
      const recovered = [...segmented.questions.slice(0, 54), ...mathQuestions.filter((question) => question !== null)];
      const mathEvidence = recovered.slice(0, 54).filter(isStrongMathQuestion).length <= 15 &&
        recovered.slice(54).filter(isStrongMathQuestion).length >= 20;
      if (exactRw && segmented.questions.length === 98 && mathQuestions.length === 44 &&
          mathQuestions.every((question) => question !== null) && mathEvidence) {
        base = segmented;
        base.questions.splice(0, base.questions.length, ...recovered);
      }
    }
  }

  // Compact, heading-less full tests can still carry unambiguous four-column
  // keys (27/27/22/22) and printed question-number restarts at those exact
  // boundaries. Recover the four modules only when all three independent
  // signals agree: exact question count, exact key grid, and a strong math
  // transition after the first 54 questions. Genuine global-ID banks and
  // screenshot compilations do not satisfy this guard.
  if (!screenshotCompilation && base.modules.length === 1 && base.questions.length === 98 &&
      parsedKey.entries.length === 98) {
    const lengths = [27, 27, 22, 22];
    const columns = lengths.map((_, column) => parsedKey.entries.filter((entry) => entry.column === column));
    const gridExact = columns.every((entries, column) =>
      entries.length === lengths[column] &&
      entries.every((entry, index) => entry.questionNumber === index + 1));
    const mathEvidence =
      base.questions.slice(0, 54).filter(isStrongMathQuestion).length <= 15 &&
      base.questions.slice(54).filter(isStrongMathQuestion).length >= 20;
    const printedNumber = (q: ScraperParseResult["questions"][number]) =>
      Number(q.prompt.match(BANK_PRINTED_RE)?.[1] ?? 0);
    const numberDisagreements = base.questions.filter((q, index) => {
      const position = index < 54 ? index % 27 + 1 : (index - 54) % 22 + 1;
      const printed = printedNumber(q);
      return printed > 0 ? printed !== position : q.sourceQuestionNumberOrigin === "observed" &&
        q.sourceQuestionNumber !== position;
    }).length;
    if (gridExact && mathEvidence && numberDisagreements <= 4) {
      const names = [
        "Reading and Writing Module 1", "Reading and Writing Module 2",
        "Math Module 1", "Math Module 2",
      ];
      const starts = [0, 27, 54, 76];
      base.modules.length = 0;
      names.forEach((name, moduleIndex) => {
        const start = starts[moduleIndex]!;
        const group = base.questions.slice(start, start + lengths[moduleIndex]!);
        base.modules.push({
          name, section: moduleIndex < 2 ? "reading_writing" : "math",
          questionCount: group.length,
          startPage: Math.min(...group.map((q) => q.pageNumber)),
          endPage: Math.max(...group.map((q) => q.pageNumber)),
        });
        group.forEach((q, position) => {
          const expected = position + 1;
          const observed = q.sourceQuestionNumber === expected || printedNumber(q) === expected;
          q.sourceModuleName = name;
          q.sourceModulePosition = moduleIndex % 2 + 1;
          q.section = moduleIndex < 2 ? "reading_writing" : "math";
          q.sourceQuestionNumber = expected;
          q.sourceQuestionNumberOrigin = observed ? "observed" : "inferred";
          q.parseFlags = q.parseFlags.filter((flag) =>
            flag !== "duplicate_source_number_conflict" && flag !== "source_question_id_unresolved");
          if (!observed) q.parseFlags = [...new Set([...q.parseFlags, "question_id_recovered_from_neighbors"])];
        });
      });
    }
  }

  // 2a. Attribute heading-less single-column key blocks ("1. B" … "27. B",
  // one per line, no module heading): a consecutive run starting at 1 whose
  // length equals a keyless module's question count (plus one slack for a
  // missing/extra question) belongs to the first such module in encounter
  // order. Runs of other lengths stay global so the positional end-of-test
  // fallback still applies. Document order is preserved (no sorting) so two
  // same-page blocks ("1..27", "1..27") stay separate while cross-page
  // continuations ("1..17", "18..27") stay joined. Crammed multi-token
  // lines ("1. B 2. C") are excluded via the second-number guard.
  {
    const SINGLE_LINE_RE = /^\s*(\d{1,3})(?:\s*[.:)]\s*|\s+)(\S[^]*)$/;
    const isSingleLine = (src: string): boolean => {
      const m = src.match(SINGLE_LINE_RE);
      if (!m) return false;
      return !/\d{1,3}\s*[.:)]/.test(m[2]!);
    };
    const keyless = (): Array<{ name: string; count: number }> => {
      const scoped = new Set(parsedKey.entries.filter((e) => e.moduleName).map((e) => e.moduleName as string));
      return base.modules
        .filter((m) => m.questionCount > 0 && !scoped.has(m.name))
        .map((m) => ({ name: m.name, count: m.questionCount }));
    };
    const runs: ParsedKeyEntry[][] = [];
    for (const e of parsedKey.entries) {
      if (e.moduleName || e.column != null || !isSingleLine(e.sourceText)) continue;
      const last = runs[runs.length - 1];
      if (last && e.questionNumber === last[last.length - 1]!.questionNumber + 1) last.push(e);
      else runs.push([e]);
    }
    for (const run of runs) {
      if (run[0]!.questionNumber !== 1) continue;
      const target = keyless().find((k) => k.count === run.length || k.count + 1 === run.length);
      if (!target) continue;
      for (const e of run) e.moduleName = target.name;
    }
  }

  // 2b. Attribute heading-less paired-column entries ("1 C  1 B") to the
  // modules that have questions but no scoped keys, in encounter order
  // (left column = first module, right column = second).
  const columnar = parsedKey.entries.filter((e) => e.column != null && !e.moduleName);
  if (columnar.length > 0) {
    const candidates = base.modules
      .filter((m) => m.questionCount > 0)
      .filter((m) => !parsedKey.entries.some((e) => e.moduleName === m.name));
    const byColumn = new Map<number, ParsedKeyEntry[]>();
    for (const e of columnar) {
      if (!byColumn.has(e.column!)) byColumn.set(e.column!, []);
      byColumn.get(e.column!)!.push(e);
    }
    [...byColumn.keys()]
      .sort((a, b) => a - b)
      .forEach((col, i) => {
        // A single keyless module (bank compilation) owns every column.
        const target = candidates.length === 1 ? candidates[0] : candidates[i];
        if (target) for (const e of byColumn.get(col)!) e.moduleName = target.name;
      });
  }

  // 3. Determine extraction method
  const method = base.questions.length > 0 ? "text" : "none";

  // 4. Apply scope filter
  const keepModule = moduleFilter(options.contentScope, options.targetModule ?? null);
  const filteredQuestions: FullTestQuestion[] = base.questions
    .filter((q) => keepModule(q.sourceModuleName))
    .map((q) => ({
      sourceQuestionNumber: q.sourceQuestionNumber,
      sourceQuestionNumberOrigin: q.sourceQuestionNumberOrigin,
      parseFlags: [...q.parseFlags],
      sourceModuleName: q.sourceModuleName,
      sourceModulePosition: q.sourceModulePosition,
      sourceQuestionId: null,
      sourceGlobalQuestionId: sourceGlobalIds.get(q) ?? null,
      pageNumber: q.pageNumber,
      section: q.section,
      questionType: q.questionType,
      prompt: q.prompt,
      passageText: q.passageText,
      choices: q.choices,
      confidence: q.confidence,
      correctAnswer: null,
      explanation: null,
      domain: null,
      skill: null,
      difficulty: null,
      hasVisualStimulus: q.hasVisualStimulus,
      visualMarkerCount: q.visualMarkerCount,
    }));

  // 5. Bank mode: heterogeneous compilations (bank-global numbering, no
  // valid test modules) can't use positional seq for keys — seq is
  // unreliable there. Renumber by printed prompt prefix when extractable
  // (stripped from the prompt); unnumbered questions get -1 so they never
  // auto-match a key.
  const bankLike = !positionalScreenshot && (
    screenshotCompilation ||
    !looksBluebook(pages) &&
    (parsedKey.entries.some((e) => e.questionNumber > 150) ||
      base.modules.some((m) => m.questionCount > 34) ||
      (filteredQuestions.length > 40 &&
        !base.modules.some((m) => m.questionCount === 22 || m.questionCount === 27))));
  if (bankLike) {
    // Section pools ("Question Bank – …") instead of pseudo-modules: bank
    // key numbers are unique per section, not per pseudo-module.
    const bankName = (m: string): string =>
      /math/i.test(m) ? "Question Bank \u2013 Math" : "Question Bank \u2013 Reading and Writing";
    for (const e of parsedKey.entries) {
      if (e.moduleName) e.moduleName = bankName(e.moduleName);
    }
    for (const q of filteredQuestions) {
      q.sourceModuleName = bankName(q.sourceModuleName);
    }
    // Renumber by printed prefix only when prefixes actually exist —
    // otherwise (Bluebook-style prompts) positional seq is more reliable.
    const printedPrefix = (q: FullTestQuestion) =>
      q.prompt.match(BANK_PRINTED_RE) ?? q.passageText?.match(BANK_PRINTED_RE) ?? null;
    const prefixed = filteredQuestions.filter((q) => q.sourceGlobalQuestionId || printedPrefix(q)).length;
    if (screenshotCompilation || prefixed >= Math.max(4, filteredQuestions.length * 0.4)) {
      for (const q of filteredQuestions) {
        const m = printedPrefix(q);
        const globalId = q.sourceGlobalQuestionId ?? m?.[1];
        if (globalId) {
          q.sourceQuestionNumber = Number(globalId);
          q.sourceQuestionNumberOrigin = "observed";
          if (m && q.prompt.startsWith(m[0])) q.prompt = q.prompt.slice(m[0].length).trim();
          else if (m && q.passageText?.startsWith(m[0])) q.passageText = q.passageText.slice(m[0].length).trim();
        } else {
          q.sourceQuestionNumber = -1;
          q.sourceQuestionNumberOrigin = "inferred";
          q.parseFlags = [...new Set([...q.parseFlags, "source_question_id_unresolved"])];
        }
      }
    }
    if (screenshotCompilation) recoverScreenshotIds(filteredQuestions);
    const merged = new Map<string, (typeof base.modules)[number]>();
    for (const m of base.modules) {
      const name = bankName(m.name);
      const acc = merged.get(name);
      if (!acc) merged.set(name, { ...m, name });
      else {
        acc.questionCount += m.questionCount;
        acc.startPage = Math.min(acc.startPage, m.startPage);
        acc.endPage = Math.max(acc.endPage, m.endPage);
      }
    }
    base.modules.length = 0;
    base.modules.push(...merged.values());
  }

  if (!bankLike && !screenshotCompilation) repairInferredQuestionIds(filteredQuestions);

  // In screenshot banks the printed question IDs are global and answer keys
  // may be columnar with no section label. Scope a key only when exactly one
  // parsed question has that ID; ambiguous IDs remain global for diagnostics.
  if (screenshotCompilation && !positionalScreenshot) {
    for (const entry of parsedKey.entries) {
      const candidates = filteredQuestions.filter((q) => q.sourceQuestionNumber === entry.questionNumber);
      if (candidates.length === 1) entry.moduleName = candidates[0]!.sourceModuleName;
    }
  }

  const keyMap = answerMap(parsedKey);

  // Single-pool banks: global keys (row-wise classic runs) belong to the
  // only pool. Multi-pool banks keep globals for positional matching.
  if (bankLike) {
    const pools = [...new Set(filteredQuestions.map((q) => q.sourceModuleName))];
    if (pools.length === 1) {
      for (const e of parsedKey.entries) {
        if (!e.moduleName) e.moduleName = pools[0]!;
      }
      for (const [k, v] of [...keyMap.entries()]) {
        if (k.startsWith("g|")) {
          keyMap.delete(k);
          keyMap.set(`${pools[0]}|${k.slice(2)}`, v);
        }
      }
    }
  }

  // 6. Reassign orphaned scoped keys: an entry tagged M|n where module M
  // has no question n (page-layout artifact — e.g. a module's trailing keys
  // printed under the next module's Answers heading) moves to the unique
  // module holding an unmatched question n. Keep the raw entry and the
  // lookup map in sync: pipeline key matching consumes keyEntries, not keyMap.
  {
    const have = new Set(filteredQuestions.map((q) => `${q.sourceModuleName}|${q.sourceQuestionNumber}`));
    const matched = new Set<string>();
    for (const k of keyMap.keys()) if (!k.startsWith("g|") && have.has(k)) matched.add(k);
    for (const e of parsedKey.entries) {
      if (!e.moduleName) continue;
      const tagged = `${e.moduleName}|${e.questionNumber}`;
      if (have.has(tagged)) continue;
      const needy = filteredQuestions.filter(
        (q) => q.sourceQuestionNumber === e.questionNumber && !matched.has(`${q.sourceModuleName}|${q.sourceQuestionNumber}`),
      );
      const mods = [...new Set(needy.map((q) => q.sourceModuleName))];
      if (mods.length === 1) {
        const key = `${mods[0]}|${e.questionNumber}`;
        if (!keyMap.has(key)) {
          const old = keyMap.get(tagged);
          if (old?.sourceText === e.sourceText && old.pageNumber === e.pageNumber) keyMap.delete(tagged);
          e.moduleName = mods[0]!;
          keyMap.set(key, { answer: e.answer, pageNumber: e.pageNumber, sourceText: e.sourceText });
          matched.add(key);
        }
      }
    }
  }

  // 7. Filter modules to only those matching the scope
  const filteredModules = base.modules.filter((m) => keepModule(m.name));

  return {
    questions: filteredQuestions,
    keyMap,
    keyEntries: parsedKey.entries,
    keyConfidence: parsedKey.confidence,
    modules: filteredModules,
    method,
    scope: options.contentScope,
    targetModule: options.targetModule ?? null,
    documentFamily: screenshotCompilation && !positionalScreenshot ? "screenshot_compilation" : bankLike ? "question_bank" : options.contentScope === "full_test" ? "full_test" : "section_test",
  };
}
