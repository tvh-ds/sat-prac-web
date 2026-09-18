/** Debug: parse a page slice. Run: npx tsx tmp/debug-slice.ts <file.ocr.txt> <fromPage> <toPage> */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseScraperQuestions } from "../src/scraperParser";
import { normalizeText } from "../src/textNormalize";

const [txtPath, fromStr, toStr] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const from = Number(fromStr ?? 1);
const to = Number(toStr ?? 999);
const slice = pages.filter((p) => p.pageNumber >= from && p.pageNumber <= to);
const res = parseScraperQuestions(normalizeText(slice) as never);
for (const q of res.questions) {
  console.log(`#${q.sourceQuestionNumber} [${q.sourceModuleName}] p${q.pageNumber}: ${q.prompt.slice(0, 90)}`);
}
