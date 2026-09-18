export interface ParsedChoice {
  label: string;
  text: string;
  position: number;
}

export interface ParsedQuestion {
  sourceQuestionNumber: number;
  pageNumber: number;
  section: "reading_writing" | "math";
  questionType: "multiple_choice" | "student_produced";
  prompt: string;
  passageText: string | null;
  choices: ParsedChoice[];
  confidence: number;
}

const SECTION_RE = /^\s*(reading and writing|math)(?:\s*test|\s*section|\s*module|\s*-\s*\d*)?\s*$/i;
const QUESTION_START_RE = /^\s*(\d{1,3})\s*[.)]\s+/;
const CHOICE_RE = /^\s*([A-H])\s*[.)]\s+/;
const ANSWER_KEY_RE = /^\s*(answer key|answers|correct answers|scoring key|answer explanations|answer guide|explanations)\s*:?\s*$/i;
const PROSE_MIN_WORDS = 25;

interface RawQuestion {
  number: number;
  section: "reading_writing" | "math";
  lines: string[];
  pageNumber: number;
}

/** Parse SAT-style text into structured draft questions. */
export function parseQuestions(pages: Array<{ pageNumber: number; text: string }>): ParsedQuestion[] {
  let section: "reading_writing" | "math" = "reading_writing";
  const passageBuffer: string[] = [];
  const raw: RawQuestion[] = [];
  let current: RawQuestion | null = null;
  let inAnswerKey = false;
  let lastNumber = 0;

  for (const page of pages) {
    const lines = page.text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (inAnswerKey) {
        // Answer-key lines must never be parsed as questions; only a new
        // section heading exits the key block.
        continue;
      }

      if (ANSWER_KEY_RE.test(trimmed)) {
        if (current) raw.push(current);
        inAnswerKey = true;
        current = null;
        continue;
      }

      const secMatch = trimmed.match(SECTION_RE);
      if (secMatch) {
        if (current) raw.push(current);
        section = secMatch[1]!.toLowerCase().startsWith("math") ? "math" : "reading_writing";
        current = null;
        lastNumber = 0; // numbering restarts per section
        continue;
      }

      const qMatch = trimmed.match(QUESTION_START_RE);
      if (qMatch) {
        const number = Number(qMatch[1]);
        // require substantive content after the number to avoid matching
        // short answer-key-style lines ("3. B") as questions
        const rest = trimmed.slice(qMatch[0].length);
        if (number > 0 && number <= 150 && rest.length >= 4 && (number === lastNumber + 1 || lastNumber === 0)) {
          if (current) raw.push(current);
          current = { number, section, lines: [trimmed], pageNumber: page.pageNumber };
          lastNumber = number;
          continue;
        }
      }

      if (current) {
        current.lines.push(trimmed);
      } else if (!secMatch && passageBuffer.join(" ").split(/\s+/).filter(Boolean).length < 600) {
        passageBuffer.push(trimmed);
      }
    }
  }
  if (current) raw.push(current);

  const questions: ParsedQuestion[] = [];
  for (const rq of raw) {
    const parsed = parseRawQuestion(rq);
    questions.push(parsed);
  }

  // attach passage text (shared for the whole section) to passage-based questions
  const passageText = passageBuffer.join("\n");
  const meaningfulPassage = passageText.split(/\s+/).filter(Boolean).length >= PROSE_MIN_WORDS;
  for (const q of questions) {
    if (meaningfulPassage && q.section === "reading_writing") {
      q.passageText = passageText;
    }
  }
  return questions;
}

function parseRawQuestion(rq: RawQuestion): ParsedQuestion {
  const choices: ParsedChoice[] = [];
  const promptLines: string[] = [];
  let position = 0;

  for (const line of rq.lines) {
    const choiceMatch = line.match(CHOICE_RE);
    if (choiceMatch) {
      position += 1;
      choices.push({ label: choiceMatch[1]!, text: line.slice(choiceMatch[0].length).trim(), position });
    } else {
      promptLines.push(line);
    }
  }

  const prompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
  const isMc = choices.length >= 2;
  const questionType: "multiple_choice" | "student_produced" = isMc ? "multiple_choice" : "student_produced";

  let confidence = 0.5;
  if (prompt.length > 15) confidence += 0.2;
  if (isMc) confidence += Math.min(0.3, choices.length * 0.05);
  if (rq.section === "math" && !isMc) confidence += 0.15;
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  return {
    sourceQuestionNumber: rq.number,
    pageNumber: rq.pageNumber,
    section: rq.section,
    questionType,
    prompt,
    passageText: null,
    choices,
    confidence,
  };
}