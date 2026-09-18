import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

const root = "D:/SAT website/Tests Unparsed/post_ocr";
const all: string[] = [];
walkTxt(root, all);
let q = 0;
let v = 0;
let mark = 0;
for (const f of all) {
  const norm = normalizeText(loadPages(f));
  const res = parseFullTest(norm as never, { contentScope: "full_test", targetModule: null });
  for (const x of res.questions) {
    q++;
    if (x.hasVisualStimulus) v++;
    const t = x.prompt + " " + (x.passageText ?? "") + " " + x.choices.map((c) => c.text).join(" ");
    if (/\[figure|\[table/i.test(t)) {
      mark++;
      const m = t.match(/.{50}\[(figure|table).{100}/i);
      console.log(f.split(/[\\/]/).slice(-2).join("/") + " Q" + x.sourceQuestionNumber + ": " + JSON.stringify(m?.[0]));
    }
  }
}
console.log(`questions: ${q}, visual: ${v}, with-marker-text: ${mark}`);
