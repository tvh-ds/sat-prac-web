export interface BankChoice {
  label: string;
  text: string;
  position: number;
}

export interface BankQuestion {
  sourceQuestionId: string;
  sourceQuestionNumber: number;
  pageNumber: number;
  section: "reading_writing";
  questionType: "multiple_choice";
  prompt: string;
  passageText: string | null;
  choices: BankChoice[];
  correctAnswer: string;
  explanation: string | null;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  hasVisualStimulus: boolean;
  /** Number of "[figure: …]"/"[table: …]" spans (drives OCR box attribution). */
  visualMarkerCount: number;
  confidence: number;
}

export interface BankParseResult {
  questions: BankQuestion[];
  errors: Array<{ sourceQuestionId: string | null; pageNumber: number; reason: string }>;
}

interface NumberedLine {
  pageNumber: number;
  text: string;
}

const DOMAIN_PREFIXES = [
  "Information and Ideas",
  "Craft and Structure",
  "Expression of Ideas",
  "Standard English Conventions",
];

const DIFFICULTY_VALUE: Record<string, number> = {
  Easy: 1,
  Medium: 3,
  Hard: 5,
};

const CHOICE_RE = /^([A-D])\.\s*(.*)$/;
const SOURCE_ID_RE = /^Question ID:\s*(\S+)/;
const CORRECT_RE = /^Correct Answer:\s*([A-D])\b/i;
const STEM_RE = /(Which choice|Which quotation|Based on the text|Based on the texts|According to the text|As used in the text|The student wants to|Which finding|Which statement|Which choice completes|Which choice most|What does the text|What is the main|The graph|The table|Which sentence|Which transition|Which choice best|It can most|It is reasonable|It is likely|The text suggests|The passage suggests)\b/i;
const VISUAL_PROMPT_RE = /\b(data|graph|table|figure|chart)\b/i;
const NUMERIC_AXIS_RE = /^(?:\d{1,3}(?:,\d{3})?|\d+(?:\.\d+)?|\d+%)$/;

/** True when this looks like the College Board R&W question-bank export. */
export function looksLikeQuestionBank(pages: Array<{ text: string }>): boolean {
  let ids = 0;
  let keys = 0;
  let headers = 0;
  for (const page of pages.slice(0, 80)) {
    ids += (page.text.match(/^Question ID:/gm) ?? []).length;
    keys += (page.text.match(/^Correct Answer:/gm) ?? []).length;
    headers += (page.text.match(/^Assessment Test Domain Skill Difficulty$/gm) ?? []).length;
    if (ids >= 3 && keys >= 3 && headers >= 3) return true;
  }
  return false;
}

export function parseQuestionBank(pages: Array<{ pageNumber: number; text: string }>): BankParseResult {
  const lines = pages.flatMap((page) =>
    page.text
      .split("\n")
      .map((text) => ({ pageNumber: page.pageNumber, text: text.trim() }))
      .filter((line) => line.text.length > 0),
  );

  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SOURCE_ID_RE.test(lines[i]!.text)) starts.push(i);
  }

  const questions: BankQuestion[] = [];
  const errors: BankParseResult["errors"] = [];
  for (let i = 0; i < starts.length; i++) {
    const block = lines.slice(starts[i], starts[i + 1] ?? lines.length);
    const parsed = parseBlock(block, i + 1);
    if ("reason" in parsed) errors.push(parsed);
    else questions.push(parsed);
  }

  return { questions, errors };
}

