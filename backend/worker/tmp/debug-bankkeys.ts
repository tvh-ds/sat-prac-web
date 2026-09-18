/** Show matched bank keys with prompts. Run: npx tsx tmp/debug-bankkeys.ts <file.ocr.txt> */
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
let shown = 0;
for (const q of res.questions) {
  const hit = res.keyMap.get(`${q.sourceModuleName}|${q.sourceQuestionNumber}`);
  if (hit && shown < 10) {
    console.log(`Q${q.sourceQuestionNumber} => ${hit.answer} :: ${q.prompt.slice(0, 70)}`);
    shown++;
  }
}
