import { readFileSync } from "node:fs";
import { normalizeText } from "../src/textNormalize";
import { parseFullTest } from "../src/fullTestParser";
import { evaluateModuleCompleteness } from "../src/scraperParser";

const raw = JSON.parse(readFileSync(new URL("./ocr-math-202408usv2.json", import.meta.url), "utf8")) as Record<string, string>;
const pages = Object.entries(raw).map(([pn, text]) => ({ pageNumber: Number(pn), text }));
const normalized = normalizeText(pages);
const result = parseFullTest(normalized, { contentScope: "full_test", targetModule: null });
console.log("questions:", result.questions.length);
for (const m of result.modules) {
  console.log(`module: ${m.name} count=${m.questionCount} pages=${m.startPage}-${m.endPage}`);
}
const completeness = evaluateModuleCompleteness(result.modules);
for (const c of completeness) {
  console.log(`completeness: ${c.name} ${c.actual}/${c.expected} missing=${c.missing}`);
}
// Simulate matchAnswers: scoped first, then positional global fallback
const scoped = new Map<string, string>();
const global: Array<{ n: number; inferred: string | null; answer: string }> = [];
for (const [k, v] of result.keyMap) {
  if (!k.startsWith("g|")) scoped.set(k, v.answer);
}
for (const e of result.keyEntries) {
  if (!e.moduleName) global.push({ n: e.questionNumber, inferred: e.inferredModule ?? null, answer: e.answer });
}
const answers: Array<string | null> = new Array(result.questions.length).fill(null);
const unmatched: number[] = [];
result.questions.forEach((q, i) => {
  const hit = scoped.get(`${q.sourceModuleName}|${q.sourceQuestionNumber}`);
  if (hit) answers[i] = hit;
  else unmatched.push(i);
});
if (unmatched.length > 0 && global.length === unmatched.length) {
  unmatched.forEach((qi, j) => { answers[qi] = global[j]!.answer; });
}
const withKey = answers.filter(Boolean).length;
const status = withKey >= result.questions.length ? "complete" : withKey === 0 ? "missing" : "partial";
console.log(`global key entries: ${global.length}, unmatched after scoped: ${unmatched.length}`);
console.log(`answer keys matched: ${withKey}/${result.questions.length} status=${status}`);
if (result.questions.length !== 44) throw new Error("expected 44 math questions");
const bad = completeness.filter((c) => c.missing !== 0);
if (bad.length > 0) throw new Error(`incomplete modules: ${bad.map((c) => c.name).join(",")}`);
console.log("VERIFY OK");
