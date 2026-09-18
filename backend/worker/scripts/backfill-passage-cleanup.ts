#!/usr/bin/env tsx
/**
 * Surgical backfill: strip "[figure: ...]" / "[table: ...]" descriptor spans
 * from stored draft passage_text (existing PASS imports are NOT reimported).
 * Prompts, keys, choices, modules, and statuses are untouched.
 *
 * Usage: npx tsx scripts/backfill-passage-cleanup.ts [--apply] [--report <path>]
 * Default is dry-run.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const MARKER_SPAN_RE = /\[(figure|table):[^\]]*\]/gi;
/** Stateless test (module-level /g/ regexes keep lastIndex between calls). */
const MARKER_TEST_RE = /\[(figure|table):[^\]]*\]/i;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : "tmp/backfill-passage-cleanup.json";
  const cfg = loadConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  let offset = 0;
  let checked = 0;
  const changed: Array<{ id: string; file: string; before: number; after: number }> = [];
  const fileNames = new Map<string, string>();
  for (;;) {
    const { data, error } = await sb
      .from("draft_questions")
      .select("id,pdf_import_id,passage_text")
      .not("passage_text", "is", null)
      .range(offset, offset + 999);
    if (error) throw new Error(`read drafts: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const d of data as Array<{ id: string; pdf_import_id: string; passage_text: string }>) {
      checked++;
      if (!MARKER_TEST_RE.test(d.passage_text)) continue;
      const cleaned = d.passage_text.replace(MARKER_SPAN_RE, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!fileNames.has(d.pdf_import_id)) {
        const { data: im } = await sb.from("pdf_imports").select("original_filename").eq("id", d.pdf_import_id).maybeSingle();
        fileNames.set(d.pdf_import_id, (im as { original_filename?: string } | null)?.original_filename ?? d.pdf_import_id);
      }
      changed.push({ id: d.id, file: fileNames.get(d.pdf_import_id)!, before: d.passage_text.length, after: cleaned.length });
      if (apply) {
        const { error: uErr } = await sb.from("draft_questions").update({ passage_text: cleaned || null }).eq("id", d.id);
        if (uErr) throw new Error(`update ${d.id}: ${uErr.message}`);
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ dry_run: !apply, checked, changed: changed.length, rows: changed }, null, 2));
  console.log(`${apply ? "Cleaned" : "Would clean"} ${changed.length}/${checked} passages. Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
