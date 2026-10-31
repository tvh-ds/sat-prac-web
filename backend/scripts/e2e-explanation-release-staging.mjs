import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${ref}`), "Explicit staging target required");
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const worker = env("../worker/.env"), frontend = env("../../frontend/.env.local"), accounts = env(".env");
for (const url of [worker.SUPABASE_URL, frontend.VITE_SUPABASE_URL]) assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(worker.SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const student = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const admin = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
async function must(promise) {
  const result = await promise;
  assert.equal(result.error, null);
  assert.notEqual(result.data, null);
  return result.data;
}
const title = `Explanation release check ${crypto.randomUUID()}`;
let userId, testId;
try {
  const password = `${crypto.randomUUID()}-Aa1!`, email = `explanation-check-${crypto.randomUUID()}@example.invalid`;
  const created = await must(service.auth.admin.createUser({ email, password, email_confirm: true }));
  userId = created.user.id;
  await must(service.from("student_profiles").update({ profile_status: "approved", phone_number: "+84123456789", parent_name: "Fixture parent", parent_phone_number: "+84987654321" }).eq("id", userId).select("id").single());
  const { session } = await must(student.auth.signInWithPassword({ email, password }));
  const { session: adminSession } = await must(admin.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD }));
  const test = await must(service.from("tests").insert({ title, kind: "practice", status: "draft" }).select("id").single());
  testId = test.id;
  const batch = await must(service.from("practice_assignment_batches").insert({ snapshot_test_id: testId, title, timer_minutes: 10 }).select("id").single());
  const section = await must(service.from("test_sections").insert({ test_id: testId, name: "Math", section_type: "math", position: 1 }).select("id").single());
  const module = await must(service.from("test_modules").insert({ section_id: section.id, name: "Math Module 1", position: 1, time_limit_minutes: 10 }).select("id").single());
  const question = await must(service.from("questions").select("id,explanation").not("explanation", "is", null).limit(1).single());
  await must(service.from("test_module_questions").insert({ module_id: module.id, question_id: question.id, position: 1 }).select("id").single());
  const assignment = await must(service.from("test_assignments").insert({ test_id: testId, student_id: userId, status: "completed" }).select("id").single());
  const attempt = await must(service.from("attempts").insert({ test_id: testId, assignment_id: assignment.id, student_id: userId, status: "graded", submitted_at: new Date(Date.now() - 8 * 86400000).toISOString() }).select("id").single());
  await must(service.from("attempt_modules").insert({ attempt_id: attempt.id, module_id: module.id, status: "completed" }).select("id").single());
  async function call(path, token = session.access_token, method = "GET") {
    const response = await fetch(`${worker.SUPABASE_URL}/functions/v1/${path}`, { method, headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  const report = () => call(`student-scores/${attempt.id}`);
  let result = await report();
  assert.equal(result.explanations_released, true, "Existing overdue completion unlocks");
  assert.equal(result.review[0].explanation, question.explanation, "Explanation text is returned");
  await must(service.from("attempts").update({ submitted_at: new Date(Date.now() - 6 * 86400000).toISOString() }).eq("id", attempt.id).select("id").single());
  result = await report();
  assert.equal(result.explanations_released, false, "Recent completion remains hidden");
  assert.equal(result.review[0].explanation, null, "Hidden explanation is withheld by server");
  await call(`admin-practice-assignments/${batch.id}/release`, adminSession.access_token, "POST");
  result = await report();
  assert.equal(result.explanations_released, true, "Manual release still unlocks recent completions");
  assert.equal(result.review[0].explanation, question.explanation);
  const unauthorized = await fetch(`${worker.SUPABASE_URL}/functions/v1/student-scores/${attempt.id}`, { headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY } });
  assert.equal(unauthorized.status, 401);
  console.log("PASS: deployed staging endpoint unlocks overdue work, hides recent work, preserves manual release, rejects anonymous access.");
} finally {
  if (userId) assert.equal((await service.auth.admin.deleteUser(userId)).error, null);
  if (testId) assert.equal((await service.from("tests").delete().eq("id", testId).eq("title", title)).error, null);
  await admin.auth.signOut({ scope: "local" });
}
