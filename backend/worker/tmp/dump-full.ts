/** Dump full question detail (choices included). Run: npx tsx tmp/dump-full.ts <file.ocr.txt> <modSubstring> <fromNum> <toNum> */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

const [txtPath, modFilter, fromStr, toStr] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const res = parseFullTest(normalizeText(pages) as never, { contentScope: "full_test", targetModule: null });
const from = Number(fromStr ?? 1);
const to = Number(toStr ?? 999);
for (const q of res.questions) {
  if (modFilter && !q.sourceModuleName.toLowerCase().includes(modFilter.toLowerCase())) continue;
  if (q.sourceQuestionNumber < from || q.sourceQuestionNumber > to) continue;
  console.log(`### #${q.sourceQuestionNumber} ${q.sourceModuleName} p${q.pageNumber} [${q.questionType}/${q.choices.length}ch]`);
  console.log(`PROMPT: ${q.prompt.slice(0, 200)}`);
  for (const c of q.choices) console.log(`  ${c.label}. ${c.text.slice(0, 90)}`);
}
