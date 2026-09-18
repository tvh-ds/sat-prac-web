#!/usr/bin/env tsx
/**
 * Standalone duplicate pass: fingerprint drafts across imports and flag
 * repeats for review (flag only — no replacements, no deletions).
 *
 * Usage:
 *   npx tsx scripts/dedupe-imports.ts --all-local-batch [--report <path>]
 *   npx tsx scripts/dedupe-imports.ts --filenames "<a.pdf>,<b.pdf>" [--report <path>]
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";
import { fingerprintQuestion } from "../src/duplicate";

async function loadAll<T>(sb: SupabaseClient, table: string, select: string, eq: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from(table).select(select);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(`read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : join("tmp", "dedupe-report.json");
  const allBatch = args.includes("--all-local-batch");
  const fnIdx = args.indexOf("--filenames");
  const names = fnIdx >= 0 ? args[fnIdx + 1]!.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!allBatch && names.length === 0) {
    throw new Error("usage: dedupe-imports.ts --all-local-batch | --filenames \"<a.pdf>,<b.pdf>\" [--report <path>]");
  }

  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  let importIds: string[] = [];
  const fileByImport = new Map<string, string>();
  if (allBatch) {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("pdf_imports")
        .select("id,original_filename")
        .like("storage_path", "local-batch/%")
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`list imports: ${error.message}`);
      for (const r of (data ?? []) as Array<{ id: string; original_filename: string }>) {
        importIds.push(r.id);
        fileByImport.set(r.id, r.original_filename);
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  } else {
    const { data, error } = await supabase.from("pdf_imports").select("id,original_filename").in("original_filename", names);
    if (error) throw new Error(`list imports: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; original_filename: string }>) {
      importIds.push(r.id);
      fileByImport.set(r.id, r.original_filename);
    }
  }
  console.log(`imports: ${importIds.length}`);

  type DraftRow = {
    id: string; pdf_import_id: string; page_number: number; section: string; question_type: string;
    prompt: string; passage_text: string | null; suggested_answer: string | null;
    source_module_name: string | null; source_question_number: number | null;
    status: string; parser_metadata: Record<string, unknown> | null;
  };
  type ChoiceRow = { draft_question_id: string; label: string | null; text: string; position: number };
  const drafts: DraftRow[] = [];
  for (const id of importIds) {
    drafts.push(...await loadAll<DraftRow>(supabase, "draft_questions", "id,pdf_import_id,page_number,section,question_type,prompt,passage_text,suggested_answer,source_module_name,source_question_number,status,parser_metadata", { pdf_import_id: id }));
  }
  console.log(`drafts: ${drafts.length}`);
  const choicesByDraft = new Map<string, ChoiceRow[]>();
  const allDraftIds = drafts.map((d) => d.id);
  for (let i = 0; i < allDraftIds.length; i += 200) {
    const chunk = allDraftIds.slice(i, i + 200);
    const { data, error } = await supabase.from("draft_question_choices").select("draft_question_id,label,text,position").in("draft_question_id", chunk);
    if (error) throw new Error(`read choices: ${error.message}`);
    for (const c of ((data ?? []) as ChoiceRow[])) {
      if (!choicesByDraft.has(c.draft_question_id)) choicesByDraft.set(c.draft_question_id, []);
      choicesByDraft.get(c.draft_question_id)!.push(c);
    }
  }
  const byFp = new Map<string, Array<{ draftId: string; file: string }>>();
  for (const d of drafts) {
    const ch = (choicesByDraft.get(d.id) ?? []).sort((a, b) => a.position - b.position);
    const fp = fingerprintQuestion({
      section: d.section,
      questionType: d.question_type,
      passageText: d.passage_text,
      prompt: d.prompt,
      choices: ch.map((c) => ({ label: c.label ?? "", text: c.text })),
      suggestedAnswer: d.suggested_answer,
    });
    if (!byFp.has(fp)) byFp.set(fp, []);
    byFp.get(fp)!.push({ draftId: d.id, file: fileByImport.get(d.pdf_import_id) ?? d.pdf_import_id });
  }
  let flagged = 0;
  let groups = 0;
  const groupSummaries: Array<{ fingerprint: string; size: number; files: string[] }> = [];
  for (const [fp, occ] of byFp) {
    if (occ.length < 2) continue;
    groups++;
    occ.sort((a, b) => a.file.localeCompare(b.file));
    groupSummaries.push({ fingerprint: fp, size: occ.length, files: [...new Set(occ.map((o) => o.file))] });
    const [first, ...rest] = occ;
    for (const o of rest) {
      const d = drafts.find((x) => x.id === o.draftId)!;
      const meta = { ...(d.parser_metadata ?? {}), duplicate: { is_duplicate: true, fingerprint: fp, group_size: occ.length, canonical_file: first!.file, occurrences: occ.map((x) => x.file) } };
      const patch: Record<string, unknown> = { parser_metadata: meta };
      if (d.status !== "needs_review") patch.status = "needs_review";
      const { error } = await supabase.from("draft_questions").update(patch).eq("id", o.draftId);
      if (error) throw new Error(`flag duplicate: ${error.message}`);
      flagged++;
    }
    const firstDraft = drafts.find((x) => x.id === first!.draftId)!;
    const firstMeta = { ...(firstDraft.parser_metadata ?? {}), duplicate: { is_duplicate: false, fingerprint: fp, group_size: occ.length, occurrences: occ.map((x) => x.file) } };
    await supabase.from("draft_questions").update({ parser_metadata: firstMeta }).eq("id", first!.draftId);
  }
  console.log(`duplicate groups: ${groups}, flagged occurrences: ${flagged}`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ imports: importIds.length, drafts: drafts.length, duplicateGroups: groupSummaries, flagged }, null, 2));
  console.log(`Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
