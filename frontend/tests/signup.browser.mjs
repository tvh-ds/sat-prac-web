// Run with a local Vite server. Set PLAYWRIGHT_MODULE_PATH to index.mjs if Playwright is supplied by a shared runtime.
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const base = process.env.SIGNUP_TEST_URL ?? "http://127.0.0.1:5173";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Browser tests must run against a local frontend");
const browser = await chromium.launch({ headless: true });
const user = { id: "11111111-1111-4111-8111-111111111111", email: "signup-fixture@example.invalid", aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {}, identities: [{ id: "fixture", provider: "email" }], created_at: new Date().toISOString() };
const encode = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
const session = { user, access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 };
const artifacts = new URL("../../tmp/signup-review/", import.meta.url);
await mkdir(artifacts, { recursive: true });

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const counts = { signup: 0, profile: 0, logout: 0 };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.supabase.co/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.hostname, "wgkggknyndgaoyazdhdf.supabase.co", "Refuse non-staging backend");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/auth/v1/signup") {
      counts.signup++;
      assert.equal(request.postDataJSON().password, "Fixture-password-123!");
      assert.deepEqual(request.postDataJSON().data, { full_name: "Fixture Student" });
      if (options.signupFailure === "network") return route.abort("failed");
      if (options.signupFailure) return json({ msg: options.signupFailure, code: "fixture_error" }, options.signupStatus ?? 422);
      if (options.noSession) return json(user);
      return json(session);
    }
    if (url.pathname === "/auth/v1/logout") {
      counts.logout++;
      if (options.logoutFailure && counts.logout === 1) return json({ msg: "Too many requests" }, 429);
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/auth/v1/user") return json(user);
    if (url.pathname === "/rest/v1/profiles") return json([{ id: user.id, role: "student", full_name: "Fixture Student" }]);
    if (url.pathname === "/rest/v1/student_profiles") return json([{ profile_status: "pending", phone_number: "+84123456789", parent_name: "Fixture Parent", parent_phone_number: "+84987654321" }]);
    if (url.pathname === "/functions/v1/student-profile") {
      counts.profile++;
      assert.deepEqual(request.postDataJSON(), { full_name: "Fixture Student", phone_number: "+84123456789", parent_name: "Fixture Parent", parent_phone_number: "+84987654321" });
      assert.ok(!request.postData().includes("password"));
      if (options.profileFailure && counts.profile === 1) return route.abort("failed");
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      return json({ ok: true, profile_status: "pending" });
    }
    throw new Error(`Unexpected backend route: ${url.pathname}`);
  });
  await page.goto(`${base}/signup`);
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  return { page, context, counts, errors };
}

