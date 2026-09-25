#!/usr/bin/env tsx
/**
 * Reproducible, read-only baseline and parser replay for the fixed partial-import
 * cohort. Output is kept under ignored worker/tmp/refinement/. No live rows are
 * changed by either command.
 *
 *   npx tsx scripts/refine-imports.ts snapshot
 *   npx tsx scripts/refine-imports.ts replay
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { summarizePdfImportReadiness, type ImportReadinessDraft } from "../../supabase/functions/_shared/importReadiness.ts";
import { loadConfig } from "../src/config.ts";
import { extractText, type PageText } from "../src/extractor.ts";
import { normalizeText } from "../src/textNormalize.ts";
import { Pipeline } from "../src/pipeline.ts";

const workerRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(workerRoot, "../..");
const pdfRoot = path.join(repoRoot, "Tests Unparsed");
const ocrRoot = path.join(pdfRoot, "post_ocr");
const outRoot = path.join(workerRoot, "tmp", "refinement");
const manifestPath = path.join(outRoot, "cohort.json");
const replayPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(outRoot, "replay-current.json");

type Row = Record<string, any>;
type Source = { pdf: string | null; pdfSha256: string | null; ocr: string | null; ocrSha256: string | null; storedPages: PageText[] | null };
type ImportRecord = { row: Row; readiness: ReturnType<typeof summarizePdfImportReadiness>; drafts: Row[]; source: Source };
type Manifest = { capturedAt: string; gitHead: string; parserFiles: Record<string, string>; importsTotal: number; draftsTotal: number; cohort: ImportRecord[]; controls: ImportRecord[]; statusPairs: Record<string, number> };

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function allFiles(root: string, suffix: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map((item) => path.join(root, String(item)))
    .filter((item) => item.toLowerCase().endsWith(suffix));
}

function onlyMatching(files: string[], name: string): string | null {
  const matches = files.filter((file) => path.basename(file).toLowerCase() === name.toLowerCase());
  if (matches.length > 1) throw new Error(`ambiguous local source for ${name}: ${matches.join(", ")}`);
  return matches[0] ?? null;
}

function parseSavedOcr(file: string): PageText[] {
  const parts = readFileSync(file, "utf8").split(/^===== PAGE (\d+) =====\s*$/m);
  const pages: PageText[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
  }
  if (!pages.length) throw new Error(`no page markers in ${file}`);
  return pages;
}

async function pagedRows(sb: ReturnType<typeof createClient>, table: string, select: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from(table).select(select).range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

async function storedPages(sb: ReturnType<typeof createClient>, id: string): Promise<PageText[] | null> {
  const { data, error } = await sb.from("pdf_import_pages")
    .select("page_number,extracted_text")
    .eq("pdf_import_id", id)
    .order("page_number");
  if (error) throw new Error(`pdf_import_pages ${id}: ${error.message}`);
  const pages = (data ?? []).map((page) => ({ pageNumber: page.page_number as number, text: String(page.extracted_text ?? "") }));
  return pages.some((page) => page.text.trim()) ? pages : null;
}

function parserFileHashes(): Record<string, string> {
  const files = [
    "backend/worker/src/pipeline.ts", "backend/worker/src/fullTestParser.ts",
    "backend/worker/src/scraperParser.ts", "backend/worker/src/answerKey.ts",
    "backend/worker/src/questionBankParser.ts", "backend/worker/src/ocr.ts",
    "backend/supabase/functions/_shared/importReadiness.ts",
  ];
  return Object.fromEntries(files.map((file) => [file, sha256(readFileSync(path.join(repoRoot, file)))]));
}

async function snapshot(): Promise<void> {
  const cfg = loadConfig();
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  const imports = await pagedRows(sb, "pdf_imports", "*");
  const summaryDrafts = await pagedRows(sb, "draft_questions",
    "id,pdf_import_id,status,page_number,section,source_question_number,source_module_name,source_module_position,suggested_answer,parser_metadata,created_at,answer_keys:draft_answer_keys(detected_answer,status)");
  const byImport = new Map<string, Row[]>();
  for (const draft of summaryDrafts) {
    const list = byImport.get(draft.pdf_import_id) ?? [];
    list.push(draft);
    byImport.set(draft.pdf_import_id, list);
  }
  const pdfFiles = allFiles(pdfRoot, ".pdf");
  const ocrFiles = allFiles(ocrRoot, ".ocr.txt");
  const cohort: ImportRecord[] = [];
  const controls: ImportRecord[] = [];
  const statusPairs: Record<string, number> = {};
  const selected: Array<{ row: Row; readiness: ReturnType<typeof summarizePdfImportReadiness>; target: "cohort" | "control" }> = [];
  for (const row of imports) {
    const readiness = summarizePdfImportReadiness({
      importStatus: String(row.status),
      drafts: (byImport.get(row.id) ?? []) as ImportReadinessDraft[],
      rawKeyEntries: row.text_quality?.key_entries,
    });
    const pair = `${readiness.questions.status}/${readiness.answer_key.status}`;
    statusPairs[pair] = (statusPairs[pair] ?? 0) + 1;
    if (readiness.questions.status === "partial" || readiness.answer_key.status === "partial") selected.push({ row, readiness, target: "cohort" });
    else if (pair === "complete/complete") selected.push({ row, readiness, target: "control" });
  }
  for (const { row, readiness, target } of selected) {
    const base = String(row.original_filename).replace(/\.pdf$/i, "");
    const pdf = onlyMatching(pdfFiles, `${base}.pdf`);
    const ocr = onlyMatching(ocrFiles, `${base}.ocr.txt`);
    const { data, error } = await sb.from("draft_questions")
      .select("id,pdf_import_id,status,question_id,page_number,section,question_type,prompt,passage_text,source_question_number,source_module_name,source_module_position,source_question_id,suggested_answer,answer_confidence,parser_metadata,created_at,updated_at,stimulus_image_path,answer_keys:draft_answer_keys(*),choices:draft_question_choices(*)")
      .eq("pdf_import_id", row.id)
      .order("page_number")
      .order("source_question_number")
      .order("created_at")
      .order("id");
    if (error) throw new Error(`drafts ${row.id}: ${error.message}`);
    const record: ImportRecord = {
      row,
      readiness,
      drafts: (data ?? []) as Row[],
      source: {
        pdf: pdf ? path.relative(repoRoot, pdf).replaceAll("\\", "/") : null,
        pdfSha256: pdf ? sha256(readFileSync(pdf)) : null,
        ocr: ocr ? path.relative(repoRoot, ocr).replaceAll("\\", "/") : null,
        ocrSha256: ocr ? sha256(readFileSync(ocr)) : null,
        storedPages: ocr ? null : await storedPages(sb, row.id),
      },
    };
    (target === "cohort" ? cohort : controls).push(record);
  }
  const manifest: Manifest = {
    capturedAt: new Date().toISOString(),
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    parserFiles: parserFileHashes(),
    importsTotal: imports.length,
    draftsTotal: summaryDrafts.length,
    cohort,
    controls,
    statusPairs,
  };
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ path: manifestPath, capturedAt: manifest.capturedAt, imports: imports.length,
    drafts: summaryDrafts.length, cohort: cohort.length, controls: controls.length, statusPairs,
    sources: { savedOcr: cohort.filter((r) => r.source.ocr).length,
      storedPages: cohort.filter((r) => !r.source.ocr && r.source.storedPages).length,
      pdfOnly: cohort.filter((r) => !r.source.ocr && !r.source.storedPages).length },
  }));
}

async function sourcePages(record: ImportRecord): Promise<{ pages: PageText[]; kind: string }> {
  const newOcr = path.join(outRoot, `new-ocr-${record.row.id}.json`);
  if (existsSync(newOcr)) {
    const saved = JSON.parse(readFileSync(newOcr, "utf8")) as { pdfSha256: string; pages: PageText[] };
    if (saved.pdfSha256 !== record.source.pdfSha256) throw new Error(`new OCR PDF hash mismatch: ${record.row.original_filename}`);
    return { pages: saved.pages, kind: "new_ocr" };
  }
  if (record.source.ocr) return { pages: parseSavedOcr(path.join(repoRoot, record.source.ocr)), kind: "saved_ocr" };
  if (record.source.storedPages) return { pages: record.source.storedPages, kind: "stored_page_text" };
  if (record.source.pdf) return { pages: await extractText(new Uint8Array(readFileSync(path.join(repoRoot, record.source.pdf)))), kind: "pdf_selectable_text" };
  throw new Error(`no source for ${record.row.original_filename}`);
}

async function replay(): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const cfg = loadConfig();
  const pipeline = new Pipeline({ supabaseUrl: cfg.supabaseUrl, supabaseServiceKey: cfg.supabaseServiceKey,
    cohereApiKeys: cfg.cohereApiKeys, cohereKeyPageCap: cfg.cohereKeyPageCap,
    ocrModel: cfg.ocrModel, ocrProvider: cfg.ocrProvider, ocrMode: cfg.ocrMode });
  const results: Row[] = [];
  for (const record of [...manifest.cohort, ...manifest.controls]) {
    const start = performance.now();
    try {
      const { pages, kind } = await sourcePages(record);
      // The worker's own parser selection and key matcher are used here. The
      // methods are private at the type level, but have no write side effects.
      const parsed = (pipeline as any).parseAll(normalizeText(pages), "full_test");
      const matched = (pipeline as any).matchAnswers(parsed);
      const simulated: ImportReadinessDraft[] = parsed.questions.map((q: Row, index: number) => ({
        id: `replay-${String(index).padStart(4, "0")}`,
        page_number: q.pageNumber,
        section: q.section,
        source_question_number: q.sourceQuestionNumber > 0 ? q.sourceQuestionNumber : null,
        source_module_name: q.sourceModuleName,
        source_module_position: q.sourceModulePosition,
        suggested_answer: q.correctAnswer ?? matched.answers[index]?.answer ?? null,
        parser_metadata: { parse_flags: q.parseFlags },
        created_at: new Date(index * 1000).toISOString(),
        answer_keys: matched.answers[index] ? [{ detected_answer: matched.answers[index].answer, status: "suggested" }] : [],
      }));
      const readiness = summarizePdfImportReadiness({ importStatus: "completed", drafts: simulated, rawKeyEntries: matched.keyEntries });
      const flags: Record<string, number> = {};
      for (const q of parsed.questions as Row[]) for (const flag of q.parseFlags as string[]) flags[flag] = (flags[flag] ?? 0) + 1;
      const lowKeyMatches = matched.answers.filter((answer: Row | null) => answer?.confidence === "low").length;
      const result = { id: record.row.id, name: record.row.original_filename, sourceKind: kind, pages: pages.length,
        live: record.readiness, replay: readiness, parser: parsed.bank ? "bank" : parsed.fullTest?.questions?.length ? "full_test" : parsed.scraper?.questions?.length ? "scraper" : "legacy",
        documentFamily: parsed.fullTest?.documentFamily ?? (parsed.bank ? "question_bank" : null),
        keyEntries: matched.keyEntries, unmatchedKeys: matched.unmatchedKeyEntries.length, lowKeyMatches,
        flags, elapsedMs: Math.round(performance.now() - start),
        issues: (parsed.questions as Row[]).filter((q) => q.parseFlags.length > 0 || q.sourceQuestionNumberOrigin === "inferred")
          .map((q) => ({ page: q.pageNumber, module: q.sourceModuleName, number: q.sourceQuestionNumber,
            flags: q.parseFlags, prompt: String(q.prompt).slice(0, 160) })).slice(0, 50),
        questions: (parsed.questions as Row[]).map((q, index) => ({ page: q.pageNumber, module: q.sourceModuleName,
          number: q.sourceQuestionNumber, origin: q.sourceQuestionNumberOrigin, flags: q.parseFlags,
          sourceGlobalQuestionId: q.sourceGlobalQuestionId ?? null,
          prompt: q.prompt, passage: q.passageText, choices: q.choices, answer: q.correctAnswer ?? matched.answers[index]?.answer ?? null,
          keyMethod: matched.answers[index]?.method ?? null, keyConfidence: matched.answers[index]?.confidence ?? null })),
      };
      results.push(result);
      console.log(`${record.row.original_filename}: ${kind} ${readiness.questions.actual}/98 Q (${readiness.questions.status}), ${readiness.answer_key.actual}/98 K (${readiness.answer_key.status}), flags=${Object.values(flags).reduce((a, b) => a + b, 0)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ id: record.row.id, name: record.row.original_filename, error: message });
      console.error(`${record.row.original_filename}: ERROR ${message}`);
    }
  }
  const report = { generatedAt: new Date().toISOString(), baselineAt: manifest.capturedAt,
    parserFiles: parserFileHashes(), results };
  writeFileSync(replayPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ path: replayPath, total: results.length, errors: results.filter((r) => r.error).length }));
}

const command = process.argv[2];
if (command === "snapshot") await snapshot();
else if (command === "replay") await replay();
else throw new Error("usage: refine-imports.ts snapshot|replay");
