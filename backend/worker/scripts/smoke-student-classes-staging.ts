import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
assert.equal(new URL(url).hostname, "wgkggknyndgaoyazdhdf.supabase.co", "Refusing non-staging project");
console.log("Verified staging project wgkggknyndgaoyazdhdf");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fixturePath = new URL("../tmp/classes-staging-fixtures.json", import.meta.url);
const state: { marker: string; users: Array<{ id: string; email: string; password: string }>; classIds: string[]; testIds: string[]; questionIds: string[]; classId?: string; practiceId?: string; fullId?: string } = process.argv.includes("--cleanup")
  ? JSON.parse(readFileSync(fixturePath, "utf8")) : { marker: `class-smoke-${randomUUID()}`, users: [], classIds: [], testIds: [], questionIds: [] };
function checked<T extends { error: any }>(value: T, label: string): T { if (value.error) throw new Error(`${label}: ${value.error.message}`); return value; }
const save = () => writeFileSync(fixturePath, JSON.stringify(state, null, 2));
async function account(name: string, admin = false) {
  const email = `${state.marker}-${state.users.length}@example.invalid`, password = `${randomUUID()}aA!9`;
  const user = checked(await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } }), "create fixture account").data.user!;
  state.users.push({ id: user.id, email, password }); save();
  checked(await db.from("profiles").update({ full_name: name, ...(admin ? { role: "admin" } : {}) }).eq("id", user.id), "fixture profile");
  if (!admin) checked(await db.from("student_profiles").update({ profile_status: "approved", phone_number: "+15550100001", parent_name: "Synthetic Parent", parent_phone_number: "+15550100002" }).eq("id", user.id), "approve fixture profile");
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = checked(await auth.auth.signInWithPassword({ email, password }), "fixture sign in");
  return { id: user.id, token: signed.data.session!.access_token, auth };
}
async function api(path: string, token?: string, method = "GET", body?: unknown) {
  const response = await fetch(`${url}/functions/v1/${path}`, { method, headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function cleanup() {
  for (const user of state.users) {
    const existing = checked(await db.auth.admin.getUserById(user.id), "verify fixture ownership");
    assert.ok(existing.data.user?.email?.startsWith(state.marker), "Fixture identity mismatch");
  }
  const admin = state.users[0]?.id;
  if (admin) {
    const tests = checked(await db.from("tests").select("id").eq("created_by", admin), "fixture tests").data ?? [];
    for (const test of tests) {
      checked(await db.from("test_assignments").delete().eq("test_id", test.id), "remove fixture assignments");
      checked(await db.from("practice_assignment_batches").delete().eq("snapshot_test_id", test.id), "remove fixture batches");
      checked(await db.from("tests").delete().eq("id", test.id), "remove fixture test");
    }
    checked(await db.from("questions").delete().eq("created_by", admin), "remove fixture questions");
    checked(await db.from("student_classes").delete().eq("created_by", admin), "remove fixture classes");
    checked(await db.from("audit_logs").delete().eq("actor_id", admin), "remove fixture audits");
  }
  for (const user of [...state.users].reverse()) checked(await db.auth.admin.deleteUser(user.id), "remove fixture account");
  unlinkSync(fixturePath);
  console.log("Disposable staging fixtures removed");
}
if (process.argv.includes("--cleanup")) { await cleanup(); process.exit(0); }
let passed = false;
try {
  const admin = await account("Class test admin", true), first = await account("Avery Student"), second = await account("Morgan Student");
  const name = `Saturday SAT ${state.marker.slice(-6)}`;
  const created = await api("admin-classes", admin.token, "POST", { name, student_ids: [first.id, second.id, first.id] });
  assert.equal(created.status, 201, JSON.stringify(created.body)); const classId = created.body.id; state.classIds.push(classId); state.classId = classId; save();
  const duplicate = await api("admin-classes", admin.token, "POST", { name: name.toUpperCase(), student_ids: [] }); assert.equal(duplicate.status, 422);
  const roster = await api("admin-classes", admin.token); assert.equal(roster.body.classes.find((c: any) => c.id === classId).student_ids.length, 2);
  assert.equal((await api("admin-classes", first.token)).status, 403);
  assert.equal((await api("admin-classes", first.token, "POST", { name: "Unauthorized", student_ids: [first.id] })).status, 403);
  const hidden = checked(await first.auth.from("student_class_members").select("*"), "student roster RLS"); assert.deepEqual(hidden.data, []);
  const empty = await api("admin-classes", admin.token, "POST", { name: `Empty ${name}`, student_ids: [] }); assert.equal(empty.status, 201); state.classIds.push(empty.body.id); save();
  const questionId = randomUUID(); state.questionIds.push(questionId); save();
  checked(await db.from("questions").insert({ id: questionId, section: "math", question_type: "student_produced", prompt: "Synthetic class assignment: what is two plus two?", correct_answer: "4", difficulty: 3, status: "active", created_by: admin.id }), "fixture question");
  for (const kind of ["practice", "full"] as const) {
    const test = checked(await db.from("tests").insert({ title: `${name} ${kind}`, kind, created_by: admin.id, is_public: false, status: "draft" }).select("id").single(), "fixture test").data;
    state.testIds.push(test.id); if (kind === "practice") state.practiceId = test.id; else state.fullId = test.id; save();
    const section = checked(await db.from("test_sections").insert({ test_id: test.id, name: "Math", section_type: "math", position: 1 }).select("id").single(), "fixture section").data;
    const module = checked(await db.from("test_modules").insert({ section_id: section.id, name: "Math Module 1", position: 1, time_limit_minutes: 10 }).select("id").single(), "fixture module").data;
    checked(await db.from("test_module_questions").insert({ module_id: module.id, question_id: questionId, position: 1 }), "fixture link");
  }
  const practice = await api("admin-practice-assignments", admin.token, "POST", { set_id: state.practiceId, class_id: classId, timer_minutes: 25 });
  assert.equal(practice.status, 201, JSON.stringify(practice.body)); assert.equal(practice.body.batch.assigned_count, 2); assert.equal(practice.body.batch.class_name, name);
  const full = await api(`admin-tests/${state.fullId}/assignees`, admin.token, "POST", { class_id: classId, content_scope: "math" });
  assert.equal(full.status, 201, JSON.stringify(full.body)); assert.equal(full.body.assigned, 2);
  for (const minutes of ["", 0, 601, 1.5]) assert.equal((await api("admin-practice-assignments", admin.token, "POST", { set_id: state.practiceId, class_id: classId, timer_minutes: minutes })).status, 422);
  assert.equal((await api("admin-practice-assignments", admin.token, "POST", { set_id: state.practiceId, class_id: empty.body.id, timer_minutes: 20 })).status, 422);
  const edited = await api(`admin-classes/${classId}`, admin.token, "PUT", { name: `${name} updated`, student_ids: [first.id] }); assert.equal(edited.status, 200);
  const invalid = await api(`admin-classes/${classId}`, admin.token, "PUT", { name, student_ids: [admin.id] }); assert.equal(invalid.status, 422);
  const current = await api("admin-classes", admin.token); assert.deepEqual(current.body.classes.find((c: any) => c.id === classId).student_ids, [first.id]);
  const history = await api(`admin-classes/${classId}`, admin.token); assert.equal(history.body.assignments.length, 2);
  const detail = await api(`admin-practice-assignments/${practice.body.batch.id}`, admin.token); assert.equal(detail.body.students.length, 2); assert.equal(detail.body.batch.class_name, name);
  const fullDetail = await api(`admin-tests/assignment-batches/${full.body.batch.id}`, admin.token); assert.equal(fullDetail.body.students.length, 2); assert.equal(fullDetail.body.batch.class_name, name);
  const personal = await api("admin-practice-assignments", admin.token, "POST", { set_id: state.practiceId, student_ids: [first.id], timer_minutes: 1 }); assert.equal(personal.status, 201); assert.equal(personal.body.batch.class_name, null);
  const mine = await api("student-tests", second.token); assert.equal(mine.status, 200, JSON.stringify(mine.body)); assert.ok(mine.body.tests.some((t: any) => t.class_name === name), "Student assignment class label missing");
  passed = true;
  console.log(JSON.stringify({ class_creation: true, member_deduplication: true, admin_only_and_RLS: true, practice_and_full_class_assignments: true, membership_snapshot: true, rename_history: true, invalid_membership_atomic: true, empty_class_rejected: true, timer_validation: true, student_labels: true, individual_assignment_unchanged: true }));
} finally {
  if (passed && process.argv.includes("--keep-for-ui")) console.log("Disposable fixtures retained for local browser checks; run with --cleanup afterward.");
  else await cleanup();
}
