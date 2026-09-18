/** Print full prompt of one question. Run: npx tsx tmp/debug-prompt.ts <file.ocr.txt> <moduleSub> <num> */
import { readFileSync } from "node:fs";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

const [txtPath, modFilter, numStr] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const res = parseFullTest(normalizeText(pages) as never, { contentScope: "full_test", targetModule: null });
const q = res.questions.find(
  (x) => x.sourceModuleName.toLowerCase().includes(modFilter!.toLowerCase()) && x.sourceQuestionNumber === Number(numStr),
);
console.log(q ? `PROMPT(${q.prompt.length} chars):\n${q.prompt}\nCHOICES: ${q.choices.map((c) => c.label).join(",")}` : "not found");
