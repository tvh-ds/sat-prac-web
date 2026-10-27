// Real persistence checks through the local frontend; only owned staging fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${ref}`), "Explicit staging reference required");
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const frontend = env("../../frontend/.env.local"), worker = env("../worker/.env"), accounts = env(".env");
for (const url of [frontend.VITE_SUPABASE_URL, worker.SUPABASE_URL]) assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
const base = process.env.PERFORMANCE_BASE_URL ?? "http://127.0.0.1:4174";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(worker.SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const admin = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const student = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const must = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const insert = async (table, row) => must(await service.from(table).insert(row).select().single());
const prefix = `loading-write-${crypto.randomUUID()}`;
let userId, testId, questionId, browser;
try {
  console.log(`Verified staging write-test target: ${ref}`);
  const adminSession = must(await admin.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD })).session;
  const email = `${prefix}@example.invalid`, password = `${crypto.randomUUID()}-Aa1!`;
  userId = must(await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: prefix } })).user.id;
  must(await service.from("student_profiles").update({ profile_status: "approved", phone_number: "+12025550100", parent_name: "Fixture parent", parent_phone_number: "+12025550101" }).eq("id", userId));
  const studentSession = must(await student.auth.signInWithPassword({ email, password })).session;
  const question = await insert("questions", { prompt: `${prefix}: What is $1 + 1$?`, section: "math", question_type: "multiple_choice", difficulty: 3, correct_answer: "B", explanation: "One plus one equals two.", status: "active", created_by: adminSession.user.id });
  questionId = question.id;
  must(await service.from("question_choices").insert(["A", "B", "C", "D"].map((label, i) => ({ question_id: questionId, label, text: String(i + 1), position: i + 1, is_correct: label === "B" }))).select());
  testId = (await insert("tests", { title: prefix, kind: "practice", status: "published", is_public: false, created_by: adminSession.user.id })).id;
  const section = await insert("test_sections", { test_id: testId, name: "Math", section_type: "math", position: 1 });
  const module = await insert("test_modules", { section_id: section.id, name: "Module 1", time_limit_minutes: 10, position: 1 });
  await insert("test_module_questions", { module_id: module.id, question_id: questionId, position: 1 });
  const assignment = await insert("test_assignments", { test_id: testId, student_id: userId, assigned_by: adminSession.user.id });

  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const errors = [], failures = [];
  async function pageFor(session) {
    const context = await browser.newContext();
    await context.addInitScript(({ ref, session }) => localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)), { ref, session });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.url().includes(`${ref}.supabase.co`) && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    return page;
  }
  const adminPage = await pageFor(adminSession);
  await adminPage.goto(`${base}/admin/questions`);
  await adminPage.getByPlaceholder("Search prompts…").fill(prefix);
  const row = adminPage.getByRole("row").filter({ hasText: prefix });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const updatedPrompt = `${prefix}: If $x + 0 = 2$, what is $x$?`;
  await adminPage.locator(".modal textarea").first().fill(updatedPrompt);
  await adminPage.getByRole("button", { name: "Save", exact: true }).click();
  await adminPage.locator(".modal").waitFor({ state: "hidden" });
  await adminPage.getByText(updatedPrompt, { exact: true }).waitFor();
  assert.equal(must(await service.from("questions").select("prompt").eq("id", questionId).single()).prompt, updatedPrompt);
  // Editing replaces choice rows, so verify against their current IDs.
  const choices = must(await service.from("question_choices").select("id,label").eq("question_id", questionId));
  console.log("PASS deferred question editor saves and refreshes persisted data");

  const page = await pageFor(studentSession);
  await page.goto(`${base}/student/practice/${testId}/start?assignment=${assignment.id}`);
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await page.waitForURL(/\/student\/attempts\/[^/]+\/session/, { timeout: 45000 });
  const saved = page.waitForResponse(response => response.url().includes("/functions/v1/student-responses") && response.request().method() === "POST");
  await page.locator(".choice").filter({ has: page.locator(".letter", { hasText: "B" }) }).click();
  assert.equal((await saved).status(), 200);
  const attemptId = new URL(page.url()).pathname.split("/")[3];
  assert.equal(must(await service.from("attempt_responses").select("selected_choice_id").eq("attempt_id", attemptId).eq("question_id", questionId).single()).selected_choice_id, choices.find(choice => choice.label === "B").id);
  await page.reload();
  await page.locator(".choice.selected").waitFor();
  assert.match(await page.locator(".choice.selected").innerText(), /B/);
  console.log("PASS practice start, answer autosave and resume after reload");
  await page.getByRole("button", { name: "Submit Practice Test", exact: true }).click();
  await page.locator(".modal-foot").getByRole("button", { name: "Submit Practice Test", exact: true }).click();
  await page.waitForURL(/\/student\/scores\//, { timeout: 45000 });
  await page.waitForLoadState("networkidle");
  const score = must(await service.from("scores").select("raw_score,total_questions").eq("attempt_id", attemptId).single());
  assert.equal(score.raw_score, 1); assert.equal(score.total_questions, 1);
  console.log("PASS submission and score persistence");

  await adminPage.goto(`${base}/admin/students/${userId}`);
  await adminPage.getByRole("button", { name: /Review/ }).first().click();
  await adminPage.locator(".modal").waitFor();
  await adminPage.waitForLoadState("networkidle");
  await adminPage.locator(".modal").getByText(prefix, { exact: false }).first().waitFor();
  assert.ok(await adminPage.locator(".modal .katex").count(), "Review renders mathematics");
  assert.deepEqual(errors, [], "Browser exceptions");
  assert.deepEqual(failures, [], "Failed Supabase requests");
  console.log("PASS deferred administrator answer review loads graded work");
} finally {
  await browser?.close();
  await student.auth.signOut();
  await admin.auth.signOut();
  if (userId) must(await service.auth.admin.deleteUser(userId));
  if (testId) must(await service.from("tests").delete().eq("id", testId).eq("title", prefix));
  if (questionId) must(await service.from("questions").delete().eq("id", questionId).like("prompt", `${prefix}%`));
  console.log("Owned staging write-test fixtures removed.");
}
