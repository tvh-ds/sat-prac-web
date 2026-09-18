#!/usr/bin/env tsx
/**
 * Surgical backfill: collapse repeated escaped-underscore blank runs
 * ("\_\_\_\_\_\_" → "_____") in stored drafts. Only runs of 3+ escaped
 * underscores are touched — standalone "\_" and LaTeX backslashes stay.
 *
 * Fields: draft_questions.prompt, draft_questions.passage_text,
 * draft_question_choices.text.
 *
 * Usage: npx tsx scripts/backfill-escaped-blanks.ts [--apply] [--report <path>]
 * Default is dry-run.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const BLANK_RUN_RE = /(?:\\_){3,}/g;
const BLANK_TEST_RE = /(?:\\_){3,}/;

function fixBlanks(s: string): string {
  return s.replace(BLANK_RUN_RE, (m) => "_".repeat(m.length / 2));
}

interface Change {
  table: string;
  id: string;
  field: string;
  file: string;
  before: number;
  after: number;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : "tmp/backfill-escaped-blanks.json";
  const cfg = loadConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  const fileNames = new Map<string, string>();
  async function fileOf(pdfImportId: string): Promise<string> {
    if (!fileNames.has(pdfImportId)) {
      const { data: im } = await sb.from("pdf_imports").select("original_filename").eq("id", pdfImportId).maybeSingle();
      fileNames.set(pdfImportId, (im as { original_filename?: string } | null)?.original_filename ?? pdfImportId);
    }
    return fileNames.get(pdfImportId)!;
  }

  const changed: Change[] = [];
  let checkedQuestions = 0;
  let checkedChoices = 0;

  // --- draft_questions: prompt + passage_text ---
  for (let offset = 0; ; ) {
    const { data, error } = await sb
      .from("draft_questions")
      .select("id,pdf_import_id,prompt,passage_text")
      .range(offset, offset + 999);
    if (error) throw new Error(`read drafts: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const d of data as Array<{ id: string; pdf_import_id: string; prompt: string; passage_text: string | null }>) {
      checkedQuestions++;
      const patch: Record<string, string> = {};
      if (d.prompt && BLANK_TEST_RE.test(d.prompt)) {
        const fixed = fixBlanks(d.prompt);
        if (fixed !== d.prompt) {
          patch.prompt = fixed;
          changed.push({ table: "draft_questions", id: d.id, field: "prompt", file: await fileOf(d.pdf_import_id), before: d.prompt.length, after: fixed.length });
        }
      }
      if (d.passage_text && BLANK_TEST_RE.test(d.passage_text)) {
        const fixed = fixBlanks(d.passage_text);
        if (fixed !== d.passage_text) {
          patch.passage_text = fixed;
          changed.push({ table: "draft_questions", id: d.id, field: "passage_text", file: await fileOf(d.pdf_import_id), before: d.passage_text.length, after: fixed.length });
        }
      }
      if (apply && Object.keys(patch).length > 0) {
        const { error: uErr } = await sb.from("draft_questions").update(patch).eq("id", d.id);
        if (uErr) throw new Error(`update draft ${d.id}: ${uErr.message}`);
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
  }

  // --- draft_question_choices: text ---
  for (let offset = 0; ; ) {
    const { data, error } = await sb
      .from("draft_question_choices")
      .select("id,draft_question_id,text")
      .range(offset, offset + 999);
    if (error) throw new Error(`read choices: ${error.message}`);
    if (!data || data.length === 0) break;
    // Map choice -> import file for the report (batched).
    const qIds = [...new Set((data as Array<{ draft_question_id: string }>).map((c) => c.draft_question_id))];
    const qFile = new Map<string, string>();
    for (let i = 0; i < qIds.length; i += 200) {
      const chunk = qIds.slice(i, i + 200);
      const { data: qs, error: qErr } = await sb.from("draft_questions").select("id,pdf_import_id").in("id", chunk);
      if (qErr) throw new Error(`map choice parents: ${qErr.message}`);
      for (const q of (qs ?? []) as Array<{ id: string; pdf_import_id: string }>) qFile.set(q.id, await fileOf(q.pdf_import_id));
    }
    for (const c of data as Array<{ id: string; draft_question_id: string; text: string }>) {
      checkedChoices++;
      if (!c.text || !BLANK_TEST_RE.test(c.text)) continue;
      const fixed = fixBlanks(c.text);
      if (fixed === c.text) continue;
      changed.push({ table: "draft_question_choices", id: c.id, field: "text", file: qFile.get(c.draft_question_id) ?? "", before: c.text.length, after: fixed.length });
      if (apply) {
        const { error: uErr } = await sb.from("draft_question_choices").update({ text: fixed }).eq("id", c.id);
        if (uErr) throw new Error(`update choice ${c.id}: ${uErr.message}`);
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ dry_run: !apply, checkedQuestions, checkedChoices, changed: changed.length, rows: changed }, null, 2));
  console.log(`${apply ? "Fixed" : "Would fix"} ${changed.length} fields (${checkedQuestions} drafts, ${checkedChoices} choices checked). Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
