/** Debug key entries. Run: npx tsx tmp/debug-keys.ts <file.ocr.txt> */
import { readFileSync } from "node:fs";
import { parseAnswerKey } from "../src/answerKey";
import { normalizeText } from "../src/textNormalize";

const [txtPath] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const res = parseAnswerKey(normalizeText(pages) as never, 100);
console.log("entries:", res.entries.length, "confidence:", res.confidence);
for (const e of res.entries.slice(0, 8)) {
  console.log(`${e.moduleName ?? e.inferredModule ?? "global"} #${e.questionNumber}=${e.answer} :: ${JSON.stringify(e.sourceText.slice(0, 40))}`);
}
