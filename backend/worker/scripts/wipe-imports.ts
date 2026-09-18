#!/usr/bin/env tsx
/**
 * Wipe pdf_imports rows (cascades to pages/drafts/choices/keys; sources are
 * set-null) plus their stimulus images, for a stale parser run.
 *
 * Usage:
 *   npx tsx scripts/wipe-imports.ts "<original_filename>" [...] [--report <path>]
 *   Filenames match exactly (original_filename column).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

async function main() {
  const args = process.argv.slice(2);
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : "tmp/wipe-report.json";
  const names = args.filter((a, i) => !(a === "--report" || (repIdx >= 0 && i === repIdx + 1)));
  if (names.length === 0) throw new Error('usage: wipe-imports.ts "<filename>" [...] [--report <path>]');

  const cfg = loadConfig();
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  // Safety: refuse if any final questions were built from these imports.
  const { data: imps, error: iErr } = await supabase.from("pdf_imports").select("id,original_filename,status").in("original_filename", names);
  if (iErr) throw new Error(`list imports: ${iErr.message}`);
  const ids = (imps ?? []).map((r) => r.id as string);
  console.log(`matched ${ids.length} imports`);
  if (ids.length > 0) {
    const { count: linked } = await supabase.from("questions").select("id", { count: "exact", head: true }).in("source_pdf_id", ids);
    if ((linked ?? 0) > 0) throw new Error(`REFUSING: ${linked} final questions linked to these imports (approve flow ran)`);
    const { count: drafts } = await supabase.from("draft_questions").select("id", { count: "exact", head: true }).in("pdf_import_id", ids);
    console.log(`drafts to delete: ${drafts ?? 0}`);
  }

  const removed: Array<{ id: string; file: string }> = [];
  for (const imp of imps ?? []) {
    const id = imp.id as string;
    // Remove stimulus images first (best-effort).
    try {
      const { data: objs } = await supabase.storage.from("question-assets").list(`imports/${id}/stimuli`);
      if (objs && objs.length > 0) {
        await supabase.storage.from("question-assets").remove(objs.map((o) => `imports/${id}/stimuli/${o.name}`));
      }
    } catch (e) {
      console.warn(`  stimulus cleanup warning for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const { error: dErr } = await supabase.from("pdf_imports").delete().eq("id", id);
    if (dErr) throw new Error(`delete import ${id}: ${dErr.message}`);
    removed.push({ id, file: imp.original_filename as string });
    console.log(`  wiped ${imp.original_filename} (${id})`);
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ wiped_at: new Date().toISOString(), removed }, null, 2));
  console.log(`Wiped ${removed.length} imports. Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
