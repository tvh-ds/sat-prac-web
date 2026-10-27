// Local production-build smoke/measurement against staging only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${ref}`), "Explicit staging reference required");
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  return m ? [[m[1], m[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const frontend = env("../../frontend/.env.local"), worker = env("../worker/.env"), accounts = env(".env");
for (const url of [frontend.VITE_SUPABASE_URL, worker.SUPABASE_URL]) assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
const base = process.env.PERFORMANCE_BASE_URL ?? "http://127.0.0.1:4173";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(worker.SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const admin = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const student = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const must = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
let studentId, browser;
const measurements = [];
const toolsOnly = process.argv.includes("--tools");
const selectedPath = process.argv.find(argument => argument.startsWith("--path="))?.slice(7);
try {
  console.log(`Verified staging target: ${ref}`);
  const adminSession = must(await admin.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD })).session;
  const email = `loading-check-${crypto.randomUUID()}@example.invalid`, password = `${crypto.randomUUID()}-Aa1!`;
  studentId = must(await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Loading check" } })).user.id;
  must(await service.from("student_profiles").update({ profile_status: "approved", phone_number: "+12025550100", parent_name: "Loading fixture", parent_phone_number: "+12025550101" }).eq("id", studentId));
  const studentSession = must(await student.auth.signInWithPassword({ email, password })).session;
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const routes = [
    ["/login", null], ["/admin/classes", adminSession], ["/admin/students", adminSession],
    ["/admin/assignments", adminSession], ["/admin/practice", adminSession], ["/admin/tests", adminSession],
    ["/admin/vocabulary", adminSession], ["/admin/questions", adminSession], ["/admin/imports", adminSession],
    ["/student/dashboard", studentSession], ["/student/practice", studentSession], ["/student/tests", studentSession],
    ["/student/results", studentSession], ["/student/vocabulary", studentSession], ["/student/profile", studentSession],
  ];
  for (const [path, session] of routes.filter(([path]) => !toolsOnly || ["/admin/classes", "/admin/students", "/admin/questions", "/admin/vocabulary", "/student/results", "/student/vocabulary"].includes(path))) {
    if (selectedPath && selectedPath !== path) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (session) await context.addInitScript(({ ref, session }) => localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)), { ref, session });
    const page = await context.newPage();
    const errors = [], requests = [], failures = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().includes("/functions/v1/")) requests.push(new URL(request.url()).pathname + new URL(request.url()).search); });
    page.on("response", response => { if (response.url().includes(`${ref}.supabase.co`) && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    const started = performance.now();
    await page.goto(`${base}${path}`);
    await page.locator("h1").first().waitFor({ timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 45000 });
    const metrics = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource");
      return {
        jsBytes: entries.filter(e => /\/assets\/.*\.js$/.test(e.name)).reduce((sum, e) => sum + e.encodedBodySize, 0),
        cssBytes: entries.filter(e => /\/assets\/.*\.css$/.test(e.name)).reduce((sum, e) => sum + e.encodedBodySize, 0),
        imageBytes: entries.filter(e => /\.(png|webp|avif)$/.test(e.name)).reduce((sum, e) => sum + e.encodedBodySize, 0),
        fontsStylesheets: entries.filter(e => e.name.includes("fonts.googleapis.com")).length,
        firstContentfulPaint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      };
    });
    assert.deepEqual(errors, [], `${path}: browser errors`);
    assert.deepEqual(failures, [], `${path}: API failures`);
    assert.equal(new URL(page.url()).pathname, path, `${path}: unexpected redirect`);
    measurements.push({ path, settledMs: Math.round(performance.now() - started), ...metrics, requests });
    console.log(JSON.stringify(measurements.at(-1)));
    if (process.env.PERFORMANCE_SCREENSHOTS && ["/admin/classes", "/student/dashboard"].includes(path)) {
      await page.screenshot({ path: `${process.env.PERFORMANCE_SCREENSHOTS}/${path.split("/")[1]}-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${process.env.PERFORMANCE_SCREENSHOTS}/${path.split("/")[1]}-mobile.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: mobile overflow`);
    }
    if (toolsOnly) {
      if (path === "/admin/classes") {
        assert.deepEqual(requests, ["/functions/v1/admin-classes"], "Class overview must not load school-wide reports");
        await page.getByRole("button", { name: "New class", exact: true }).click();
        await page.getByLabel("Students · 0 selected").waitFor();
        assert.ok(requests.includes("/functions/v1/admin-students"), "Class editor loads the roster on demand");
        assert.ok(!requests.includes("/functions/v1/admin-students?progress=1"), "Class editor does not need progress reports");
        await page.getByRole("button", { name: "Close", exact: true }).click();
        const classLink = page.getByRole("link", { name: "View class", exact: true }).first();
        if (await classLink.count()) {
          await classLink.click();
          await page.waitForLoadState("networkidle");
          assert.ok(requests.includes("/functions/v1/admin-students?progress=1"), "Opening a class loads full student progress");
          assert.ok(requests.includes("/functions/v1/admin-vocab/assignments"), "Opening a class loads vocabulary progress");
          await page.getByRole("button", { name: "Vocabulary", exact: true }).click();
          await page.getByRole("heading", { name: "Assigned vocabulary decks", exact: true }).waitFor();
        }
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route("**/assets/QuestionsPage-*.js", async route => { await gate; await route.continue(); });
        try {
          await page.locator(".admin-sidebar").getByRole("link", { name: "Question Bank", exact: true }).click();
          await page.locator(".admin-main .spinner:visible").first().waitFor();
          assert.ok(await page.locator(".admin-sidebar").isVisible(), "Navigation shell remains visible during route loading");
        } finally { release(); }
        await page.getByRole("heading", { name: "Practice Question Bank", exact: true }).waitFor();
      }
      if (path === "/admin/questions") {
        const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(e => e.name));
        assert.ok(!resources.some(name => /\/(MathText|QuestionTools)-/.test(name)), "Question list defers math and editing tools");
        await page.getByRole("button", { name: "Preview", exact: true }).first().click();
        await page.locator(".modal-head").getByText("Question Preview", { exact: true }).waitFor();
        await page.locator(".modal-foot").getByRole("button", { name: "Edit", exact: true }).click();
        await page.locator(".modal-head").getByText("Edit Question", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      if (path === "/admin/students") {
        const before = requests.length;
        await page.getByRole("button", { name: "Accounts", exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.deepEqual(requests.slice(before), ["/functions/v1/admin-students"], "Accounts skips progress reports");
        await page.getByRole("button", { name: "Progress", exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.ok(requests.slice(before + 1).includes("/functions/v1/admin-students?progress=1"), "Progress loads the complete report again");
      }
      if (path === "/admin/vocabulary") {
        const open = page.getByRole("button", { name: "Open", exact: true }).first();
        if (await open.count()) {
          await open.click();
          await page.getByRole("button", { name: "Import file", exact: true }).click();
          await page.locator(".modal").waitFor();
          await page.getByRole("button", { name: "Close", exact: true }).first().click();
        }
      }
      if (path === "/student/results") {
        const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(e => e.name));
        assert.ok(!resources.some(name => /\/(MathText|ErrorLogPanel)-/.test(name)), "Results defers Error Log and math tools");
        await page.getByRole("tab", { name: "Error Log", exact: true }).click();
        await page.waitForLoadState("networkidle");
        assert.ok(await page.locator("#error-log-panel").isVisible(), "Deferred Error Log opens");
        assert.ok(await page.locator(".student-rail").isVisible(), "Student shell remains visible");
      }
      if (path === "/student/vocabulary") {
        const { data: deck, error } = await service.from("vocab_decks").insert({ student_id: studentId, name: "Loading check deck" }).select("id").single();
        assert.equal(error, null);
        await page.goto(`${base}/student/vocabulary/decks/${deck.id}`);
        await page.getByRole("button", { name: "Import", exact: true }).click();
        await page.locator(".modal").waitFor();
        await page.getByRole("button", { name: "Close", exact: true }).first().click();
      }
      await page.waitForLoadState("networkidle");
      assert.deepEqual(errors, [], `${path}: interaction errors`);
      assert.deepEqual(failures, [], `${path}: interaction API failures`);
      console.log(`PASS deferred tools and navigation: ${path}`);
    }
    await context.close();
  }
  if (process.env.PERFORMANCE_REPORT) writeFileSync(process.env.PERFORMANCE_REPORT, JSON.stringify({ projectRef: ref, measurements }, null, 2));
} finally {
  await browser?.close();
  await student.auth.signOut();
  await admin.auth.signOut();
  if (studentId) {
    const result = await service.auth.admin.deleteUser(studentId);
    assert.equal(result.error, null, "Remove owned loading-check account");
    console.log("Temporary loading-check account removed.");
  }
}
