#!/usr/bin/env tsx
/**
 * Folder ingestion: upload every PDF in a folder to the `pdf-imports`
 * bucket, register a `pdf_imports` row (upload-only workflow: full test,
 * automatic OCR), trigger the worker /process endpoint, and report the
 * stored drafts per file.
 *
 * Usage:
 *   npx tsx scripts/ingest-folder.ts "<folder>" [--out tmp/report.json]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const WORKER_URL = process.env.WORKER_PUBLIC_URL ?? "http://localhost:8000";
const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN ?? "";
if (!SUPABASE_URL || !SERVICE_KEY || !WORKER_AUTH_TOKEN) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / WORKER_AUTH_TOKEN in backend/worker/.env");
  process.exit(1);
}

interface Timings {
  ocrMs: number;
  parserMs: number;
  finalizeMs: number;
  totalMs: number;
}

interface FileResult {
  file: string;
  import_id: string | null;
  status: string;
  pages: number | null;
  method: string | null;
  drafts: number;
  modules: Record<string, number>;
  module_checks: Array<{ module: string; expected: number; actual: number; status: string }>;
  module_keys: Record<string, { total: number; with_key: number }>;
  draft_statuses: Record<string, number>;
  answer_key_status: string | null;
  ocr_provider: string | null;
  ocr_model: string | null;
  ocr_pages_attempted: number;
  ocr_pages_succeeded: number;
  ocr_pages_failed: Array<{ page: number; error: string }>;
  billed_parse_pages: number;
  visual_review: number;
  visual_pages: number[];
  timings_ms: Timings | null;
  warnings: string[];
  error: string | null;
}

function emptyTimings(): Timings {
  return { ocrMs: 0, parserMs: 0, finalizeMs: 0, totalMs: 0 };
}

function fmtModules(m: Record<string, number> | null): string {
  if (!m || Object.keys(m).length === 0) return "—";
  return Object.entries(m)
    .map(([k, n]) => `${k}: ${n}`)
    .join(" | ");
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: npx tsx scripts/ingest-folder.ts "<folder>" [--out tmp/report.json]');
    process.exit(1);
  }
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1]! : null;

  const files = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => path.join(folder, e.name))
    .sort();
  if (files.length === 0) {
    console.error(`No PDFs found in ${folder}`);
    process.exit(1);
  }
  console.log(`Found ${files.length} PDFs in ${folder}`);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: admin } = await supabase.from("profiles").select("id").eq("role", "admin").limit(1).maybeSingle();
  if (!admin) {
    console.error("No admin profile found; cannot set created_by.");
    process.exit(1);
  }

  const results: FileResult[] = [];
  for (const file of files) {
    const name = path.basename(file);
    console.log(`\n=== ${name} ===`);
    const result: FileResult = {
      file: name,
      import_id: null,
      status: "not_started",
      pages: null,
      method: null,
      drafts: 0,
      modules: {},
      module_checks: [],
      module_keys: {},
      draft_statuses: {},
      answer_key_status: null,
      ocr_provider: null,
      ocr_model: null,
      ocr_pages_attempted: 0,
      ocr_pages_succeeded: 0,
      ocr_pages_failed: [],
      billed_parse_pages: 0,
      visual_review: 0,
      visual_pages: [],
      timings_ms: null,
      warnings: [],
      error: null,
    };
    try {
      const buf = fs.readFileSync(file);
      const storagePath = `uploads/${crypto.randomUUID()}.pdf`;
      console.log(`  uploading ${(buf.length / 1024 / 1024).toFixed(1)} MB -> ${storagePath}`);
      const { error: upErr } = await supabase.storage.from("pdf-imports").upload(storagePath, buf, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(`storage upload: ${upErr.message}`);

      // NOTE: register with base columns only. Newer migration columns
      // (ocr_mode, content_scope, target_module, generated_test_id,
      // answer_key_*) may not exist on the target DB yet; the worker
      // always parses the whole PDF and decides OCR itself.
      const { data: imp, error: impErr } = await supabase
        .from("pdf_imports")
        .insert({
          storage_path: storagePath,
          original_filename: name,
          file_size: buf.length,
          created_by: (admin as { id: string }).id,
        })
        .select("id")
        .single();
      if (impErr) throw new Error(`register import: ${impErr.message}`);
      result.import_id = (imp as { id: string }).id;
      console.log(`  import ${result.import_id}; triggering worker...`);

      let workerStatus: string | null = null;
      let workerBody: Record<string, unknown> = {};
      try {
        const resp = await fetch(`${WORKER_URL}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_AUTH_TOKEN}` },
          body: JSON.stringify({ import_id: result.import_id }),
        });
        workerBody = (await resp.json()) as Record<string, unknown>;
        if (!resp.ok) throw new Error(`worker: ${String(workerBody.error ?? resp.status)}`);
        workerStatus = String(workerBody.status ?? "");
        console.log(`  worker: status=${workerStatus} drafts=${String(workerBody.drafts)} method=${String(workerBody.method)}`);
      } catch (e) {
        // Long OCR jobs can drop the HTTP response after the worker already
        // finished. Poll the import row for a terminal status instead.
        console.log(`  process response lost (${e instanceof Error ? e.message : String(e)}); polling import status...`);
        const deadline = Date.now() + 10 * 60 * 1000;
        for (;;) {
          await new Promise((r) => setTimeout(r, 15000));
          const { data: polled } = await supabase.from("pdf_imports").select("status").eq("id", result.import_id).maybeSingle();
          const st = (polled as { status?: string } | null)?.status;
          if (st === "completed" || st === "failed" || st === "cancelled") {
            workerStatus = st;
            console.log(`  polled terminal status: ${st}`);
            break;
          }
          if (Date.now() > deadline) throw new Error(`worker response lost and import still ${st ?? "?"} after 10 min`);
        }
      }

      const rep = (workerBody.report ?? {}) as Record<string, unknown>;
      const { data: row } = await supabase.from("pdf_imports").select("*").eq("id", result.import_id).maybeSingle();
      const r = row as Record<string, unknown> | null;
      const tq = (r?.text_quality ?? {}) as Record<string, unknown>;
      const pick = (a: unknown, b: unknown) => (a !== undefined && a !== null ? a : b);
      result.status = String(pick(rep.status, r?.status ?? workerBody.status ?? "unknown"));
      result.pages = typeof pick(rep.totalPages, r?.page_count) === "number" ? (pick(rep.totalPages, r?.page_count) as number) : null;
      result.method = typeof r?.extraction_method === "string" ? r.extraction_method : typeof workerBody.method === "string" ? workerBody.method : null;
      result.answer_key_status =
        typeof rep.answerKeyStatus === "string"
          ? rep.answerKeyStatus
          : typeof r?.answer_key_status === "string"
            ? r.answer_key_status
            : typeof tq.answer_key_status === "string"
              ? tq.answer_key_status
              : null;
      result.module_checks =
        (rep.moduleChecks as FileResult["module_checks"] | undefined) ??
        (tq.module_checks as FileResult["module_checks"] | undefined) ??
        [];
      result.ocr_provider =
        typeof rep.ocrProvider === "string" ? rep.ocrProvider : typeof tq.ocr_provider === "string" ? tq.ocr_provider : null;
      result.ocr_model = typeof rep.ocrModel === "string" ? rep.ocrModel : typeof tq.ocr_model === "string" ? tq.ocr_model : null;
      result.ocr_pages_attempted =
        typeof rep.ocrPagesAttempted === "number" ? rep.ocrPagesAttempted : typeof tq.ocr_pages === "number" ? tq.ocr_pages : 0;
      result.ocr_pages_succeeded =
        typeof rep.ocrPagesSucceeded === "number" ? rep.ocrPagesSucceeded : typeof tq.ocr_pages_succeeded === "number" ? tq.ocr_pages_succeeded : 0;
      result.ocr_pages_failed =
        (rep.ocrPagesFailed as FileResult["ocr_pages_failed"] | undefined) ??
        (tq.ocr_pages_failed as FileResult["ocr_pages_failed"] | undefined) ??
        [];
      result.billed_parse_pages =
        typeof rep.billedParsePages === "number" ? rep.billedParsePages : typeof tq.billed_parse_pages === "number" ? tq.billed_parse_pages : 0;
      result.visual_review =
        typeof rep.visualReviewQuestions === "number"
          ? rep.visualReviewQuestions
          : typeof tq.visual_review_questions === "number"
            ? tq.visual_review_questions
            : 0;
      result.visual_pages =
        (rep.visualPages as number[] | undefined) ?? (tq.visual_pages as number[] | undefined) ?? [];
      result.timings_ms = (rep.timingsMs as Timings | undefined) ?? (tq.timings_ms as Timings | undefined) ?? null;
      result.warnings = Array.isArray(rep.warnings)
        ? (rep.warnings as string[])
        : Array.isArray(tq.parser_warnings)
          ? (tq.parser_warnings as string[])
          : [];
      if (typeof r?.error_message === "string" && r.error_message) result.error = r.error_message;
      else if (typeof rep.message === "string" && result.status !== "completed") result.error = rep.message;

      // Draft summary: statuses + per-module counts + key coverage
      const PAGE = 1000;
      const drafts: Array<{ status: string; source_module_name: string | null; suggested_answer: string | null }> = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data: batch, error: dErr } = await supabase
          .from("draft_questions")
          .select("status, source_module_name, suggested_answer")
          .eq("pdf_import_id", result.import_id)
          .range(offset, offset + PAGE - 1);
        if (dErr) throw new Error(`read drafts: ${dErr.message}`);
        drafts.push(...((batch ?? []) as typeof drafts));
        if ((batch?.length ?? 0) < PAGE) break;
      }
      result.drafts = drafts.length;
      for (const d of drafts) {
        result.draft_statuses[d.status] = (result.draft_statuses[d.status] ?? 0) + 1;
        const mod = d.source_module_name ?? "Unknown";
        result.modules[mod] = (result.modules[mod] ?? 0) + 1;
        const mk = result.module_keys[mod] ?? { total: 0, with_key: 0 };
        mk.total += 1;
        if (d.suggested_answer) mk.with_key += 1;
        result.module_keys[mod] = mk;
      }
      const t = result.timings_ms ?? emptyTimings();
      console.log(`  stored: ${result.drafts} drafts | modules: ${fmtModules(result.modules)} | key: ${result.answer_key_status ?? "?"} | statuses: ${JSON.stringify(result.draft_statuses)}`);
      console.log(`  Parse OCR (${result.ocr_model ?? "?"}): pages ok=${result.ocr_pages_succeeded}/${result.ocr_pages_attempted} failed=${result.ocr_pages_failed.length} billed=${result.billed_parse_pages}`);
      console.log(`  visual review: ${result.visual_review} questions on pages [${result.visual_pages.join(", ")}]`);
      console.log(`  time: ocr=${fmtMs(t.ocrMs)} parser=${fmtMs(t.parserMs)} finalize=${fmtMs(t.finalizeMs)} total=${fmtMs(t.totalMs)}`);
      if (result.warnings.length > 0) for (const w of result.warnings) console.log(`  warning: ${w}`);
    } catch (e) {
      result.status = "script_error";
      result.error = e instanceof Error ? e.message : String(e);
      console.log(`  ERROR: ${result.error}`);
    }
    results.push(result);
  }

  const summary = {
    folder,
    ingested_at: new Date().toISOString(),
    files: results,
    totals: {
      files: results.length,
      completed: results.filter((r) => r.status === "completed").length,
      failed: results.filter((r) => r.status === "failed" || r.status === "script_error").length,
      drafts: results.reduce((n, r) => n + r.drafts, 0),
    },
  };
  console.log(`\nDone: ${summary.totals.completed}/${summary.totals.files} completed, ${summary.totals.drafts} drafts total.`);
  console.log("\n================ FINAL INGESTION REPORT ================");
  for (const r of results) {
    const t = r.timings_ms ?? emptyTimings();
    console.log(`\n--- ${r.file} ---`);
    console.log(`  status: ${r.status} | import: ${r.import_id ?? "—"} | pages: ${r.pages ?? "—"} | drafts: ${r.drafts}`);
    console.log(`  modules (final): ${fmtModules(r.modules)}`);
    for (const c of r.module_checks) console.log(`    ${c.module}: ${c.actual}/${c.expected} (${c.status})`);
    console.log(`  Parse OCR (${r.ocr_model ?? "?"}): ok=${r.ocr_pages_succeeded}/${r.ocr_pages_attempted} failed=${r.ocr_pages_failed.length} billed=${r.billed_parse_pages}`);
    for (const f of r.ocr_pages_failed) console.log(`    page ${f.page} failed: ${String(f.error).slice(0, 160)}`);
    console.log(`  visual review: ${r.visual_review} questions on pages [${r.visual_pages.join(", ")}]`);
    console.log(`  answer key: ${r.answer_key_status ?? "?"} | per-module: ${JSON.stringify(r.module_keys)}`);
    console.log(`  time: ocr=${fmtMs(t.ocrMs)} | parser=${fmtMs(t.parserMs)} | finalize=${fmtMs(t.finalizeMs)} | total=${fmtMs(t.totalMs)}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    if (r.error) console.log(`  error: ${r.error.slice(0, 300)}`);
  }
  const tot = (f: (t: Timings) => number) => results.reduce((n, r) => n + f(r.timings_ms ?? emptyTimings()), 0);
  console.log(
    `\nTotals: ocr=${fmtMs(tot((t) => t.ocrMs))} parser=${fmtMs(tot((t) => t.parserMs))} finalize=${fmtMs(tot((t) => t.finalizeMs))} total=${fmtMs(tot((t) => t.totalMs))} | Parse pages ok=${results.reduce((n, r) => n + r.ocr_pages_succeeded, 0)} billed=${results.reduce((n, r) => n + r.billed_parse_pages, 0)}`,
  );
  console.log("========================================================\n");
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`Report written to ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
