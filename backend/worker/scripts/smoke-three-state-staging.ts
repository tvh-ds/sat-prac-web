#!/usr/bin/env tsx
import "dotenv/config";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const expectedRef = "wgkggknyndgaoyazdhdf";
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workerToken = process.env.WORKER_AUTH_TOKEN;
if (!url || !serviceKey || !workerToken) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and WORKER_AUTH_TOKEN are required");
if (new URL(url).hostname.split(".")[0] !== expectedRef) throw new Error(`Refusing non-staging target: ${url}`);

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ids = { passingImport: randomUUID(), failedImport: randomUUID(), clean: randomUUID(), minor: randomUUID(), major: randomUUID(), failedDraft: randomUUID() };
const storagePaths: string[] = [];

function makePdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(14).text("Synthetic staging review evidence");
    doc.moveDown().text("1. Which value equals two plus two? A. 2 B. 3 C. 4 D. 5");
    doc.moveDown().text("2. Which word means careful? A. casual B. meticulous C. random D. unclear");
    doc.moveDown().text("3. This question intentionally has no answer key.");
    doc.end();
  });
}

async function addDraft(importId: string, id: string, question: number, options: { inferred?: boolean; answer?: string | null; prompt?: string; choices?: string[] } = {}) {
  const answer = options.answer === undefined ? "C" : options.answer;
  const { error } = await db.from("draft_questions").insert({
    id, pdf_import_id: importId, page_number: 1, section: "reading_writing",
    question_type: "multiple_choice", prompt: options.prompt ?? `Synthetic staging question ${question} has enough text.`,
    suggested_answer: answer, status: answer ? "has_suggested_key" : "missing_key",
    source_question_number: question, source_module_name: "Question Bank",
    parser_metadata: options.inferred ? { source_number_origin: "inferred", parse_flags: [] } : { parse_flags: [] },
  });
  if (error) throw new Error(`insert draft: ${error.message}`);
  const choices = ["A", "B", "C", "D"].map((label, index) => ({ draft_question_id: id, label, text: options.choices?.[index] ?? `Choice ${label}`, position: index + 1 }));
  const choiceResult = await db.from("draft_question_choices").insert(choices);
  if (choiceResult.error) throw new Error(`insert choices: ${choiceResult.error.message}`);
  if (answer) {
    const keyResult = await db.from("draft_answer_keys").insert({ draft_question_id: id, detected_answer: answer, confidence: 0.99, source_text: `${question}. ${answer}`, source_page: 1, status: "suggested" });
    if (keyResult.error) throw new Error(`insert answer: ${keyResult.error.message}`);
  }
}

async function createImport(id: string, path: string, family: "question_bank" | "full_test") {
  const { error } = await db.from("pdf_imports").insert({
    id, storage_path: path, original_filename: `three-state-smoke-${family}.pdf`, file_size: 1,
    page_count: 1, status: "completed", extraction_method: "text",
    content_scope: "full_test",
    text_quality: { document_family: family, answer_key_status: "complete", answer_key_source: "parsed", ocr_pages_failed: [], ocr_retry_results: [], parser_warnings: [] },
  });
  if (error) throw new Error(`insert import: ${error.message}`);
  const page = await db.from("pdf_import_pages").insert({ pdf_import_id: id, page_number: 1, extracted_text: "Synthetic source evidence for staging integration.", ocr_text: "Synthetic source evidence for staging integration.", ocr_status: "completed", needs_ocr: false, word_count: 7 });
  if (page.error) throw new Error(`insert page: ${page.error.message}`);
}

async function requestReview(importId: string) {
  const response = await fetch("http://127.0.0.1:8000/review", { method: "POST", headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ import_id: importId, force: true }) });
  if (!response.ok) throw new Error(`worker review ${response.status}: ${await response.text()}`);
  return response.json();
}

async function waitForTerminal(importId: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { data, error } = await db.from("ai_ingestion_review_jobs").select("status").eq("pdf_import_id", importId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data && ["completed", "completed_with_errors", "failed", "stale", "cancelled"].includes(data.status)) return data.status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("AI review job did not reach a terminal state");
}

async function main() {
  const pdf = await makePdf();
  const passingPath = `staging-smoke/${ids.passingImport}.pdf`;
  const failedPath = `staging-smoke/${ids.failedImport}.pdf`;
  storagePaths.push(passingPath, failedPath);
  for (const path of storagePaths) {
    const upload = await db.storage.from("pdf-imports").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw new Error(`upload PDF: ${upload.error.message}`);
  }

  await createImport(ids.passingImport, passingPath, "question_bank");
  await addDraft(ids.passingImport, ids.clean, 1);
  await addDraft(ids.passingImport, ids.minor, 2, { inferred: true, answer: "B", prompt: "Which w0rd means careful?", choices: ["casual", "meticulous", "random", "unclear"] });
  await addDraft(ids.passingImport, ids.major, 3, { answer: null });
  await requestReview(ids.passingImport);
  const jobStatus = await waitForTerminal(ids.passingImport);

  const passingRows = await db.from("draft_questions").select("id,review_state,review_job_id,review_error_category,review_source_image_path,ai_repair_snapshot").eq("pdf_import_id", ids.passingImport);
  if (passingRows.error) throw new Error(passingRows.error.message);
  const byId = new Map((passingRows.data ?? []).map((row) => [row.id, row]));
  if (byId.get(ids.clean)?.review_state !== "complete") throw new Error("clean question did not become Complete");
  if (byId.get(ids.minor)?.review_state !== "review" || !byId.get(ids.minor)?.review_job_id) throw new Error("minor question did not go through AI and end in Review");
  if (!byId.get(ids.minor)?.ai_repair_snapshot) throw new Error("minor question did not receive a validated AI repair");
  if (byId.get(ids.major)?.review_state !== "review" || byId.get(ids.major)?.review_job_id) throw new Error("major question did not bypass AI into Review");
  if (!byId.get(ids.minor)?.review_source_image_path || !byId.get(ids.major)?.review_source_image_path) throw new Error("Review questions are missing source images");

  await createImport(ids.failedImport, failedPath, "full_test");
  await addDraft(ids.failedImport, ids.failedDraft, 1);
  await requestReview(ids.failedImport);
  const failedImport = await db.from("pdf_imports").select("deterministic_review_status,deterministic_major_risks").eq("id", ids.failedImport).single();
  const failedDraft = await db.from("draft_questions").select("review_state").eq("id", ids.failedDraft).single();
  const failedJobs = await db.from("ai_ingestion_review_jobs").select("id", { count: "exact", head: true }).eq("pdf_import_id", ids.failedImport);
  if (failedImport.error || failedImport.data.deterministic_review_status !== "failed") throw new Error("malformed full test did not fail its import gate");
  if (failedDraft.error || failedDraft.data.review_state !== "failed") throw new Error("failed import draft was not marked Failed");
  if ((failedJobs.count ?? 0) !== 0) throw new Error("failed import created an AI job");

  console.log(JSON.stringify({
    target: expectedRef,
    passingImport: { deterministic: "passed", clean: "complete", minor: "review_after_ai", major: "review_without_ai", aiJob: jobStatus },
    structuralImport: { deterministic: "failed", draft: "failed", aiJobs: 0 },
  }, null, 2));
}

main().finally(async () => {
  await db.from("pdf_imports").delete().in("id", [ids.passingImport, ids.failedImport]);
  await db.storage.from("pdf-imports").remove(storagePaths);
  await db.storage.from("question-assets").remove([
    `imports/${ids.passingImport}/review-sources/page-1.png`,
    `imports/${ids.failedImport}/review-sources/page-1.png`,
  ]);
});
