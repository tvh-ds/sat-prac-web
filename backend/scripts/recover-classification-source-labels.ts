import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { extractText } from "../worker/src/extractor";
import { parseQuestionBank } from "../worker/src/questionBankParser";

const file = process.argv[2] ?? "Tests Unparsed/Full RW Question Bank With Key.pdf";
const output = process.argv[3] ?? "ml-service/datasets/raw/rw-source-labels.json";
if (existsSync(output)) throw new Error("Source audits are immutable; choose a new output");
const bytes = readFileSync(file);
const questions = parseQuestionBank(await extractText(new Uint8Array(bytes)));
mkdirSync("ml-service/datasets/raw", { recursive: true });
const normalized = (s: string) => s.replace(/\s+/g, " ").trim();
const fingerprint = (prompt: string, choices: string[]) => createHash("sha256").update(JSON.stringify([normalized(prompt), choices.map(normalized)])).digest("hex");
writeFileSync(output, JSON.stringify({ pdf_sha256: createHash("sha256").update(bytes).digest("hex"),
  source_file: file, parser_version: "rw-question-bank-source-audit-v1", errors: questions.errors.length,
  labels: questions.questions.map(q => ({ source_question_id: q.sourceQuestionId, domain: q.domain, skill: q.skill,
    difficulty: q.difficulty, content_fingerprint: fingerprint(q.prompt, q.choices.map(c => c.text)), page: q.pageNumber })) }, null, 2));
console.log(JSON.stringify({ source_questions: questions.questions.length, parser_errors: questions.errors.length, output }));
