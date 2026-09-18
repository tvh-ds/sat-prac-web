import { parseScraperQuestions } from "../src/scraperParser";
const text = `Reading and Writing
Passage: The canal system transformed inland trade, cutting journey times from weeks to days and slashing costs.
1. Which choice best states the main idea of the passage?
A. Canals were expensive.
B. The canal system changed commerce.
C. Merchants built the canals.
D. Ports closed after.
2. As used in the passage, transformed most nearly means
A. altered
B. removed
C. frozen
D. hidden
Math
1. If 3x + 7 = 22, what is the value of x?
A. 4
B. 5
C. 6
D. 7
2. If 2(x + 3) = x + 10, what is the value of x?
Answer Key
1. B
2. A
3. B
4. 4`;
const r = parseScraperQuestions([{ pageNumber: 1, text }]);
console.log("questions:", r.questions.length, "keys:", r.keys.length, "modules:", JSON.stringify(r.modules));
for (const q of r.questions) console.log(`#${q.sourceQuestionNumber} ${q.section} ${q.questionType} choices=${q.choices.length} | ${q.prompt.slice(0, 50)}`);
for (const k of r.keys) console.log(`key ${k.moduleName} #${k.questionNumber} -> ${k.answer}`);
