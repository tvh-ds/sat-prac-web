import { parseKeyRow, keyRowsContinue, normalizeKeyAnswer, splitKeySegments, type KeyRowPair } from "./answerKey";

export interface ScraperChoice {
  label: string;
  text: string;
  position: number;
}

export interface ScraperQuestion {
  sourceQuestionNumber: number;
  sourceModuleName: string;
  sourceModulePosition: number;
  pageNumber: number;
  section: "reading_writing" | "math";
  questionType: "multiple_choice" | "student_produced";
  prompt: string;
  passageText: string | null;
  choices: ScraperChoice[];
  confidence: number;
  /** True when a "[figure: …]"/"[table: …]" marker landed in this block. */
  hasVisualStimulus: boolean;
  /** Number of visual marker spans in this block (drives OCR box attribution). */
  visualMarkerCount: number;
}

export interface ScraperKeyEntry {
  questionNumber: number;
  answer: string;
  pageNumber: number;
  sourceText: string;
  moduleName: string;
  /** True when the key came from a bare "Answer Key" heading (global numbering). */
  global: boolean;
}

export interface ScraperModule {
  name: string;
  section: "reading_writing" | "math";
  questionCount: number;
  /** First page where the module heading (or its first question) appeared. */
  startPage: number;
  /** Last page containing the module's questions. */
  endPage: number;
}

export interface ScraperParseResult {
  questions: ScraperQuestion[];
  keys: ScraperKeyEntry[];
  modules: ScraperModule[];
  keyConfidence: number;
}

/** Expected complete-module question counts for a real SAT practice PDF. */
export const EXPECTED_RW_QUESTIONS = 27;
export const EXPECTED_MATH_QUESTIONS = 22;

export function expectedQuestionsForSection(section: "reading_writing" | "math"): number {
  return section === "math" ? EXPECTED_MATH_QUESTIONS : EXPECTED_RW_QUESTIONS;
}

export interface ModuleCompleteness {
  name: string;
  section: "reading_writing" | "math";
  expected: number;
  actual: number;
  /** expected - actual; <= 0 means complete. */
  missing: number;
  startPage: number;
  endPage: number;
  complete: boolean;
}

/** Compare each detected module against its expected question count. */
export function evaluateModuleCompleteness(modules: ScraperModule[]): ModuleCompleteness[] {
  return modules.map((m) => {
    const expected = expectedQuestionsForSection(m.section);
    const missing = expected - m.questionCount;
    return {
      name: m.name,
      section: m.section,
      expected,
      actual: m.questionCount,
      missing,
      startPage: m.startPage,
      endPage: m.endPage,
      complete: missing <= 0,
    };
  });
}

/** Also matches "Reading Module N" and adaptive labels ("Math Module 2 (Hard)"). */
const MODULE_HEADING_RE =
  /^\s*(reading(?:\s*(?:and|&)?\s*writing)?|math)(?:\s+module\s+(\d))?\s*(?:\(\s*(?:hard|easy|medium)\s*\))?\s*$/i;
const MODULE_ANSWERS_RE = /^\s*(reading\s*(?:and|&)?\s*writing|math)\s+module\s+(\d)\s+answers?\s*:?\s*$/i;
const ANSWER_KEY_RE = /^\s*answer\s+keys?\s*:?\s*$/i;
const QUESTIONS_COUNT_RE = /^\s*(\d{1,3})\s+questions?\s*$/i;
/**
 * One answer value or comma-separated acceptable answers ("43/3, 14.33",
 * leading-decimal grid-ins like ".1428", LaTeX "$1/4 \\mid 0.25$").
 */
const KEY_ANSWER_RE = `[A-Ha-h]|\\$[^$]{1,60}\\$|[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:\\s*\\/\\s*\\d+)?`;
const KEY_ANSWER_LIST_RE = `(?:${KEY_ANSWER_RE})(?:\\s*[,;]\\s*(?:${KEY_ANSWER_RE}))*`;

const KEY_ENTRY_RE = new RegExp(`^\\s*(\\d{1,3})\\s*[.)]?\\s*(${KEY_ANSWER_LIST_RE})\\s*$`);
/** Standalone question number, optionally with trailing period ("18" or "18."). */
const QUESTION_NUMBER_BAR_RE = /^\s*(\d{1,3})\s*[.)]?\s*$/;
/** Markdown horizontal rules ("---", "***", "___") carry no content. */
const HRULE_RE = /^\s*([-*_])\1{2,}\s*$/;
const INLINE_QUESTION_RE = /^\s*(\d{1,3})\s*[.)]\s+(.+)$/;
const QUESTION_MARKER_RE = /^\s*[Qq]uestion\s+(\d{1,3})\s*$/;
/**
 * Paren-wrapped labels ("(A) text") included; figure/table choices
 * ("B [figure: …]") need no delimiter; bare "A text" stays Bluebook-only.
 */
