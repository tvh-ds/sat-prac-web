export interface ParsedKeyEntry {
  questionNumber: number;
  answer: string;
  pageNumber: number;
  sourceText: string;
  moduleName?: string;
  /**
   * Module inferred for a bare "Answer Key" block from the most recent
   * question-module heading ("Math Module 1" seen before the key block).
   * Used to attribute generic keys that follow a module; end-of-test global
   * keys are still matched positionally across modules.
   */
  inferredModule?: string;
  /**
   * Paired-column index (0 = left, 1 = right) for heading-less key tables
   * like "1 C  1 B" where each column is an independent module sequence.
   * Attribution to modules happens in fullTestParser by column order.
   */
  column?: number;
}

export interface ParsedAnswerKey {
  entries: ParsedKeyEntry[];
  confidence: number;
  /** Detected module name for the current key block, if any. */
  currentModule?: string;
}

const KEY_HEADING_RE =
  /^\s*(answer key|answers|correct answers|scoring key|answer explanations|answer guide|explanations)\s*:?\s*$/i;

/** Module-scoped answer heading: "Reading and Writing Module 1 Answers" */
const MODULE_KEY_HEADING_RE =
  /^\s*(reading\s*(?:and|&)?\s*writing|math)\s+module\s+(\d)\s+answers?\s*:?\s*$/i;

/** Question-module heading ("Math Module 1") — tracks context for generic keys. */
const QUESTION_MODULE_HEADING_RE =
  /^\s*(reading\s*(?:and|&)?\s*writing|math)\s+module\s+(\d)\s*$/i;

/** Number-first module heading ("Module 1: Reading and Writing"). */
const MODULE_COLON_HEADING_RE =
  /^\s*module\s+(\d)\s*:\s*(reading\s*(?:and|&)?\s*writing|math)\s*$/i;

/** Number-first key heading ("Module 1: Reading and Writing Answers"). */
const MODULE_COLON_KEY_HEADING_RE =
  /^\s*module\s+(\d)\s*:\s*(reading\s*(?:and|&)?\s*writing|math)\s+answers?\s*:?\s*$/i;

/**
 * Trailing metadata on College Board headings is discarded:
 * "Section: Section 1, Module 1: Reading and Writing, Difficulty: hard
 * (27 questions)". Capture groups stay (section, module, name).
 */
const SECTION_TRAIL_RE = `(?:\\s*,.*)?`;

/** College Board list format: "Section: Section 1, Module 1: Reading and Writing," */
const SECTION_PREFIX_RE = new RegExp(
  `^\\s*section:\\s*section\\s+(\\d+)\\s*,\\s*module\\s+(\\d+)\\s*:\\s*(reading\\s*(?:and|&)?\\s*writing|math)${SECTION_TRAIL_RE}\\s*$`,
  "i",
);

/** Shorter variant: "Section 2, Module 1: Math". */
const SECTION_SHORT_RE = new RegExp(
  `^\\s*section\\s+(\\d+)\\s*,\\s*module\\s+(\\d+)\\s*:\\s*(reading\\s*(?:and|&)?\\s*writing|math)${SECTION_TRAIL_RE}\\s*$`,
  "i",
);

/** Shorter key-heading variant: "Section 2, Module 1: Math Answers". */
const SECTION_SHORT_KEY_HEADING_RE = new RegExp(
  `^\\s*section\\s+(\\d+)\\s*,\\s*module\\s+(\\d+)\\s*:\\s*(reading\\s*(?:and|&)?\\s*writing|math)\\s+answers?\\s*:?${SECTION_TRAIL_RE}\\s*$`,
  "i",
);

/** "33 QUESTIONS" count stub — marks the start of a key section. */
const QUESTIONS_COUNT_RE = /^\s*(\d{1,3})\s+questions?\s*$/i;

/**
 * Mangled key heading from bad extraction/OCR (e.g. "iting Module
 * AnswReading and Wr ers"). Same leniency as the scraper parser: short
 * line mentioning answers + module/section words.
 */
export function isMangledKeyHeading(line: string): boolean {
  return /answ/i.test(line) && /(module|reading|writing|math)/i.test(line) && line.length <= 60;
}

/**
 * Parse 5 emits markdown headings ("# Reading and Writing Module 1 Answers",
 * "## 27 QUESTIONS"). Strip heading markers / wrapping bold before testing
 * structural regexes so module-scoped keys are attributed, not globalized.
 */
