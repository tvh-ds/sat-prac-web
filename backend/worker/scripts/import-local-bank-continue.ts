#!/usr/bin/env node
/**
 * Continue inserting draft questions for the existing import.
 * Picks up from the last inserted source_question_number.
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

  // Find existing import
  const { data: imp } = await supabase.from("pdf_imports").select("id").eq("storage_path", "local-no-upload").order("created_at", { ascending: false }).limit(1).single();
  if (!imp) { console.error("No import found"); process.exit(1); }
  console.log(`Import: ${imp.id}`);

  // Find highest inserted source_question_number
  const { data: last } = await supabase.from("draft_questions").select("source_question_number").eq("pdf_import_id", imp.id).order("source_question_number", { ascending: false }).limit(1).single();
  const startAfter = last?.source_question_number ?? 0;
  console.log(`Last inserted: Q${startAfter}`);

  // Re-parse PDF
  console.log("Parsing PDF...");
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const pageTexts = await extractText(new Uint8Array(pdfBuffer));
  const bank = parseQuestionBank(pageTexts);
  console.log(`Total parsed: ${bank.questions.length}`);

  // Insert remaining
  let inserted = 0;
  let skipped = 0;
  const remaining = bank.questions.filter((q) => q.sourceQuestionNumber > startAfter);
  console.log(`Remaining: ${remaining.length}`);

  for (const q of remaining) {
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

    if (q.choices.length > 0) {
      await supabase.from("draft_question_choices").insert(
        q.choices.map((c) => ({ draft_question_id: draft.id, label: c.label, text: c.text, position: c.position })),
      );
    }

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
  console.log(`Total in import: ${startAfter + inserted}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
