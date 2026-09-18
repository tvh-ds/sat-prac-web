/** Check prompt-leading printed numbers vs seq. Run: npx tsx tmp/check-bank-align.ts <file.ocr.txt> */
import { readFileSync } from "node:fs";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

const [txtPath] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const res = parseFullTest(normalizeText(pages) as never, { contentScope: "full_test", targetModule: null });
let ok = 0;
let bad: string[] = [];
for (const q of res.questions) {
  const m = q.prompt.match(/^\*{0,2}(\d{1,4})\*{0,2}[.)]?\s+[A-Z$\\(]/);
  if (m && Number(m[1]) === q.sourceQuestionNumber) ok++;
  else bad.push(`seq${q.sourceQuestionNumber}->${m ? m[1] : "none"} :: ${q.prompt.slice(0, 60)}`);
}
console.log(`aligned: ${ok}/${res.questions.length}`);
for (const b of bad.slice(0, 15)) console.log("  " + b);
