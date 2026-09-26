import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { performance } from "node:perf_hooks";

const STAGING_PROJECT_REF = "wgkggknyndgaoyazdhdf";
const PRODUCTION_PROJECT_REF = "ygqndcgpbtmewzkruyuq";
const WAVES = 10;
const STUDENTS = 7;
const VOCAB_CARDS = 120;
const LABELS = ["A", "B", "C", "D"] as const;

type StudentFixture = { id: string; email: string; practiceAssignmentId: string; fullAssignmentId: string };
type Manifest = {
  version: 1;
  runId: string;
  projectRef: string;
  createdAt: string;
  tempDir: string;
  password: string;
  students: StudentFixture[];
  practiceTestId: string;
  fullTestId: string;
  practiceModuleId: string;
  fullModuleIds: string[];
  questionIds: string[];
  choiceIdsByQuestion: Record<string, string[]>;
  vocabDeckId: string;
  vocabCardIds: string[];
  storagePaths: string[];
};

type TimedSample = { durationMs: number; ok: boolean; status?: number };
type MetricSummary = {
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  samples: number;
  errors: number;
  status_errors: Record<string, number>;
};
type RunResult = {
  phase: "baseline" | "after";
  runId: string;
  projectRef: string;
  startedAt: string;
  finishedAt: string;
  waves: number;
  users: number;
  environment: { urlHost: string; buildRevision: string; sourceSubmitSha256: string; region: string | null };
  metrics: Record<string, MetricSummary>;
  verification: Record<string, unknown>;
};

const here = dirname(fileURLToPath(import.meta.url));
const frontendEnvPath = resolve(here, "../../frontend/.env.local");
if (existsSync(frontendEnvPath)) {
  const frontendEnv = parseDotenv(readFileSync(frontendEnvPath));
  process.env.VITE_SUPABASE_URL ??= frontendEnv.VITE_SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY ??= frontendEnv.VITE_SUPABASE_ANON_KEY;
}

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
};
const has = (name: string) => argv.includes(name);
const phase = arg("--phase") as "baseline" | "after" | undefined;
const manifestArg = arg("--manifest");
const confirmedRef = arg("--confirm-ref");

function assertEnvironment(): { url: string; serviceKey: string; anonKey: string; ref: string } {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !serviceKey || !anonKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and VITE_SUPABASE_ANON_KEY for the staging project.");
  }
  const ref = new URL(url).hostname.split(".")[0];
  if (ref === PRODUCTION_PROJECT_REF || ref !== STAGING_PROJECT_REF || confirmedRef !== STAGING_PROJECT_REF) {
    throw new Error("Refusing load-test writes: target must be the explicitly confirmed staging project.");
  }
  const frontendUrl = process.env.VITE_SUPABASE_URL;
  if (frontendUrl && new URL(frontendUrl).hostname.split(".")[0] !== ref) {
    throw new Error("Frontend and backend Supabase environments point to different projects.");
  }
  return { url, serviceKey, anonKey, ref };
}

function assert<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} did not return data`);
  return value;
}

function check<T>(label: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${label} failed (${(result.error as { code?: string }).code ?? "database error"})`);
  return result.data;
}

