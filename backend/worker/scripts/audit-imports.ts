#!/usr/bin/env tsx
/**
 * Audit local-batch imports: per-file draft counts, key coverage, statuses,
 * phantom prompts (directions/answer-box/UI), duplicate flags.
 *
 * Usage: npx tsx scripts/audit-imports.ts [--report <path>]
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const PHANTOM_RES = [
  /student-produced response directions/i,
  /more than one correct answer/i,
  /answer preview/i,
  /rectangular box[^.]{0,120}(write|enter|blank|answer)/i,
  /mark for review/i,
  /hide\s+calculator/i,
  /back\s+next/i,
];

async function main() {
  const args = process.argv.slice(2);
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : join("tmp", "audit-imports.json");
  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  const { data: imports, error: iErr } = await supabase
    .from("pdf_imports")
    .select("id,original_filename,status,page_count")
    .like("storage_path", "local-batch/%")
    .order("original_filename");
  if (iErr) throw new Error(`list imports: ${iErr.message}`);

  const rows: Array<Record<string, unknown>> = [];
  for (const imp of (imports ?? []) as Array<{ id: string; original_filename: string; status: string; page_count: number }>) {
    const { data: drafts, error: dErr } = await supabase
      .from("draft_questions")
      .select("id,status,section,source_module_name,source_question_number,suggested_answer,prompt,has_visual_stimulus,parser_metadata")
      .eq("pdf_import_id", imp.id);
    if (dErr) throw new Error(`read drafts: ${dErr.message}`);
    const ds = (drafts ?? []) as Array<{
      id: string; status: string; section: string; source_module_name: string | null;
      source_question_number: number | null; suggested_answer: string | null; prompt: string;
      has_visual_stimulus: boolean; parser_metadata: Record<string, unknown> | null;
    }>;
    const byStatus: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    let keyed = 0;
    let visual = 0;
    let dup = 0;
    const phantoms: Array<{ n: number | null; mod: string | null; head: string }> = [];
    for (const d of ds) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      const m = d.source_module_name ?? "(bank)";
      byModule[m] = (byModule[m] ?? 0) + 1;
      if (d.suggested_answer) keyed++;
      if (d.has_visual_stimulus) visual++;
      const dupMeta = (d.parser_metadata as { duplicate?: { is_duplicate?: boolean } } | null)?.duplicate;
      if (dupMeta) dup++;
      const hit = PHANTOM_RES.findIndex((re) => re.test(d.prompt));
      if (hit >= 0) phantoms.push({ n: d.source_question_number, mod: d.source_module_name, head: d.prompt.slice(0, 80) });
    }
    rows.push({
      file: imp.original_filename,
      status: imp.status,
      drafts: ds.length,
      keyed,
      visual,
      byStatus,
      byModule,
      dupFlagged: dup,
      phantoms,
    });
    console.log(
      `${imp.original_filename}: drafts=${ds.length} keyed=${keyed} visual=${visual} dup=${dup} phantoms=${phantoms.length} statuses=${JSON.stringify(byStatus)}`,
    );
  }
  const totals = {
    imports: rows.length,
    drafts: rows.reduce((n, r) => n + (r.drafts as number), 0),
    keyed: rows.reduce((n, r) => n + (r.keyed as number), 0),
    phantoms: rows.reduce((n, r) => n + ((r.phantoms as unknown[]).length), 0),
  };
  console.log(`\nTotals: ${totals.imports} imports, ${totals.drafts} drafts, ${totals.keyed} keyed, ${totals.phantoms} phantoms`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ files: rows, totals }, null, 2));
  console.log(`Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
