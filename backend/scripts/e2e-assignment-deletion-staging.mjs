import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${ref}`), "Explicit staging reference required");
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/); return m ? [[m[1], m[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const worker = env("../worker/.env"), frontend = env("../../frontend/.env.local"), accounts = env(".env");
for (const url of [worker.SUPABASE_URL, frontend.VITE_SUPABASE_URL]) assert.equal(new URL(url).hostname, `${ref}.supabase.co`);
console.log(`Verified staging target: ${ref}`);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(worker.SUPABASE_URL, worker.SUPABASE_SERVICE_ROLE_KEY, options);
const admin = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
const students = [], tests = [], classes = [], decks = [];
const prefix = `assignment-check-${crypto.randomUUID()}`;
async function must(query) { const r = await query; assert.equal(r.error, null, r.error?.message); return r.data; }
async function insert(table, row) { return must(service.from(table).insert(row).select().single()); }
async function exists(table, id) { return (await must(service.from(table).select("id").eq("id", id))).length > 0; }
let token, owner;
async function api(path, method = "GET", bearer = token) {
  const headers = { apikey: frontend.VITE_SUPABASE_ANON_KEY };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${worker.SUPABASE_URL}/functions/v1/${path}`, { method, headers });
  const body = await res.json();
  return { status: res.status, body };
}
try {
  const login = await admin.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD });
  assert.equal(login.error, null); token = login.data.session.access_token; owner = login.data.user.id;
  let studentToken;
  for (let i = 0; i < 2; i++) {
    const email = `${prefix}-${i}@example.invalid`, password = `${crypto.randomUUID()}-Aa1!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null); students.push(created.data.user.id);
    if (i === 0) {
      const client = createClient(worker.SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, options);
      const signed = await client.auth.signInWithPassword({ email, password });
      assert.equal(signed.error, null); studentToken = signed.data.session.access_token;
    }
  }
  const cls = await insert("student_classes", { name: prefix, created_by: owner }); classes.push(cls.id);
  const empty = await insert("student_classes", { name: `${prefix}-empty`, created_by: owner }); classes.push(empty.id);
  await must(service.from("student_class_members").insert({ class_id: cls.id, student_id: students[0] }));
  async function test(kind) { const row = await insert("tests", { title: `${prefix}-${kind}`, kind, status: "published", is_public: false, created_by: owner }); tests.push(row.id); return row; }
  const source = await test("practice"), snapshot = await test("practice"), full = await test("full");
  const practiceBatch = await insert("practice_assignment_batches", { source_test_id: source.id, snapshot_test_id: snapshot.id, title: prefix, timer_minutes: 20, class_id: cls.id, class_name: cls.name, assigned_by: owner });
  const fullBatch = await insert("full_test_assignment_batches", { source_test_id: full.id, title: prefix, class_id: cls.id, class_name: cls.name, assigned_by: owner });
  const neighbor = await insert("full_test_assignment_batches", { source_test_id: full.id, title: `${prefix}-keep`, assigned_by: owner });
  const assignments = [];
  for (const [testId, batchId] of [[snapshot.id, null], [full.id, fullBatch.id], [full.id, neighbor.id]]) {
    assignments.push(await insert("test_assignments", { test_id: testId, student_id: students[0], assignment_batch_id: batchId, assigned_by: owner }));
  }
  const attempts = [];
  for (const assignment of assignments) {
    const attempt = await insert("attempts", { student_id: students[0], test_id: assignment.test_id, assignment_id: assignment.id, status: "graded" }); attempts.push(attempt);
    await insert("scores", { attempt_id: attempt.id, raw_score: 1, total_questions: 1 });
  }
  for (const path of [`admin-practice-assignments/${practiceBatch.id}`, `admin-tests/assignment-batches/${fullBatch.id}`]) {
    assert.ok([401, 403].includes((await api(path, "DELETE", "")).status), "Anonymous deletion must fail");
    assert.equal((await api(path, "DELETE", studentToken)).status, 403, "Student deletion must fail");
  }
  assert.ok((await admin.rpc("delete_assignment_batch", { p_kind: "full", p_id: fullBatch.id, p_admin_id: owner })).error, "Direct authenticated RPC must fail");
  assert.equal((await api("admin-practice-assignments/not-a-uuid", "DELETE")).status, 422);
  assert.equal((await api(`admin-practice-assignments/${practiceBatch.id}`, "DELETE")).status, 200);
  for (const [table, id] of [["practice_assignment_batches", practiceBatch.id], ["tests", snapshot.id], ["test_assignments", assignments[0].id], ["attempts", attempts[0].id]]) assert.equal(await exists(table, id), false, `${table} practice cascade`);
  assert.equal(await exists("tests", source.id), true, "Practice source is kept");
  assert.equal((await api(`admin-practice-assignments/${practiceBatch.id}`, "DELETE")).status, 404);
  assert.equal((await api(`admin-tests/assignment-batches/${fullBatch.id}`, "DELETE")).status, 200);
  for (const [table, id] of [["full_test_assignment_batches", fullBatch.id], ["test_assignments", assignments[1].id], ["attempts", attempts[1].id]]) assert.equal(await exists(table, id), false, `${table} full batch deletion`);
  for (const [table, id] of [["tests", full.id], ["full_test_assignment_batches", neighbor.id], ["test_assignments", assignments[2].id], ["attempts", attempts[2].id]]) assert.equal(await exists(table, id), true, `${table} unrelated data is kept`);
  assert.equal((await must(service.from("scores").select("attempt_id").in("attempt_id", attempts.map(a => a.id)))).length, 1, "Only deleted batch scores removed");

  const deck = await insert("vocab_decks", { name: prefix, student_id: null, created_by: owner }); decks.push(deck.id);
  const card = await insert("vocab_cards", { deck_id: deck.id, word: "fixture", definition: "Temporary staging check" });
  await must(service.from("vocab_deck_assignments").insert(students.map(student_id => ({ deck_id: deck.id, student_id, assigned_by: owner }))));
  const review = await insert("vocab_reviews", { card_id: card.id, student_id: students[0], rating: 3, mode: "study" });
  const path = `admin-vocab/assignments/${deck.id}`;
  assert.equal((await api(path, "DELETE", studentToken)).status, 403);
  const report = await api(`${path}?class_id=${cls.id}`);
  assert.equal(report.status, 200); assert.deepEqual(report.body.decks[0].students.map(s => s.student_id), [students[0]], "Report contains only class member");
  assert.equal((await api(`${path}?class_id=${empty.id}`, "DELETE")).status, 200);
  assert.equal((await must(service.from("vocab_deck_assignments").select("id").eq("deck_id", deck.id))).length, 2, "Empty class deletion never broadens scope");
  assert.equal((await api(`${path}?class_id=${cls.id}`, "DELETE")).status, 200);
  assert.deepEqual((await must(service.from("vocab_deck_assignments").select("student_id").eq("deck_id", deck.id))).map(s => s.student_id), [students[1]], "Other class students keep access");
  assert.equal(await exists("vocab_reviews", review.id), true, "Review history preserved");
  assert.equal((await api(path, "DELETE")).status, 200);
  assert.equal((await must(service.from("vocab_deck_assignments").select("id").eq("deck_id", deck.id))).length, 0);
  assert.equal(await exists("vocab_decks", deck.id), true, "Deck preserved");
  const audit = await must(service.from("audit_logs").select("id").eq("action", "assignment.deleted").in("entity_id", [practiceBatch.id, fullBatch.id]));
  assert.equal(audit.length, 2, "Batch deletions audited");
  console.log("PASS: admin authorization, validation, batch/result deletion, source and repeat isolation, class filtering, class-scoped vocabulary deletion, empty-class protection, review preservation, audit logs");
} finally {
  for (const id of decks) await must(service.from("vocab_decks").delete().eq("id", id).eq("name", prefix));
  for (const id of tests) await must(service.from("tests").delete().eq("id", id).like("title", `${prefix}%`));
  for (const id of classes) await must(service.from("student_classes").delete().eq("id", id).like("name", `${prefix}%`));
  for (const id of students) {
    const r = await service.auth.admin.getUserById(id);
    assert.ok(r.data.user?.email?.startsWith(prefix), "Cleanup requires fixture ownership");
    assert.equal((await service.auth.admin.deleteUser(id)).error, null);
  }
  console.log("Temporary staging fixtures cleaned up.");
}
