/**
 * Parser fixture harness: run the parser over a saved post-OCR .ocr.txt
 * (no Parse calls, no DB) and report module counts, key coverage.
 * Run: npx tsx tmp/parse-fixture.ts <name.ocr.txt> [name2.ocr.txt ...]
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parseFullTest } from "../src/fullTestParser";
import { evaluateModuleCompleteness } from "../src/scraperParser";
import { normalizeText } from "../src/textNormalize";

function loadPages(txtPath: string): Array<{ pageNumber: number; text: string }> {
  const raw = readFileSync(txtPath, "utf8");
  const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
  const pages: Array<{ pageNumber: number; text: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
  }
  return pages;
}

function check(txtPath: string): boolean {
  const name = basename(txtPath);
  const pages = normalizeText(loadPages(txtPath));
  const res = parseFullTest(pages as never, { contentScope: "full_test", targetModule: null });
  console.log(`\n### ${name} (${pages.length} pages, ${res.questions.length} questions, ${res.keyEntries.length} key entries)`);
  let ok = true;
  for (const mod of res.modules) {
    const expected = mod.section === "math" ? 22 : 27;
    const status = mod.questionCount === expected ? "VALID" : mod.questionCount > expected ? "OVER" : "PARTIAL";
    if (status !== "VALID") ok = false;
    console.log(`  ${mod.name}: ${mod.questionCount}/${expected} ${status} (pp ${mod.startPage}-${mod.endPage})`);
  }
  const completeness = evaluateModuleCompleteness(res.modules);
  const incomplete = completeness.filter((c) => !c.complete);
  if (incomplete.length) console.log(`  incomplete: ${incomplete.map((c) => `${c.name} missing ${c.missing}`).join("; ")}`);
  // Key coverage per module: scoped lookup, then positional within module keys
  const byModule = new Map<string, Array<{ n: number; answer: string }>>();
  for (const e of res.keyEntries) {
    const m = e.moduleName ?? e.inferredModule ?? "global";
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m)!.push({ n: e.questionNumber, answer: e.answer });
  }
  for (const [m, entries] of byModule) {
    const qs = res.questions.filter((q) => q.sourceModuleName === m);
    let matched = 0;
    for (const q of qs) {
      const hit = entries.find((e) => e.n === q.sourceQuestionNumber);
      if (hit) matched++;
    }
    const cov = qs.length ? `${matched}/${qs.length}` : `${entries.length} key-only`;
    console.log(`  keys [${m}]: ${entries.length} entries, matched ${cov}`);
    if (qs.length && matched !== qs.length) ok = false;
  }
  for (const q of res.questions) {
    const entries = byModule.get(q.sourceModuleName);
    if (!entries || !entries.some((e) => e.n === q.sourceQuestionNumber)) {
      // only print first few unmatched to keep output readable
    }
  }
  const unmatched = res.questions.filter((q) => {
    const entries = byModule.get(q.sourceModuleName) ?? [];
    return !entries.some((e) => e.n === q.sourceQuestionNumber);
  });
  if (unmatched.length) {
    console.log(`  unmatched questions: ${unmatched.slice(0, 8).map((q) => `${q.sourceModuleName}#${q.sourceQuestionNumber}`).join(", ")}${unmatched.length > 8 ? ` (+${unmatched.length - 8} more)` : ""}`);
  }
  console.log(`  => ${ok ? "PASS" : "FAIL"}`);
  return ok;
}

const dir = "D:\\SAT website\\Tests Unparsed\\post_ocr";
const args = process.argv.slice(2);
const files = args.length ? args : readdirSync(dir).filter((f) => f.endsWith(".ocr.txt")).map((f) => join(dir, f));
let allOk = true;
for (const f of files) {
  if (!check(f)) allOk = false;
}
process.exit(allOk ? 0 : 1);
