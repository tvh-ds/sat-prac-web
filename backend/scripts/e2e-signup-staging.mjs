// Uses disposable, owned fixtures only. Run after starting the local frontend.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const REF = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${REF}`), "Explicit staging reference required");
async function env(path) {
  return Object.fromEntries((await readFile(new URL(path, import.meta.url), "utf8")).split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
  }));
}
const frontend = await env("../../frontend/.env.local");
const worker = await env("../worker/.env");
for (const url of [frontend.VITE_SUPABASE_URL, worker.SUPABASE_URL]) assert.equal(new URL(url).hostname, `${REF}.supabase.co`, "Refuse non-staging target");
console.log(`Verified staging target: ${REF}`);
const url = worker.SUPABASE_URL;
const key = frontend.VITE_SUPABASE_ANON_KEY;
const authSettings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(20000) }).then((response) => response.json());
assert.equal(authSettings.disable_signup, false, "Staging signup must be enabled");
assert.equal(authSettings.mailer_autoconfirm, true, "Disable staging email confirmation before running this test");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = process.env.SIGNUP_TEST_URL ?? "http://127.0.0.1:5173";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const student = createClient(url, key, options);
const admin = createClient(url, key, options);
const run = crypto.randomUUID();
const email = `signup-check-${run}@example.com`;
const password = `${crypto.randomUUID()}-Aa1!`;
const owned = new Set();
let browser;
async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function call(path, token, method = "GET", body, expected = 200) {
  const response = await fetch(`${url}/functions/v1/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000),
  });
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}`);
  return response.json();
}
try {
  const weak = await student.auth.signUp({ email, password: "seven77" });
  assert.ok(weak.error && /password|weak/.test(weak.error.message.toLowerCase()), "Supabase must reject seven-character passwords");
  console.log("PASS: server rejects passwords shorter than eight characters");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/login`);
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Student full name", { exact: true }).fill("Signup fixture student");
  await page.getByLabel("Student phone number (Zalo)", { exact: true }).fill("+84123456789");
  await page.getByLabel("Parent / guardian full name", { exact: true }).fill("Signup fixture parent");
  await page.getByLabel("Parent / guardian phone number (Zalo)", { exact: true }).fill("+84987654321");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  const outcome = await Promise.race([
    page.getByRole("heading", { name: "Your profile", exact: true }).waitFor({ timeout: 30000 }).then(() => "success"),
    page.getByRole("alert").waitFor({ timeout: 30000 }).then(async () => page.getByRole("alert").innerText()),
  ]);
  assert.equal(outcome, "success", outcome);
  const login = await must("Student login", student.auth.signInWithPassword({ email, password }));
  assert.ok(login.session);
  const id = login.user.id;
  owned.add(id);
  const pending = await must("Pending profile", service.from("student_profiles").select("profile_status,parent_name,phone_number").eq("id", id).single());
  assert.equal(pending.profile_status, "pending");
  assert.equal(pending.parent_name, "Signup fixture parent");
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some((name) => name.endsWith("-auth-token"))), "Signup retains signed-in session");
  assert.ok(page.url().endsWith("/student/profile"));
  assert.equal(await page.getByRole("link", { name: "Dashboard", exact: true }).count(), 0);
  await page.getByLabel("Parent / guardian full name", { exact: false }).fill("Updated signup fixture parent");
  await page.getByRole("button", { name: "Update and resubmit", exact: true }).click();
  await page.getByText("Profile submitted. Study sections unlock after an administrator approves it.").waitFor();
  await call("student-dashboard", login.session.access_token, "GET", undefined, 403);
  console.log("PASS: live signup without verification, signed-in pending profile, preserved session, pending edit, API access denied");

  const adminEmail = `signup-check-admin-${run}@example.com`;
  const created = await must("Create fixture admin", service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true, user_metadata: { full_name: "Signup fixture admin", signup_test_run: run } }));
  owned.add(created.user.id);
  await must("Fixture admin role", service.from("profiles").update({ role: "admin" }).eq("id", created.user.id));
  const adminLogin = await must("Fixture admin login", admin.auth.signInWithPassword({ email: adminEmail, password }));
  const list = await call("admin-students", adminLogin.session.access_token);
  assert.ok(JSON.stringify(list).includes(id), "Pending student visible in administrator list");
  await call(`admin-students/${id}/profile/approve`, adminLogin.session.access_token, "POST", {});
  await page.reload();
  await page.getByRole("link", { name: "Dashboard", exact: true }).waitFor({ timeout: 30000 });
  await page.mouse.move(2, 200);
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.waitForURL("**/student/dashboard");
  await call("student-dashboard", login.session.access_token);
  console.log("PASS: administrator sees pending student, approves through existing endpoint, dashboard and API unlock");
  await page.mouse.move(2, 200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Student full name", { exact: true }).fill("Duplicate fixture");
  await page.getByLabel("Student phone number (Zalo)", { exact: true }).fill("+84123456789");
  await page.getByLabel("Parent / guardian full name", { exact: true }).fill("Duplicate fixture parent");
  await page.getByLabel("Parent / guardian phone number (Zalo)", { exact: true }).fill("+84987654321");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.getByRole("alert").waitFor({ timeout: 30000 });
  assert.match(await page.getByRole("alert").innerText(), /already exists/);
  console.log("PASS: live duplicate email has sign-in recovery");
} finally {
  await browser?.close();
  // Discover a partially-created browser fixture too, so failures never leave it behind.
  const users = await must("Find owned fixtures", service.auth.admin.listUsers({ perPage: 1000 }));
  for (const account of users.users) if (account.email === email) owned.add(account.id);
  for (const id of owned) {
    const found = await must("Verify fixture ownership", service.auth.admin.getUserById(id));
    assert.ok(found.user && (found.user.email === email || (found.user.email === `signup-check-admin-${run}@example.com` && found.user.user_metadata.signup_test_run === run)), "Refuse cleanup of non-fixture account");
    await must("Delete owned temporary account", service.auth.admin.deleteUser(id));
  }
  console.log("Temporary staging signup accounts cleaned up");
}
