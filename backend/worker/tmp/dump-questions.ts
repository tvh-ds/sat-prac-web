/** Dump parsed questions per module for gap diagnosis. Run: npx tsx tmp/dump-questions.ts <file.ocr.txt> [moduleSubstring] */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

const [txtPath, modFilter] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const res = parseFullTest(normalizeText(pages) as never, { contentScope: "full_test", targetModule: null });
for (const q of res.questions) {
  if (modFilter && !q.sourceModuleName.toLowerCase().includes(modFilter.toLowerCase())) continue;
  console.log(`#${q.sourceQuestionNumber} ${q.sourceModuleName} p${q.pageNumber} [${q.questionType}/${q.choices.length}ch] ${q.prompt.slice(0, 100).replace(/\s+/g, " ")}`);
}
