import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
if (!process.argv.includes(`--project-ref=${ref}`)) throw new Error("Explicit staging reference required");
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/); return m ? [[m[1], m[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const worker = env("../worker/.env"), frontend = env("../../frontend/.env.local"), accounts = env(".env");
for (const url of [worker.SUPABASE_URL, frontend.VITE_SUPABASE_URL]) assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const service = createClient(worker.SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const anonymous = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const scope = `admin-practice-assignments/${crypto.randomUUID()}`;
let owner, studentId;
try {
  const login = await admin.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD });
  assert.equal(login.error, null, "Existing staging administrator login"); owner = login.data.user.id;
  const q = await service.from("questions").select("id").limit(1).single(); assert.equal(q.error, null);
  const document = { version: 1, theme: "black", notes: "Annotation integration fixture", height: 1000,
    strokes: [{ points: [[10, 10], [100, 100]], color: "#ffffff", width: 3, opacity: 1 }],
    comments: [{ id: "comment-fixture", text: "Linked plain-text comment", x: 500, y: 600, width: 400, height: 300, highlights: [{ x: 40, y: 100, width: 200, height: 20 }] }] };
  const row = { owner_id: owner, scope, question_id: q.data.id, content_hash: "a".repeat(64), document };
  assert.equal((await admin.from("admin_review_annotations").upsert(row)).error, null, "Admin save");
  const loaded = await admin.from("admin_review_annotations").select("document").eq("scope", scope).single();
  assert.equal(loaded.error, null); assert.deepEqual(loaded.data.document, document, "Reload parity");
  for (const invalid of [{ ...document, theme: null }, { ...document, strokes: [{ ...document.strokes[0], color: null }] }, { ...document, notes: "x".repeat(10001) }]) {
    assert.ok((await admin.from("admin_review_annotations").update({ document: invalid }).eq("scope", scope)).error, "Malformed documents rejected by database");
  }
  for (const comment of [{ ...document.comments[0], x: 701 }, { ...document.comments[0], y: 821 }, { ...document.comments[0], width: 601 }, { ...document.comments[0], width: null }, { ...document.comments[0], height: 119 }, { ...document.comments[0], x: 650 }, { ...document.comments[0], text: "x".repeat(2001) }, { ...document.comments[0], highlights: [{ x: 900, y: 100, width: 200, height: 20 }] }]) {
    assert.ok((await admin.from("admin_review_annotations").update({ document: { ...document, comments: [comment] } }).eq("scope", scope)).error, "Invalid comment rejected by database");
  }
  assert.ok((await anonymous.from("admin_review_annotations").select("document")).error, "Anonymous access rejected");
  const email = `annotation-check-${crypto.randomUUID()}@example.invalid`, password = `${crypto.randomUUID()}-Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null); studentId = created.data.user.id;
  const student = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
  assert.equal((await student.auth.signInWithPassword({ email, password })).error, null);
  const forbiddenRead = await student.from("admin_review_annotations").select("document").eq("scope", scope);
  assert.equal(forbiddenRead.error, null); assert.deepEqual(forbiddenRead.data, [], "Student cannot read admin boards");
  assert.ok((await student.from("admin_review_annotations").insert({ ...row, owner_id: studentId })).error, "Student cannot save boards");
  assert.ok((await admin.from("admin_review_annotations").update({ owner_id: studentId }).eq("scope", scope)).error, "Owner cannot be forged");
  console.log("PASS: administrator save/reload, database validation, anonymous/student denial, owner isolation");
} finally {
  if (owner) await service.from("admin_review_annotations").delete().eq("owner_id", owner).eq("scope", scope);
  if (studentId) await service.auth.admin.deleteUser(studentId);
}
