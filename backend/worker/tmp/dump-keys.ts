/** Dump key entries per module. Run: npx tsx tmp/dump-keys.ts <file.ocr.txt> [moduleSubstring] */
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
for (const e of res.keyEntries) {
  const m = e.moduleName ?? e.inferredModule ?? "global";
  if (modFilter && !m.toLowerCase().includes(modFilter.toLowerCase())) continue;
  console.log(`${m} #${e.questionNumber}=${e.answer} p${e.pageNumber} col=${e.column ?? "-"} :: ${e.sourceText.slice(0, 60)}`);
}
