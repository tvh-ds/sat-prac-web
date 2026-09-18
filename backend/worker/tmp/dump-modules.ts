/** Dump module records (name/count/pages) for a fixture. Run: npx tsx tmp/dump-modules.ts <file.ocr.txt> */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
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
console.log(`### ${basename(txtPath!)}: ${res.modules.length} module records, ${res.questions.length} questions`);
for (const m of res.modules) {
  const n = res.questions.filter((q) => q.sourceModuleName === m.name).length;
  console.log(`  [${m.name}] count=${m.questionCount} attributed=${n} pp ${m.startPage}-${m.endPage}`);
}
