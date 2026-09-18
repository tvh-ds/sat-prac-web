import { parseFullTest } from "../src/fullTestParser";
import { parseAnswerKey } from "../src/answerKey";
import { normalizeText } from "../src/textNormalize";

const lines: string[] = [];
for (let n = 321; n <= 326; n++) {
  lines.push(`**${n}** Which choice completes the text?\nA) One\nB) Two`);
}
lines.push("321 C 322 A\n323 B 324 D\n325 A 326 B");
const pages = normalizeText([{ pageNumber: 1, text: lines.join("\n") }]);
const key = parseAnswerKey(pages as never, 6);
console.log("key entries:", key.entries.length, key.entries.map((e) => e.questionNumber));
const res = parseFullTest(pages as never, { contentScope: "full_test" });
console.log("questions:", res.questions.length, "modules:", res.modules.map((m) => `${m.name}:${m.questionCount}`));