function parseBlock(block: NumberedLine[], sourceQuestionNumber: number): BankQuestion | BankParseResult["errors"][number] {
  const sourceQuestionId = block[0]?.text.match(SOURCE_ID_RE)?.[1] ?? null;
  const pageNumber = block[0]?.pageNumber ?? 0;
  const fail = (reason: string) => ({ sourceQuestionId, pageNumber, reason });

  const headerIdx = block.findIndex((line) => line.text === "Assessment Test Domain Skill Difficulty");
  const questionIdx = block.findIndex((line, i) => i > headerIdx && line.text === "Question");
  const answerIdx = block.findIndex((line, i) => i > questionIdx && line.text === "Answer");
  const keyIdx = block.findIndex((line, i) => i > answerIdx && CORRECT_RE.test(line.text));
  if (!sourceQuestionId) return fail("missing source question id");
  if (headerIdx < 0 || questionIdx < 0 || answerIdx < 0 || keyIdx < 0) return fail("missing required bank markers");

  const metadata = parseMetadata(block.slice(headerIdx + 1, questionIdx).map((line) => line.text));
  const questionLines = block.slice(questionIdx + 1, answerIdx).map((line) => line.text);
  let preVisual = false;
  let preNumeric = 0;
  for (let i = questionLines.length - 1; i >= 0; i--) {
    if (STEM_RE.test(questionLines[i]!)) {
      const preStemLines = questionLines.slice(0, i);
      preNumeric = preStemLines.filter((line) => NUMERIC_AXIS_RE.test(line)).length;
      const promptSlice = questionLines.slice(i).join(" ");
      preVisual = preNumeric >= 6 || VISUAL_PROMPT_RE.test(promptSlice);
      break;
    }
  }
  const { passageText, prompt } = splitPassageAndPrompt(questionLines, preVisual);
  const choiceLines = block.slice(answerIdx + 1, keyIdx).map((line) => line.text);
  const choices = parseChoices(choiceLines);
  const correctAnswer = block[keyIdx]!.text.match(CORRECT_RE)![1]!.toUpperCase();
  const explanation = parseExplanation(block.slice(keyIdx + 1).map((line) => line.text));
  const hasVisualStimulus =
    detectVisualStimulus(questionLines, prompt) || choiceLines.some((l) => /\[(figure|table)\b/i.test(l));
  const visualMarkerCount = [...questionLines, ...choiceLines].reduce(
    (n, l) => n + (l.match(/\[(figure|table)(:[^\]]*)?\]/gi)?.length ?? 0),
    0,
  );

  if (!prompt || prompt.length < 8) return fail("missing prompt");
  if (choices.length !== 4) return fail(`expected 4 choices, found ${choices.length}`);

  const confidence = metadata.domain && metadata.skill && metadata.difficulty && correctAnswer ? 0.98 : 0.9;
  return {
    sourceQuestionId,
    sourceQuestionNumber,
    pageNumber,
    section: "reading_writing",
    questionType: "multiple_choice",
    prompt,
    passageText,
    choices,
    correctAnswer,
    explanation,
    domain: metadata.domain,
    skill: metadata.skill,
    difficulty: metadata.difficulty,
    hasVisualStimulus,
    visualMarkerCount,
    confidence,
  };
}

function parseMetadata(lines: string[]): { domain: string | null; skill: string | null; difficulty: number | null } {
  const raw = lines.join(" ").replace(/\s+/g, " ").trim().replace(/^SAT\s+Reading\s+and\s+Writing\s+/i, "");
  const words = raw.split(/\s+/);
  const difficultyLabel = words[words.length - 1] ?? "";
  const difficulty = DIFFICULTY_VALUE[difficultyLabel] ?? null;
  const body = difficulty ? words.slice(0, -1).join(" ").trim() : raw;
  const domain = DOMAIN_PREFIXES.find((prefix) => body.toLowerCase().startsWith(prefix.toLowerCase())) ?? null;
  const skill = domain ? body.slice(domain.length).trim() || null : body || null;
  return { domain, skill, difficulty };
}

function splitPassageAndPrompt(lines: string[], isVisual = false): { passageText: string | null; prompt: string } {
  let promptStart = -1;
  let stemMatchIndex = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i]!.match(STEM_RE);
    if (match) {
      promptStart = i;
      stemMatchIndex = match.index ?? 0;
      break;
    }
  }
  if (promptStart < 0) {
    promptStart = Math.max(0, lines.length - 1);
    stemMatchIndex = 0;
  }
  const passageLines = lines.slice(0, promptStart).filter((l) => !/^\s*\[(figure|table)\b/i.test(l));
  const rail = lines[promptStart]!.slice(0, stemMatchIndex).trim();
  let passageParts: string[];
  if (isVisual) {
    passageParts = cleanVisualPassage(passageLines);
    if (passageParts.length > 0 && rail.length > 0 && (rail.length > 1 && /[a-z]/.test(rail))) passageParts.push(rail);
  } else {
    passageParts = rail ? [...passageLines, rail] : passageLines;
  }
  const passage = passageParts.filter((l) => l.trim().length > 0).join(" ").replace(/\s+/g, " ").trim();
  const promptLines = [lines[promptStart]!.slice(stemMatchIndex), ...lines.slice(promptStart + 1)];
  const prompt = promptLines
    .filter((l) => l.trim().length > 0)
    // Visual markers are dropped entirely (reviewers crop/attach manually).
    .map((l) => l.replace(/\[(figure|table)(:[^\]]*)?\]/gi, "").replace(/[ \t]{2,}/g, " ").trim())
    .filter((l) => l.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { passageText: passage || null, prompt };
}

