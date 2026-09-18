/** Trace answerKey on tail slices. */
import { readFileSync } from "node:fs";
import { parseAnswerKey } from "../src/answerKey";

const [txtPath, fromStr] = process.argv.slice(2);
const raw = readFileSync(txtPath!, "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const from = Number(fromStr ?? 1);
const slice = pages.filter((p) => p.pageNumber >= from);
const res = parseAnswerKey(slice as never, 98);
console.log("entries:", res.entries.length);
const byMod = new Map<string, number[]>();
for (const e of res.entries) {
  const m = e.moduleName ?? e.inferredModule ?? "global";
  if (!byMod.has(m)) byMod.set(m, []);
  byMod.get(m)!.push(e.questionNumber);
}
for (const [m, ns] of byMod) console.log(` ${m}: ${ns.length} [${ns.slice(0, 30).join(",")}]`);
