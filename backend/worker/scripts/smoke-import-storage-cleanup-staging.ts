import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cleanupImportedTestStorage } from "../../supabase/functions/_shared/importStorageCleanup";

const ref = "wgkggknyndgaoyazdhdf";
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
assert.equal(new URL(url).hostname, `${ref}.supabase.co`, "Refusing a non-staging project");
console.log(`Verified staging project: ${ref}`);
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const id = randomUUID(), former = randomUUID(), questionId = randomUUID(), sharedId = randomUUID();
const paths = {
  crop: `imports/${id}/stimuli/final.png`, source: `imports/${former}/stimuli/source.png`,
  review: `imports/${id}/review-sources/page-1.png`, obsolete: `imports/${id}/stimuli/obsolete.png`,
  shared: `imports/${former}/stimuli/shared.png`,
};
const pdfPath = `smoke-cleanup/${id}.pdf`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
let userId: string | null = null, testId: string | null = null;
function check(result: { error: any }, label: string) { if (result.error) throw new Error(`${label}: ${result.error.message}`); }
async function api(token: string, action: string) {
  const response = await fetch(`${url}/functions/v1/admin-pdf-imports/${id}/${action}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, apikey: key, "Content-Type": "application/json" }, body: "{}",
  });
  return { status: response.status, body: await response.json() };
}
try {
  const email = `storage-cleanup-${id}@example.invalid`, password = `${randomUUID()}aA!4`;
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true }); check(user, "create fixture user");
  userId = user.data.user!.id;
  check(await db.from("profiles").update({ role: "admin" }).eq("id", userId), "fixture admin");
  const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await authClient.auth.signInWithPassword({ email, password }); check(signed, "fixture login");
  const token = signed.data.session!.access_token;
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const path of Object.values(paths)) check(await svc.storage.from("question-assets").upload(path, png, { contentType: "image/png" }), "upload fixture image");
  check(await svc.storage.from("pdf-imports").upload(pdfPath, Buffer.from("%PDF-1.4\nSynthetic disposable storage cleanup fixture"), { contentType: "application/pdf" }), "upload fixture PDF");
  check(await svc.from("pdf_imports").insert({ id, storage_path: pdfPath, original_filename: "cleanup-smoke.pdf", file_size: 1, status: "completed", created_by: userId,
    deterministic_review_status: "passed", text_quality: { document_family: "question_bank" } }), "create fixture import");
  check(await svc.from("questions").insert([
    { id: questionId, section: "math", question_type: "student_produced", prompt: "Synthetic cleanup fixture: what is 2 + 2?", correct_answer: "4", status: "archived", stimulus_image_path: paths.crop, created_by: userId, source_pdf_id: id },
    { id: sharedId, section: "math", question_type: "student_produced", prompt: "Synthetic shared image fixture", correct_answer: "4", status: "archived", stimulus_image_path: paths.shared, created_by: userId },
  ]), "create fixture questions");
  const draftId = randomUUID();
  check(await svc.from("draft_questions").insert({ id: draftId, pdf_import_id: id, question_id: questionId, page_number: 1,
    section: "math", question_type: "student_produced", prompt: "Synthetic cleanup fixture: what is 2 + 2?", suggested_answer: "4",
    status: "approved", review_state: "complete", has_visual_stimulus: true, stimulus_crop_status: "confirmed",
    stimulus_image_path: paths.crop, stimulus_source_image_path: paths.source, review_source_image_path: paths.review,
    stimulus_crop_rect: { x: 0, y: 0, w: 1, h: 1 }, assigned_module_name: "Math Module 1", display_order: 1,
  }), "create fixture draft");
  await assert.rejects(cleanupImportedTestStorage(svc, id), /generated test/);
  const generated = await api(token, "generate-test");
  assert.equal(generated.status, 201, JSON.stringify(generated.body)); testId = generated.body.test_id;
  assert.equal(generated.body.storage_cleanup.status, "complete", JSON.stringify(generated.body));
  for (const path of [paths.source, paths.review, paths.obsolete]) assert.ok((await svc.storage.from("question-assets").download(path)).error, `Temporary image remains: ${path}`);
  for (const path of [paths.crop, paths.shared]) check(await svc.storage.from("question-assets").download(path), "retained active/shared image");
  assert.ok((await svc.storage.from("pdf-imports").download(pdfPath)).error, "Source PDF remains");
  const draft = await svc.from("draft_questions").select("review_state,status,stimulus_source_image_path,review_source_image_path").eq("id", draftId).single(); check(draft, "read cleaned draft");
  assert.equal(draft.data.review_state, "complete"); assert.equal(draft.data.status, "approved");
  assert.equal(draft.data.stimulus_source_image_path, paths.crop); assert.equal(draft.data.review_source_image_path, null);
  const repeated = await api(token, "generate-test"); assert.equal(repeated.status, 200); assert.equal(repeated.body.test_id, testId);
  const reprocess = await api(token, "process"); assert.equal(reprocess.status, 409);
  console.log(JSON.stringify({ generated_test: true, source_pdf_deleted: true, temporary_images_deleted: true, active_and_shared_images_preserved: true, approvals_preserved: true, retry_idempotent: true, reprocess_blocked: true }));
} finally {
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const imp = await svc.from("pdf_imports").select("generated_test_id").eq("id", id).maybeSingle();
  testId ??= imp.data?.generated_test_id ?? null;
  if (testId) check(await svc.from("tests").delete().eq("id", testId), "remove fixture test");
  check(await svc.from("draft_questions").delete().eq("pdf_import_id", id), "remove fixture drafts");
  check(await svc.from("questions").delete().in("id", [questionId, sharedId]), "remove fixture questions");
  check(await svc.from("pdf_imports").delete().eq("id", id), "remove fixture import");
  check(await svc.storage.from("question-assets").remove(Object.values(paths)), "remove fixture images");
  check(await svc.storage.from("pdf-imports").remove([pdfPath]), "remove fixture PDF");
  if (userId) { check(await svc.from("audit_logs").delete().eq("actor_id", userId), "remove fixture audit logs"); check(await svc.auth.admin.deleteUser(userId), "remove fixture user"); }
}