const CHOICE_RE = /^\s*\(?([A-H])(?:[.)]|\))\s*(.*)$|^\s*\(?([A-H])\)?\s*(\[figure|\[table)/;
/**
 * Choice labels wrapped in markdown bold ("**A.** text", "**B)** text").
 * Normalize to "A. text" before choice detection/extraction.
 */
function stripBoldChoice(line: string): string {
  return line.replace(/^\s*\*+([A-H])\**\s*[.)]\**\s*/, "$1. ");
}

/** "Module 1: Reading and Writing" — number-first heading variant. */
const MODULE_COLON_RE = /^\s*module\s+(\d)\s*:\s*(reading\s*(?:and|&)?\s*writing|math)\s*$/i;
/** "Module 1: Reading and Writing Answers" — number-first key heading. */
const MODULE_COLON_ANSWERS_RE = /^\s*module\s+(\d)\s*:\s*(reading\s*(?:and|&)?\s*writing|math)\s+answers?\s*:?\s*$/i;
/** "n. answer" tokens anywhere in a line (crammed key lists). */
const TOKEN_ENTRY_RE = new RegExp(
  `(?:^|\\s)(\\d{1,3})\\s*(?:[.)]\\s*|\\s{2,})(${KEY_ANSWER_LIST_RE})(?=\\s|$)`,
  "g",
);

/** Bare answer with no question number (headed key sections only). */
const SCRAPER_BARE_ANSWER_RE = new RegExp(`^\\s*(?:${KEY_ANSWER_LIST_RE}|\\$[^$]{1,60}\\$)\\s*$`);
const SCRAPER_PLAIN_INT_RE = /^[+-]?\d+$/;



/** A line of several "n. answer" tokens (answer-key list crammed on one line). */
const KEY_LIST_RE = /^\s*(?:\d{1,3}\s*[.)]\s*([A-Ha-h]|[+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*){3,}$/;
/** Looser variant: matches lines containing two or more "n. answer" tokens. */
const KEY_TOKEN_RE = /(?:^|\s)\d{1,3}\s*[.)]\s+(?:[A-Ha-h]|[+-]?(?:\d+(?:\.\d+)?|\.\d+))(?=\s|$)/g;
const PROSE_MIN_WORDS = 25;

/** Question stems typical of SAT Reading & Writing questions. */
const R_W_STEM_RE =
  /^\s*(which choice|as used in the passage|as used in the text|as used in line|the student wants to|which finding|which quotation|according to the passage|according to the text|based on the passages?|based on the texts?|which statement|which option|the texts? (most strongly )?suggests?|the passages? suggests?|what does the texts?|what does the author|which claim|which list|the (main|primary|central) (purpose|idea|claim|idea)|the author (most likely|suggests?|argues?|implies?|notes?|concludes?)|the narrator (most likely|suggests?)|the data|the graph|the table|how would the author|what is the main|which choice would)\b/i;

/** Math graph-axis noise: lone "x"/"y" or a standalone numeric value. */
const MATH_NOISE_RE = /^[xy]$/i;

/** True for axis ticks like "60", "-15", "0", "2.72", "x", "y". */
function isMathNoise(line: string): boolean {
  return MATH_NOISE_RE.test(line) || /^[+-]?\d+(?:\.\d+)?%?$/.test(line);
}

/**
 * True for student-produced response directions blocks ("Student-produced
 * response directions … If you find more than one correct answer … You can
 * enter up to 5 characters … Answer Preview"). In Bluebook exports the same
 * instructions appear as "Answer Preview:" + "Enter only one answer" lines.
 */
function isDirectionsBlock(promptLines: string[], choices: Array<{ label: string }>): boolean {
  if (choices.length > 0) return false;
  const text = promptLines.join(" ").toLowerCase();
  if (!/student-produced response directions|answer preview|more than one correct answer/.test(text)) return false;
  return /more than one correct answer|enter only one answer|enter up to \d+ characters|up to \d+ characters|characters for a (positive|negative) answer|answer preview/.test(text);
}

/**
 * True for a single instruction line inside an anchored directions block:
 * bullets ("If your answer is a fraction that doesn't fit …", "Don't enter
 * symbols …"), headers ("Answer Preview:", "answer acceptable
 * unacceptable"), example values ("3.5 3.5", ".666", "7/2"), and OCR garbage
 * with no ASCII letters. Real prompts (letters, not instruction patterns)
 * survive.
 */
function isDirectionsLine(line: string): boolean {
  const t = line.replace(/^[*#\-\s\d.)\]]+/, "").trim();
  if (/student-produced response directions/i.test(t)) return true;
  if (/more than one correct answer|enter only one answer/i.test(t)) return true;
  if (/enter up to \d+ characters|characters (for a|including)/i.test(t)) return true;
  if (/^answer preview:?\s*$/i.test(t)) return true;
  if (/^answer acceptable/i.test(t)) return true;
  if (/^express your answer as a decimal or fraction/i.test(t)) return true;
  if (/doesn't fit in the provided space|truncating or rounding|mixed number|improper fraction|decimal equivalent/i.test(t)) return true;
  if (/don't enter.*symbols|percent sign, comma, or dollar/i.test(t)) return true;
  if (/^\[box for answer\]\s*$/i.test(t)) return true;
  if (/^answer:\s*$/i.test(t)) return true;
  if (/^enter response/i.test(t)) return true;
  if (/examples(\s+answer)?\s+acceptable/i.test(t) || /^\s*examples\b/i.test(t)) return true;
  // Letterless lines are instruction examples ("3.5 3.5", ".666", "7/2")
  // or OCR garbage — but plain-integer rows ("20 6") can be real table
  // data, so only strip with decimal/slash/percent markers or CJK text.
  if (!/[a-zA-Z]/.test(t) && (/[./%]/.test(t) || /[⺀-⺙⺛-⻳⼀-⿕々〇〡-〩〪-〯〰〱-〳〵-〶〷぀-ヹァ-ヺー-ヿ㐀-䶵一-鿋豈-頻並-龎]/.test(t))) return true;
  return false;
}

/**
 * Stray instruction line outside any block (empty blockPrompt/Choices/
 * Passage): directions continuations orphaned by a boundary flush
 * ("* You can enter up to 5 characters …", example values). A real
 * question never starts with one of these.
 */
function isStrayInstructionLine(line: string): boolean {
  return isDirectionsLine(line);
}

/**
 * True for a directions anchor strong enough to close the current question
 * block ("Student-produced response directions", "Answer Preview:",
 * "more than one correct answer"). Packed questions on either side split
 * apart instead of merging.
 */
function isDirectionsBoundary(line: string): boolean {
  const t = stripMarkdown(line).replace(/^[*#\-\s\d.)\]]+/, "").trim();
  return (
    /student-produced response directions/i.test(t) ||
    /^answer preview:?\s*$/i.test(t) ||
    /more than one correct answer/i.test(t)
  );
}

/** True for answer-entry box figures ("[figure: A rectangular box … write the answer]"). */
function isAnswerBoxFigure(line: string): boolean {
  const m = line.match(/^\[(figure|table):([^\]]*)\]/i);
  if (!m) return false;
  const desc = m[2]!.toLowerCase();
  return /\bbox\b/.test(desc) && /(write|enter|blank|answer)/.test(desc);
}

/**
 * True for Bluebook UI screenshot figures (question-number badge, toolbar):
 * Parse describes them with "Mark for Review", "bookmark icon", "black
 * square containing the number", etc. Never question content.
 */
function isUiScreenshotFigure(line: string): boolean {
  const m = line.match(/^\[(figure|table):([^\]]*)\]/i);
  if (!m) return false;
  const desc = m[2]!.toLowerCase();
  return /mark for review|bookmark|black square|separator.*(square|icon)|(square|icon).*separator/.test(desc);
}

/**
 * True when block prompt lines form a complete standalone question (ends
 * with "?"). Lead-in fragments ("The scatterplot shows … is also shown.")
 * end with "." and must not trigger the figure split.
 */
function isCompletePrompt(promptLines: string[]): boolean {
  const text = promptLines.join(" ").replace(/\s+/g, " ").trim();
  return text.length >= 20 && /\?\s*$/.test(text);
}

/**
 * Split an R&W prompt block at the first question mark: the prompt usually
 * ends with "?" and anything substantial after it is passage/stimulus text
 * that OCR placed after the instruction (e.g. "Which choice completes the
 * text …? A study by … tended to ______ …"). Math is excluded — equations
 * legitimately contain "?"-adjacent content and multi-line prompts.
 *
 * Returns null when there is nothing worth splitting (no "?", a short tail
 * like a normal self-contained prompt, a choice run, or another question).
 */
/**
 * Remove a fully-wrapping markdown bold fence ("**Which choice …?**" →
 * "Which choice …?"). Only applies when the whole line is fenced, so
 * bullet "* item" lines and mid-line emphasis are untouched. Detection
 * already ignores these fences; stored text should too.
 */
function unwrapBoldLine(line: string): string {
  const m = line.match(/^\s*\*\*(.+?)\*\*\s*$/);
  return m ? m[1]!.trim() : line;
}

function splitRwPromptAtQuestionMark(lines: string[]): { prompt: string; rest: string } | null {
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const qm = text.search(/[?？]/);
  if (qm < 0) return null;
  const prompt = text.slice(0, qm + 1).trim();
  const rest = text.slice(qm + 1).trim();
  if (prompt.length < 15) return null;
  if (rest.length < 30 || rest.split(/\s+/).filter(Boolean).length < 5) return null;
  // A choice run or another question stem after "?" is a boundary problem,
  // not passage text — leave it for the normal boundary logic.
  if (/^\(?[A-H][.)\]]\s+\S/.test(rest)) return null;
  if (R_W_STEM_RE.test(rest)) return null;
  return { prompt, rest };
}

/**
 * Lookahead for the math figure split: after a figure marker, is there
 * another complete prompt followed by choices (a new visual question),
 * rather than choices directly (figure illustrating the current prompt)?
 * Scans <= 12 non-blank lines; bars/headings end the search negatively.
 */
function figureSplitAhead(
  pages: Array<{ pageNumber: number; text: string }>,
  pi: number,
  li: number,
): boolean {
  let promptSeen = false;
  let seen = 0;
  for (let p = pi; p < pages.length && seen < 12; p++) {
    const lines = pages[p]!.text.split("\n");
    for (let i = p === pi ? li + 1 : 0; i < lines.length && seen < 12; i++) {
      const line = lines[i]!.trim();
      if (!line || /^===== PAGE \d+ =====\s*$/.test(line)) continue;
      seen++;
      const kind = classifyLine(line).kind;
      if (kind === "choice") return promptSeen;
      if (kind === "stem" || kind === "inline" || kind === "question-marker") return true;
      if (kind === "bar" || kind === "module-heading" || kind === "key-heading" || kind === "questions-count") {
        // A bar/heading after a seen prompt ends a trailing grid-in question
        // (no choices of its own); with no prompt seen it ends a tick run.
        return promptSeen;
      }
      if (line.length >= 30 && /[a-zA-Z]{3}/.test(line) && /[?.!…:]$/.test(line)) promptSeen = true;
    }
  }
  return false;
}

/**
 * Lookahead for bar resync: does a candidate out-of-window bar lead into
 * real question content? Scans forward (<= 24 non-blank lines): true when a
 * choice, stem, or delimited inline number appears. The next question's own
 * bar (candidate+1, then +2, ...) may intervene as long as prompt text sits
 * between the numbers — grid-in questions have no choices of their own. A
 * run of bare numbers with no prompt between (axis ticks) returns false, as
 * do headings.
 */
function looksLikeQuestionAhead(
  pages: Array<{ pageNumber: number; text: string }>,
  pi: number,
  li: number,
): boolean {
  const cand = Number(stripMarkdown(pages[pi]!.text.split("\n")[li]!));
  let lastNum = cand;
  let promptSince = false;
  let seen = 0;
  for (let p = pi; p < pages.length && seen < 24; p++) {
    const lines = pages[p]!.text.split("\n");
    for (let i = p === pi ? li + 1 : 0; i < lines.length && seen < 24; i++) {
      const line = lines[i]!.trim();
      if (!line || /^===== PAGE \d+ =====\s*$/.test(line)) continue;
      seen++;
      const kind = classifyLine(line).kind;
      if (kind === "choice" || kind === "stem" || kind === "inline" || kind === "question-marker") return true;
      if (kind === "module-heading" || kind === "key-heading" || kind === "questions-count") return false;
      if (kind === "bar") {
        const n = Number(stripMarkdown(line));
        // Next question's number continuing the run with prompt text between
        // (grid-in question needs no choices): skip over it.
        if (promptSince && n === lastNum + 1) {
          lastNum = n;
          promptSince = false;
          continue;
        }
        return false;
      }
      if (line.length >= 25 && /[a-zA-Z]{3}/.test(line)) promptSince = true;
    }
  }
  return false;
}

/**
 * Parse 5 emits markdown: "# Reading and Writing Module 2",
 * "## 27 QUESTIONS", "**1**" bars. Strip heading markers and fully-wrapping
 * bold so structural regexes see the underlying text.
 */
export function stripMarkdown(line: string): string {
  let s = line.replace(/^\s*#{1,6}\s*/, "");
  const bold = s.match(/^\s*\*\*(.+?)\*\*\s*$/);
  if (bold) s = bold[1]!;
  return s.trim();
}

type LineKind =
  | "module-heading"
  | "key-heading"
  | "questions-count"
  | "bar"
  | "inline"
  | "question-marker"
  | "review-marker"
  | "bb-footer"
  | "chrome"
  | "choice"
  | "stem"
  | "key-list"
  | "prose";

/** Bluebook export: "2 Mark for Review" / "**3** Mark for Review" question marker. */
const REVIEW_MARKER_RE = /^\s*\*{0,2}(\d{1,3})\*{0,2}\s+mark\s+for\s+review\s*$/i;
/** Bluebook export: "Question 6 of 22" end-of-question footer. */
const BB_FOOTER_RE = /^\s*question\s+(\d{1,3})\s+of\s+(22|27)\s*$/i;
/** Bluebook UI chrome: nav, toolbar, timers, widget labels. */
const BB_CHROME_RE =
  /^\s*(back(\s+next)?|next|directions?\s*[v▼▾]?|hide(\s+calculator(\s+reference(\s+more)?)?)?|calculator(\s+reference(\s+more)?)?|reference(\s+more)?|more|annotate|answer\s+preview|box\s+for\s+answer)\s*:?\s*$/i;
const BB_TIMER_RE = /^\s*\d{1,2}:\d{2}\s*$/;
/** Probable student name ("Haotian Yu"): 2-3 capitalized words, nothing else. */
const BB_NAME_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/;

/** True when pages look like a Bluebook app export (markers/footers). */
export function looksBluebook(pages: Array<{ text: string }>): boolean {
  let markers = 0;
  for (const pg of pages) {
    for (const ln of pg.text.split("\n")) {
      const c = stripMarkdown(ln);
      if (REVIEW_MARKER_RE.test(c) || BB_FOOTER_RE.test(c)) markers++;
      if (markers >= 3) return true;
    }
  }
  return false;
}
/** Bare-letter choice ("A mock") — Bluebook exports only, with A-D sequence rule. */
const BB_BARE_CHOICE_RE = /^\s*([A-D])\s+(\S[^]*)$/;

/**
 * OCR visual-descriptor marker ("[figure: long description]", "[table: …]",
 * bare "[figure]"/"[table]"). The description is Parse's textual account of
 * a graph/image — it must never become prompt, passage, or choice text.
 * Reviewers crop/attach the visual manually; the question is still flagged
 * via hasVisualStimulus + needs_review + stimulus image.
 */
const FIGURE_MARKER_RE = /^\s*\[(figure|table)\b/i;
const FIGURE_SPAN_RE = /\[(figure|table)(:[^\]]*)?\]/gi;

/** Remove "[figure: …]"/"[table: …]"/"[figure]"/"[table]" spans entirely. */
export function stripFigureMarkers(text: string): string {
  return text.replace(FIGURE_SPAN_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

/** True when the text contains any visual-descriptor marker span. */
export function hasFigureMarker(text: string): boolean {
  return /\[(figure|table)\b/i.test(text);
}

/** True when the whole line is a visual-descriptor marker. */
export function isFigureMarkerLine(line: string): boolean {
  return FIGURE_MARKER_RE.test(line.trim());
}

/**
 * Lookahead for a Bluebook bare-letter choice run: the next non-blank lines
 * (<= 10 scanned) must be B, C, D bare labels in order. Confirms a leading
 * "A …" line really starts choices rather than a passage sentence.
 */
function bbChoiceRunAhead(
  pages: Array<{ pageNumber: number; text: string }>,
  pi: number,
  li: number,
): boolean {
  const want = ["B", "C", "D"];
  let wi = 0;
  let seen = 0;
  for (let p = pi; p < pages.length && wi < want.length && seen < 10; p++) {
    const lines = pages[p]!.text.split("\n");
    for (let i = p === pi ? li + 1 : 0; i < lines.length && wi < want.length && seen < 10; i++) {
      const t = lines[i]!.trim();
      if (!t) continue;
      seen++;
      const m = stripBoldChoice(stripMarkdown(t)).match(BB_BARE_CHOICE_RE);
      if (m && m[1] === want[wi]) wi++;
      else return false;
    }
  }
  return wi === want.length;
}

interface LineClass {
  kind: LineKind;
  label?: string;
}

function classifyLine(line: string): LineClass {
  const clean = stripBoldChoice(stripMarkdown(line));
  if (
    MODULE_ANSWERS_RE.test(clean) ||
    MODULE_COLON_ANSWERS_RE.test(clean) ||
    SECTION_SHORT_ANSWERS_RE.test(clean) ||
    ANSWER_KEY_RE.test(clean)
  )
    return { kind: "key-heading" };
  if (/answ/i.test(clean) && /(module|reading|writing|math)/i.test(clean) && clean.length <= 60) return { kind: "key-heading" };
  if (
    MODULE_HEADING_RE.test(clean) ||
    MODULE_COLON_RE.test(clean) ||
    SECTION_PREFIX_RE.test(clean) ||
    SECTION_SHORT_RE.test(clean)
  )
    return { kind: "module-heading" };
  if (QUESTIONS_COUNT_RE.test(clean)) return { kind: "questions-count" };
  if (BB_CHROME_RE.test(clean) || BB_TIMER_RE.test(clean)) return { kind: "chrome" };
  const reviewMarker = clean.match(REVIEW_MARKER_RE);
  if (reviewMarker && Number(reviewMarker[1]) > 0 && Number(reviewMarker[1]) <= 150) return { kind: "review-marker" };
  const bbFooter = clean.match(BB_FOOTER_RE);
  if (bbFooter && Number(bbFooter[1]) > 0 && Number(bbFooter[1]) <= 150) return { kind: "bb-footer" };
  const bar = clean.match(QUESTION_NUMBER_BAR_RE);
  if (bar && Number(bar[1]) > 0 && Number(bar[1]) <= 150) return { kind: "bar" };
  const questionMarker = clean.match(QUESTION_MARKER_RE);
  if (questionMarker && Number(questionMarker[1]) > 0 && Number(questionMarker[1]) <= 150) return { kind: "question-marker" };
  if (KEY_LIST_RE.test(clean)) return { kind: "key-list" };
  if ((clean.match(KEY_TOKEN_RE) ?? []).length >= 2) return { kind: "key-list" };
  const inline = clean.match(INLINE_QUESTION_RE);
  if (inline && inline[2]) {
    // Count only standalone question-like numbers: boundary-delimited, not
    // math fragments like f(0), g(3), 4), or decimals like 3.14.
    const keyLike = (inline[2].match(/(?:^|[\s;:])\d{1,3}[.)](?=\s)/g) ?? []).length >= 2;
    if (Number(inline[1]) > 0 && Number(inline[1]) <= 150 && inline[2].trim().length >= 4 && !keyLike)
      return { kind: "inline" };
  }
  const choice = clean.match(CHOICE_RE);
  if (choice) return { kind: "choice", label: (choice[1] ?? choice[3])! };
  if (R_W_STEM_RE.test(clean)) return { kind: "stem" };
  return { kind: "prose" };
}

/**
 * Scan forward from (pi, li) and return the next non-blank line that is
 * structurally significant (headings, bars, inline numbers, choices, stems).
 * Prose, questions-count stubs, and answer-key entries are skipped.
 */
function nextSpecial(
  pages: Array<{ pageNumber: number; text: string }>,
  pi: number,
  li: number,
): { kind: LineKind; label?: string } | null {
  for (let p = pi; p < pages.length; p++) {
    const lines = pages[p]!.text.split("\n");
    const start = p === pi ? li + 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const kind = classifyLine(line).kind;
      if (kind !== "prose" && kind !== "questions-count" && kind !== "chrome") return { kind, label: classifyLine(line).label };
    }
  }
  return null;
}

/** True when choice label `b` follows `a` in the A-H sequence. */
function continues(a: string, b: string): boolean {
  return b.toUpperCase().charCodeAt(0) === a.toUpperCase().charCodeAt(0) + 1;
}

/**
 * True when a module/key heading is followed by real question content
 * before the next heading (<= 60 lines scanned). Structural lines
 * (choices, stems, bars, markers, inlines, key entries, figures) qualify
 * immediately; otherwise two substantial prose lines do. Index stubs
 * ("Math Module 1 / 22 QUESTIONS / Math Module 2") have nothing.
 */
function headingHasContent(
  pages: Array<{ pageNumber: number; text: string }>,
  pi: number,
  li: number,
): boolean {
  let prose = 0;
  let seen = 0;
  for (let p = pi; p < pages.length && seen < 60; p++) {
    const lines = pages[p]!.text.split("\n");
    for (let i = p === pi ? li + 1 : 0; i < lines.length && seen < 60; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      seen++;
      const clean = stripMarkdown(line);
      if (HRULE_RE.test(clean) || BB_CHROME_RE.test(clean) || BB_TIMER_RE.test(clean)) continue;
      if (QUESTIONS_COUNT_RE.test(clean)) continue;
      const kind = classifyLine(line).kind;
      if (kind === "module-heading" || kind === "key-heading") return prose >= 2;
      if (kind !== "prose" || /^\[(figure|table)\b/i.test(line)) return true;
      if (line.length >= 10) prose++;
      if (prose >= 2) return true;
    }
  }
  return prose >= 2;
}

/**
 * Trailing metadata on College Board headings, discarded before matching:
 * "Section: Section 1, Module 1: Reading and Writing, Difficulty: hard
 * (27 questions)". Capture groups stay (section, module, name).
 */
const SECTION_TRAIL_RE = `(?:\\s*,.*)?`;
/**
 * College Board question-list format:
 * "Section: Section 1, Module 1: Reading and Writing,"
 */
const SECTION_PREFIX_RE = new RegExp(
  `^\\s*section:\\s*section\\s+(\\d+)\\s*,\\s*module\\s+(\\d+)\\s*:\\s*(reading\\s*(?:and|&)?\\s*writing|math)${SECTION_TRAIL_RE}\\s*$`,
  "i",
);
/** Shorter variant: "Section 2, Module 1: Math" (also with "#" markdown). */
const SECTION_SHORT_RE = new RegExp(
  `^\\s*section\\s+(\\d+)\\s*,\\s*module\\s+(\\d+)\\s*:\\s*(reading\\s*(?:and|&)?\\s*writing|math)${SECTION_TRAIL_RE}\\s*$`,
  "i",
);
/** Shorter key-heading variant: "Section 2, Module 1: Math Answers". */
const SECTION_SHORT_ANSWERS_RE = new RegExp(
  `^\\s*section\\s+(\\d+)\\s*,\\s*module\\s+(\\d+)\\s*:\\s*(reading\\s*(?:and|&)?\\s*writing|math)\\s+answers?\\s*:?${SECTION_TRAIL_RE}\\s*$`,
  "i",
);

/**
 * Standardize a section heading, discarding trailing metadata:
 * "# Section: Section 1, Module 1: Reading and Writing, Difficulty:
 * unknown (27 questions)" → "Section 1, Module 1: Reading and Writing".
 * Returns null when the line is not a section heading.
 */
export function normalizeSectionHeading(line: string): string | null {
  const clean = stripMarkdown(line);
  const m = clean.match(SECTION_PREFIX_RE) ?? clean.match(SECTION_SHORT_RE);
  if (!m) return null;
  const name = m[3]!.toLowerCase().startsWith("math") ? "Math" : "Reading and Writing";
  return `Section ${Number(m[1])}, Module ${Number(m[2])}: ${name}`;
}

function isSectionHeading(line: string): boolean {
  const clean = stripMarkdown(line);
  return (
    MODULE_HEADING_RE.test(clean) ||
    MODULE_COLON_RE.test(clean) ||
    SECTION_PREFIX_RE.test(clean) ||
    SECTION_SHORT_RE.test(clean)
  );
}

function sectionFor(which: string): "reading_writing" | "math" {
  return which.toLowerCase().startsWith("math") ? "math" : "reading_writing";
}

function moduleLabel(which: string, num: number): string {
  const base = which.toLowerCase().startsWith("math") ? "Math" : "Reading and Writing";
  return `${base} Module ${num}`;
}

/**
 * Parse OCR output of a Bluebook-style SAT practice PDF into structured
 * questions and module-scoped answer keys.
 *
 * Robust to GLM-OCR quirks observed on 202605asIav2-rw.pdf:
 *  - standalone question-number bars are captured inconsistently, so
 *    question boundaries are found structurally: a block starts at a stem,
 *    an inline number, a bar, or the first prose line after a completed
 *    choice run; a block ends when a full choice run is followed by prose
 *  - prose lines that continue the text of a choice across line/page breaks
 *    are appended to the last choice (detected by looking ahead for the next
 *    labeled choice before any stem/bar/heading)
 *  - a stem line arriving while an earlier stem block is open (no choices
 *    yet) is appended rather than starting a duplicate question
 *  - "Reading and Writing Module N" / "Math Module N" headings carry module
 *    identity; headings for the current module (page headers) and index
 *    stubs that are not followed by any question content are ignored;
 *    "27 QUESTIONS"/"22 QUESTIONS" count stubs are skipped
 *  - answer keys ("Reading and Writing Module N Answers" + "1. B") are
 *    parsed per module
 */
export function parseScraperQuestions(pages: Array<{ pageNumber: number; text: string }>): ScraperParseResult {
  const questions: ScraperQuestion[] = [];
  const keys: ScraperKeyEntry[] = [];
  const modules: ScraperParseResult["modules"] = [];
  const moduleCounters = new Map<string, number>();

  // Bluebook app-export detection: "N Mark for Review" markers + "Question N
  // of 22/27" footers. Gates bare-letter choices ("A mock").
  let bluebookMode = false;
  {
    let markers = 0;
    for (const pg of pages) {
      for (const ln of pg.text.split("\n")) {
        const c = stripMarkdown(ln);
        if (REVIEW_MARKER_RE.test(c) || BB_FOOTER_RE.test(c)) markers++;
        if (markers >= 3) break;
      }
      if (markers >= 3) break;
    }
    bluebookMode = markers >= 3;
  }

  let currentSection: "reading_writing" | "math" = "reading_writing";
  let currentModule = moduleLabel("reading and writing", 1);
  let currentModuleNumber = 1;
  let inKeyBlock = false;
  let keyModule = "";
  let keyGlobal = false;
  let lastKeyNumber = 0;
  /** Per-column sequences for independent-column key tables. */
  let keyColLast: number[] = [];
  /** Heading-less key mode: never swallows, exits after a few misses. */
  let autoKeyBlock = false;
  let autoKeyMisses = 0;
  /**
   * Unconfirmed heading-less rows: key mode starts only after 3 consecutive
   * continuing rows, so pending rows cost nothing if the trigger was false.
   */
  let autoPendingRows: Array<{ pairs: KeyRowPair[]; page: number; src: string }> = [];
  let lastAutoRow: KeyRowPair[] | null = null;
  /** Column buffers (col 1..N) appended in order at the end. */
  const keyColumnBuffers: ScraperKeyEntry[][] = [];

  const scraperCommitRow = (pairs: KeyRowPair[], pg: number, src: string): boolean => {
    const mk = (p: KeyRowPair): ScraperKeyEntry => ({
      questionNumber: p.n,
      answer: p.answer,
      pageNumber: pg,
      sourceText: src,
      moduleName: keyModule,
      global: keyGlobal,
    });
    if (keyModule) {
      // Headed table: all pairs scoped to the key module.
      if (pairs[0]!.n !== lastKeyNumber + 1 && lastKeyNumber !== 0) return false;
      for (const p of pairs) keys.push(mk(p));
      lastKeyNumber = Math.max(...pairs.map((p) => p.n));
      return true;
    }
    if (
      pairs.length === 2 &&
      pairs[1]!.n === pairs[0]!.n + 1 &&
      (pairs[0]!.n === lastKeyNumber + 1 || lastKeyNumber === 0)
    ) {
      keys.push(mk(pairs[0]!), mk(pairs[1]!));
      lastKeyNumber = pairs[1]!.n;
      keyColLast = pairs.map((p) => p.n);
      return true;
    }
    // Row-wise sequential table ("321 C 322 A" as one run): push in order.
    // Multi-module rows ("1 D 1 A 1 B 1 B") are not sequential — safe.
    if (
      pairs.length > 2 &&
      pairs.every((p, j) => (j === 0 ? p.n === lastKeyNumber + 1 || lastKeyNumber === 0 : p.n === pairs[j - 1]!.n + 1))
    ) {
      for (const p of pairs) keys.push(mk(p));
      lastKeyNumber = pairs[pairs.length - 1]!.n;
      keyColLast = pairs.map((p) => p.n);
      return true;
    }
    while (keyColLast.length < pairs.length) keyColLast.push(0);
    if (!pairs.every((p, j) => p.n === keyColLast[j]! + 1 || keyColLast[j]! === 0)) return false;
    pairs.forEach((p, j) => {
      const e = mk(p);
      if (j === 0) keys.push(e);
      else {
        while (keyColumnBuffers.length < j) keyColumnBuffers.push([]);
        keyColumnBuffers[j - 1]!.push(e);
      }
      keyColLast[j] = p.n;
    });
    return true;
  };

  let blockPassage: string[] = [];
  let blockPrompt: string[] = [];
  let blockChoices: ScraperChoice[] = [];
  /** Raw choice lines carried a visual marker (choice text is pre-stripped). */
  let blockChoiceVisual = false;
  /** Count of visual marker spans on raw choice lines (choice text is pre-stripped). */
  let blockChoiceVisualCount = 0;
  let blockPage = 0;
  let pendingNewQuestion = false;
  let passageBuffer: string[] = [];
  /** Last non-blank processed line (for graph-axis detection before a bar). */
  let lastNonBlank = "";
  /** Next question number that a standalone bar must match to be treated as a boundary. */
  let expectedQuestionNumber = 1;
  /**
   * A prompt-only block held back at a bar boundary so its choices (which may
   * start on the following page under that bar) can be re-attached.
   */
  let carryoverPrompt: { lines: string[]; page: number } | null = null;

  /** Page number of the line currently being processed (for module ranges). */
  let currentPage = 0;
  const registerModule = () => {
    if (!modules.some((m) => m.name === currentModule)) {
      modules.push({ name: currentModule, section: currentSection, questionCount: 0, startPage: currentPage, endPage: currentPage });
    }
  };

  const clearBlock = () => {
    blockPassage = [];
    blockPrompt = [];
    blockChoices = [];
    blockChoiceVisual = false;
    blockChoiceVisualCount = 0;
    blockPage = 0;
  };

  const flushCore = () => {
    if (blockPassage.length > 0) {
      passageBuffer.push(...blockPassage);
      blockPassage = [];
    }
    if (blockPrompt.length === 0 && blockChoices.length === 0) return;

    const seq = (moduleCounters.get(currentModule) ?? 0) + 1;
    const isMc = blockChoices.length >= 2;
    if (blockPrompt.length === 0 && isMc && passageBuffer.length > 0) {
      // A stem misclassified as prose leaves a promptless choice block (the
      // stem is the last buffered line). Promote it instead of dropping.
      // Figure-marker lines are never stems — pop past them.
      let stem: string | undefined;
      while (passageBuffer.length > 0) {
        const cand = passageBuffer.pop()!;
        if (!isFigureMarkerLine(cand)) {
          stem = cand;
          break;
        }
      }
      if (stem !== undefined) blockPrompt = [stem];
    }
    if (isDirectionsBlock(blockPrompt, blockChoices)) {
      // Student-produced response directions ("If you find more than one
      // correct answer, enter only one answer …", example values, answer
      // boxes) are instructions, not a question — but they often share the
      // block with the real grid-in prompt, so strip the instruction lines
      // instead of dropping the block (either way no sequence number is
      // consumed for them).
      blockPrompt = blockPrompt.filter((l) => !isDirectionsLine(l));
    }
    if (currentSection === "reading_writing" && blockPrompt.length > 0) {
      // Fenced bold ("**Which choice …?**") is formatting, not content.
      blockPrompt = blockPrompt.map((l) => unwrapBoldLine(l));
      // The R&W prompt ends at the first "?" — trailing prose is the
      // stimulus/passage, not the question (handles instruction-first OCR
      // order: "Which choice completes the text …? A study by …").
      const split = splitRwPromptAtQuestionMark(blockPrompt);
      if (split) {
        blockPrompt = [split.prompt];
        passageBuffer.push(split.rest);
      }
    }
    // Visual-descriptor markers ("[figure: long description]") belong to
    // this question block: flag it visual, then remove the marker text
    // entirely (reviewers crop/attach the visual manually — no placeholder
    // is stored). Computed before stripping, while markers are still present.
    // Math equations ($…$, \frac, \sqrt, …) pass through untouched.
    const blockHasVisual =
      blockChoiceVisual || [...blockPrompt, ...blockPassage, ...passageBuffer, ...blockChoices.map((c) => c.text)].some(hasFigureMarker);
    // Marker spans per question, counted before stripping (choice-line spans
    // were counted when seen — choice text is already stripped by now).
    const visualMarkerCount =
      [...blockPrompt, ...blockPassage, ...passageBuffer].reduce((n, l) => n + (l.match(FIGURE_SPAN_RE)?.length ?? 0), 0) +
      blockChoiceVisualCount;
    const prompt = blockPrompt
      .filter((l) => !isFigureMarkerLine(l))
      .map((l) => stripFigureMarkers(l))
      .filter((l) => l.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!prompt) {
      clearBlock();
      return;
    }

    let confidence = 0.5;
    if (prompt.length > 15) confidence += 0.2;
    if (isMc) confidence += Math.min(0.3, blockChoices.length * 0.05);
    if (currentSection === "math" && !isMc) confidence += 0.15;
    confidence = Math.min(1, Math.round(confidence * 100) / 100);

    // Visual-descriptor markers never belong to passage text: drop those
    // lines (and any inline spans) before measuring/joining so "[figure: …]"
    // accounts can't leak into stored passages.
    const passageLines = passageBuffer
      .filter((l) => !isFigureMarkerLine(l))
      .map((l) => stripFigureMarkers(l))
      .filter((l) => l.length > 0);
    const passageWords = passageLines.join(" ").split(/\s+/).filter(Boolean).length;
    const passageText = currentSection === "reading_writing" && passageWords >= PROSE_MIN_WORDS ? passageLines.join("\n") : null;

    moduleCounters.set(currentModule, seq);
    registerModule();
    const m = modules.find((x) => x.name === currentModule);
    if (m) {
      m.questionCount = seq;
      m.endPage = Math.max(m.endPage, blockPage || currentPage);
    }
    questions.push({
      sourceQuestionNumber: seq,
      sourceModuleName: currentModule,
      sourceModulePosition: currentModuleNumber,
      pageNumber: blockPage,
      section: currentSection,
      questionType: isMc ? "multiple_choice" : "student_produced",
      prompt,
      passageText,
      choices: blockChoices.map((c) => ({ ...c })),
      confidence,
      hasVisualStimulus: blockHasVisual,
      visualMarkerCount,
    });
    passageBuffer = [];
    clearBlock();
  };

  /** Emit the carried-over prompt-only block as its own question (student-produced). */
  const flushCarryover = () => {
    if (!carryoverPrompt) return;
    blockPrompt = carryoverPrompt.lines;
    blockPage = carryoverPrompt.page;
    carryoverPrompt = null;
    flushCore();
  };

  const flushBlock = (opts: { withCarryover?: boolean } = {}) => {
    if (opts.withCarryover) flushCarryover();
    flushCore();
  };

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!;
    currentPage = page.pageNumber;
    const lines = page.text.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!.trim();
      if (!line) continue;
      if (HRULE_RE.test(stripMarkdown(line))) continue;
      // Answer-entry boxes ("[figure: A rectangular box … write the answer]")
      // are grid-in widgets, not question content; dropping them keeps them
      // from splitting blocks or polluting prompts. Same for Bluebook UI
      // screenshot figures (question badge, toolbar).
      if (!inKeyBlock && (isAnswerBoxFigure(line) || isUiScreenshotFigure(line))) continue;

      // ---- answer-key block ----
      // Heading-less key tables need 3 consecutive continuing rows before key
      // mode starts. Pending rows are skipped as question content (key-list)
      // without disturbing open blocks, so a false trigger costs nothing.
      if (!inKeyBlock && moduleCounters.size > 0) {
        const pendingPairs = parseKeyRow(stripMarkdown(line));
        if (pendingPairs && pendingPairs.length >= 2) {
          if (!lastAutoRow || !keyRowsContinue(lastAutoRow, pendingPairs)) {
            autoPendingRows = [{ pairs: pendingPairs, page: page.pageNumber, src: line }];
          } else {
            autoPendingRows.push({ pairs: pendingPairs, page: page.pageNumber, src: line });
          }
          lastAutoRow = pendingPairs;
          if (autoPendingRows.length >= 3) {
            flushBlock({ withCarryover: true });
            inKeyBlock = true;
            keyModule = "";
            keyGlobal = true;
            lastKeyNumber = 0;
            keyColLast = [];
            autoKeyBlock = true;
            autoKeyMisses = 0;
            for (const b of autoPendingRows) scraperCommitRow(b.pairs, b.page, b.src);
            autoPendingRows = [];
          }
        }
      }
      if (inKeyBlock) {
        const cleanKeyLine = stripMarkdown(line);
        if (!autoKeyBlock) {
          // Pipe-separated rows ("1 A | 2 C") split into segments; a bare
          // answer continues the sequence ("$4 \\frac{4}{31}$" after "3 B").
          // Pipes inside $…$ ("$1/4 \\mid 0.25$") are alternatives.
          const segList = splitKeySegments(cleanKeyLine);
          let segConsumed = false;
          for (let seg of segList) {
            seg = seg.trim();
            if (!seg) continue;
            const entry = seg.match(KEY_ENTRY_RE);
            if (entry) {
              const n = Number(entry[1]);
              if (n === lastKeyNumber + 1 || lastKeyNumber === 0 || (n === 1 && lastKeyNumber > 1)) {
                keys.push({ questionNumber: n, answer: normalizeKeyAnswer(entry[2]!), pageNumber: page.pageNumber, sourceText: seg, moduleName: keyModule, global: keyGlobal });
                lastKeyNumber = n;
                segConsumed = true;
              }
              continue;
            }
            if (lastKeyNumber > 0 && SCRAPER_BARE_ANSWER_RE.test(seg) && !SCRAPER_PLAIN_INT_RE.test(seg)) {
              keys.push({ questionNumber: lastKeyNumber + 1, answer: normalizeKeyAnswer(seg), pageNumber: page.pageNumber, sourceText: seg, moduleName: keyModule, global: keyGlobal });
              lastKeyNumber += 1;
              segConsumed = true;
            }
          }
          if (segConsumed) continue;
          // A single-shaped line (even non-sequential) stays swallowed.
          if (segList.some((s) => KEY_ENTRY_RE.test(s.trim()))) continue;
          const rowPairs = parseKeyRow(cleanKeyLine);
          if (rowPairs && scraperCommitRow(rowPairs, page.pageNumber, line)) continue;
          TOKEN_ENTRY_RE.lastIndex = 0;
          const tokenEntries = [...cleanKeyLine.matchAll(TOKEN_ENTRY_RE)];
          if (tokenEntries.length >= 2) {
            const nums = tokenEntries.map((t) => Number(t[1]));
            const sequential = nums.every((n, i) =>
              i === 0 ? n === lastKeyNumber + 1 || lastKeyNumber === 0 : n === nums[i - 1]! + 1,
            );
            if (sequential) {
              for (const t of tokenEntries) {
                keys.push({ questionNumber: Number(t[1]), answer: t[2]!.toUpperCase(), pageNumber: page.pageNumber, sourceText: line, moduleName: keyModule, global: keyGlobal });
              }
              lastKeyNumber = nums[nums.length - 1]!;
              continue;
            }
          }
        } else {
          // Auto mode: rows commit when continuing, token lists when
          // sequential; nothing is ever swallowed — other lines fall through
          // to normal question processing.
          const rowPairs = parseKeyRow(cleanKeyLine);
          if (rowPairs && rowPairs.length >= 2) {
            if (!lastAutoRow || !keyRowsContinue(lastAutoRow, rowPairs)) {
              autoPendingRows = [{ pairs: rowPairs, page: page.pageNumber, src: line }];
            } else if (autoPendingRows.length > 0) {
              autoPendingRows.push({ pairs: rowPairs, page: page.pageNumber, src: line });
              if (autoPendingRows.length >= 3) {
                for (const b of autoPendingRows) scraperCommitRow(b.pairs, b.page, b.src);
                autoPendingRows = [];
              }
            } else {
              scraperCommitRow(rowPairs, page.pageNumber, line);
            }
            lastAutoRow = rowPairs;
            autoKeyMisses = 0;
            continue;
          }
          TOKEN_ENTRY_RE.lastIndex = 0;
          const autoTokens = [...cleanKeyLine.matchAll(TOKEN_ENTRY_RE)];
          if (autoTokens.length >= 2) {
            const nums = autoTokens.map((t) => Number(t[1]));
            if (nums.every((n, i) => (i === 0 ? n === lastKeyNumber + 1 || lastKeyNumber === 0 : n === nums[i - 1]! + 1))) {
              for (const t of autoTokens) {
                keys.push({ questionNumber: Number(t[1]), answer: t[2]!.toUpperCase(), pageNumber: page.pageNumber, sourceText: line, moduleName: keyModule, global: keyGlobal });
              }
              lastKeyNumber = nums[nums.length - 1]!;
              autoKeyMisses = 0;
              continue;
            }
          }
        }
        const answersHeading =
          cleanKeyLine.match(MODULE_ANSWERS_RE) ??
          cleanKeyLine.match(MODULE_COLON_ANSWERS_RE) ??
          cleanKeyLine.match(SECTION_SHORT_ANSWERS_RE);
        if (answersHeading) {
          // Number-first variant swaps capture order (num, section).
          const isColon = /^\s*module\s+\d\s*:/i.test(cleanKeyLine);
          const isShort = /^\s*section\s+\d+\s*,/i.test(cleanKeyLine);
          keyModule = isColon
            ? moduleLabel(answersHeading[2]!, Number(answersHeading[1]))
            : isShort
              ? moduleLabel(answersHeading[3]!, Number(answersHeading[2]))
              : moduleLabel(answersHeading[1]!, Number(answersHeading[2]));
          lastKeyNumber = 0;
          keyColLast = [];
          autoKeyBlock = false;
          autoKeyMisses = 0;
          autoPendingRows = [];
          lastAutoRow = null;
          continue;
        }
        // A headed block runs until the next module section and swallows key
        // page noise. An auto block exits on a section heading or after a few
        // misses — and never swallows: the line falls through to question
        // parsing below.
        if (isSectionHeading(line)) {
          inKeyBlock = false;
          autoKeyBlock = false;
          autoKeyMisses = 0;
          autoPendingRows = [];
          lastAutoRow = null;
        } else if (autoKeyBlock) {
          autoKeyMisses++;
          if (autoKeyMisses >= 3) {
            inKeyBlock = false;
            autoKeyBlock = false;
            autoKeyMisses = 0;
            autoPendingRows = [];
            lastAutoRow = null;
          }
        } else {
          continue;
        }
      }

      const rawKind = classifyLine(line);
      let cls = rawKind;
      if (rawKind.kind === "chrome") continue;
      if (!inKeyBlock && isDirectionsBoundary(line)) {
        // A directions anchor mid-block ("Student-produced response
        // directions …", "Answer Preview:") closes the current question so
        // packed questions on either side split apart; the line itself is
        // skipped (stripped at flush if it ever lands in a block).
        flushBlock();
        continue;
      }
      if (
        rawKind.kind === "prose" &&
        BB_NAME_RE.test(stripMarkdown(line)) &&
        nextSpecial(pages, pi, li)?.kind === "bb-footer"
      ) {
        // Bluebook student-name line ("Haotian Yu") right before the
        // "Question N of 27" footer — UI chrome, not content.
        continue;
      }
      if (rawKind.kind === "prose" && bluebookMode) {
        // Bluebook bare-letter choices ("A mock") with A-D sequence rule.
        // A leading "A" is accepted only when B/C/D follow in order
        // (lookahead), so passage openers ("A student …") can't become a
        // choice; continuations just follow the run. No open-prompt
        // requirement: RW stems often sit in the passage buffer.
        const bc = stripBoldChoice(stripMarkdown(line)).match(BB_BARE_CHOICE_RE);
        if (bc && bc[2]!.trim().length >= 1 && bc[2]!.trim().length <= 300) {
          if (blockChoices.length === 0) {
            if (bc[1] === "A" && bbChoiceRunAhead(pages, pi, li)) {
              cls = { kind: "choice", label: "A" };
            }
          } else {
            const want = String.fromCharCode(blockChoices[blockChoices.length - 1]!.label.charCodeAt(0) + 1);
            if (bc[1] === want && bc[1]! <= "D") {
              cls = { kind: "choice", label: bc[1]! };
            }
          }
        }
      }
      if (rawKind.kind === "bar") {
        const barNum = Number(stripMarkdown(line));
        const prevNoise = currentSection === "math" && lastNonBlank !== "" && isMathNoise(lastNonBlank);
        if (prevNoise) {
          // Bar runs through a graph axis tick (e.g. "2" after "0"); not a boundary.
          continue;
        }
        const inWindow =
          barNum === expectedQuestionNumber || (barNum > expectedQuestionNumber && barNum <= expectedQuestionNumber + 2);
        if (!inWindow) {
          // Axis ticks and stray page numbers (60, 55, 0, ...) are single
          // numbers too; only an in-sequence bar is a real question boundary.
          // Exception: resync after dropped number lines — an out-of-window
          // bar followed by real question content (choices/stem before the
          // next bar) re-anchors the sequence instead of cascading.
          if (
            barNum > expectedQuestionNumber &&
            barNum <= 150 &&
            !inKeyBlock &&
            currentModule &&
            looksLikeQuestionAhead(pages, pi, li)
          ) {
            expectedQuestionNumber = barNum;
          } else {
            cls = { kind: "prose" };
          }
        }
      } else if (currentSection === "math" && rawKind.kind === "prose" && isMathNoise(line)) {
        // Skip graph axis value labels so they don't pollute math prompts.
        continue;
      }
      switch (cls.kind) {
        case "module-heading": {
          const cleanHeading = stripMarkdown(line);
          const mm = cleanHeading.match(MODULE_HEADING_RE);
          const cm = mm ? null : cleanHeading.match(MODULE_COLON_RE);
          const sm = mm || cm ? null : (cleanHeading.match(SECTION_PREFIX_RE) ?? cleanHeading.match(SECTION_SHORT_RE));
          const sectionName = mm ? mm[1]! : cm ? cm[2]! : sm![3]!;
          const modNum = mm ? (mm[2] ? Number(mm[2]) : currentModuleNumber) : cm ? Number(cm[1]) : Number(sm![2]);
          const label = moduleLabel(sectionName, modNum);
          // Per-page header repeating the current module: not a boundary.
          if (label === currentModule) break;
          // Index stubs ("Math Module 1 / 22 QUESTIONS / Math Module 2 ...")
          // are not followed by any question content; ignore them. A repeat
          // heading with real content after it (even if every line
          // classifies as skippable prose/chrome) is a genuine boundary.
          const next = nextSpecial(pages, pi, li);
          if (
            (next?.kind === "module-heading" || next?.kind === "key-heading") &&
            !headingHasContent(pages, pi, li)
          )
            break;
          flushBlock({ withCarryover: true });
          currentSection = sectionFor(sectionName);
          currentModuleNumber = modNum;
          currentModule = label;
          expectedQuestionNumber = 1;
          registerModule();
          passageBuffer = [];
          pendingNewQuestion = false;
          break;
        }

        case "key-heading": {
          flushBlock({ withCarryover: true });
          inKeyBlock = true;
          const cleanKey = stripMarkdown(line);
          const kh =
            cleanKey.match(MODULE_ANSWERS_RE) ??
            cleanKey.match(MODULE_COLON_ANSWERS_RE) ??
            cleanKey.match(SECTION_SHORT_ANSWERS_RE);
          // A bare "Answer Key" right after a module's questions is inferred
          // to belong to that module (kept flagged global so the matcher can
          // still treat end-of-test global keys positionally).
          keyModule = kh
            ? /^\s*module\s+\d\s*:/i.test(cleanKey)
              ? moduleLabel(kh[2]!, Number(kh[1]))
              : /^\s*section\s+\d+\s*,/i.test(cleanKey)
                ? moduleLabel(kh[3]!, Number(kh[2]))
                : moduleLabel(kh[1]!, Number(kh[2]))
            : currentModule;
          keyGlobal = !kh;
          lastKeyNumber = 0;
          break;
        }

        case "questions-count":
          break;

        case "bar":
          // cls.bar is only reached when the number is in sequence (or within
          // the slip-recovery window).
          expectedQuestionNumber = Number(stripMarkdown(line)) + 1;
          // A prompt-only block ready to flush may actually be waiting for its
          // choices that start under this bar on the following page; hold it back.
          if (blockPrompt.length > 0 && blockChoices.length === 0 && !carryoverPrompt) {
            carryoverPrompt = { lines: blockPrompt, page: blockPage };
            blockPrompt = [];
          }
          flushBlock();
          pendingNewQuestion = true;
          break;

        case "question-marker": {
          // "Question N" standalone line — start a new question block.
          // The question number is already captured; we use it to verify
          // sequence but let the module counter assign the actual number.
          const markerNum = Number(stripMarkdown(line).match(QUESTION_MARKER_RE)?.[1] ?? 0);
          if (markerNum >= expectedQuestionNumber && markerNum <= expectedQuestionNumber + 2) {
            expectedQuestionNumber = markerNum + 1;
          }
          flushBlock({ withCarryover: true });
          blockPage = page.pageNumber;
          pendingNewQuestion = true;
          break;
        }

        case "inline": {
          // Inline numbers advance the bar-sequence window so later
          // standalone bars ("18.") stay in-window.
          const inlineNum = Number(stripBoldChoice(stripMarkdown(line)).match(INLINE_QUESTION_RE)?.[1] ?? 0);
          if (inlineNum >= expectedQuestionNumber && inlineNum <= expectedQuestionNumber + 2) {
            expectedQuestionNumber = inlineNum + 1;
          }
          flushBlock({ withCarryover: true });
          blockPrompt = [line];
          blockPage = page.pageNumber;
          pendingNewQuestion = false;
          break;
        }

        case "review-marker": {
          // Bluebook "N Mark for Review" between passage and stem — start a
          // new question block, mirroring bar behavior.
          const n = Number(stripMarkdown(line).match(REVIEW_MARKER_RE)?.[1] ?? 0);
          if (n !== expectedQuestionNumber && (n < expectedQuestionNumber || n > expectedQuestionNumber + 2)) break;
          expectedQuestionNumber = n + 1;
          if (blockPrompt.length > 0 && blockChoices.length === 0 && !carryoverPrompt) {
            carryoverPrompt = { lines: blockPrompt, page: blockPage };
            blockPrompt = [];
          }
          flushBlock();
          pendingNewQuestion = true;
          break;
        }

        case "bb-footer": {
          // Bluebook "Question N of 27" — the question just ended; close it.
          if (inKeyBlock) {
            inKeyBlock = false;
            autoKeyBlock = false;
            autoKeyMisses = 0;
            autoPendingRows = [];
            lastAutoRow = null;
          }
          flushBlock({ withCarryover: true });
          break;
        }

        case "choice": {
          if (hasFigureMarker(line)) {
            blockChoiceVisual = true;
            blockChoiceVisualCount += line.match(FIGURE_SPAN_RE)?.length ?? 0;
          }
          const choice: ScraperChoice = { label: cls.label!, text: stripFigureMarkers(stripBoldChoice(line).replace(/^\s*\(?[A-H](?:[.)]|\))\s*|^\s*\(?[A-H]\s+/, "").trim()), position: blockChoices.length + 1 };
          if (carryoverPrompt && blockChoices.length === 0 && blockPrompt.length === 0 && blockPassage.length === 0) {
            // Choices arriving right after a bar belong to the held-back prompt.
            blockPrompt = carryoverPrompt.lines;
            blockPage = carryoverPrompt.page;
            carryoverPrompt = null;
            pendingNewQuestion = false;
          }
          if (blockChoices.length > 0) {
            const last = blockChoices[blockChoices.length - 1]!;
            if (!continues(last.label, choice.label)) {
              // A choice that does not continue the last run belongs to the
              // next question (e.g. choices whose stem was on a prior page).
              flushBlock({ withCarryover: true });
              choice.position = 1;
              blockPage = page.pageNumber;
            }
            blockChoices.push(choice);
          } else if (blockPrompt.length > 0 || blockPassage.length > 0) {
            if (blockPassage.length > 0) {
              // In math there are no real passages: a prose block preceding the
              // choices is the question prompt (handles missing question bars).
              if (currentSection === "math") {
                blockPrompt.push(...blockPassage);
              } else {
                passageBuffer.push(...blockPassage);
              }
              blockPassage = [];
            }
            blockChoices.push(choice);
            if (!blockPage) blockPage = page.pageNumber;
          } else {
            blockChoices.push(choice);
            blockPage = page.pageNumber;
            pendingNewQuestion = false;
          }
          break;
        }

        case "stem": {
          if (blockChoices.length > 0) {
            flushBlock({ withCarryover: true });
            blockPrompt = [line];
            blockPage = page.pageNumber;
          } else if (blockPrompt.length > 0) {
            blockPrompt.push(line);
          } else if (blockPassage.length > 0) {
            passageBuffer.push(...blockPassage);
            blockPassage = [];
            blockPrompt = [line];
            blockPage = page.pageNumber;
          } else {
            blockPrompt = [line];
            blockPage = page.pageNumber;
          }
          pendingNewQuestion = false;
          break;
        }

        case "key-list":
          // Answer-key entries crammed onto one line ("1. C 2. B 3. A ...").
          // The dedicated answer-key parser handles these; skip here.
          break;

        case "prose": {
          // Stray instruction lines outside any block (directions
          // continuations orphaned by a boundary flush): a real question
          // never starts with one of these.
          if (
            blockPrompt.length === 0 &&
            blockChoices.length === 0 &&
            blockPassage.length === 0 &&
            isStrayInstructionLine(line)
          ) {
            break;
          }
          // Math figure split: a figure/table marker arriving after a
          // complete choiceless prompt, with another prompt + choices ahead,
          // starts a new (visual) question — the previous grid-in prompt is
          // complete on its own (its number line was dropped by OCR).
          if (
            !inKeyBlock &&
            currentSection === "math" &&
            /^\[(figure|table)\b/i.test(line) &&
            blockChoices.length === 0 &&
            blockPrompt.length > 0 &&
            isCompletePrompt(blockPrompt) &&
            figureSplitAhead(pages, pi, li)
          ) {
            flushBlock();
            pendingNewQuestion = true;
            blockPage = page.pageNumber;
          }
          if (blockChoices.length > 0) {
            const next = nextSpecial(pages, pi, li);
            const last = blockChoices[blockChoices.length - 1]!;
            if (next?.kind === "choice" && next.label && continues(last.label, next.label)) {
              // continuation of the last choice's text across a line/page break
              // (visual markers stripped here too — continuations bypass the
              // choice-creation strip above)
              if (hasFigureMarker(line)) {
                blockChoiceVisual = true;
                blockChoiceVisualCount += line.match(FIGURE_SPAN_RE)?.length ?? 0;
              }
              const clean = stripFigureMarkers(line);
              last.text = clean ? (last.text ? `${last.text} ${clean}` : clean) : last.text;
            } else {
              flushBlock({ withCarryover: true });
              blockPassage = [line];
              blockPage = page.pageNumber;
              pendingNewQuestion = false;
            }
          } else if (blockPrompt.length > 0) {
            blockPrompt.push(line);
          } else if (blockPassage.length > 0) {
            blockPassage.push(line);
          } else if (pendingNewQuestion) {
            // A bare question-number bar in math is followed by the prompt
            // text (no "which"/stem keyword); keep it as the prompt.
            if (carryoverPrompt) {
              // A new prompt has begun; the held-back block is truly complete.
              flushCarryover();
            }
            if (currentSection === "math") {
              blockPrompt = [line];
            } else {
              blockPassage = [line];
            }
            blockPage = page.pageNumber;
            pendingNewQuestion = false;
          } else {
            passageBuffer.push(line);
          }
          break;
        }
      }
      // Extend the module's page range on every non-key line so
      // module-targeted OCR covers all of the module's pages. startPage
      // stays as recorded (heading/flush page) to avoid preamble creep.
      if (!inKeyBlock) {
        const m = modules.find((x) => x.name === currentModule);
        if (m && currentPage > m.endPage) m.endPage = currentPage;
      }
      lastNonBlank = line;
    }
  }
  flushBlock({ withCarryover: true });
  for (const buf of keyColumnBuffers) keys.push(...buf);

  const totalQuestions = questions.length;
  const keyConfidence = totalQuestions > 0 ? Math.min(1, Math.round((keys.length / totalQuestions) * 100) / 100) : 0;

  return { questions, keys, modules, keyConfidence };
}