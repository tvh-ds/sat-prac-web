#!/usr/bin/env node
/**
 * One-shot script: parse Full RW Question Bank from local disk,
 * insert into cloud DB (pdf_imports + draft_questions), no storage upload needed.
 *
 * Usage:  npx tsx scripts/import-local-bank.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { extractText } from "../src/extractor";
import { looksLikeQuestionBank, parseQuestionBank } from "../src/questionBankParser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ygqndcgpbtmewzkruyuq.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see backend/worker/.env)");

const PDF_PATH = path.resolve(__dirname, "../../../Tests Unparsed/Full RW Question Bank With Key.pdf");

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Read PDF
  console.log(`Reading PDF: ${PDF_PATH}`);
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  console.log(`  Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // 2. Extract text
  console.log("Extracting text from PDF pages...");
  const pageTexts = await extractText(new Uint8Array(pdfBuffer));
  console.log(`  Pages: ${pageTexts.length}`);

  // 3. Detect format and parse
  if (!looksLikeQuestionBank(pageTexts)) {
    console.error("ERROR: PDF does not look like the R&W question bank format.");
    process.exit(1);
  }

  console.log("Parsing question bank...");
  const result = parseQuestionBank(pageTexts);
  console.log(`  Parsed: ${result.questions.length} questions`);
  console.log(`  Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.log("  First 5 errors:");
    for (const e of result.errors.slice(0, 5)) console.log(`    Q${e.sourceQuestionId}: ${e.reason} (page ${e.pageNumber})`);
  }

  const textOnly = result.questions.filter((q) => !q.hasVisualStimulus);
  const visual = result.questions.filter((q) => q.hasVisualStimulus);
  console.log(`  Text-only: ${textOnly.length}`);
  console.log(`  Visual stimulus: ${visual.length}`);

  // 4. Get admin user
  const { data: admin } = await supabase.from("profiles").select("id").eq("role", "admin").limit(1).single();
  if (!admin) { console.error("ERROR: No admin profile found."); process.exit(1); }

  // 5. Insert pdf_import record
  console.log("Creating pdf_imports record...");
  const { data: imp, error: impErr } = await supabase
    .from("pdf_imports")
    .insert({
      storage_path: "local-no-upload",
      original_filename: "Full RW Question Bank With Key.pdf",
      file_size: pdfBuffer.length,
      created_by: admin.id,
      status: "completed",
      page_count: pageTexts.length,
      extraction_method: "text",
      text_quality: {
        drafts: result.questions.length,
        key_entries: result.questions.length,
        key_confidence: 0.99,
        modules: {
          "RW Question Bank": result.questions.length,
          "Text-only": textOnly.length,
          "Visual stimulus": visual.length,
          "Parse errors": result.errors.length,
        },
      },
    })
    .select("*")
    .single();
  if (impErr) { console.error("Insert import failed:", impErr); process.exit(1); }
  console.log(`  Import ID: ${imp.id}`);

  // 6. Write extracted pages (first 50 only to keep it fast; full 1977 would be slow)
  console.log("Writing extracted_text pages (first 100)...");
  const pagesToWrite = pageTexts.slice(0, 100);
  for (const p of pagesToWrite) {
    const words = p.text.trim().split(/\s+/).filter(Boolean).length;
    await supabase.from("pdf_import_pages").upsert(
      { pdf_import_id: imp.id, page_number: p.pageNumber, extracted_text: p.text, word_count: words },
      { onConflict: "pdf_import_id,page_number" },
    );
  }
  console.log(`  Wrote ${pagesToWrite.length} pages`);

  // 7. Insert draft questions + choices + answer keys
  console.log("Inserting draft questions...");
  let inserted = 0;
  let skipped = 0;

  for (const q of result.questions) {
    const status = q.hasVisualStimulus ? "needs_review" : q.correctAnswer ? "has_suggested_key" : "missing_key";

    const { data: draft, error: dErr } = await supabase
      .from("draft_questions")
      .insert({
        pdf_import_id: imp.id,
        page_number: q.pageNumber,
        section: q.section,
        question_type: q.questionType,
        prompt: q.prompt,
        passage_text: q.passageText,
        domain: q.domain,
        skill: q.skill,
        difficulty: q.difficulty,
        suggested_answer: q.correctAnswer,
        answer_confidence: q.confidence,
        status,
        source_question_number: q.sourceQuestionNumber,
        source_question_id: q.sourceQuestionId,
        explanation: q.explanation,
        has_visual_stimulus: q.hasVisualStimulus,
        stimulus_image_path: null,
        parser_metadata: { parser: "rw-question-bank" },
      })
      .select("id")
      .single();

    if (dErr) {
      console.error(`  Skip Q${q.sourceQuestionId}: ${dErr.message}`);
      skipped++;
      continue;
    }

    // Choices
    if (q.choices.length > 0) {
      await supabase.from("draft_question_choices").insert(
        q.choices.map((c) => ({ draft_question_id: draft.id, label: c.label, text: c.text, position: c.position })),
      );
    }

    // Answer key
    await supabase.from("draft_answer_keys").insert({
      draft_question_id: draft.id,
      detected_answer: q.correctAnswer,
      confidence: 0.99,
      source_text: `Correct Answer: ${q.correctAnswer}`,
      source_page: q.pageNumber,
      status: "suggested",
    });

    inserted++;
    if (inserted % 100 === 0) console.log(`  ... ${inserted} inserted`);
  }

  console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);
  console.log(`Import ID: ${imp.id}`);
  console.log(`Open: http://localhost:5173/admin/imports/${imp.id}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
