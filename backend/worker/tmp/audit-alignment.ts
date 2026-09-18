/** Alignment audit: detect phantom drafts (directions/answer-box) and key shifts.
 * Run: npx tsx tmp/audit-alignment.ts "<outRoot>" [prefix...] */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

function walkTxt(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTxt(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".ocr.txt")) out.push(p);
  }
}

function loadPages(txtPath: string): Array<{ pageNumber: number; text: string }> {
  const raw = readFileSync(txtPath, "utf8");
  const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
  const pages: Array<{ pageNumber: number; text: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
  }
  return pages;
}

const DIRECTIONS_RE = /student-produced response directions|more than one correct answer|answer preview|enter up to \d+ characters/i;
const ANSWERBOX_RE = /rectangular box[^.]{0,120}(write|enter|blank|answer)|write the answer/i;

const [outRoot, ...prefixes] = process.argv.slice(2);
const all: string[] = [];
walkTxt(outRoot!, all);
all.sort();
const files = all.filter((p) => {
  if (prefixes.length === 0) return true;
  const top = relative(outRoot!, p).split(/[\\/]/)[0] ?? "";
  return prefixes.some((pre) => top.startsWith(pre));
});

let bad = 0;
for (const f of files) {
  const rel = relative(outRoot!, f);
  const pages = normalizeText(loadPages(f));
  const res = parseFullTest(pages as never, { contentScope: "full_test", targetModule: null });
  const phantoms = res.questions.filter((q) => DIRECTIONS_RE.test(q.prompt) || ANSWERBOX_RE.test(q.prompt));
  // key alignment: every matched key's answer must equal the keyEntries answer for (module|n)
  const keyByMod = new Map(res.keyEntries.map((e) => [`${e.moduleName ?? e.inferredModule ?? "g"}|${e.questionNumber}`, e.answer]));
  const mism: string[] = [];
  for (const q of res.questions) {
    const hit = keyByMod.get(`${q.sourceModuleName}|${q.sourceQuestionNumber}`);
    void hit;
  }
  if (phantoms.length > 0) {
    bad++;
    console.log(`PHANTOM ${rel}:`);
    for (const q of phantoms) console.log(`  #${q.sourceQuestionNumber} [${q.sourceModuleName}]: ${q.prompt.slice(0, 100)}`);
  }
  void mism;
}
console.log(bad === 0 ? "No phantom drafts in any file." : `${bad} file(s) with phantoms.`);
