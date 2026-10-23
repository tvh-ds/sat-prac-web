import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
assert.equal(new URL(url).hostname, "wgkggknyndgaoyazdhdf.supabase.co", "Refusing non-staging project");
console.log("Verified staging project wgkggknyndgaoyazdhdf");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fixturePath = new URL("../tmp/admin-tracking-staging-fixtures.json", import.meta.url);
const state: { marker: string; users: Array<{ id: string; email: string; password: string }>; classIds: string[]; testIds: string[]; questionIds: string[]; classId?: string; practiceId?: string; fullId?: string } = (process.argv.includes("--cleanup") || process.argv.includes("--verify-existing"))
  ? JSON.parse(readFileSync(fixturePath, "utf8")) : { marker: `tracking-smoke-${randomUUID()}`, users: [], classIds: [], testIds: [], questionIds: [] };
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
    checked(await db.from("vocab_decks").delete().eq("created_by", admin), "remove fixture vocabulary decks");
    checked(await db.from("questions").delete().eq("created_by", admin), "remove fixture questions");
    checked(await db.from("student_classes").delete().eq("created_by", admin), "remove fixture classes");
    checked(await db.from("audit_logs").delete().eq("actor_id", admin), "remove fixture audits");
  }
  for (const user of [...state.users].reverse()) checked(await db.auth.admin.deleteUser(user.id), "remove fixture account");
  unlinkSync(fixturePath);
  console.log("Disposable staging fixtures removed");
}
if (process.argv.includes("--cleanup")) { await cleanup(); process.exit(0); }
if (process.argv.includes("--verify-existing")) {
  const fixture = state.users[0]!;
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = checked(await auth.auth.signInWithPassword({ email: fixture.email, password: fixture.password }), "verify fixture sign in");
  const token = signed.data.session!.access_token;
  const detail = await api(`admin-students/${state.users[1]!.id}`, token);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.practice_assignments.length, 2);
  assert.equal(detail.body.full_assignments.length, 1);
  assert.equal(detail.body.full_assignments[0].status, "completed");
  assert.equal(detail.body.vocabulary.decks.length, 2);
  const roster = await api("admin-students?progress=1", token);
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  assert.equal(roster.body.students.find((s: any) => s.id === state.users[1]!.id).assignment_progress.length, 3);
  const history = await api(`admin-classes/${state.classId}`, token);
  assert.equal(history.status, 200, JSON.stringify(history.body));
  for (const assignment of history.body.assignments) {
    assert.equal(assignment.student_count, 2); assert.equal(assignment.completed_count, 1);
    const endpoint = assignment.kind === "practice" ? `admin-practice-assignments/${assignment.id}` : `admin-tests/assignment-batches/${assignment.id}`;
    const report = await api(endpoint, token);
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.equal(report.body.students.length, 2);
    assert.equal(report.body.students.filter((s: any) => s.status === "graded").length, 1);
    assert.ok(report.body.students.every((s: any) => s.email));
  }
  console.log("PASS: final deployed pagination, complete roster/history, full/practice recipients, emails and completion counts");
  process.exit(0);
}

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
  // Complete one assignment of each kind while preserving every unstarted recipient.
  for (const testId of [practice.body.batch.snapshot_test_id, state.fullId]) {
    const assignment = checked(await db.from("test_assignments").select("id,test_id").eq("student_id", first.id).eq("test_id", testId).single(), "fixture assignment").data;
    const attempt = checked(await db.from("attempts").insert({ student_id: first.id, test_id: assignment.test_id, assignment_id: assignment.id, status: "graded", submitted_at: new Date().toISOString() }).select("id").single(), "completed fixture attempt").data;
    checked(await db.from("scores").insert({ attempt_id: attempt.id, raw_score: 1, total_questions: 1 }), "fixture score");
  }
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000);
  const later = new Date((now.getTime() + tomorrow.getTime()) / 2).toISOString();
  const assignedAt = new Date(now.getTime() - 180000).toISOString();
  const deck = checked(await db.from("vocab_decks").insert({ name: `${state.marker} daily vocabulary`, student_id: null, created_by: admin.id, status: "active" }).select("id").single(), "fixture deck").data;
  const archive = checked(await db.from("vocab_decks").insert({ name: `${state.marker} archived vocabulary`, student_id: null, created_by: admin.id, status: "archived" }).select("id").single(), "fixture archived deck").data;
  checked(await db.from("vocab_deck_assignments").insert([{ deck_id: deck.id, student_id: first.id, assigned_at: assignedAt }, { deck_id: deck.id, student_id: second.id, assigned_at: assignedAt }, { deck_id: archive.id, student_id: first.id, assigned_at: assignedAt }]), "fixture deck assignments");
  const cards = checked(await db.from("vocab_cards").insert(["alpha", "beta", "gamma"].map(word => ({ deck_id: deck.id, word, definition: "Synthetic tracking fixture", created_at: new Date(now.getTime() - 120000).toISOString() }))).select("id"), "fixture cards").data!;
  const future = new Date(tomorrow.getTime() + 86400000).toISOString();
  checked(await db.from("vocab_card_state").insert([
    { student_id: first.id, card_id: cards[0].id, due_at: future, status: "review", fsrs_state: "review", last_reviewed_at: now.toISOString() },
    { student_id: first.id, card_id: cards[2].id, due_at: later, status: "review", fsrs_state: "review" },
    ...cards.map(card => ({ student_id: second.id, card_id: card.id, due_at: future, status: "review", fsrs_state: "review" })),
  ]), "fixture schedules");
  checked(await db.from("vocab_reviews").insert([1000, 2000].map((response_ms, index) => ({ student_id: first.id, card_id: cards[0].id, reviewed_on: today, response_ms, mode: "study", rating: 3, created_at: new Date(now.getTime() - 60000 + index * 1000).toISOString(), state_before: { due_at: new Date(now.getTime() - 3600000).toISOString(), fsrs_state: "review" } }))), "fixture study reviews");
  const student = await api(`admin-students/${first.id}`, admin.token);
  assert.equal(student.status, 200, JSON.stringify(student.body));
  assert.equal(student.body.practice_assignments.length, 2);
  assert.equal(student.body.practice_assignments.filter((a: any) => a.status === "completed").length, 1);
  assert.equal(student.body.full_assignments.length, 1);
  assert.equal(student.body.full_assignments[0].status, "completed");
  assert.equal(student.body.full_assignments[0].raw_score, 1);
  const vocab = student.body.vocabulary.decks.find((d: any) => d.deck_id === deck.id);
  assert.equal(vocab.remaining_today, 2);
  assert.equal(vocab.due_later_today, 1);
  assert.equal(vocab.history.at(-1).studied_due, 1);
  assert.equal(vocab.history.at(-1).total_due, 3);
  assert.equal(vocab.history.at(-1).tracked_ms, 3000);
  assert.equal(vocab.history.at(-1).average_card_ms, 3000);
  assert.ok(student.body.vocabulary.decks.some((d: any) => d.deck_id === archive.id), "Archived assignments must remain visible");
  const rosterProgress = await api("admin-students?progress=1", admin.token);
  assert.equal(rosterProgress.status, 200, JSON.stringify(rosterProgress.body));
  assert.equal(rosterProgress.body.students.find((s: any) => s.id === first.id).assignment_progress.length, 3);
  assert.equal((await api("admin-students?progress=1", first.token)).status, 403);
  assert.equal((await api(`admin-students/${first.id}`, second.token)).status, 403);
  const classProgress = await api(`admin-classes/${classId}`, admin.token);
  assert.equal(classProgress.body.assignments.length, 2);
  assert.ok(classProgress.body.assignments.every((a: any) => a.student_count === 2 && a.completed_count === 1));
  const pList = await api("admin-practice-assignments", admin.token);
  const fList = await api("admin-tests/assignment-batches", admin.token);
  assert.equal(pList.body.batches.find((b: any) => b.id === practice.body.batch.id).completed_count, 1);
  assert.equal(fList.body.batches.find((b: any) => b.id === full.body.batch.id).completed_count, 1);
  const vList = await api("admin-vocab/assignments", admin.token);
  assert.equal(vList.body.decks.find((d: any) => d.id === deck.id).students.length, 2);
  assert.equal(vList.body.decks.find((d: any) => d.id === deck.id).students.find((s: any) => s.student_id === second.id).remaining_today, 0);
  console.log("PASS: exhaustive practice/full histories, retained recipients, archived decks, unique reviewed/due, remaining/new/later counts, timing averages, roster summaries, and admin-only access");
  passed = true;
  console.log(JSON.stringify({ class_creation: true, member_deduplication: true, admin_only_and_RLS: true, practice_and_full_class_assignments: true, membership_snapshot: true, rename_history: true, invalid_membership_atomic: true, empty_class_rejected: true, timer_validation: true, student_labels: true, individual_assignment_unchanged: true }));
} finally {
  if (passed && process.argv.includes("--keep-for-ui")) console.log("Disposable fixtures retained for local browser checks; run with --cleanup afterward.");
  else await cleanup();
}
