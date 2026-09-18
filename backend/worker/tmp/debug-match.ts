/** Debug key matching for one file. */
import { readFileSync } from "node:fs";
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
for (const q of res.questions.filter((x) => x.sourceModuleName === "Math Module 2" && x.sourceQuestionNumber <= 6)) {
  const hit = res.keyMap.get(`${q.sourceModuleName}|${q.sourceQuestionNumber}`);
  console.log(`Q${q.sourceQuestionNumber}: key=${hit ? hit.answer : "NONE"}`);
}
console.log("--- keyMap M2 keys:", [...res.keyMap.keys()].filter((k) => k.startsWith("Math Module 2|")).slice(0, 10));
console.log("--- question modules:", [...new Set(res.questions.map((q) => JSON.stringify(q.sourceModuleName)))]);