function writeManifest(manifest: Manifest): void {
  writeFileSync(join(manifest.tempDir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
}

function readManifest(manifestPath: string): Manifest {
  const manifestRealPath = realpathSync(manifestPath);
  const rootRealPath = realpathSync(tmpdir());
  const tempDirRealPath = realpathSync(dirname(manifestRealPath));
  if (dirname(tempDirRealPath) !== rootRealPath || !tempDirRealPath.toLowerCase().includes("sat-performance-")) {
    throw new Error("Refusing manifest outside its owned temporary run directory.");
  }
  const loaded = JSON.parse(readFileSync(manifestRealPath, "utf8")) as Manifest;
  if (loaded.version !== 1 || loaded.tempDir !== tempDirRealPath || !/^perf-[a-z0-9-]{8,80}$/.test(loaded.runId)) {
    throw new Error("Invalid or unexpected load-test manifest.");
  }
  return loaded;
}

function createOwnedManifest(): Manifest {
  const runId = `perf-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`.toLowerCase();
  const tempDir = join(tmpdir(), `sat-performance-${randomBytes(8).toString("hex")}`);
  mkdirSync(tempDir, { recursive: false, mode: 0o700 });
  return {
    version: 1,
    runId,
    projectRef: STAGING_PROJECT_REF,
    createdAt: new Date().toISOString(),
    tempDir,
    password: `Perf-${randomBytes(30).toString("base64url")}-Q7!`,
    students: [],
    practiceTestId: randomUUID(),
    fullTestId: randomUUID(),
    practiceModuleId: randomUUID(),
    fullModuleIds: [],
    questionIds: [],
    choiceIdsByQuestion: {},
    vocabDeckId: randomUUID(),
    vocabCardIds: [],
    storagePaths: Array.from({ length: 3 }, (_, index) => `performance-runs/${runId}/stimulus-${index + 1}.png`),
  };
}

function fixtureImage(): Buffer {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMk0AAAAASUVORK5CYII=", "base64");
}

async function seedFixture(db: SupabaseClient, url: string, anonKey: string, manifest: Manifest): Promise<void> {
  const fullSections = [randomUUID(), randomUUID()];
  const practiceSection = randomUUID();
  const moduleIds: string[] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  manifest.fullModuleIds = moduleIds;
  const questionRows: Array<Record<string, unknown>> = [];
  const choiceRows: Array<Record<string, unknown>> = [];
  const linkRows: Array<Record<string, unknown>> = [];
  let globalIndex = 0;
  const modules: Array<{ id: string; sectionId: string; section: "reading_writing" | "math"; count: number; name: string }> = [
    { id: moduleIds[0], sectionId: fullSections[0], section: "reading_writing", count: 27, name: "Module 1" },
    { id: moduleIds[1], sectionId: fullSections[0], section: "reading_writing", count: 27, name: "Module 2" },
    { id: moduleIds[2], sectionId: fullSections[1], section: "math", count: 22, name: "Module 1" },
    { id: moduleIds[3], sectionId: fullSections[1], section: "math", count: 22, name: "Module 2" },
  ];

  for (const studentIndex of Array.from({ length: STUDENTS }, (_, i) => i)) {
    const email = `${manifest.runId}+student${studentIndex + 1}@example.test`;
    const created = await db.auth.admin.createUser({
      email,
      password: manifest.password,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic Load Student ${studentIndex + 1}` },
    });
    const user = assert(created.data.user, "Create synthetic student");
    if (created.error) throw new Error(`Create synthetic student failed (${created.error.code ?? "Auth error"}).`);
    const student: StudentFixture = {
      id: user.id,
      email,
      practiceAssignmentId: randomUUID(),
      fullAssignmentId: randomUUID(),
    };
    manifest.students.push(student);
    writeManifest(manifest);

    check("Set synthetic student identity", await db.from("profiles").update({ role: "student", full_name: `Synthetic Load Student ${studentIndex + 1}` }).eq("id", user.id));
    check("Approve synthetic student", await db.from("student_profiles").update({
      phone_number: "+1555000" + String(studentIndex + 1).padStart(4, "0"),
      parent_name: "Synthetic Test Parent",
      parent_phone_number: "+1555111" + String(studentIndex + 1).padStart(4, "0"),
      profile_status: "approved",
      profile_submitted_at: new Date().toISOString(),
      profile_approved_at: new Date().toISOString(),
    }).eq("id", user.id));
  }
  writeManifest(manifest);

  const { data: buckets, error: bucketError } = await db.storage.listBuckets();
  if (bucketError) throw new Error("Unable to verify the existing question-assets bucket.");
  if (!(buckets ?? []).some((bucket) => bucket.name === "question-assets")) {
    throw new Error("The existing question-assets bucket is missing; no global bucket was created.");
  }
  for (const storagePath of manifest.storagePaths) {
    const uploaded = await db.storage.from("question-assets").upload(storagePath, fixtureImage(), {
      contentType: "image/png",
      upsert: false,
    });
    if (uploaded.error) throw new Error(`Upload synthetic visual fixture failed (${uploaded.error.statusCode ?? "storage error"}).`);
  }

  for (const [moduleIndex, module] of modules.entries()) {
    for (let position = 1; position <= module.count; position++) {
      const questionId = randomUUID();
      manifest.questionIds.push(questionId);
      const choiceIds = LABELS.map(() => randomUUID());
      manifest.choiceIdsByQuestion[questionId] = choiceIds;
      questionRows.push({
        id: questionId,
        section: module.section,
        question_type: "multiple_choice",
        prompt: `Synthetic ${module.section} load-test question ${globalIndex + 1}: choose A.`,
        domain: module.section === "math" ? "Algebra" : "Information and Ideas",
        skill: "Synthetic benchmark",
        difficulty: 2,
        correct_answer: "A",
        explanation: "Synthetic performance fixture.",
        status: "active",
        stimulus_image_path: globalIndex < 9 ? manifest.storagePaths[globalIndex % manifest.storagePaths.length] : null,
      });
      choiceRows.push(...LABELS.map((label, choiceIndex) => ({
        id: choiceIds[choiceIndex], question_id: questionId, label,
        text: `Synthetic choice ${label}`,
        is_correct: choiceIndex === 0,
        position: choiceIndex + 1,
      })));
      linkRows.push({ id: randomUUID(), module_id: module.id, question_id: questionId, position, points: 1 });
      globalIndex++;
    }
  }
  writeManifest(manifest);

  const tests = [
    { id: manifest.fullTestId, title: `${manifest.runId} full-length 98`, description: "Synthetic performance fixture; safe to delete by run ID.", status: "published", is_public: false, kind: "full" },
    { id: manifest.practiceTestId, title: `${manifest.runId} practice 20`, description: "Synthetic performance fixture; safe to delete by run ID.", status: "published", is_public: false, kind: "practice" },
  ];
  check("Insert synthetic tests", await db.from("tests").insert(tests));
  const sectionRows = [
    { id: fullSections[0], test_id: manifest.fullTestId, name: "Reading and Writing", section_type: "reading_writing", position: 1 },
    { id: fullSections[1], test_id: manifest.fullTestId, name: "Math", section_type: "math", position: 2 },
    { id: practiceSection, test_id: manifest.practiceTestId, name: "Reading and Writing Practice", section_type: "reading_writing", position: 1 },
  ];
  check("Insert synthetic sections", await db.from("test_sections").insert(sectionRows));
  const moduleRows = [
    ...modules.map((module, index) => ({ id: module.id, section_id: module.sectionId, name: module.name, time_limit_minutes: index < 2 ? 32 : 35, position: index % 2 + 1, is_adaptive: false })),
    { id: manifest.practiceModuleId, section_id: practiceSection, name: "20-question Practice", time_limit_minutes: 15, position: 1, is_adaptive: false },
  ];
  check("Insert synthetic modules", await db.from("test_modules").insert(moduleRows));
  check("Insert synthetic questions", await db.from("questions").insert(questionRows));
  check("Insert synthetic choices", await db.from("question_choices").insert(choiceRows));
  const practiceLinks = linkRows.filter((row) => moduleIds.includes(String(row.module_id))).slice(0, 20).map((row, index) => ({
    id: randomUUID(), module_id: manifest.practiceModuleId, question_id: row.question_id, position: index + 1, points: 1,
  }));
  check("Insert synthetic question links", await db.from("test_module_questions").insert([...linkRows, ...practiceLinks]));

  const assignments = manifest.students.flatMap((student) => [
    { id: student.practiceAssignmentId, test_id: manifest.practiceTestId, student_id: student.id, status: "assigned", content_scope: "full_test", module_ids: [] },
    { id: student.fullAssignmentId, test_id: manifest.fullTestId, student_id: student.id, status: "assigned", content_scope: "full_test", module_ids: [] },
  ]);
  check("Assign synthetic tests", await db.from("test_assignments").insert(assignments));

  check("Insert synthetic vocabulary deck", await db.from("vocab_decks").insert({
    id: manifest.vocabDeckId,
    student_id: null,
    name: `${manifest.runId} synthetic vocabulary`,
    description: "Synthetic load-test fixture.",
    color: "#2856a8",
    status: "active",
  }));
  const cards = Array.from({ length: VOCAB_CARDS }, (_, index) => ({
    id: randomUUID(),
    deck_id: manifest.vocabDeckId,
    word: `${manifest.runId}-word-${String(index + 1).padStart(3, "0")}`,
    definition: `Synthetic definition ${index + 1} for a vocabulary load test.`,
    example_sentence: "This is synthetic data used only for a staging performance test.",
    part_of_speech: "noun",
    tags: ["synthetic", "performance-test"],
  }));
  manifest.vocabCardIds = cards.map((card) => card.id);
  writeManifest(manifest);
  check("Insert synthetic vocabulary cards", await db.from("vocab_cards").insert(cards));
  check("Assign synthetic vocabulary deck", await db.from("vocab_deck_assignments").insert(
    manifest.students.map((student) => ({ deck_id: manifest.vocabDeckId, student_id: student.id })),
  ));
  void url;
  void anonKey;
}

function summarize(samples: TimedSample[]): MetricSummary {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (p: number) => durations.length === 0 ? null : Math.round(durations[Math.max(0, Math.ceil((p / 100) * durations.length) - 1)] * 10) / 10;
  const statusErrors: Record<string, number> = {};
  for (const sample of samples) if (!sample.ok) {
    const label = String(sample.status ?? "unknown");
    statusErrors[label] = (statusErrors[label] ?? 0) + 1;
  }
  return {
    p50_ms: percentile(50),
    p95_ms: percentile(95),
    p99_ms: percentile(99),
    max_ms: durations.length ? Math.round(durations.at(-1)! * 10) / 10 : null,
    samples: samples.length,
    errors: samples.filter((sample) => !sample.ok).length,
    status_errors: statusErrors,
  };
}

function createTimedCall(
  metrics: Map<string, TimedSample[]>,
  errors: Array<{ action: string; status?: number; errorKind: string }>,
) {
  return async function measure<T>(name: string, action: () => Promise<T>): Promise<T | null> {
    const started = performance.now();
    try {
      const result = await action();
      const rows = metrics.get(name) ?? [];
      rows.push({ durationMs: performance.now() - started, ok: true });
      metrics.set(name, rows);
      return result;
    } catch (cause) {
      const status = typeof cause === "object" && cause !== null && "status" in cause ? Number((cause as { status: unknown }).status) : undefined;
      const errorKind = status ? "http" : cause instanceof Error ? cause.name : "unknown";
      const rows = metrics.get(name) ?? [];
      rows.push({ durationMs: performance.now() - started, ok: false, status });
      metrics.set(name, rows);
      errors.push({ action: name, ...(status ? { status } : {}), errorKind });
      return null;
    }
  };
}

class HttpFailure extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}

function authClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) }),
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function functionRequest(url: string, anonKey: string, token: string, path: string, method = "GET", body?: unknown) {
  return fetch(`${url}/functions/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  }).then(async (response) => {
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new HttpFailure(response.status);
    return data as Record<string, unknown>;
  });
}

function dbCheck(label: string, result: { error: { message: string; code?: string } | null }): void {
  if (result.error) throw new Error(`${label} failed (${result.error.code ?? "database error"})`);
}

async function startAttemptRequest(url: string, anonKey: string, testId: string, assignmentId: string, token: string): Promise<string> {
  const test = await functionRequest(url, anonKey, token, "student-attempts", "POST", { test_id: testId, assignment_id: assignmentId });
  const attemptId = String(test.attempt_id ?? "");
  if (!attemptId) throw new Error("Attempt start returned no attempt ID");
  return attemptId;
}

async function loadAttemptRoster(db: SupabaseClient, attemptId: string): Promise<Map<string, string>> {
  const { data: modules, error: modulesError } = await db.from("attempt_modules").select("module_id").eq("attempt_id", attemptId);
  if (modulesError) throw new Error("Unable to read synthetic attempt modules");
  const moduleByQuestion = new Map<string, string>();
  const questionLinks = await db.from("test_module_questions").select("module_id, question_id").in("module_id", (modules ?? []).map((row) => row.module_id));
  if (questionLinks.error) throw new Error("Unable to read synthetic attempt roster");
  for (const row of questionLinks.data ?? []) moduleByQuestion.set(row.question_id, row.module_id);
  return moduleByQuestion;
}

async function setupAttempt(db: SupabaseClient, url: string, anonKey: string, testId: string, assignmentId: string, token: string): Promise<{ attemptId: string; moduleByQuestion: Map<string, string> }> {
  const attemptId = await startAttemptRequest(url, anonKey, testId, assignmentId, token);
  return { attemptId, moduleByQuestion: await loadAttemptRoster(db, attemptId) };
}

function rowsForAttempt(
  attemptId: string,
  questionIds: string[],
  moduleByQuestion: Map<string, string>,
  choiceIdsByQuestion: Record<string, string[]>,
) {
  return questionIds.map((questionId) => ({
    attempt_id: attemptId,
    question_id: questionId,
    module_id: assert(moduleByQuestion.get(questionId), "Resolve question module"),
    selected_choice_id: assert(choiceIdsByQuestion[questionId]?.[0], "Resolve correct answer choice"),
    typed_answer: null,
    marked_for_review: false,
    eliminated_choice_ids: [],
    highlights: [],
    time_spent_seconds: 1,
  }));
}

async function runActor(
  db: SupabaseClient,
  url: string,
  anonKey: string,
  manifest: Manifest,
  student: StudentFixture,
  studentIndex: number,
  cardOffset: number,
  measure: ReturnType<typeof createTimedCall>,
  verification: Record<string, unknown>,
): Promise<void> {
  const auth = authClient(url, anonKey);
  const login = await measure("login", async () => {
    const { data, error: err } = await auth.auth.signInWithPassword({ email: student.email, password: manifest.password });
    if (err || !data.session) throw new Error("Auth login failed");
    return data.session.access_token;
  });
  if (!login) return;
  const token = login;

  await measure("test_listing", () => functionRequest(url, anonKey, token, "student-tests"));

  const fullAttemptId = await measure("test_start_98q", () => startAttemptRequest(url, anonKey, manifest.fullTestId, student.fullAssignmentId, token));
  if (!fullAttemptId) return;
  (verification.fullAttemptIds as string[]).push(fullAttemptId);
  const fullAttempt = { attemptId: fullAttemptId, moduleByQuestion: await loadAttemptRoster(db, fullAttemptId) };

  await measure("test_resume_98q", () => functionRequest(url, anonKey, token, `student-attempts/current?attempt_id=${encodeURIComponent(fullAttempt.attemptId)}`));

  const practiceAttemptId = await measure("test_start_20q", () => startAttemptRequest(url, anonKey, manifest.practiceTestId, student.practiceAssignmentId, token));
  if (!practiceAttemptId) return;
  (verification.practiceAttemptIds as string[]).push(practiceAttemptId);
  const practiceAttempt = { attemptId: practiceAttemptId, moduleByQuestion: await loadAttemptRoster(db, practiceAttemptId) };

  const practiceQuestionIds = manifest.questionIds.slice(0, 20);
  const saved = await measure("answer_save", async () => {
    const first = practiceQuestionIds[0];
    const result = await functionRequest(url, anonKey, token, "student-responses", "POST", {
      attempt_id: practiceAttempt.attemptId,
      question_id: first,
      module_id: manifest.practiceModuleId,
      selected_choice_id: manifest.choiceIdsByQuestion[first][0],
      typed_answer: null,
      marked_for_review: false,
      eliminated_choice_ids: [],
      highlights: [],
      time_spent_seconds: 1,
    });
    return result;
  });
  if (!saved) return;
  const practiceRows = rowsForAttempt(practiceAttempt.attemptId, practiceQuestionIds, practiceAttempt.moduleByQuestion, manifest.choiceIdsByQuestion);
  dbCheck("Persist synthetic practice answers", await db.from("attempt_responses").upsert(practiceRows, { onConflict: "attempt_id,question_id" }));

  const practiceSubmission = await measure("submit_20q", () => functionRequest(url, anonKey, token, "student-submit", "POST", { attempt_id: practiceAttempt.attemptId }));
  (verification.practiceScores as boolean[]).push(
    !!practiceSubmission && Number(practiceSubmission.raw_score) === 20 && Number(practiceSubmission.total_questions) === 20 && Number(practiceSubmission.accuracy) === 100,
  );

  const deckPath = `student-vocab/study?deck_id=${encodeURIComponent(manifest.vocabDeckId)}`;
  await measure("vocab_dashboard", () => functionRequest(url, anonKey, token, "student-vocab"));
  await measure("vocab_study_queue", () => functionRequest(url, anonKey, token, deckPath));
  const cardId = manifest.vocabCardIds[(cardOffset + studentIndex) % manifest.vocabCardIds.length];
  await measure("vocab_review", () => functionRequest(url, anonKey, token, "student-vocab/review", "POST", {
    card_id: cardId,
    rating: 3,
    mode: "study",
    response_ms: 1050,
  }));

  const fullRows = rowsForAttempt(fullAttempt.attemptId, manifest.questionIds, fullAttempt.moduleByQuestion, manifest.choiceIdsByQuestion);
  dbCheck("Persist synthetic full-test answers", await db.from("attempt_responses").upsert(fullRows, { onConflict: "attempt_id,question_id" }));
  const submitPath = "student-submit";
  const submissions = await Promise.all([
    measure("submit_98q", () => functionRequest(url, anonKey, token, submitPath, "POST", { attempt_id: fullAttempt.attemptId })),
    measure("submit_98q_retry", () => functionRequest(url, anonKey, token, submitPath, "POST", { attempt_id: fullAttempt.attemptId })),
  ]);
  const first = submissions[0] as Record<string, unknown> | null;
  const second = submissions[1] as Record<string, unknown> | null;
  (verification.fullScores as boolean[]).push(
    !!first && Number(first.raw_score) === 98 && Number(first.total_questions) === 98 && Number(first.accuracy) === 100,
  );
  if (first && second) {
    const match = first.raw_score === second.raw_score && first.total_questions === second.total_questions && first.accuracy === second.accuracy;
    (verification.concurrentRetryMatches as boolean[]).push(match);
  }
}

async function runBenchmark(
  db: SupabaseClient,
  url: string,
  anonKey: string,
  manifest: Manifest,
  phase: "baseline" | "after",
  buildRevision: string,
  sourceSubmitSha256: string,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const metrics = new Map<string, TimedSample[]>();
  const actionErrors: Array<{ action: string; status?: number; errorKind: string }> = [];
  const measure = createTimedCall(metrics, actionErrors);
  const verification: Record<string, unknown> = {
    concurrentRetryMatches: [] as boolean[],
    fullAttemptIds: [] as string[],
    practiceAttemptIds: [] as string[],
    fullScores: [] as boolean[],
    practiceScores: [] as boolean[],
    emptySubmission: null,
    partialSubmission: null,
    transactionFailureRollback: null,
  };

  for (let wave = 0; wave < WAVES; wave++) {
    if (wave > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 60_000));
    console.log(`${phase}: wave ${wave + 1}/${WAVES} started (${STUDENTS} synthetic users).`);
    const actors = manifest.students.map((student, index) =>
      runActor(db, url, anonKey, manifest, student, index, wave * STUDENTS, measure, verification),
    );
    await Promise.all(actors);
    console.log(`${phase}: wave ${wave + 1}/${WAVES} completed.`);
  }

  const fullAttemptIds = verification.fullAttemptIds as string[];
  const practiceAttemptIds = verification.practiceAttemptIds as string[];
  if (fullAttemptIds.length > 0 && practiceAttemptIds.length > 0) {
    const submittedIds = [...fullAttemptIds, ...practiceAttemptIds];
    const [scoresResult, eventsResult, statusesResult, fullCorrectResult, practiceCorrectResult, topicResult, reviewsResult, activityResult, vocabStateResult] = await Promise.all([
      db.from("scores").select("attempt_id, raw_score, total_questions").in("attempt_id", submittedIds).limit(1000),
      db.from("attempt_events").select("attempt_id").in("attempt_id", submittedIds).eq("event_type", "attempt.submitted").limit(1000),
      db.from("attempts").select("id, status").in("id", submittedIds).limit(1000),
      db.from("attempt_responses").select("is_correct").eq("attempt_id", fullAttemptIds[0]).limit(100),
      db.from("attempt_responses").select("is_correct").eq("attempt_id", practiceAttemptIds[0]).limit(100),
      db.from("topic_performance").select("student_id, attempted, correct").in("student_id", manifest.students.map((student) => student.id)),
      db.from("vocab_reviews").select("student_id, response_ms").in("student_id", manifest.students.map((student) => student.id)).limit(1000),
      db.from("vocab_daily_activity").select("student_id, cards_reviewed, cards_correct").in("student_id", manifest.students.map((student) => student.id)),
      db.from("vocab_card_state").select("student_id, interval_days, repetitions, status").in("student_id", manifest.students.map((student) => student.id)).limit(1000),
    ]);
    dbCheck("Verify synthetic submission scores", scoresResult);
    dbCheck("Verify synthetic submission events", eventsResult);
    dbCheck("Verify synthetic attempt states", statusesResult);
    dbCheck("Verify synthetic full-test answers", fullCorrectResult);
    dbCheck("Verify synthetic practice answers", practiceCorrectResult);
    dbCheck("Verify synthetic topic totals", topicResult);
    dbCheck("Verify synthetic vocabulary reviews", reviewsResult);
    dbCheck("Verify synthetic vocabulary activity", activityResult);
    dbCheck("Verify synthetic vocabulary scheduling", vocabStateResult);

    const scores = scoresResult.data ?? [];
    const events = eventsResult.data ?? [];
    const statuses = statusesResult.data ?? [];
    const scoreMap = new Map(scores.map((score) => [score.attempt_id, score]));
    const statusMap = new Map(statuses.map((attempt) => [attempt.id, attempt.status]));
    const fullPersistence = fullAttemptIds.length === STUDENTS * WAVES
      && fullAttemptIds.every((id) => Number(scoreMap.get(id)?.raw_score) === 98 && scoreMap.get(id)?.total_questions === 98 && statusMap.get(id) === "graded")
      && events.filter((event) => fullAttemptIds.includes(event.attempt_id)).length === fullAttemptIds.length
      && (fullCorrectResult.data ?? []).length === 98
      && (fullCorrectResult.data ?? []).every((row) => row.is_correct === true);
    const practicePersistence = practiceAttemptIds.length === STUDENTS * WAVES
      && practiceAttemptIds.every((id) => Number(scoreMap.get(id)?.raw_score) === 20 && scoreMap.get(id)?.total_questions === 20 && statusMap.get(id) === "graded")
      && events.filter((event) => practiceAttemptIds.includes(event.attempt_id)).length === practiceAttemptIds.length
      && (practiceCorrectResult.data ?? []).length === 20
      && (practiceCorrectResult.data ?? []).every((row) => row.is_correct === true);
    const attemptsByStudent = new Map<string, number>();
    for (const topic of topicResult.data ?? []) {
      attemptsByStudent.set(topic.student_id, (attemptsByStudent.get(topic.student_id) ?? 0) + Number(topic.attempted));
    }
    const topicTotals = manifest.students.every((student) => attemptsByStudent.get(student.id) === (98 + 20) * WAVES);
    const reviewsByStudent = new Map<string, number>();
    for (const review of reviewsResult.data ?? []) reviewsByStudent.set(review.student_id, (reviewsByStudent.get(review.student_id) ?? 0) + 1);
    const activityByStudent = new Map((activityResult.data ?? []).map((row) => [row.student_id, row]));
    const vocabularyConsistency = reviewsResult.data?.length === STUDENTS * WAVES
      && (reviewsResult.data ?? []).every((review) => review.response_ms === 1050)
      && manifest.students.every((student) => reviewsByStudent.get(student.id) === WAVES)
      && activityResult.data?.length === STUDENTS
      && manifest.students.every((student) => activityByStudent.get(student.id)?.cards_reviewed === WAVES && activityByStudent.get(student.id)?.cards_correct === WAVES)
      && vocabStateResult.data?.length === STUDENTS * WAVES
      && (vocabStateResult.data ?? []).every((state) => state.interval_days === 1 && state.repetitions === 1 && state.status === "learning");
    verification.submissionPersistence = {
      fullLength: fullPersistence,
      practice: practicePersistence,
      oneScoreAndEventPerAttempt: fullPersistence && practicePersistence,
      topicTotalsExactlyOnce: topicTotals,
    };
    verification.vocabularyReviewConsistency = vocabularyConsistency;
  } else {
    verification.submissionPersistence = { fullLength: false, practice: false, oneScoreAndEventPerAttempt: false, topicTotalsExactlyOnce: false };
    verification.vocabularyReviewConsistency = false;
  }

  const targetStudent = manifest.students[0];
  const auth = authClient(url, anonKey);
  const session = await auth.auth.signInWithPassword({ email: targetStudent.email, password: manifest.password });
  const token = assert(session.data.session?.access_token, "Verification student login");
  const emptyAttempt = await setupAttempt(db, url, anonKey, manifest.fullTestId, targetStudent.fullAssignmentId, token);
  const emptyResult = await functionRequest(url, anonKey, token, "student-submit", "POST", { attempt_id: emptyAttempt.attemptId });
  verification.emptySubmission = { rawScore: emptyResult.raw_score, totalQuestions: emptyResult.total_questions, passed: Number(emptyResult.raw_score) === 0 && Number(emptyResult.total_questions) === 98 };

  const partialAttempt = await setupAttempt(db, url, anonKey, manifest.fullTestId, targetStudent.fullAssignmentId, token);
  const firstQuestion = manifest.questionIds[0];
  dbCheck("Persist partial verification answer", await db.from("attempt_responses").insert({
    attempt_id: partialAttempt.attemptId,
    question_id: firstQuestion,
    module_id: assert(partialAttempt.moduleByQuestion.get(firstQuestion), "Partial verification module"),
    selected_choice_id: manifest.choiceIdsByQuestion[firstQuestion][0],
  }));
  const partialResult = await functionRequest(url, anonKey, token, "student-submit", "POST", { attempt_id: partialAttempt.attemptId });
  verification.partialSubmission = { rawScore: partialResult.raw_score, totalQuestions: partialResult.total_questions, passed: Number(partialResult.raw_score) === 1 && Number(partialResult.total_questions) === 98 };

  if (phase === "after") {
    const failingAttempt = await setupAttempt(db, url, anonKey, manifest.fullTestId, targetStudent.fullAssignmentId, token);
    const rollbackQuestionId = manifest.questionIds[0];
    dbCheck("Seed answer for failed-transaction rollback check", await db.from("attempt_responses").insert({
      attempt_id: failingAttempt.attemptId,
      question_id: rollbackQuestionId,
      module_id: assert(failingAttempt.moduleByQuestion.get(rollbackQuestionId), "Rollback test module"),
      selected_choice_id: manifest.choiceIdsByQuestion[rollbackQuestionId][0],
    }));
    const failedRpc = await db.rpc("finalize_student_attempt", {
      p_attempt_id: failingAttempt.attemptId,
      p_student_id: targetStudent.id,
      p_raw_score: 0,
      p_total_questions: 98,
      p_section_scores: {},
      p_module_scores: {},
      p_topic_performance: [{ domain: "Synthetic invalid topic", skill: null, total: 1, correct: 2 }],
      p_corrections: [{ question_id: rollbackQuestionId, is_correct: true }],
    });
    const attemptState = await db.from("attempts").select("status").eq("id", failingAttempt.attemptId).maybeSingle();
    const scoreRows = await db.from("scores").select("id").eq("attempt_id", failingAttempt.attemptId);
    const submitEvents = await db.from("attempt_events").select("id").eq("attempt_id", failingAttempt.attemptId).eq("event_type", "attempt.submitted");
    const rolledBackAnswer = await db.from("attempt_responses").select("is_correct").eq("attempt_id", failingAttempt.attemptId).eq("question_id", rollbackQuestionId).maybeSingle();
    verification.transactionFailureRollback = {
      rpcRejected: !!failedRpc.error,
      stillInProgress: attemptState.data?.status === "in_progress",
      noScore: (scoreRows.data ?? []).length === 0,
      noSubmissionEvent: (submitEvents.data ?? []).length === 0,
      answerCorrectionRolledBack: rolledBackAnswer.data?.is_correct === null,
      passed: !!failedRpc.error && attemptState.data?.status === "in_progress" && (scoreRows.data ?? []).length === 0 && (submitEvents.data ?? []).length === 0 && rolledBackAnswer.data?.is_correct === null,
    };
    if (failingAttempt.attemptId) dbCheck("Delete failed-transaction verification attempt", await db.from("attempts").delete().eq("id", failingAttempt.attemptId));
  }

  const metricsOut = Object.fromEntries([...metrics.entries()].map(([name, samples]) => [name, summarize(samples)]));
  const fullScoreChecks = verification.fullScores as boolean[];
  const practiceScoreChecks = verification.practiceScores as boolean[];
  const retryChecks = verification.concurrentRetryMatches as boolean[];
  verification.expectedScoreResponses = {
    fullLength: { passed: fullScoreChecks.filter(Boolean).length, samples: fullScoreChecks.length, allPassed: fullScoreChecks.length === STUDENTS * WAVES && fullScoreChecks.every(Boolean) },
    practice: { passed: practiceScoreChecks.filter(Boolean).length, samples: practiceScoreChecks.length, allPassed: practiceScoreChecks.length === STUDENTS * WAVES && practiceScoreChecks.every(Boolean) },
  };
  verification.concurrentRetryMatches = {
    matched: retryChecks.filter(Boolean).length,
    samples: retryChecks.length,
    allMatched: retryChecks.length === STUDENTS * WAVES && retryChecks.every(Boolean),
  };
  delete verification.fullAttemptIds;
  delete verification.practiceAttemptIds;
  delete verification.fullScores;
  delete verification.practiceScores;
  const result: RunResult = {
    phase,
    runId: manifest.runId,
    projectRef: manifest.projectRef,
    startedAt,
    finishedAt: new Date().toISOString(),
    waves: WAVES,
    users: STUDENTS,
    environment: {
      urlHost: new URL(url).host,
      buildRevision,
      sourceSubmitSha256,
      region: null,
    },
    metrics: metricsOut,
    verification: { ...verification, actionErrors },
  };
  writeFileSync(join(manifest.tempDir, `${phase}.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
  return result;
}

async function verifyAndCleanup(db: SupabaseClient, manifest: Manifest): Promise<void> {
  const tempDirStat = lstatSync(manifest.tempDir);
  if (tempDirStat.isSymbolicLink() || !tempDirStat.isDirectory()) throw new Error("Refusing cleanup: run directory is not an owned real directory.");
  const testRows = await db.from("tests").select("id, title").in("id", [manifest.practiceTestId, manifest.fullTestId]);
  if (testRows.error || (testRows.data ?? []).some((row) =>
    ![manifest.practiceTestId, manifest.fullTestId].includes(row.id) || !row.title.startsWith(manifest.runId)
  )) {
    throw new Error("Refusing cleanup: run-tagged tests do not match the manifest.");
  }
  const deck = await db.from("vocab_decks").select("id, name").eq("id", manifest.vocabDeckId).maybeSingle();
  if (deck.error || (deck.data && deck.data.name !== `${manifest.runId} synthetic vocabulary`)) throw new Error("Refusing cleanup: run-tagged deck does not match the manifest.");
  for (const student of manifest.students) {
    const authUser = await db.auth.admin.getUserById(student.id);
    if (authUser.error || authUser.data.user?.email !== student.email || !student.email.startsWith(`${manifest.runId}+`)) {
      throw new Error("Refusing cleanup: synthetic Auth identity does not match the manifest.");
    }
  }
  const { error: testDeleteError } = await db.from("tests").delete().in("id", [manifest.practiceTestId, manifest.fullTestId]);
  if (testDeleteError) throw new Error("Unable to delete exact synthetic tests.");
  const { error: questionDeleteError } = await db.from("questions").delete().in("id", manifest.questionIds);
  if (questionDeleteError) throw new Error("Unable to delete exact synthetic questions.");
  const { error: deckDeleteError } = await db.from("vocab_decks").delete().eq("id", manifest.vocabDeckId);
  if (deckDeleteError) throw new Error("Unable to delete exact synthetic vocabulary deck.");
  for (const student of manifest.students) {
    const removed = await db.auth.admin.deleteUser(student.id);
    if (removed.error) throw new Error("Unable to delete one of the exact synthetic Auth identities.");
  }
  const { error: storageDeleteError } = await db.storage.from("question-assets").remove(manifest.storagePaths);
  if (storageDeleteError) throw new Error("Unable to delete the exact synthetic stimulus image.");

  const tempDir = realpathSync(manifest.tempDir);
  const tempRoot = realpathSync(tmpdir());
  if (dirname(tempDir) !== tempRoot || !tempDir.toLowerCase().includes("sat-performance-")) {
    throw new Error("Refusing to remove a run directory outside the operating-system temporary root.");
  }
  rmSync(tempDir, { recursive: true, force: false });
}

async function resetDynamicData(db: SupabaseClient, manifest: Manifest): Promise<void> {
  const studentIds = manifest.students.map((student) => student.id);
  dbCheck("Reset exact synthetic attempts", await db.from("attempts").delete().in("test_id", [manifest.practiceTestId, manifest.fullTestId]));
  dbCheck("Reset exact synthetic vocabulary reviews", await db.from("vocab_reviews").delete().in("student_id", studentIds));
  dbCheck("Reset exact synthetic vocabulary state", await db.from("vocab_card_state").delete().in("student_id", studentIds));
  dbCheck("Reset exact synthetic daily activity", await db.from("vocab_daily_activity").delete().in("student_id", studentIds));
  dbCheck("Reset exact synthetic topic totals", await db.from("topic_performance").delete().in("student_id", studentIds));
  dbCheck("Reset exact synthetic assignments", await db.from("test_assignments").update({ status: "assigned" }).in("id", manifest.students.flatMap((student) => [student.practiceAssignmentId, student.fullAssignmentId])));
}

async function main(): Promise<void> {
  const { url, serviceKey, anonKey, ref } = assertEnvironment();
  if (has("--diagnose-listing")) {
    if (!manifestArg) throw new Error("Use --diagnose-listing --manifest <path> --confirm-ref <staging-project-ref>.");
    const manifest = readManifest(manifestArg);
    if (manifest.projectRef !== ref) throw new Error("Manifest project does not match the confirmed staging project.");
    const results = await Promise.all(manifest.students.map(async (student, index) => {
      const auth = authClient(url, anonKey);
      const { data, error: authError } = await auth.auth.signInWithPassword({ email: student.email, password: manifest.password });
      if (authError || !data.session) return { student: index + 1, status: "login_failed" };
      const headers = { apikey: anonKey, Authorization: `Bearer ${data.session.access_token}` };
      const listingResponse = await fetch(`${url}/functions/v1/student-tests`, { headers, cache: "no-store", signal: AbortSignal.timeout(60_000) });
      const listingText = await listingResponse.text();
      const vocabularyResponse = await fetch(`${url}/functions/v1/student-vocab`, { headers, cache: "no-store", signal: AbortSignal.timeout(60_000) });
      const vocabularyText = await vocabularyResponse.text();
      let fullStartResponse: Response | null = null;
      let practiceStartResponse: Response | null = null;
      let fullStartText = "";
      let practiceStartText = "";
      if (!has("--diagnose-reads-only")) {
        const start = (testId: string, assignmentId: string) => fetch(`${url}/functions/v1/student-attempts`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ test_id: testId, assignment_id: assignmentId }),
          cache: "no-store",
          signal: AbortSignal.timeout(60_000),
        });
        fullStartResponse = await start(manifest.fullTestId, student.fullAssignmentId);
        fullStartText = await fullStartResponse.text();
        practiceStartResponse = await start(manifest.practiceTestId, student.practiceAssignmentId);
        practiceStartText = await practiceStartResponse.text();
      }
      let listing: { tests?: Array<{ id: string; questions: number }> } = {};
      let vocabulary: { decks?: Array<{ id: string; card_count: number; due_count: number; new_count: number }> } = {};
      let fullStart: { attempt_id?: string; test?: Record<string, unknown> } = {};
      let practiceStart: { attempt_id?: string; test?: Record<string, unknown> } = {};
      try { listing = JSON.parse(listingText); } catch { /* report the status only */ }
      try { vocabulary = JSON.parse(vocabularyText); } catch { /* report the status only */ }
      try { fullStart = JSON.parse(fullStartText); } catch { /* report the status only */ }
      try { practiceStart = JSON.parse(practiceStartText); } catch { /* report the status only */ }
      const testShape = (test: Record<string, unknown> | undefined) => {
        const sections = (test?.sections ?? []) as Array<{ modules?: Array<{ questions?: unknown[] }> }>;
        const modules = sections.flatMap((section) => section.modules ?? []);
        return { sections: sections.length, modules: modules.length, questions: modules.reduce((sum, module) => sum + (module.questions?.length ?? 0), 0) };
      };
      return {
        student: index + 1,
        listingStatus: listingResponse.status,
        syntheticTestQuestionCounts: (listing.tests ?? []).filter((test) => [manifest.fullTestId, manifest.practiceTestId].includes(test.id)).map((test) => test.questions),
        vocabularyStatus: vocabularyResponse.status,
        syntheticDeckCounts: (vocabulary.decks ?? []).filter((deck) => deck.id === manifest.vocabDeckId).map(({ card_count, due_count, new_count }) => ({ card_count, due_count, new_count })),
        listingError: listingResponse.ok ? undefined : listingText.slice(0, 500),
        fullStart: fullStartResponse ? { status: fullStartResponse.status, hasAttempt: !!fullStart.attempt_id, ...testShape(fullStart.test) } : undefined,
        practiceStart: practiceStartResponse ? { status: practiceStartResponse.status, hasAttempt: !!practiceStart.attempt_id, ...testShape(practiceStart.test) } : undefined,
      };
    }));
    console.log(JSON.stringify({ runId: manifest.runId, results }, null, 2));
    return;
  }
  if (has("--cleanup")) {
    if (!manifestArg) throw new Error("Use --cleanup --manifest <path> --confirm-ref <staging-project-ref>.");
    const manifest = readManifest(manifestArg);
    if (manifest.projectRef !== ref) throw new Error("Manifest project does not match the confirmed staging project.");
    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await verifyAndCleanup(db, manifest);
    console.log(JSON.stringify({ cleaned: true, runId: manifest.runId, projectRef: ref }));
    return;
  }
  if (phase !== "baseline" && phase !== "after") throw new Error("Pass --phase baseline|after, or use --cleanup.");

  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let manifest: Manifest;
  if (phase === "baseline") {
    manifest = createOwnedManifest();
    writeManifest(manifest);
    try {
      await seedFixture(db, url, anonKey, manifest);
      writeManifest(manifest);
    } catch (error) {
      console.error(`Synthetic fixture setup failed for ${manifest.runId}; exact cleanup manifest: ${join(manifest.tempDir, "manifest.json")}`);
      throw error;
    }
  } else {
    if (!manifestArg) throw new Error("After run requires --manifest <path> from the baseline run.");
    manifest = readManifest(manifestArg);
    if (manifest.projectRef !== ref) throw new Error("Manifest project does not match the confirmed staging project.");
    await resetDynamicData(db, manifest);
  }

  const { createHash } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const source = readFileSync(resolve(here, "../supabase/functions/student-submit/index.ts"));
  let revision = "working-tree";
  try { revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: resolve(here, "../.."), encoding: "utf8" }).trim(); } catch { /* keep the explicit working-tree label */ }
  const result = await runBenchmark(db, url, anonKey, manifest, phase, revision, createHash("sha256").update(source).digest("hex"));
  console.log(JSON.stringify({
    phase,
    runId: manifest.runId,
    projectRef: ref,
    reportFile: join(manifest.tempDir, `${phase}.json`),
    manifestFile: join(manifest.tempDir, "manifest.json"),
    metrics: result.metrics,
    verification: result.verification,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown load-test failure";
  console.error(message);
  process.exitCode = 1;
});
