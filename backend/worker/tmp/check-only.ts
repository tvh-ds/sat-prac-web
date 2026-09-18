import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const cmd = readFileSync("tmp/run-import-tier1.cmd", "utf8");
const m = cmd.match(/--only "([^"]+)"/);
const subs = m![1]!.split(",");
console.log("names:", subs.length);
const all: string[] = [];
const walk = (d: string): void => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".ocr.txt")) all.push(p);
  }
};
walk("D:/SAT website/Tests Unparsed/post_ocr");
const matched = all.filter((p) => subs.some((s) => p.includes(s)));
console.log("ocr files:", all.length, "matched:", matched.length);
const mm = matched.map((p) => basename(p, ".ocr.txt"));
for (const s of subs) {
  if (!mm.some((b) => b.includes(s) || s.includes(b))) console.log("UNMATCHED NAME:", s);
}
