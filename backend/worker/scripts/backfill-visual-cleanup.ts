#!/usr/bin/env tsx
/**
 * Visual cleanup backfill (safe order matters):
 *
 * Phase A — draft stimulus dedup: rows sharing one stimulus_image_path on the
 * same page/import keep the image only on the row that owns the visual:
 *   1. prompt/passage contains "[figure: …]"/"[table: …]" (strongest), else
 *   2. exactly one row whose prompt/passage references the visual
 *      (graph/table/figure/chart/… cue words), else
 *   3. group left untouched (reported as ambiguous).
 * Cleared rows (non-approved only) get has_visual_stimulus=false,
 * stimulus_image_path=null, and status recomputed from suggested_answer
 * unless parser_metadata.duplicate keeps them at needs_review.
 *
 * Phase B — same dedup for published questions sharing one
 * stimulus_image_path on the same source page (non-owner paths nulled).
 *
 * Phase C — strip ALL visual marker text ("[figure: …]", "[table: …]",
 * "[figure]", "[table]") from draft_questions.prompt/passage_text,
 * draft_question_choices.text, questions.prompt, question_choices.text,
 * and passages.content. No placeholders are left behind.
 *
 * Phase A/B run BEFORE Phase C (markers are the ownership signal).
 *
 * Usage: npx tsx scripts/backfill-visual-cleanup.ts [--apply] [--report <path>]
 * Default is dry-run.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const MARKER_SPAN_RE = /\[(figure|table)(:[^\]]*)?\]/gi;
const MARKER_TEST_RE = /\[(figure|table)\b/i;
const CUE_RE = /\b(data|graph|table|figure|chart|scatterplot|histogram|diagram|plot)\b/i;

function stripMarkers(s: string): string {
  return s
    .replace(MARKER_SPAN_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasMarker(...texts: Array<string | null>): boolean {
  return texts.some((t) => !!t && MARKER_TEST_RE.test(t));
}

function cuesVisual(...texts: Array<string | null>): boolean {
  return texts.some((t) => !!t && CUE_RE.test(t));
}

interface Row {
  id: string;
  prompt: string | null;
  passage: string | null;
}

function pickOwner<T extends Row>(group: T[]): T | null {
  const marked = group.filter((r) => hasMarker(r.prompt, r.passage));
  if (marked.length === 1) return marked[0]!;
  if (marked.length > 1) return null; // ambiguous: multiple markers
  const cued = group.filter((r) => cuesVisual(r.prompt, r.passage));
  if (cued.length === 1) return cued[0]!;
  return null; // ambiguous: none or several
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1]! : "tmp/backfill-visual-cleanup.json";
  const cfg = loadConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });

  const report: Record<string, unknown> = { dry_run: !apply };
  const changes: Array<Record<string, unknown>> = [];
  const ambiguous: Array<Record<string, unknown>> = [];
  const skippedEmpty: Array<Record<string, unknown>> = [];

  // ---------------- Phase A: draft stimulus dedup ----------------
  interface Draft extends Row {
    pdf_import_id: string;
    page_number: number | null;
    source_question_number: number | null;
    status: string;
    suggested_answer: string | null;
    has_visual_stimulus: boolean;
    stimulus_image_path: string | null;
    parser_metadata: Record<string, unknown> | null;
    file: string;
  }
  const drafts: Draft[] = [];
  for (let offset = 0; ; ) {
    const { data, error } = await sb
      .from("draft_questions")
      .select("id,pdf_import_id,page_number,source_question_number,status,suggested_answer,has_visual_stimulus,stimulus_image_path,parser_metadata,prompt,passage_text,pdf_imports(original_filename)")
      .not("stimulus_image_path", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`read drafts: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const d of data as Array<Record<string, unknown> & { pdf_imports?: { original_filename?: string } | null }>) {
      drafts.push({
        id: d.id as string,
        pdf_import_id: d.pdf_import_id as string,
        page_number: (d.page_number as number | null) ?? null,
        source_question_number: (d.source_question_number as number | null) ?? null,
        status: d.status as string,
        suggested_answer: (d.suggested_answer as string | null) ?? null,
        has_visual_stimulus: !!d.has_visual_stimulus,
        stimulus_image_path: d.stimulus_image_path as string | null,
        parser_metadata: (d.parser_metadata as Record<string, unknown> | null) ?? null,
        prompt: (d.prompt as string | null) ?? null,
        passage: (d.passage_text as string | null) ?? null,
        file: d.pdf_imports?.original_filename ?? (d.pdf_import_id as string),
      });
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  const draftGroups = new Map<string, Draft[]>();
  for (const d of drafts) {
    const key = `${d.pdf_import_id}|${d.page_number}|${d.stimulus_image_path}`;
    if (!draftGroups.has(key)) draftGroups.set(key, []);
    draftGroups.get(key)!.push(d);
  }
  let draftGroupsFixed = 0;
  let draftRowsCleared = 0;
  for (const group of draftGroups.values()) {
    if (group.length < 2) continue;
    const owner = pickOwner(group);
    if (!owner) {
      ambiguous.push({ scope: "draft", file: group[0]!.file, page: group[0]!.page_number, rows: group.map((g) => ({ id: g.id, q: g.source_question_number, status: g.status })) });
      continue;
    }
    draftGroupsFixed++;
    for (const r of group) {
      if (r.id === owner.id) continue;
      if (r.status === "approved" || r.status === "rejected") continue; // text strip only
      const isDup = (r.parser_metadata as { duplicate?: { is_duplicate?: boolean } } | null)?.duplicate?.is_duplicate === true;
      const patch: Record<string, unknown> = { has_visual_stimulus: false, stimulus_image_path: null };
      if (r.status === "needs_review" && !isDup) patch.status = r.suggested_answer ? "has_suggested_key" : "missing_key";
      draftRowsCleared++;
      changes.push({ phase: "A-draft-dedup", id: r.id, file: r.file, q: r.source_question_number, kept_by: owner.source_question_number, patch });
      if (apply) {
        const { error: uErr } = await sb.from("draft_questions").update(patch).eq("id", r.id);
        if (uErr) throw new Error(`update draft ${r.id}: ${uErr.message}`);
      }
    }
  }
  report.phaseA = { groups: draftGroups.size, multiRow: [...draftGroups.values()].filter((g) => g.length > 1).length, fixed: draftGroupsFixed, rowsCleared: draftRowsCleared, ambiguous: ambiguous.filter((a) => a.scope === "draft").length };

  // ---------------- Phase B: published stimulus dedup ----------------
  interface Pub extends Row {
    source_pdf_id: string | null;
    source_page: number | null;
    stimulus_image_path: string | null;
  }
  const pubs: Pub[] = [];
  for (let offset = 0; ; ) {
    const { data, error } = await sb
      .from("questions")
      .select("id,source_pdf_id,source_page,stimulus_image_path,prompt,passages(content)")
      .not("stimulus_image_path", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`read questions: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const q of data as Array<Record<string, unknown> & { passages?: { content?: string } | null }>) {
      pubs.push({
        id: q.id as string,
        source_pdf_id: (q.source_pdf_id as string | null) ?? null,
        source_page: (q.source_page as number | null) ?? null,
        stimulus_image_path: q.stimulus_image_path as string | null,
        prompt: (q.prompt as string | null) ?? null,
        passage: q.passages?.content ?? null,
      });
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  const pubGroups = new Map<string, Pub[]>();
  for (const q of pubs) {
    const key = `${q.source_pdf_id}|${q.source_page}|${q.stimulus_image_path}`;
    if (!pubGroups.has(key)) pubGroups.set(key, []);
    pubGroups.get(key)!.push(q);
  }
  let pubGroupsFixed = 0;
  let pubRowsCleared = 0;
  for (const group of pubGroups.values()) {
    if (group.length < 2) continue;
    const owner = pickOwner(group);
    if (!owner) {
      ambiguous.push({ scope: "published", source_pdf_id: group[0]!.source_pdf_id, page: group[0]!.source_page, rows: group.map((g) => g.id) });
      continue;
    }
    pubGroupsFixed++;
    for (const r of group) {
      if (r.id === owner.id) continue;
      pubRowsCleared++;
      changes.push({ phase: "B-published-dedup", id: r.id, kept_by: owner.id });
      if (apply) {
        const { error: uErr } = await sb.from("questions").update({ stimulus_image_path: null }).eq("id", r.id);
        if (uErr) throw new Error(`update question ${r.id}: ${uErr.message}`);
      }
    }
  }
  report.phaseB = { groups: pubGroups.size, multiRow: [...pubGroups.values()].filter((g) => g.length > 1).length, fixed: pubGroupsFixed, rowsCleared: pubRowsCleared, ambiguous: ambiguous.filter((a) => a.scope === "published").length };

  // ---------------- Phase C: strip marker text everywhere ----------------
  let stripped = 0;
  async function stripTable(
    table: string,
    idCol: string,
    fields: Array<{ col: string; nullable: boolean }>,
    extraSelect = "",
    filter?: (row: Record<string, unknown>) => boolean,
  ) {
    for (let offset = 0; ; ) {
      const { data, error } = await sb
        .from(table)
        .select(`id,${fields.map((f) => f.col).join(",")}${extraSelect}`)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(`read ${table}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as Array<Record<string, unknown>>) {
        if (filter && !filter(row)) continue;
        const patch: Record<string, string | null> = {};
        for (const f of fields) {
          const v = row[f.col];
          if (typeof v !== "string" || !MARKER_TEST_RE.test(v)) continue;
          const fixed = stripMarkers(v);
          if (fixed === v) continue;
          if (!fixed && !f.nullable) {
            // Marker-only choice text (graph-as-answer-option): the visual
            // itself is the option, so empty text + label is the honest
            // representation (NOT NULL allows ''). Reported for review.
            skippedEmpty.push({ table, id: row[idCol], col: f.col, emptied: true });
            patch[f.col] = "";
            stripped++;
            changes.push({ phase: "C-strip-empty", table, id: row[idCol], col: f.col, before: (v as string).length });
            continue;
          }
          patch[f.col] = fixed || null;
          stripped++;
          changes.push({ phase: "C-strip", table, id: row[idCol], col: f.col, before: (v as string).length, after: fixed.length });
        }
        if (apply && Object.keys(patch).length > 0) {
          const { error: uErr } = await sb.from(table).update(patch).eq("id", row[idCol] as string);
          if (uErr) throw new Error(`update ${table} ${row[idCol]}: ${uErr.message}`);
        }
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  const markerLike = (row: Record<string, unknown>) =>
    fieldsSome(row, ["prompt", "passage_text", "text", "content"]);
  function fieldsSome(row: Record<string, unknown>, cols: string[]): boolean {
    return cols.some((c) => typeof row[c] === "string" && MARKER_TEST_RE.test(row[c] as string));
  }

  await stripTable("draft_questions", "id", [
    { col: "prompt", nullable: false },
    { col: "passage_text", nullable: true },
  ], "", markerLike);
  await stripTable("draft_question_choices", "id", [{ col: "text", nullable: false }], "", markerLike);
  await stripTable("questions", "id", [{ col: "prompt", nullable: false }], "", markerLike);
  await stripTable("question_choices", "id", [{ col: "text", nullable: false }], "", markerLike);
  await stripTable("passages", "id", [{ col: "content", nullable: false }], "", markerLike);
  report.phaseC = { fieldsStripped: stripped, skippedEmpty: skippedEmpty.length };

  report.changes = changes.length;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ ...report, ambiguous, skippedEmpty, changes }, null, 2));
  console.log(`${apply ? "Applied" : "Would apply"}: A fixed ${draftGroupsFixed} draft groups (${draftRowsCleared} rows cleared), B fixed ${pubGroupsFixed} published groups (${pubRowsCleared} rows cleared), C stripped ${stripped} fields, ${ambiguous.length} ambiguous, ${skippedEmpty.length} skipped-empty. Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
