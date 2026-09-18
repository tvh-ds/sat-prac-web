#!/usr/bin/env node
/**
 * Batch auto-approve all text-only (has_suggested_key) drafts from the bank import.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ygqndcgpbtmewzkruyuq.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (see backend/worker/.env)");

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: admin } = await supabase.from("profiles").select("id").eq("role", "admin").limit(1).single();
  if (!admin) { console.error("No admin profile"); process.exit(1); }

  const { data: imp } = await supabase.from("pdf_imports").select("id").eq("storage_path", "local-no-upload").order("created_at", { ascending: false }).limit(1).single();
  if (!imp) { console.error("No import found"); process.exit(1); }
  console.log(`Import: ${imp.id}`);

  // Load all text-only drafts
  console.log("Loading drafts...");
  const allDrafts: Array<Record<string, unknown>> = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: batch } = await supabase
      .from("draft_questions")
      .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*)")
      .eq("pdf_import_id", imp.id)
      .eq("status", "has_suggested_key")
      .range(offset, offset + PAGE - 1);
    if (!batch || batch.length === 0) break;
    allDrafts.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`  Loaded ${allDrafts.length} drafts`);

  let approved = 0;
  let failed = 0;

  for (let i = 0; i < allDrafts.length; i++) {
    const draft = allDrafts[i]!;
    const draftId = draft.id as string;

    // Create passage if needed
    let passageId: string | null = null;
    if (draft.passage_text) {
      const { data: passage, error: pErr } = await supabase
        .from("passages")
        .insert({ content: draft.passage_text, source: imp.id, created_by: admin.id })
        .select("id")
        .single();
      if (pErr) { failed++; continue; }
      passageId = passage.id;
    }

    const suggested = draft.suggested_answer as string | null;
    const choices = (draft.choices ?? []) as Array<{ label: string | null; text: string }>;

    // Create question
    const { data: question, error: qErr } = await supabase
      .from("questions")
      .insert({
        section: draft.section,
        question_type: draft.question_type,
        passage_id: passageId,
        prompt: draft.prompt,
        domain: draft.domain,
        skill: draft.skill,
        difficulty: draft.difficulty,
        correct_answer: suggested,
        explanation: draft.explanation,
        source_pdf_id: imp.id,
        source_page: draft.page_number,
        source_question_id: draft.source_question_id,
        stimulus_image_path: draft.stimulus_image_path,
        created_by: admin.id,
      })
      .select("id")
      .single();
    if (qErr) { failed++; continue; }

    // Create choices and mark correct
    if (choices.length > 0) {
      await supabase.from("question_choices").insert(
        choices.map((c, idx) => ({
          question_id: question.id,
          label: c.label ?? String.fromCharCode(65 + idx),
          text: c.text,
          is_correct: false,
          position: idx + 1,
        })),
      );
      if (suggested) {
        await supabase.from("question_choices").update({ is_correct: true }).eq("question_id", question.id).eq("label", suggested.trim().toUpperCase());
      }
    }

    // Record source
    await supabase.from("question_sources").insert({
      question_id: question.id,
      pdf_import_id: imp.id,
      page_number: draft.page_number,
      raw_text: draft.prompt,
    });

    // Update draft status
    await supabase.from("draft_questions").update({ status: "approved", question_id: question.id }).eq("id", draftId);
    await supabase.from("draft_answer_keys").update({ status: "approved" }).eq("draft_question_id", draftId).eq("status", "suggested");

    approved++;
    if (approved % 100 === 0) console.log(`  ${approved}/${allDrafts.length} approved, ${failed} failed`);
  }

  console.log(`\nDone! Approved: ${approved}, Failed: ${failed}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
