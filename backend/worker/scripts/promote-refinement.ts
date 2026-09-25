#!/usr/bin/env tsx
/**
 * Internal, guarded live-import replay. Never run this on an arbitrary import:
 * its ID must be in the frozen cohort.json and its source hash must still match.
 *
 *   npx tsx scripts/promote-refinement.ts stage <import-id>
 *   npx tsx scripts/promote-refinement.ts promote <import-id>
 *
 * Staging writes under a temporary import. Promotion backs up every original
 * row, moves old rows to a backup import, moves staged rows into the original,
 * verifies counts and details, and only then deletes the temporary imports.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { summarizePdfImportReadiness, type ImportReadinessDraft } from "../../supabase/functions/_shared/importReadiness.ts";
import { readinessPromotionDecision } from "../src/refinementReadiness.ts";
import { loadConfig } from "../src/config.ts";
import { extractText, type PageText } from "../src/extractor.ts";
import { Pipeline, type PageVisualInfo } from "../src/pipeline.ts";

type Row = Record<string, any>;
type Record_ = { row: Row; drafts: Row[]; source: { pdf: string | null; pdfSha256: string | null; ocr: string | null; ocrSha256: string | null; storedPages: PageText[] | null } };
const workerRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(workerRoot, "../..");
const outRoot = path.join(workerRoot, "tmp", "refinement");
const manifest = JSON.parse(readFileSync(path.join(outRoot, "cohort.json"), "utf8")) as { cohort: Record_[] };
const config = loadConfig();
const sb = createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
const pipeline = new Pipeline({ supabaseUrl: config.supabaseUrl, supabaseServiceKey: config.supabaseServiceKey,
  cohereApiKeys: config.cohereApiKeys, cohereKeyPageCap: config.cohereKeyPageCap,
  ocrModel: config.ocrModel, ocrProvider: config.ocrProvider, ocrMode: config.ocrMode });

function sha(bytes: Buffer | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function fail(message: string): never { throw new Error(message); }
function getRecord(id: string): Record_ {
  return manifest.cohort.find((r) => r.row.id === id) ?? fail(`not in frozen 36-import cohort: ${id}`);
}
function parseOcr(file: string): PageText[] {
  const parts = readFileSync(file, "utf8").split(/^===== PAGE (\d+) =====\s*$/m);
  const pages: PageText[] = [];
  for (let i = 1; i < parts.length; i += 2) pages.push({ pageNumber: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
  return pages;
}
async function rows(table: string, select: string, column: string, id: string): Promise<Row[]> {
  const result: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await sb.from(table).select(select).eq(column, id).range(start, start + 999);
    if (error) fail(`${table}: ${error.message}`);
    result.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < 1000) return result;
  }
}
async function importRow(id: string): Promise<Row> {
  const { data, error } = await sb.from("pdf_imports").select("*").eq("id", id).single();
  if (error || !data) fail(`import ${id}: ${error?.message ?? "not found"}`);
  return data as Row;
}
async function fullDrafts(id: string): Promise<Row[]> {
  return rows("draft_questions", "*,answer_keys:draft_answer_keys(*),choices:draft_question_choices(*)", "pdf_import_id", id);
}
function stableDrafts(items: Row[], shape?: Row): string {
  const keys = shape ? Object.keys(shape) : null;
  const clean = items.map((item) => ({ ...(keys ? Object.fromEntries(keys.map((key) => [key, item[key]])) : item),
    answer_keys: [...(item.answer_keys ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    choices: [...(item.choices ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return sha(JSON.stringify(clean));
}
async function checkOriginal(record: Record_): Promise<void> {
  const now = await importRow(record.row.id);
  if (now.updated_at !== record.row.updated_at) fail(`original import was edited after baseline (${now.updated_at})`);
  if (stableDrafts(await fullDrafts(record.row.id), record.drafts[0]) !== stableDrafts(record.drafts, record.drafts[0])) fail("original drafts/choices/keys changed after baseline");
}
async function createTemporary(prefix: string, original: Row): Promise<Row> {
  const { data, error } = await sb.from("pdf_imports").insert({
    storage_path: `refinement/${prefix}/${crypto.randomUUID()}.pdf`,
    original_filename: `${prefix} ${original.original_filename}`,
    file_size: original.file_size,
    status: "uploaded",
    text_quality: { refinement_temp: prefix, original_import_id: original.id },
  }).select("*").single();
  if (error || !data) fail(`create ${prefix}: ${error?.message ?? "missing row"}`);
  return data as Row;
}
async function source(record: Record_): Promise<{ pages: PageText[]; pdf: Uint8Array; visuals: Record<number, PageVisualInfo>; kind: string }> {
  if (!record.source.pdf) fail("local PDF missing");
  const pdf = readFileSync(path.join(repoRoot, record.source.pdf));
  if (sha(pdf) !== record.source.pdfSha256) fail("PDF checksum changed since baseline");
  let pages: PageText[];
  let kind: string;
  const newOcrPath = path.join(outRoot, `new-ocr-${record.row.id}.json`);
  const newOcr = existsSync(newOcrPath) ? JSON.parse(readFileSync(newOcrPath, "utf8")) as Row : null;
  if (newOcr) {
    if (newOcr.pdfSha256 !== record.source.pdfSha256 || newOcr.pages.some((page: Row) => page.error)) {
      fail("new OCR has a PDF hash mismatch or page failure");
    }
    pages = newOcr.pages.map((page: Row) => ({ pageNumber: page.pageNumber, text: page.text }));
    kind = "new_ocr";
  } else if (record.source.ocr) {
    const file = path.join(repoRoot, record.source.ocr);
    if (sha(readFileSync(file)) !== record.source.ocrSha256) fail("OCR checksum changed since baseline");
    pages = parseOcr(file); kind = "saved_ocr";
  } else if (record.source.storedPages) {
    pages = record.source.storedPages; kind = "stored_page_text";
  } else {
    pages = await extractText(new Uint8Array(pdf)); kind = "pdf_selectable_text";
  }
  const visuals: Record<number, PageVisualInfo> = {};
  if (newOcr) {
    for (const page of newOcr.pages as Row[]) {
      if (!(page.visuals ?? []).length) continue;
      const visualBlocks = page.visuals as Row[];
      visuals[Number(page.pageNumber)] = {
        imageCount: visualBlocks.filter((block) => block.kind === "image").length,
        tableCount: visualBlocks.filter((block) => block.kind === "table").length,
        notes: visualBlocks.map((block) => `${block.kind}: ${block.description ?? block.category ?? "visual"}`),
        boxes: visualBlocks.map((block) => ({ kind: block.kind, description: block.description ?? null,
          category: block.category ?? null, bbox: block.bbox ?? null, bboxNormalized: block.bboxNormalized ?? null })),
      };
    }
  }
  if (record.source.ocr) {
    const parseFile = path.join(path.dirname(path.join(repoRoot, record.source.ocr)),
      path.basename(record.source.ocr).replace(/\.ocr\.txt$/i, ".parse.json"));
    if (existsSync(parseFile)) {
      const parsed = JSON.parse(readFileSync(parseFile, "utf8")) as { pages?: Row[] };
      for (const page of parsed.pages ?? []) {
        if (!page.imageCount && !page.tableCount) continue;
        visuals[Number(page.page)] = {
          imageCount: Number(page.imageCount ?? 0), tableCount: Number(page.tableCount ?? 0),
          notes: (page.visuals ?? []).map((v: Row) => `${v.kind}: ${v.description ?? v.category ?? "visual"}`),
          boxes: (page.visuals ?? []).map((v: Row) => ({ kind: v.kind, description: v.description ?? null,
            category: v.category ?? null, bbox: v.bbox ?? null, bboxNormalized: v.bboxNormalized ?? null })),
        };
      }
    }
  }
  return { pages, pdf: new Uint8Array(pdf), visuals, kind };
}
function readiness(row: Row, drafts: Row[]) {
  return summarizePdfImportReadiness({ importStatus: row.status, drafts: drafts as ImportReadinessDraft[],
    rawKeyEntries: row.text_quality?.key_entries });
}
async function stage(record: Record_): Promise<void> {
  await checkOriginal(record);
  const { pages, pdf, visuals, kind } = await source(record);
  const temp = await createTemporary("__refine_stage__", record.row);
  const statePath = path.join(outRoot, `stage-${record.row.id}.json`);
  writeFileSync(statePath, JSON.stringify({ originalId: record.row.id, stageId: temp.id, sourceKind: kind,
    startedAt: new Date().toISOString(), state: "ingesting" }, null, 2));
  const result = await pipeline.importSavedOcr(temp.id, pages, visuals, pdf);
  const staged = await importRow(temp.id);
  const drafts = await fullDrafts(temp.id);
  const summary = readiness(staged, drafts);
  const stageState = { originalId: record.row.id, stageId: temp.id, sourceKind: kind, state: "staged",
    completedAt: new Date().toISOString(), result, summary, draftCount: drafts.length,
    draftHash: stableDrafts(drafts), originalDraftHash: stableDrafts(record.drafts, record.drafts[0]) };
  writeFileSync(statePath, JSON.stringify(stageState, null, 2));
  console.log(JSON.stringify({ statePath, stageId: temp.id, result, summary, draftCount: drafts.length }));
}
async function move(table: string, fromId: string, toId: string): Promise<number> {
  const before = await rows(table, "id", "pdf_import_id", fromId);
  for (let start = 0; start < before.length; start += 100) {
    const ids = before.slice(start, start + 100).map((item) => item.id);
    const { data, error } = await sb.from(table).update({ pdf_import_id: toId })
      .eq("pdf_import_id", fromId).in("id", ids).select("id");
    if (error || data?.length !== ids.length) fail(`move ${table} batch ${start}: ${error?.message ?? "affected-row count mismatch"}`);
  }
  const after = await rows(table, "id", "pdf_import_id", toId);
  const have = new Set(after.map((r) => r.id));
  if (before.some((r) => !have.has(r.id))) fail(`move ${table}: target is missing moved rows`);
  return before.length;
}
async function deleteTemp(id: string): Promise<void> {
  const { error } = await sb.from("pdf_imports").delete().eq("id", id);
  if (error) fail(`delete temporary import ${id}: ${error.message}`);
}
async function discard(record: Record_): Promise<void> {
  const statePath = path.join(outRoot, `stage-${record.row.id}.json`);
  if (!existsSync(statePath)) fail("no staging state to discard");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as Row;
  if (state.state !== "staged" && state.state !== "ingesting") fail(`cannot discard state ${state.state}`);
  const temp = await importRow(state.stageId);
  if (!String(temp.original_filename).startsWith("__refine_stage__ ") ||
      !String(temp.storage_path).startsWith("refinement/__refine_stage__/") ||
      state.originalId !== record.row.id) fail("staging import identity mismatch");
  await deleteTemp(state.stageId);
  writeFileSync(statePath, JSON.stringify({ ...state, state: "discarded", discardedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ discardedStageId: state.stageId, originalId: record.row.id }));
}
async function promote(record: Record_): Promise<void> {
  const statePath = path.join(outRoot, `stage-${record.row.id}.json`);
  if (!existsSync(statePath)) fail("not staged; run stage first");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as Row;
  if (state.state !== "staged") fail(`stage state is ${state.state}; refusing promotion`);
  await checkOriginal(record);
  const staged = await importRow(state.stageId);
  const stagedDrafts = await fullDrafts(state.stageId);
  if (staged.status !== "completed" || stableDrafts(stagedDrafts) !== state.draftHash) fail("staged rows changed or not completed");
  const auditPath = path.join(outRoot, `audit-${record.row.id}.json`);
  if (!existsSync(auditPath)) fail("source/content audit missing; run audit-refinement.ts first");
  const audit = JSON.parse(readFileSync(auditPath, "utf8")) as Row;
  if (!audit.accepted || audit.stageId !== state.stageId || audit.stageDrafts !== stagedDrafts.length) {
    fail("source/content audit not accepted for this staging run");
  }
  const stageSummary = readiness(staged, stagedDrafts);
  if (JSON.stringify(stageSummary) !== JSON.stringify(state.summary)) fail("staged summary changed");
  const baseline = readiness(record.row, record.drafts);
  const promotionDecision = readinessPromotionDecision(baseline, stageSummary,
    Number(audit.verifiedDuplicateRemoval ?? 0));
  if (!promotionDecision.allowed) fail(`${promotionDecision.reason}; inspect source before promotion`);
  const originalPages = await rows("pdf_import_pages", "*", "pdf_import_id", record.row.id);
  const stagedPages = await rows("pdf_import_pages", "*", "pdf_import_id", state.stageId);
  const linkedIds = [...new Set(record.drafts.map((draft) => draft.question_id).filter(Boolean))];
  const linkedQuestions = linkedIds.length ? await (async () => {
    const { data, error } = await sb.from("questions").select("*").in("id", linkedIds);
    if (error || data?.length !== linkedIds.length) fail(`load linked questions: ${error?.message ?? "count mismatch"}`);
    return (data ?? []) as Row[];
  })() : [];
  const linkedHash = sha(JSON.stringify([...linkedQuestions].sort((a, b) => a.id.localeCompare(b.id))));
  const backupPath = path.join(outRoot, `backup-${record.row.id}-${Date.now()}.json`);
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(backupPath, JSON.stringify({ originalImport: await importRow(record.row.id), drafts: await fullDrafts(record.row.id),
    pages: originalPages, linkedQuestions, stageImport: staged, stageDrafts: stagedDrafts, stagePages: stagedPages }, null, 2));
  const backup = await createTemporary("__refine_backup__", record.row);
  const journalPath = path.join(outRoot, `promotion-${record.row.id}.json`);
  const journal: Row = { originalId: record.row.id, stageId: state.stageId, backupId: backup.id,
    backupPath, state: "created_backup", steps: [], startedAt: new Date().toISOString() };
  const save = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  save();
  try {
    // Guard the import row first. The DB trigger changes updated_at; that is
    // expected from this point onward. Retest draft content just before moves.
    const { data: locked, error: lockErr } = await sb.from("pdf_imports").update({ status: "parsing" })
      .eq("id", record.row.id).eq("updated_at", record.row.updated_at).select("id");
    if (lockErr || locked?.length !== 1) fail(`original changed during staging: ${lockErr?.message ?? "timestamp mismatch"}`);
    journal.steps.push("original_status_parsing"); save();
    if (stableDrafts(await fullDrafts(record.row.id), record.drafts[0]) !== state.originalDraftHash) fail("admin draft edits detected before move");
    for (const table of ["draft_questions", "pdf_import_pages"]) {
      const count = await move(table, record.row.id, backup.id);
      journal.steps.push(`original_${table}_backed_up_${count}`); save();
    }
    for (const table of ["draft_questions", "pdf_import_pages"]) {
      const count = await move(table, state.stageId, record.row.id);
      journal.steps.push(`stage_${table}_promoted_${count}`); save();
    }
    const { error: importErr } = await sb.from("pdf_imports").update({
      status: "completed", page_count: staged.page_count, extraction_method: staged.extraction_method,
      text_quality: staged.text_quality, answer_key_status: staged.answer_key_status,
      answer_key_summary: staged.answer_key_summary, error_message: null,
    }).eq("id", record.row.id);
    if (importErr) fail(`update import summary: ${importErr.message}`);
    journal.steps.push("summary_promoted"); save();
    const actual = await importRow(record.row.id);
    const actualDrafts = await fullDrafts(record.row.id);
    const actualPages = await rows("pdf_import_pages", "id", "pdf_import_id", record.row.id);
    const actualSummary = readiness(actual, actualDrafts);
    if (actualDrafts.length !== stagedDrafts.length || actualPages.length !== stagedPages.length ||
      JSON.stringify(actualSummary) !== JSON.stringify(stageSummary)) fail("post-promotion verification failed");
    // Detail check: every staged draft ID, child row, and source position is
    // still present. pdf_import_id and updated_at legitimately changed.
    const stagedIds = new Set(stagedDrafts.map((q) => q.id));
    if (actualDrafts.some((q) => !stagedIds.has(q.id)) || actualDrafts.length !== stagedIds.size) fail("draft-detail identity mismatch");
    if (linkedIds.length) {
      const { data, error } = await sb.from("questions").select("*").in("id", linkedIds);
      if (error || data?.length !== linkedIds.length ||
        sha(JSON.stringify([...(data ?? [])].sort((a, b) => a.id.localeCompare(b.id)))) !== linkedHash) {
        fail(`linked question records changed during promotion: ${error?.message ?? "hash mismatch"}`);
      }
    }
    journal.state = "verified"; journal.summary = actualSummary; journal.steps.push("verified"); save();
    await deleteTemp(state.stageId);
    await deleteTemp(backup.id);
    journal.state = "promoted"; journal.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ journalPath, backupPath, originalId: record.row.id, summary: actualSummary,
      oldDrafts: record.drafts.length, newDrafts: actualDrafts.length,
      approvalsReset: record.drafts.filter((q) => ["approved", "rejected"].includes(q.status)).length }));
  } catch (error) {
    journal.error = error instanceof Error ? error.message : String(error);
    journal.state = "rollback_needed"; save();
    // No temp rows are deleted on error. Restore the backup rows first, then
    // the import metadata. The journal and full JSON backup remain on disk.
    try {
      await move("draft_questions", record.row.id, state.stageId);
      await move("pdf_import_pages", record.row.id, state.stageId);
      await move("draft_questions", backup.id, record.row.id);
      await move("pdf_import_pages", backup.id, record.row.id);
      const { error: restoreErr } = await sb.from("pdf_imports").update({ status: record.row.status,
        page_count: record.row.page_count, extraction_method: record.row.extraction_method,
        text_quality: record.row.text_quality, answer_key_status: record.row.answer_key_status,
        answer_key_summary: record.row.answer_key_summary, error_message: record.row.error_message,
      }).eq("id", record.row.id);
      if (restoreErr) fail(`restore import row: ${restoreErr.message}`);
      journal.state = "rolled_back"; save();
    } catch (rollbackError) {
      journal.rollbackError = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      journal.state = "manual_recovery_required"; save();
    }
    throw error;
  }
}

const [command, id] = process.argv.slice(2);
if (!id) fail("usage: promote-refinement.ts stage|promote <cohort-import-id>");
const record = getRecord(id);
if (command === "stage") await stage(record);
else if (command === "promote") await promote(record);
else if (command === "discard") await discard(record);
else fail("usage: promote-refinement.ts stage|promote|discard <cohort-import-id>");
