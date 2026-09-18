import { readFile } from "node:fs/promises";
import { parseScraperQuestions } from "../src/scraperParser";

const pages = [];
for (const n of [1, 2, 5, 10, 11, 17, 18, 19, 20, 21]) {
  try {
    const text = await readFile(`tests/fixtures/page${String(n).padStart(2, "0")}.txt`, "utf8");
    pages.push({ pageNumber: n, text });
  } catch {
    console.log(`missing fixture page ${n}`);
  }
}

const result = parseScraperQuestions(pages);
console.log(`modules: ${JSON.stringify(result.modules)}`);
console.log(`questions: ${result.questions.length}, keys: ${result.keys.length}, keyConfidence: ${result.keyConfidence}`);
for (const q of result.questions) {
  console.log(`#${String(q.sourceQuestionNumber).padStart(2)} [${q.sourceModuleName}] p${q.pageNumber} ${q.questionType} conf=${q.confidence} choices=${q.choices.length} | ${q.prompt.slice(0, 70)}`);
}
console.log("--- keys ---");
for (const k of result.keys) console.log(`${k.moduleName} #${k.questionNumber} -> ${k.answer}`);