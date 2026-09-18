import { readFileSync } from "node:fs";
import { parseFullTest } from "../src/fullTestParser";
import { normalizeText } from "../src/textNormalize";

const raw = readFileSync("D:/SAT website/Tests Unparsed/post_ocr/2025 09/202509asiav1.ocr.txt", "utf8");
const parts = raw.split(/^===== PAGE (\d+) =====\s*$/m);
const pages: Array<{ pageNumber: number; text: string }> = [];
for (let i = 1; i < parts.length; i += 2) {
  pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
}
const res = parseFullTest(normalizeText(pages), { contentScope: "full_test", targetModule: null });
for (const q of res.questions.filter((x) => x.section === "math").slice(0, 6)) {
  console.log(`--- Math#${q.sourceQuestionNumber} (${q.sourceModuleName}):`);
  console.log(`prompt: ${q.prompt.slice(0, 260)}`);
  console.log(`passage: ${(q.passageText ?? "(none)").slice(0, 200)}`);
}
const rwFig = res.questions.filter((x) => x.section === "reading_writing" && /\[figure|\[table/.test(x.passageText ?? ""));
console.log(`RW passages with markers: ${rwFig.length}`);
for (const q of res.questions.filter((x) => x.section === "reading_writing" && x.passageText).slice(10, 12)) {
  console.log(`--- RW#${q.sourceQuestionNumber} passage head: ${(q.passageText ?? "").slice(0, 250)}`);
}