async function fill(page) {
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("Fixture-password-123!");
  await page.getByLabel("Student full name", { exact: true }).fill("Fixture Student");
  await page.getByLabel("Student phone number (Zalo)", { exact: true }).fill("+84123456789");
  await page.getByLabel("Parent / guardian full name", { exact: true }).fill("Fixture Parent");
  await page.getByLabel("Parent / guardian phone number (Zalo)", { exact: true }).fill("+84987654321");
}
const profileHeading = (page) => page.getByRole("heading", { name: "Your profile", exact: true });
try {
  {
    const f = await fixture({ delay: 250 });
    await f.page.goto(`${base}/login`);
    assert.match(await f.page.locator(".login-account-note").innerText(), /Don't have an account\? Sign up/);
    const link = f.page.getByRole("link", { name: "Sign up", exact: true });
    assert.equal(await link.getAttribute("href"), "/signup");
    await link.focus();
    await f.page.keyboard.press("Enter");
    await f.page.getByRole("heading", { name: "Create your account" }).waitFor();
    await f.page.screenshot({ path: fileURLToPath(new URL("desktop.png", artifacts)), fullPage: true });
    await fill(f.page);
    await f.page.getByRole("button", { name: "Show password" }).click();
    assert.equal(await f.page.getByLabel("Password", { exact: true }).getAttribute("type"), "text");
    await f.page.getByRole("button", { name: "Hide password" }).click();
    await f.page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No mobile overflow");
    await f.page.screenshot({ path: fileURLToPath(new URL("mobile.png", artifacts)), fullPage: true });
    await f.page.locator("form").evaluate((form) => { form.requestSubmit(); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await profileHeading(f.page).waitFor();
    assert.deepEqual(f.counts, { signup: 1, profile: 1, logout: 0 });
    assert.ok(await f.page.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith("-auth-token"))), "Signup session retained");
    await f.page.screenshot({ path: fileURLToPath(new URL("success.png", artifacts)), fullPage: true });
    assert.ok(f.page.url().endsWith("/student/profile"));
    await f.page.getByText("Awaiting approval", { exact: true }).waitFor();
    for (const route of ["dashboard", "practice", "tests", "results", "vocabulary"]) {
      await f.page.goto(`${base}/student/${route}`);
      await profileHeading(f.page).waitFor();
      assert.ok(f.page.url().endsWith("/student/profile"));
    }
    await f.page.getByRole("button", { name: "Open navigation", exact: true }).click();
    assert.equal(await f.page.getByRole("link", { name: "Dashboard", exact: true }).count(), 0);
    await f.page.getByRole("button", { name: "Sign out", exact: true }).click();
    await f.page.getByRole("heading", { name: "Welcome back" }).waitFor();
    assert.deepEqual(f.errors, []);
    await f.context.close();
    console.log("PASS: login link, keyboard activation, password toggle, desktop/mobile, duplicate-submit guard, signed-in profile, locked study routes, logout");
  }
  {
    const f = await fixture();
    await fill(f.page);
    await f.page.getByLabel("Email", { exact: true }).fill("bad-email");
    await f.page.getByRole("button", { name: "Submit for approval" }).click();
    assert.equal(f.counts.signup, 0);
    await f.page.getByLabel("Email", { exact: true }).fill(user.email);
    await f.page.getByLabel("Password", { exact: true }).fill("short");
    await f.page.getByRole("button", { name: "Submit for approval" }).click();
    assert.equal(f.counts.signup, 0);
    await f.page.getByLabel("Password", { exact: true }).fill("Fixture-password-123!");
    await f.page.getByLabel("Student phone number (Zalo)", { exact: true }).fill("abc12345");
    await f.page.getByRole("button", { name: "Submit for approval" }).click();
    await f.page.getByRole("alert").waitFor();
    assert.equal(f.counts.signup, 0);
    await f.context.close();
    console.log("PASS: invalid email, short password, invalid contact blocked before account creation");
  }
  for (const [failure, pattern, status] of [["User already registered", /already exists/, 422], ["Too many requests", /Too many attempts/, 429], ["network", /couldn’t connect/, 0]]) {
    const f = await fixture({ signupFailure: failure, signupStatus: status });
    await fill(f.page);
    await f.page.getByRole("button", { name: "Submit for approval" }).click();
    await f.page.getByRole("alert").waitFor();
    assert.match(await f.page.getByRole("alert").innerText(), pattern);
    assert.equal(f.counts.profile, 0);
    await f.context.close();
    console.log(`PASS: signup error ${failure}`);
  }
  {
    const f = await fixture({ profileFailure: true });
    await fill(f.page);
    await f.page.getByRole("button", { name: "Submit for approval" }).click();
    await f.page.getByRole("alert").waitFor();
    assert.match(await f.page.getByRole("alert").innerText(), /account was created/);
    assert.equal(await f.page.getByLabel("Password", { exact: true }).inputValue(), "");
    assert.equal(await f.page.getByLabel("Student full name", { exact: true }).inputValue(), "Fixture Student");
    await f.page.getByRole("button", { name: "Retry submission" }).click();
    await profileHeading(f.page).waitFor();
    assert.deepEqual(f.counts, { signup: 1, profile: 2, logout: 0 });
    await f.context.close();
    console.log("PASS: failed profile submission retries without creating a second account");
  }
  {
    const f = await fixture({ noSession: true });
    await fill(f.page);
    await f.page.getByRole("button", { name: "Submit for approval" }).click();
    await f.page.getByRole("alert").waitFor();
    assert.match(await f.page.getByRole("alert").innerText(), /Return to Login/);
    assert.equal(f.counts.profile, 0);
    await f.context.close();
    console.log("PASS: missing signup session has recovery instructions and does not claim success");
  }
} finally {
  await browser.close();
}
