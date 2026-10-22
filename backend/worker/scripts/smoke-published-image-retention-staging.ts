import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parse } from "dotenv";
import { cleanupImportedTestStorage, tryCleanupImportedTestStorage, retryPendingImportStorageCleanup, tryCleanupPublishedTestStorage } from "../../supabase/functions/_shared/importStorageCleanup";

const REF = "wgkggknyndgaoyazdhdf";
assert(process.argv.includes(`--project-ref=${REF}`), "Explicit staging reference is required");
const config = parse(readFileSync(new URL("../.env", import.meta.url)));
const url = config.SUPABASE_URL!, key = config.SUPABASE_SERVICE_ROLE_KEY!;
assert.equal(new URL(url).hostname, `${REF}.supabase.co`);
const frontend = parse(readFileSync(new URL("../../../frontend/.env.local", import.meta.url)));
assert.equal(new URL(frontend.VITE_SUPABASE_URL!).hostname, `${REF}.supabase.co`);
const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const userClient = createClient(url, frontend.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
async function must(query: any): Promise<any> { const result = await query; if (result.error) throw new Error(result.error.message); return result.data; }
const tests: string[] = [], imports: string[] = [], questions: string[] = [], paths: string[] = [], pdfs: string[] = [];
let adminId: string | undefined;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=", "base64");
async function image(path: string) { paths.push(path); await must(svc.storage.from("question-assets").upload(path, png, { contentType: "image/png" })); }
// Downloads can remain in a CDN cache briefly after removal. Verify object
// presence with the authoritative storage listing instead.
async function exists(bucket: string, path: string) {
  const slash = path.lastIndexOf("/"), prefix = path.slice(0, slash), name = path.slice(slash + 1);
  const rows = await must(svc.storage.from(bucket).list(prefix, { search: name, limit: 100 }));
  return rows.some((row: { name: string; id: string | null }) => row.id && row.name === name);
}
try {
  console.log(`Verified staging target: ${REF}`);
  const email = `publication-cleanup-${randomUUID()}@example.invalid`, password = `${randomUUID()}Aa1!`;
  const created = await must(svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Temporary cleanup admin" } }));
  adminId = created.user.id;
  await must(svc.from("profiles").update({ role: "admin" }).eq("id", adminId));
  const session = (await must(userClient.auth.signInWithPassword({ email, password }))).session;
  const test = await must(svc.from("tests").insert({ title: "Temporary publication retention check", kind: "full", status: "draft", created_by: adminId }).select("id").single()); tests.push(test.id);
  const section = await must(svc.from("test_sections").insert({ test_id: test.id, name: "Reading and Writing", section_type: "reading_writing", position: 1 }).select("id").single());
  const module = await must(svc.from("test_modules").insert({ section_id: section.id, name: "Module 1", position: 1, time_limit_minutes: 32 }).select("id").single());
  const importId = randomUUID(), legacyId = randomUUID(); imports.push(importId, legacyId);
  const pdf = `uploads/publication-check-${importId}.pdf`; pdfs.push(pdf);
  await must(svc.storage.from("pdf-imports").upload(pdf, Buffer.from("%PDF-1.4\n%%EOF"), { contentType: "application/pdf" }));
  await must(svc.from("pdf_imports").insert([
    { id: importId, original_filename: "Temporary retention fixture.pdf", storage_path: pdf, status: "completed", generated_test_id: test.id, created_by: adminId },
    { id: legacyId, original_filename: "Temporary bank fixture.pdf", storage_path: "uploads/not-uploaded-fixture.pdf", status: "completed", created_by: adminId },
  ]));
  const source = `imports/${importId}/stimuli/1-page-1.png`, crop = `imports/${importId}/stimuli/1-manual-crop.png`, review = `imports/${importId}/review-sources/page-1.png`, unused = `imports/${importId}/stimuli/unused-crop.png`;
  for (const path of [source, crop, review, unused]) await image(path);
  const q = await must(svc.from("questions").insert({ section: "reading_writing", question_type: "multiple_choice", prompt: "Temporary visual question", correct_answer: "A", difficulty: 2, source_pdf_id: importId, stimulus_image_path: source, created_by: adminId }).select("id").single()); questions.push(q.id);
  await must(svc.from("test_module_questions").insert({ module_id: module.id, question_id: q.id, position: 1 }));
  const draft = await must(svc.from("draft_questions").insert({ pdf_import_id: importId, prompt: "Temporary visual question", question_id: q.id, status: "approved", review_state: "complete", review_route: "batch_ready", has_visual_stimulus: true, stimulus_crop_status: "confirmed", stimulus_image_path: crop, stimulus_source_image_path: source, review_source_image_path: review }).select("id").single());
  await must(svc.from("draft_questions").insert({ pdf_import_id: importId, prompt: "Unused generated-import draft", stimulus_image_path: unused, stimulus_source_image_path: source }));
  await must(svc.from("draft_questions").insert(Array.from({ length: 100 }, (_, i) => ({ pdf_import_id: importId, prompt: `Bulk cleanup fixture ${i}`, stimulus_source_image_path: source }))));
  assert.equal((await cleanupImportedTestStorage(svc, importId)).status, "awaiting_publication");
  assert(await exists("question-assets", source));
  async function publish(expected: number) {
    const response = await fetch(`${url}/functions/v1/admin-tests/${test.id}/publish`, { method: "POST", headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY!, Authorization: `Bearer ${session.access_token}` } });
    const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
  }
  assert.match(JSON.stringify(await publish(500)), /Crop the question image/);
  await must(svc.from("questions").update({ stimulus_image_path: crop }).eq("id", q.id));
  await publish(200);
  const cleanupState = await must(svc.from("pdf_imports").select("text_quality").eq("id", importId).single());
  assert.equal(cleanupState.text_quality.storage_cleanup?.status, "complete");
  assert(await exists("question-assets", crop));
  for (const path of [source, review, unused]) assert.equal(await exists("question-assets", path), false, path);
  assert.equal(await exists("pdf-imports", pdf), false);
  const after = await must(svc.from("draft_questions").select("review_state,stimulus_image_path,stimulus_source_image_path,review_source_image_path").eq("id", draft.id).single());
  assert.equal(after.review_state, "complete"); assert.equal(after.stimulus_source_image_path, crop); assert.equal(after.review_source_image_path, null);
  const forbidden = await svc.from("questions").update({ stimulus_image_path: source }).eq("id", q.id);
  assert.match(forbidden.error?.message ?? "", /Crop the question image/);
  console.log("Passed: unpublished sources preserved; full-page publication/edit rejected; publish immediately removes originals, review pages and unused crops; final crop and review approval survive.");

  const legacySource = `imports/${legacyId}/stimuli/1-page-1.png`, legacyCrop = `imports/${legacyId}/stimuli/1-auto-crop.png`, unfinished = `imports/${legacyId}/stimuli/2-page-2.png`;
  for (const path of [legacySource, legacyCrop, unfinished]) await image(path);
  const lq = await must(svc.from("questions").insert({ section: "reading_writing", question_type: "multiple_choice", prompt: "Legacy bank visual fixture", correct_answer: "A", source_pdf_id: legacyId, stimulus_image_path: legacyCrop }).select("id").single()); questions.push(lq.id);
  await must(svc.from("draft_questions").insert([
    { pdf_import_id: legacyId, prompt: "Legacy bank visual fixture", question_id: lq.id, stimulus_image_path: legacyCrop, stimulus_source_image_path: legacySource, review_state: "complete" },
    { pdf_import_id: legacyId, prompt: "Unfinished bank draft", stimulus_image_path: unfinished, stimulus_source_image_path: unfinished },
  ]));
  await must(svc.from("test_module_questions").insert({ module_id: module.id, question_id: lq.id, position: 2 }));
  const removedVisualPath = `imports/${legacyId}/stimuli/3-page-3.png`; await image(removedVisualPath);
  const textQuestion = await must(svc.from("questions").insert({ section: "reading_writing", question_type: "multiple_choice", prompt: "Published question with visual removed", correct_answer: "A", source_pdf_id: legacyId }).select("id").single()); questions.push(textQuestion.id);
  const staleDraft = await must(svc.from("draft_questions").insert({ pdf_import_id: legacyId, prompt: "Old visual reference", question_id: textQuestion.id, stimulus_image_path: removedVisualPath, stimulus_source_image_path: removedVisualPath }).select("id").single());
  await must(svc.from("test_module_questions").insert({ module_id: module.id, question_id: textQuestion.id, position: 3 }));
  const queued = await must(svc.from("pdf_imports").select("text_quality").eq("id", legacyId).single());
  assert.equal(queued.text_quality.storage_cleanup.status, "pending");
  await tryCleanupPublishedTestStorage(svc, test.id);
  assert.equal(await exists("question-assets", removedVisualPath), false);
  const clearedDraft = await must(svc.from("draft_questions").select("stimulus_image_path,stimulus_source_image_path").eq("id", staleDraft.id).single());
  assert.equal(clearedDraft.stimulus_image_path, null); assert.equal(clearedDraft.stimulus_source_image_path, null);
  assert.equal(await exists("question-assets", legacySource), false); assert(await exists("question-assets", legacyCrop)); assert(await exists("question-assets", unfinished));
  await must(svc.from("questions").update({ stimulus_image_path: unfinished }).eq("id", lq.id)).then(() => { throw new Error("Full page edit should fail"); }, (e: Error) => assert.match(e.message, /Crop the question image/));
  const pendingPath = `imports/${importId}/stimuli/retry-page-2.png`; await image(pendingPath);
  const brokenClient = { from: svc.from.bind(svc), rpc: svc.rpc.bind(svc), storage: { from: (bucket: string) => {
    const storage = svc.storage.from(bucket); return { list: storage.list.bind(storage), remove: async () => ({ data: null, error: { message: "Temporary test outage" } }) };
  } } };
  assert.equal((await tryCleanupImportedTestStorage(brokenClient, importId)).status, "pending");
  await retryPendingImportStorageCleanup(svc);
  assert.equal(await exists("question-assets", pendingPath), false);
  const denied = await userClient.rpc("release_import_source_images", { p_import_id: importId }); assert(denied.error, "Authenticated admins cannot call the service-only release RPC");
  console.log("Passed: legacy imports, linked-after-publication scheduling, unfinished draft protection, storage failure/retry and service-only RPC authorization.");
} finally {
  for (const id of tests) await must(svc.from("tests").delete().eq("id", id));
  for (const id of imports) await must(svc.from("pdf_imports").delete().eq("id", id));
  for (const id of questions) await must(svc.from("questions").delete().eq("id", id));
  if (paths.length) await must(svc.storage.from("question-assets").remove(paths));
  if (pdfs.length) await must(svc.storage.from("pdf-imports").remove(pdfs));
  if (adminId) await must(svc.auth.admin.deleteUser(adminId));
  console.log("Temporary staging fixtures removed.");
}
