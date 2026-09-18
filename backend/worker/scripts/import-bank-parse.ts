#!/usr/bin/env node
/**
 * Step 1: Parse the full bank PDF and save to JSON (avoids re-parsing).
 * Step 2: Run import-insert.ts to insert from the JSON.
 *
 * Usage:  npx tsx scripts/import-bank-parse.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractText } from "../src/extractor";
import { looksLikeQuestionBank, parseQuestionBank } from "../src/questionBankParser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_PATH = path.resolve(__dirname, "../../../Tests Unparsed/Full RW Question Bank With Key.pdf");
const OUT_PATH = path.resolve(__dirname, "../tmp/bank-parsed.json");

async function main() {
  console.log(`Reading PDF: ${PDF_PATH}`);
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  console.log(`  Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  console.log("Extracting text...");
  const pageTexts = await extractText(new Uint8Array(pdfBuffer));
  console.log(`  Pages: ${pageTexts.length}`);

  if (!looksLikeQuestionBank(pageTexts)) {
    console.error("ERROR: Not the R&W question bank format.");
    process.exit(1);
  }

  console.log("Parsing questions...");
  const result = parseQuestionBank(pageTexts);
  console.log(`  Parsed: ${result.questions.length}, Errors: ${result.errors.length}`);

  const textOnly = result.questions.filter((q) => !q.hasVisualStimulus).length;
  const visual = result.questions.filter((q) => q.hasVisualStimulus).length;
  console.log(`  Text-only: ${textOnly}, Visual: ${visual}`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log(`Saved to: ${OUT_PATH}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