function stripMarkdown(line: string): string {
  let s = line.replace(/^\s*#{1,6}\s*/, "");
  const bold = s.match(/^\s*\*\*(.+?)\*\*\s*$/);
  if (bold) s = bold[1]!;
  return s.trim();
}

/**
 * One answer value (letter, integer, decimal, negative, fraction,
 * leading-decimal grid-ins like ".1428", LaTeX answers like
 * "$4 \\frac{4}{31}$" or "$1/4 \\mid 0.25$") or a separated list of
 * acceptable answers ("43/3, 14.33", "27, 28, 29", "27/4; 6.75").
 */
const KEY_ANSWER_RE = `[A-Ha-h]|\\$[^$]{1,60}\\$|[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:\\s*\\/\\s*\\d+)?`;

/** Split pipe-separated key rows, ignoring pipes inside $…$ math. */
export function splitKeySegments(clean: string): string[] {
  if (!clean.includes("|")) return [clean];
  const segs: string[] = [];
  let cur = "";
  let inMath = false;
  for (const ch of clean) {
    if (ch === "$") inMath = !inMath;
    if (ch === "|" && !inMath) {
      segs.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  segs.push(cur);
  return segs;
}
const KEY_ANSWER_LIST_RE = `(?:${KEY_ANSWER_RE})(?:\\s*[,;]\\s*(?:${KEY_ANSWER_RE}))*`;

/** Single entry: "1. B" or "1 : B" or "1 . B" or "1  B" or "9. 43/3, 14.33" */
const SINGLE_ENTRY_RE = new RegExp(`^\\s*(\\d{1,3})\\s*[.:)]?\\s*(${KEY_ANSWER_LIST_RE})\\s*$`);

/**
 * Single entry with an explicit delimiter ("1. B", "1: B", "1) B").
 * Bare numbers ("11" = graph tick split as n=1/ans=1) must never trigger
 * heading-less key mode.
 */
const EXPLICIT_SINGLE_RE = new RegExp(`^\\s*(\\d{1,3})\\s*[.:)]\\s*(${KEY_ANSWER_LIST_RE})\\s*$`);

/** "n. answer" tokens anywhere in a line (crammed key lists: "1. C 2. B 3. A"). */
const TOKEN_ENTRY_RE = new RegExp(
  `(?:^|\\s)(\\d{1,3})\\s*(?:[.)]\\s*|\\s{2,})(${KEY_ANSWER_LIST_RE})(?=\\s|$)`,
  "g",
);

/** Lines containing two or more "n. answer" tokens (crammed key lists). */
const KEY_TOKEN_RE = /(?:^|\s)\d{1,3}\s*[.)]\s+(?:[A-Ha-h]|[+-]?(?:\d+(?:\.\d+)?|\.\d+))(?=\s|$)/g;
/**
 * Whole-line number + single letter ("1 A"). Bare numbers never trigger
 * (graph ticks), but a trailing letter makes it an unambiguous key entry —
 * accepted in heading-less mode only.
 */
const NO_DELIM_SINGLE_RE = /^\s*(\d{1,3})\s+([A-Ha-h])\s*$/;

export interface KeyRowPair {
  n: number;
  answer: string;
}

/**
 * Parse a full-line key table row into (number, answer) pairs. Handles:
 * - classic interleaved pairs ("1 A  2 C")
 * - independent columns ("1 C  1 B" = two modules side by side)
 * - multi-module rows ("1 D 1 A 1 B 1 B" = RW1/RW2/Math1/Math2, incl.
 *   numeric grid-ins like "19 -4", "20 2100", "2 3/5")
 * Returns null unless the whole line is 2+ clean pairs.
 */
export function parseKeyRow(clean: string): KeyRowPair[] | null {
  const tokens = clean.trim().split(/\s+/);
  if (tokens.length < 4 || tokens.length % 2 !== 0) return null;
  const pairs: KeyRowPair[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const n = Number(tokens[i]);
    const a = tokens[i + 1]!;
    // Bank compilations number keys into the hundreds; big-number rows that
    // match nothing stay harmless orphans (and heading-less rows still need
    // 3-row confirmation).
    if (!Number.isInteger(n) || n < 1 || n > 999) return null;
    if (!/^([A-Ha-h]|[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\/\d+(?:\.\d+)?)?)$/.test(a)) return null;
    pairs.push({ n, answer: a.toUpperCase() });
  }
  return pairs;
}

/**
 * True when cur continues prev: column-wise (every overlapping column +1,
 * for independent-column tables) or row-wise (same-length rows where cur
 * resumes right after prev's max, for interleaved "321 C 322 A / 323 B …"
 * tables). Data tables ("200 500 / 300 600") satisfy neither.
 */
export function keyRowsContinue(prev: KeyRowPair[], cur: KeyRowPair[]): boolean {
  const k = Math.min(prev.length, cur.length);
  if (k === 0) return false;
  let col = true;
  for (let j = 0; j < k; j++) {
    if (cur[j]!.n !== prev[j]!.n + 1) {
      col = false;
      break;
    }
  }
  if (col) return true;
  if (prev.length === cur.length) {
    const pmax = Math.max(...prev.map((p) => p.n));
    const cmin = Math.min(...cur.map((p) => p.n));
    if (cmin === pmax + 1) return true;
  }
  return false;
}

/**
 * Normalize a raw key answer: strip LaTeX ("$4 \\frac{4}{31}$" → "4 4/31",
 * "$1/4 \\mid 0.25$" → "1/4, 0.25"), collapse whitespace, uppercase.
 */
export function normalizeKeyAnswer(raw: string): string {
  let s = raw.replace(/\$/g, "").trim();
  s = s.replace(/\\[dt]?frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");
  s = s.replace(/\\mid/g, ",");
  s = s.replace(/\\/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\s*,\s*/g, ", ");
  return s.toUpperCase();
}

/**
 * A bare answer with no question number ("B", "4 4/31", "$4 \\frac{4}{31}$").
 * Plain integers are excluded (page numbers); they stay continuations.
 */
const BARE_ANSWER_RE = new RegExp(`^\\s*(?:${KEY_ANSWER_LIST_RE}|\\$[^$]{1,60}\\$)\\s*$`);
const PLAIN_INT_RE = /^[+-]?\d+$/;

/** True for a full-line key table row or a crammed multi-token key list. */
function isKeyTableLine(clean: string): boolean {
  if (parseKeyRow(clean)?.length) return true;
  const tokens = clean.match(KEY_TOKEN_RE) ?? [];
  return tokens.length >= 2;
}

/**
 * Parse an answer key block that usually appears at the end of a practice
 * PDF. Handles:
 * - single-column ("1. B")
 * - paired two-column ("1 A 2 B")
 * - numeric grid-in answers ("15", "3/5", "-2", "0.25")
 * - module-scoped keys ("Reading and Writing Module 1 Answers")
 * - "33 QUESTIONS" count stubs
 * - "1 . B" format (spaces around period)
 */
export function parseAnswerKey(
  pages: Array<{ pageNumber: number; text: string }>,
  totalQuestions?: number,
): ParsedAnswerKey {
  const entries: ParsedKeyEntry[] = [];
  let inKey = false;
  let lastNumber = 0;
  /** Per-column sequences for independent-column key tables. */
  let colLast: number[] = [];
  let confidence = 0;
  let currentModule = "";
  let keyInferredModule: string | null = null;
  let lastQuestionModule = "";
  /** Heading-less key mode: exits after a couple of non-entry lines. */
  let autoKeyed = false;
  let autoMisses = 0;
  /**
   * Unconfirmed heading-less rows: committed only after 3 consecutive
   * continuing rows, so a stray data line can't become key entries.
   */
  let autoRowBuffer: Array<{ pairs: KeyRowPair[]; pageNumber: number; sourceText: string }> = [];
  let lastRowPairs: KeyRowPair[] | null = null;

  const resetKeyState = () => {
    lastNumber = 0;
    colLast = [];
    autoRowBuffer = [];
    lastRowPairs = null;
  };

  const pushEntry = (
    n: number,
    answer: string,
    pageNumber: number,
    sourceText: string,
    column: number | null,
  ) => {
    entries.push({
      questionNumber: n,
      answer: normalizeKeyAnswer(answer),
      pageNumber,
      sourceText,
      moduleName: currentModule || undefined,
      inferredModule: keyInferredModule ?? undefined,
      column: column ?? undefined,
    });
  };

  for (const page of pages) {
    for (const rawLine of page.text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const clean = stripMarkdown(line);

      // Track question-module headings for generic-key attribution
      const questionModuleMatch = clean.match(QUESTION_MODULE_HEADING_RE);
      if (questionModuleMatch) {
        lastQuestionModule = buildModuleName(questionModuleMatch[1]!, Number(questionModuleMatch[2]));
      } else {
        const colonModuleMatch = clean.match(MODULE_COLON_HEADING_RE);
        if (colonModuleMatch) {
          lastQuestionModule = buildModuleName(colonModuleMatch[2]!, Number(colonModuleMatch[1]));
        } else {
          const sectionPrefixMatch = clean.match(SECTION_PREFIX_RE) ?? clean.match(SECTION_SHORT_RE);
          if (sectionPrefixMatch) {
            lastQuestionModule = buildModuleName(sectionPrefixMatch[3]!, Number(sectionPrefixMatch[2]));
          }
        }
      }

      // Check for module-scoped key heading first
      const moduleKeyMatch = clean.match(MODULE_KEY_HEADING_RE);
      if (moduleKeyMatch) {
        inKey = true;
        currentModule = buildModuleName(moduleKeyMatch[1]!, Number(moduleKeyMatch[2]));
        keyInferredModule = null;
        autoKeyed = false;
        autoMisses = 0;
        resetKeyState();
        continue;
      }
      const colonKeyMatch = clean.match(MODULE_COLON_KEY_HEADING_RE);
      if (colonKeyMatch) {
        inKey = true;
        currentModule = buildModuleName(colonKeyMatch[2]!, Number(colonKeyMatch[1]));
        keyInferredModule = null;
        autoKeyed = false;
        autoMisses = 0;
        resetKeyState();
        continue;
      }
      const shortKeyMatch = clean.match(SECTION_SHORT_KEY_HEADING_RE);
      if (shortKeyMatch) {
        inKey = true;
        currentModule = buildModuleName(shortKeyMatch[3]!, Number(shortKeyMatch[2]));
        keyInferredModule = null;
        autoKeyed = false;
        autoMisses = 0;
        resetKeyState();
        continue;
      }

      // Check for general key heading (including mangled OCR variants)
      if (KEY_HEADING_RE.test(clean) || isMangledKeyHeading(clean)) {
        inKey = true;
        currentModule = "";
        keyInferredModule = lastQuestionModule || null;
        autoKeyed = false;
        autoMisses = 0;
        resetKeyState();
        continue;
      }

      // "33 QUESTIONS" stub — enter key mode but skip the line.
      // A stub with no prior heading ("27 QUESTIONS" under a module title)
      // is tentative: real entries must follow or it exits after misses.
      if (QUESTIONS_COUNT_RE.test(clean)) {
        if (!inKey) {
          autoKeyed = true;
          autoMisses = 0;
        }
        inKey = true;
        resetKeyState();
        continue;
      }

      if (!inKey) {
        // Heading-less key table at the end of a test (paired columns or a
        // crammed list). Only after real question content was seen, so stray
        // numbered lines mid-test can't trigger it. Bare numbers never
        // trigger (graph ticks like "11" split as n=1/ans=1). Files without
        // module headings (pure Bluebook streams) use the known question
        // count as existence proof instead of a heading.
        const singleStart = clean.match(EXPLICIT_SINGLE_RE) ?? clean.match(NO_DELIM_SINGLE_RE);
        if (
          (lastQuestionModule || (totalQuestions ?? 0) > 0) &&
          (isKeyTableLine(clean) || (singleStart && Number(singleStart[1]) === 1 && lastNumber === 0))
        ) {
          inKey = true;
          currentModule = "";
          keyInferredModule = lastQuestionModule;
          resetKeyState();
          autoKeyed = true;
          autoMisses = 0;
        } else {
          continue;
        }
      }

      // Key table row (2+ pairs): classic interleaved ("1 A  2 C"),
      // independent columns ("1 C  1 B"), or multi-module rows
      // ("1 D 1 A 1 B 1 B"). Heading-less rows commit only after 3
      // consecutive continuing rows (autoRowBuffer).
      const commitRow = (pairs: KeyRowPair[], rowPage: number, rowText: string): boolean => {
        if (
          pairs.length === 2 &&
          pairs[1]!.n === pairs[0]!.n + 1 &&
          (pairs[0]!.n === lastNumber + 1 || lastNumber === 0)
        ) {
          pushEntry(pairs[0]!.n, pairs[0]!.answer, rowPage, rowText, null);
          pushEntry(pairs[1]!.n, pairs[1]!.answer, rowPage, rowText, null);
          lastNumber = pairs[1]!.n;
          pairs.forEach((p, j) => {
            while (colLast.length <= j) colLast.push(0);
            colLast[j] = p.n;
          });
          return true;
        }
        // Row-wise sequential table ("321 C 322 A" as one run): every number
        // continues the previous within the row, starting after lastNumber.
        // Multi-module rows ("1 D 1 A 1 B 1 B") are not sequential — safe.
        const rowWise =
          pairs.length > 2 &&
          pairs.every((p, j) => (j === 0 ? p.n === lastNumber + 1 || lastNumber === 0 : p.n === pairs[j - 1]!.n + 1));
        if (rowWise) {
          pairs.forEach((p, j) => {
            pushEntry(p.n, p.answer, rowPage, rowText, null);
            while (colLast.length <= j) colLast.push(0);
            colLast[j] = p.n;
          });
          lastNumber = pairs[pairs.length - 1]!.n;
          return true;
        }
        while (colLast.length < pairs.length) colLast.push(0);
        const colOk = pairs.every((p, j) => p.n === colLast[j]! + 1 || colLast[j]! === 0);
        if (!colOk) return false;
        pairs.forEach((p, j) => {
          pushEntry(p.n, p.answer, rowPage, rowText, currentModule ? null : j);
          colLast[j] = p.n;
        });
        if (pairs.length === 2 && currentModule) lastNumber = Math.max(pairs[0]!.n, pairs[1]!.n);
        return true;
      };

      const rowPairs = parseKeyRow(clean);
      if (rowPairs) {
        if (!currentModule && autoKeyed) {
          if (!lastRowPairs || !keyRowsContinue(lastRowPairs, rowPairs)) {
            autoRowBuffer = [{ pairs: rowPairs, pageNumber: page.pageNumber, sourceText: line }];
          } else if (autoRowBuffer.length > 0) {
            autoRowBuffer.push({ pairs: rowPairs, pageNumber: page.pageNumber, sourceText: line });
            if (autoRowBuffer.length >= 3) {
              for (const b of autoRowBuffer) commitRow(b.pairs, b.pageNumber, b.sourceText);
              autoRowBuffer = [];
            }
          } else {
            commitRow(rowPairs, page.pageNumber, line);
          }
          lastRowPairs = rowPairs;
          autoMisses = 0;
          continue;
        }
        if (commitRow(rowPairs, page.pageNumber, line)) {
          lastRowPairs = rowPairs;
          autoMisses = 0;
          continue;
        }
      }

      // Crammed key list on one line ("1. C 2. B 3. A").
      TOKEN_ENTRY_RE.lastIndex = 0;
      const tokenMatches = [...clean.matchAll(TOKEN_ENTRY_RE)];
      if (tokenMatches.length >= 2) {
        const nums = tokenMatches.map((t) => Number(t[1]));
        const sequential = nums.every((n, i) =>
          i === 0 ? n === lastNumber + 1 || lastNumber === 0 : n === nums[i - 1]! + 1,
        );
        if (sequential) {
          for (const t of tokenMatches) pushEntry(Number(t[1]), t[2]!, page.pageNumber, line, null);
          lastNumber = nums[nums.length - 1]!;
          autoMisses = 0;
          continue;
        }
      }

      // Single-column entries, including pipe-separated rows
      // ("1 A | 2 C | ..."). In heading-less mode only explicit delimiters
      // count, so bare-number graph ticks can't pollute the key table.
      // Pipes inside $…$ ("$1/4 \\mid 0.25$") are alternatives, not columns.
      const segList = splitKeySegments(clean);
      let segConsumed = false;
      let segShape = false;
      for (let seg of segList) {
        seg = seg.trim();
        if (!seg) continue;
        const single = autoKeyed
          ? (seg.match(EXPLICIT_SINGLE_RE) ?? seg.match(NO_DELIM_SINGLE_RE))
          : seg.match(SINGLE_ENTRY_RE);
        if (single) {
          segShape = true;
          const n = Number(single[1]);
          if (n === lastNumber + 1 || lastNumber === 0) {
            pushEntry(n, single[2]!, page.pageNumber, seg, null);
            lastNumber = n;
            autoMisses = 0;
            segConsumed = true;
          } else if (!autoKeyed && n === 1 && lastNumber > 1) {
            // New run within one headed section: a previous module's trailing
            // keys ("26. C 27. C" printed under the next Answers heading)
            // must not swallow this section's real "1. …" entries.
            pushEntry(n, single[2]!, page.pageNumber, seg, null);
            lastNumber = n;
            autoMisses = 0;
            segConsumed = true;
          } else if (autoKeyed && n === 1 && lastNumber > 1) {
            // New run in heading-less mode: consecutive single-column blocks
            // ("1. B … 27. B", "1. A … 27. D"). Without the reset the second
            // block dies and later column attribution misaligns.
            colLast = [];
            autoRowBuffer = [];
            lastRowPairs = null;
            pushEntry(n, single[2]!, page.pageNumber, seg, null);
            lastNumber = n;
            autoMisses = 0;
            segConsumed = true;
          }
          continue;
        }
        // Numberless continuation (headed only): a bare answer continues the
        // sequence ("$4 \\frac{4}{31}$" after "3 B" is Q4's answer).
        if (!autoKeyed && lastNumber > 0 && BARE_ANSWER_RE.test(seg) && !PLAIN_INT_RE.test(seg)) {
          pushEntry(lastNumber + 1, seg, page.pageNumber, seg, null);
          lastNumber += 1;
          autoMisses = 0;
          segConsumed = true;
        }
      }
      if (segConsumed) continue;
      if (segShape && (!autoKeyed || lastNumber === 0)) continue;

      // If we hit something that doesn't look like a key entry and we have
      // some entries, exit key mode. Heading-less mode also exits after a
      // couple of misses so a false trigger can't run away. Unconfirmed
      // buffered rows are discarded on any exit.
      if (entries.length > 0 && !isKeyContinuation(line)) {
        inKey = false;
        currentModule = "";
        keyInferredModule = null;
        autoKeyed = false;
        autoMisses = 0;
        autoRowBuffer = [];
        lastRowPairs = null;
      } else if (autoKeyed) {
        autoMisses++;
        if (autoMisses >= 2) {
          inKey = false;
          keyInferredModule = null;
          autoKeyed = false;
          autoMisses = 0;
          autoRowBuffer = [];
          lastRowPairs = null;
        }
      }
    }
  }

  if (totalQuestions) {
    const coverage = entries.length / totalQuestions;
    confidence = Math.min(1, coverage * (entries.length >= 3 ? 0.9 : 0.5));
  } else {
    confidence = entries.length >= 3 ? 0.7 : entries.length > 0 ? 0.4 : 0;
  }
  confidence = Math.round(confidence * 100) / 100;

  return { entries, confidence };
}

/** Build a normalized module name from section keyword + number. */
function buildModuleName(section: string, num: number): string {
  const base = section.toLowerCase().startsWith("math") ? "Math" : "Reading and Writing";
  return `${base} Module ${num}`;
}

/** Lines that might continue a key block (multi-column fragments, etc.) */
function isKeyContinuation(line: string): boolean {
  // Bare number on a line (could be a page number or continued key)
  if (/^\d{1,3}$/.test(line)) return true;
  // Another module key heading (including mangled variants)
  if (MODULE_KEY_HEADING_RE.test(line)) return true;
  if (isMangledKeyHeading(line)) return true;
  // Questions count
  if (QUESTIONS_COUNT_RE.test(line)) return true;
  return false;
}

/**
 * Build a lookup from `"moduleName|questionNumber"` or `"g|questionNumber"` (global)
 * to detected answer.
 */
export function answerMap(
  key: ParsedAnswerKey,
): Map<string, { answer: string; pageNumber: number; sourceText: string }> {
  const m = new Map<string, { answer: string; pageNumber: number; sourceText: string }>();
  for (const e of key.entries) {
    const scoped = e.moduleName ? `${e.moduleName}|${e.questionNumber}` : `g|${e.questionNumber}`;
    m.set(scoped, { answer: e.answer, pageNumber: e.pageNumber, sourceText: e.sourceText });
  }
  return m;
}

/** Build a legacy global-only answer map (for backwards compat). */
export function answerMapGlobal(key: ParsedAnswerKey): Map<number, { answer: string; pageNumber: number; sourceText: string }> {
  const m = new Map<number, { answer: string; pageNumber: number; sourceText: string }>();
  for (const e of key.entries) m.set(e.questionNumber, { answer: e.answer, pageNumber: e.pageNumber, sourceText: e.sourceText });
  return m;
}