function parseChoices(lines: string[]): BankChoice[] {
  const choices: BankChoice[] = [];
  let current: BankChoice | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(CHOICE_RE);
    if (match) {
      current = { label: match[1]!, text: match[2]!.replace(/\[(figure|table)(:[^\]]*)?\]/gi, "").replace(/[ \t]{2,}/g, " ").trim(), position: choices.length + 1 };
      choices.push(current);
      continue;
    }

    if (!current) continue;
    const isLastLine = i === lines.length - 1;
    if (current.label === "C" && choices.length === 3 && isLastLine && current.text.endsWith(".")) {
      current = { label: "D", text: line.replace(/\[(figure|table)(:[^\]]*)?\]/gi, "").replace(/[ \t]{2,}/g, " ").trim(), position: 4 };
      choices.push(current);
    } else {
      const clean = line.replace(/\[(figure|table)(:[^\]]*)?\]/gi, "").replace(/[ \t]{2,}/g, " ").trim();
      if (clean) current.text = `${current.text} ${clean}`.replace(/\s+/g, " ").trim();
    }
  }

  return choices;
}

function parseExplanation(lines: string[]): string | null {
  const start = lines.findIndex((line) => line === "Rationale");
  const body = (start >= 0 ? lines.slice(start + 1) : lines).join(" ").replace(/\s+/g, " ").trim();
  return body || null;
}

const TERMINAL_PUNCT_RE = /[.!?][)\]\u201d'"*]?$/;
const BLANK_RE = /_{3,}/;
const NUMBER_TOKEN_RE = /[\d]{2,}(?:[.,]\d+)?/g;
const PROSE_MARKER_RE = /\b(the|that|which|they|their|its|them|and|but|or|of|to|in|for|with|from|as|by|at|on|can|could|would|should|may|might|will|was|were|are|is|has|have|had|this|these|those|than|more|most|when|while|because|although|however|furthermore|additionally|if)\b/i;

function isNarrativeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (NUMERIC_AXIS_RE.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if (TERMINAL_PUNCT_RE.test(t)) return true;
  if (BLANK_RE.test(t)) return true;
  const words = t.split(/\s+/);
  const numericTokens = (t.match(NUMBER_TOKEN_RE) ?? []).length;
  if (numericTokens / words.length > 0.3) return false;
  if (words.length < 6) return false;
  return PROSE_MARKER_RE.test(t);
}

function cleanVisualPassage(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]!.trim()) continue;
    if (isNarrativeLine(lines[i]!)) out.unshift(lines[i]!.trim());
    else break;
  }
  if (out.length === 0) return out;
  if (!out.some((l) => TERMINAL_PUNCT_RE.test(l) || BLANK_RE.test(l))) return [];
  return out;
}

function detectVisualStimulus(questionLines: string[], prompt: string): boolean {
  if (VISUAL_PROMPT_RE.test(prompt)) return true;
  // A "[figure: …]"/"[table: …]" marker in the block means this question
  // owns the visual (per-block, not per-page).
  if (questionLines.some((l) => /\[(figure|table)\b/i.test(l))) return true;
  const beforePrompt = questionLines.slice(0, Math.max(0, questionLines.findIndex((line) => STEM_RE.test(line))));
  const numericLines = beforePrompt.filter((line) => NUMERIC_AXIS_RE.test(line)).length;
  const labelishLines = beforePrompt.filter((line) => /\b(percentage|number|rate|mean|median|year|species|condition|temperature|region)\b/i.test(line)).length;
  return numericLines >= 6 && labelishLines >= 2;
}
