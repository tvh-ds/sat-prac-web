import "dotenv/config";
import fs from "node:fs";
import { extractText } from "../src/extractor";
import { normalizeText } from "../src/textNormalize";
import { renderPagePng } from "../src/renderPage";
import { createOcrProvider } from "../src/ocr";
import { parseFullTest } from "../src/fullTestParser";

const PDF = "D:/SAT website/Tests Unparsed/Digital SAT Tests/2024 08/202408usv2.pdf";
const PAGES = [...Array(10)].map((_, i) => i + 16); // 16..25 (math M1 pages 16-20, M2 pages 20-25)

(async () => {
  const buf = fs.readFileSync(PDF);
  const provider = createOcrProvider("cohere", process.env.COHERE_API_KEY, process.env.COHERE_OCR_MODEL);
  if (!provider) throw new Error("No OCR provider (COHERE_API_KEY missing)");
  console.log("provider:", provider.name);

  const original = await extractText(new Uint8Array(buf));
  let ocrResults: Record<number, string> = {};

  const cachedPath = "tmp/ocr-math-202408usv2.json";
  if (!process.env.REDO_OCR && fs.existsSync(cachedPath)) {
    ocrResults = JSON.parse(fs.readFileSync(cachedPath, "utf-8"));
    console.log("using cached OCR results");
  } else {
    for (const pn of PAGES) {
      const started = Date.now();
      const png = await renderPagePng(new Uint8Array(buf), pn, 2);
      const text = await provider.ocrImage(png);
      ocrResults[pn] = text;
      console.log(`[ocr p${pn}] ${text.length} chars in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    fs.writeFileSync(cachedPath, JSON.stringify(ocrResults, null, 2), "utf-8");
  }

  const merged = original.map((p) => (ocrResults[p.pageNumber] ? { ...p, text: ocrResults[p.pageNumber]! } : p));
  const pages = normalizeText(merged);
  const r = parseFullTest(pages, { contentScope: "math" });

  console.log("\n== modules ==");
  for (const m of r.modules) console.log(m.name, "count=" + m.questionCount);
  console.log("keyConfidence=" + r.keyConfidence, "keyMap.size=" + r.keyMap.size);

  console.log("\n== questions ==");
  for (const q of r.questions) {
    console.log(
      [
        q.sourceModuleName,
        q.sourceQuestionNumber,
        "p" + q.pageNumber,
        q.questionType,
        "choices=" + q.choices.length,
        q.prompt.slice(0, 140).replace(/\s+/g, " "),
      ].join(" | "),
    );
  }
  console.log("total questions:", r.questions.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});