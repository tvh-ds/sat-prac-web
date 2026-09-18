#!/usr/bin/env node
/**
 * Batch-insert remaining draft questions from the parsed bank JSON.
 * Handles large volumes by batching inserts (50 at a time).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { BankParseResult, BankQuestion } from "../src/questionBankParser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ygqndcgpbtmewzkruyuq.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see backend/worker/.env)");
const BANK_JSON = path.resolve(__dirname, "../tmp/bank-parsed.json");
const BATCH_SIZE = 50;

function sanitize(text: string | null): string | null {
  if (!text) return null;
  // Remove control characters except tab/newline/carriage-return
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Find existing import
  const { data: imp } = await supabase.from("pdf_imports").select("id").eq("storage_path", "local-no-upload").order("created_at", { ascending: false }).limit(1).single();
  if (!imp) { console.error("No import found"); process.exit(1); }
  console.log(`Import: ${imp.id}`);

  // Find which source_question_ids already exist (paginate to get all)
  const existingIds = new Set<string>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: batch, error } = await supabase.from("draft_questions").select("source_question_id").eq("pdf_import_id", imp.id).range(offset, offset + PAGE - 1);
    if (error) { console.error("Error fetching existing IDs:", error.message); break; }
    if (!batch || batch.length === 0) break;
    for (const d of batch) existingIds.add(d.source_question_id);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`Already inserted: ${existingIds.size} questions`);

  // Load parsed data
  if (!fs.existsSync(BANK_JSON)) { console.error(`Run import-bank-parse.ts first to create ${BANK_JSON}`); process.exit(1); }
  const bank: BankParseResult = JSON.parse(fs.readFileSync(BANK_JSON, "utf-8"));
  const remaining = bank.questions.filter((q) => !existingIds.has(q.sourceQuestionId));
  console.log(`Remaining: ${remaining.length} questions`);

  // Process in batches
  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);

    // Batch insert draft_questions
    const draftRows = batch.map((q) => ({
      pdf_import_id: imp.id,
      page_number: q.pageNumber,
      section: q.section,
      question_type: q.questionType,
      prompt: sanitize(q.prompt) ?? q.prompt,
      passage_text: sanitize(q.passageText),
      domain: q.domain,
      skill: q.skill,
      difficulty: q.difficulty,
      suggested_answer: q.correctAnswer,
      answer_confidence: q.confidence,
      status: q.hasVisualStimulus ? "needs_review" : q.correctAnswer ? "has_suggested_key" : "missing_key",
      source_question_number: q.sourceQuestionNumber,
      source_question_id: q.sourceQuestionId,
      explanation: sanitize(q.explanation),
      has_visual_stimulus: q.hasVisualStimulus,
      stimulus_image_path: null,
      parser_metadata: { parser: "rw-question-bank" },
    }));

    const { data: drafts, error: dErr } = await supabase.from("draft_questions").insert(draftRows).select("id, source_question_number");
    if (dErr) {
      console.error(`  Batch error at Q${batch[0]?.sourceQuestionId}: ${dErr.message} — retrying one-by-one`);
      // Retry one-by-one, skipping duplicates
      for (const q of batch) {
        const { data: one, error: oneErr } = await supabase
          .from("draft_questions")
          .insert({
            pdf_import_id: imp.id,
            page_number: q.pageNumber,
            section: q.section,
            question_type: q.questionType,
            prompt: sanitize(q.prompt) ?? q.prompt,
            passage_text: sanitize(q.passageText),
            domain: q.domain,
            skill: q.skill,
            difficulty: q.difficulty,
            suggested_answer: q.correctAnswer,
            answer_confidence: q.confidence,
            status: q.hasVisualStimulus ? "needs_review" : q.correctAnswer ? "has_suggested_key" : "missing_key",
            source_question_number: q.sourceQuestionNumber,
            source_question_id: q.sourceQuestionId,
            explanation: sanitize(q.explanation),
            has_visual_stimulus: q.hasVisualStimulus,
            stimulus_image_path: null,
            parser_metadata: { parser: "rw-question-bank" },
          })
          .select("id")
          .single();
        if (oneErr) {
          if (!oneErr.message.includes("duplicate")) totalSkipped++;
          continue;
        }
        const choiceRows2: Array<{ draft_question_id: string; label: string; text: string; position: number }> = [];
        for (const c of q.choices) choiceRows2.push({ draft_question_id: one.id, label: c.label, text: sanitize(c.text) ?? c.text, position: c.position });
        if (choiceRows2.length > 0) await supabase.from("draft_question_choices").insert(choiceRows2);
        await supabase.from("draft_answer_keys").insert({
          draft_question_id: one.id, detected_answer: q.correctAnswer, confidence: 0.99,
          source_text: `Correct Answer: ${q.correctAnswer}`, source_page: q.pageNumber, status: "suggested",
        });
        totalInserted++;
      }
      continue;
    }

    // Batch insert choices and answer keys
    const choiceRows: Array<{ draft_question_id: string; label: string; text: string; position: number }> = [];
    const keyRows: Array<{ draft_question_id: string; detected_answer: string; confidence: number; source_text: string; source_page: number; status: string }> = [];

    for (const draft of drafts ?? []) {
      const q = batch.find((x) => x.sourceQuestionNumber === draft.source_question_number);
      if (!q) continue;

      for (const c of q.choices) {
        choiceRows.push({ draft_question_id: draft.id, label: c.label, text: sanitize(c.text) ?? c.text, position: c.position });
      }

      keyRows.push({
        draft_question_id: draft.id,
        detected_answer: q.correctAnswer,
        confidence: 0.99,
        source_text: `Correct Answer: ${q.correctAnswer}`,
        source_page: q.pageNumber,
        status: "suggested",
      });
    }

    if (choiceRows.length > 0) {
      // Choices can be large; insert in sub-batches of 200
      for (let j = 0; j < choiceRows.length; j += 200) {
        const sub = choiceRows.slice(j, j + 200);
        const { error: cErr } = await supabase.from("draft_question_choices").insert(sub);
        if (cErr) console.error(`  Choices sub-batch error: ${cErr.message}`);
      }
    }

    if (keyRows.length > 0) {
      const { error: kErr } = await supabase.from("draft_answer_keys").insert(keyRows);
      if (kErr) console.error(`  Keys batch error: ${kErr.message}`);
    }

    totalInserted += (drafts ?? []).length;
    totalSkipped += batch.length - (drafts ?? []).length;
    if (totalInserted % 200 === 0 || i + BATCH_SIZE >= remaining.length) {
      console.log(`  Progress: ${totalInserted}/${remaining.length} inserted, ${totalSkipped} skipped`);
    }
  }

  console.log(`\nDone! Inserted: ${totalInserted}, Skipped: ${totalSkipped}`);
  console.log(`Total in import: ${existingIds.size + totalInserted}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
