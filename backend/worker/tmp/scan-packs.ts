/** Scan parsed prompts for missed-bar remnants (packs). Run: npx tsx tmp/scan-packs.ts "<outRoot>" [prefix...] */
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

const [outRoot, ...prefixes] = process.argv.slice(2);
const all: string[] = [];
walkTxt(outRoot!, all);
all.sort();
const files = all.filter((p) => {
  if (prefixes.length === 0) return true;
  const top = relative(outRoot!, p).split(/[\\/]/)[0] ?? "";
  return prefixes.some((pre) => top.startsWith(pre));
});

for (const f of files) {
  const rel = relative(outRoot!, f);
  const pages = normalizeText(loadPages(f));
  const res = parseFullTest(pages as never, { contentScope: "full_test", targetModule: null });
  for (const q of res.questions) {
    // bold-bar remnant ("**11**") or bare "NN. ..." mid-prompt (after 1st 30 chars)
    const body = q.prompt.slice(30);
    const boldBar = body.match(/\*\*(\d{1,2})\*\*/);
    const bareBar = body.match(/(?:^|\s)(\d{1,2})\.\s+[A-Z$]/);
    // double choice run: two "A. ... B. ..." runs
    const choiceRuns = (q.prompt.match(/\bA[.)]\s+\S[^]*?\bB[.)]\s+\S/g) ?? []).length;
    if (boldBar || bareBar || choiceRuns >= 2) {
      console.log(`${rel} #${q.sourceQuestionNumber} [${q.sourceModuleName}]: bold=${boldBar?.[1] ?? "-"} bare=${bareBar?.[1] ?? "-"} runs=${choiceRuns} :: ${q.prompt.slice(0, 80)}`);
    }
  }
}
console.log("scan done");
