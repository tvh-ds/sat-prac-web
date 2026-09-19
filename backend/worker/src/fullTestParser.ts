import type { PageText } from "./extractor";
import { parseScraperQuestions, looksBluebook, type ScraperParseResult, type ScraperKeyEntry } from "./scraperParser";
import { parseAnswerKey, answerMap, type ParsedKeyEntry } from "./answerKey";

/**
 * Printed number prefix on bank prompts ("**317** Circle …", "23 Which …",
 * "32. What …"). Prompts starting with data ("18, 18, …", "18qrt …",
 * "3.5 …", "$x …") never match: digits must be followed by a space and a
 * letter opener.
 */
const BANK_PRINTED_RE = /^\*{0,2}(\d{1,4})\*{0,2}[.)]?\s+(?=[A-Za-z$\\(\[])/;

export type ContentScope = "full_test" | "reading_writing" | "math" | "single_module";
export type TargetModule = "rw1" | "rw2" | "math1" | "math2";

export interface FullTestParseOptions {
  contentScope: ContentScope;
  targetModule?: TargetModule | null;
}

export interface FullTestQuestion {
  sourceQuestionNumber: number;
  sourceModuleName: string;
  sourceModulePosition: number;
  sourceQuestionId: string | null;
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
  const base: ScraperParseResult = parseScraperQuestions(pages);

  // 2. Parse answer keys with module support
  const parsedKey = parseAnswerKey(pages, base.questions.length);

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
      sourceModuleName: q.sourceModuleName,
      sourceModulePosition: q.sourceModulePosition,
      sourceQuestionId: null,
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
  const bankLike =
    !looksBluebook(pages) &&
    (parsedKey.entries.some((e) => e.questionNumber > 150) ||
      base.modules.some((m) => m.questionCount > 34) ||
      (filteredQuestions.length > 40 &&
        !base.modules.some((m) => m.questionCount === 22 || m.questionCount === 27)));
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
    const prefixed = filteredQuestions.filter((q) => BANK_PRINTED_RE.test(q.prompt)).length;
    if (prefixed >= Math.max(4, filteredQuestions.length * 0.4)) {
      for (const q of filteredQuestions) {
        const m = q.prompt.match(BANK_PRINTED_RE);
        if (m) {
          q.sourceQuestionNumber = Number(m[1]);
          q.prompt = q.prompt.slice(m[0].length).trim();
        } else {
          q.sourceQuestionNumber = -1;
        }
      }
    }
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
  // module holding an unmatched question n. The original tag stays put.
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
  };
}
