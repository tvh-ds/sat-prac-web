import { createClient } from "npm:@supabase/supabase-js@2";
import {
  replayFsrsHistory,
  VOCAB_SCHEDULER_VERSION,
} from "../supabase/functions/_shared/vocab_fsrs.ts";

const STAGING_REF = "wgkggknyndgaoyazdhdf";
const args = new Set(Deno.args);
const projectRefArg = Deno.args.find((arg) => arg.startsWith("--project-ref="))?.slice("--project-ref=".length);
const apply = args.has("--apply");
const pageSize = 1000;

if (projectRefArg !== STAGING_REF) {
  throw new Error(`Require --project-ref=${STAGING_REF}; refusing any other target.`);
}

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const projectHost = new URL(url).hostname;
if (`${STAGING_REF}.supabase.co` !== projectHost) {
  throw new Error(`Configured Supabase URL targets ${projectHost}; expected ${STAGING_REF}.supabase.co.`);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

interface ExistingState {
  student_id: string;
  card_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  status: string;
  due_at: string;
  last_reviewed_at: string | null;
  scheduler_version: number;
  state_version: number;
  updated_at: string;
}

interface StudyReview {
  id: string;
  student_id: string;
  card_id: string;
  rating: number;
  created_at: string;
}

const keyFor = (studentId: string, cardId: string) => `${studentId}:${cardId}`;

async function readAll<T>(queryForPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryForPage(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

async function loadAll() {
  const states = await readAll<ExistingState>((from, to) => supabase
    .from("vocab_card_state")
    .select("student_id, card_id, ease_factor, interval_days, repetitions, lapses, status, due_at, last_reviewed_at, scheduler_version, state_version, updated_at")
    .order("student_id")
    .order("card_id")
    .range(from, to));
  const reviews = await readAll<StudyReview>((from, to) => supabase
    .from("vocab_reviews")
    .select("id, student_id, card_id, rating, created_at")
    .eq("mode", "study")
    .order("student_id")
    .order("card_id")
    .order("created_at")
    .order("id")
    .range(from, to));
  return { states, reviews };
}

function replay(reviews: StudyReview[], now: Date) {
  return replayFsrsHistory(reviews, now);
}

function statusFor(fsrsState: string, legacyLapses: number) {
  if (legacyLapses >= 4) return "leech";
  return fsrsState === "relearning" ? "learning" : fsrsState;
}

const { states, reviews } = await loadAll();
const historyByKey = new Map<string, StudyReview[]>();
for (const review of reviews) {
  const key = keyFor(review.student_id, review.card_id);
  const rows = historyByKey.get(key) ?? [];
  rows.push(review);
  historyByKey.set(key, rows);
}
const stateByKey = new Map(states.map((state) => [keyFor(state.student_id, state.card_id), state]));
const keys = new Set([...historyByKey.keys(), ...stateByKey.keys()]);
const pending: Array<{ key: string; state: ExistingState | null; reviews: StudyReview[] }> = [];
let alreadyMigrated = 0;
let noHistory = 0;
for (const key of keys) {
  const state = stateByKey.get(key) ?? null;
  if (state?.scheduler_version === VOCAB_SCHEDULER_VERSION) {
    alreadyMigrated++;
    continue;
  }
  const history = historyByKey.get(key) ?? [];
  if (history.length === 0) noHistory++;
  pending.push({ key, state, reviews: history });
}

console.log(JSON.stringify({
  target: projectHost,
  mode: apply ? "apply" : "dry-run",
  current_states: states.length,
  study_reviews: reviews.length,
  card_schedules: keys.size,
  already_fsrs6: alreadyMigrated,
  pending_schedules: pending.length,
  pending_without_study_history: noHistory,
}));

if (!apply) {
  console.log(`Dry run only. Add --apply to migrate schedules on ${STAGING_REF}.`);
  Deno.exit(0);
}

const originalStates = pending.flatMap(({ state }) => state ? [state] : []);
for (let start = 0; start < originalStates.length; start += 500) {
  const batch = originalStates.slice(start, start + 500).map((state) => ({
    student_id: state.student_id,
    card_id: state.card_id,
    migration_version: VOCAB_SCHEDULER_VERSION,
    ease_factor: state.ease_factor,
    interval_days: state.interval_days,
    repetitions: state.repetitions,
    lapses: state.lapses,
    status: state.status,
    due_at: state.due_at,
    last_reviewed_at: state.last_reviewed_at,
  }));
  const { error } = await supabase.from("vocab_schedule_migration_snapshots").upsert(batch, {
    onConflict: "student_id,card_id,migration_version",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`Could not write rollback snapshot: ${error.message}`);
}

async function migrateCard(key: string, initialState: ExistingState | null, initialReviews: StudyReview[]) {
  const [studentId, cardId] = key.split(":");
  let state = initialState;
  let cardReviews = initialReviews;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (state?.scheduler_version === VOCAB_SCHEDULER_VERSION) return "already_migrated" as const;
    const snapshot = replay(cardReviews, new Date());
    const legacyLapses = state?.lapses ?? 0;
    const target = {
      student_id: studentId,
      card_id: cardId,
      fsrs_difficulty: snapshot.difficulty,
      fsrs_stability: snapshot.stability,
      fsrs_state: snapshot.fsrs_state,
      learning_steps: snapshot.learning_steps,
      scheduled_days: snapshot.scheduled_days,
      repetitions: snapshot.repetitions,
      lapses: snapshot.lapses,
      due_at: snapshot.due_at,
      last_reviewed_at: snapshot.last_reviewed_at,
      status: statusFor(snapshot.fsrs_state, legacyLapses),
      legacy_lapses: legacyLapses,
      scheduler_version: VOCAB_SCHEDULER_VERSION,
      state_version: (state?.state_version ?? 0) + 1,
    };

    let result;
    if (state) {
      let query = supabase.from("vocab_card_state").update(target)
        .eq("student_id", studentId)
        .eq("card_id", cardId)
        .eq("state_version", state.state_version)
        .eq("updated_at", state.updated_at);
      query = state.last_reviewed_at
        ? query.eq("last_reviewed_at", state.last_reviewed_at)
        : query.is("last_reviewed_at", null);
      result = await query.select("student_id");
    } else {
      result = await supabase.from("vocab_card_state").insert(target).select("student_id");
    }
    if (result.error && result.error.code !== "23505") throw new Error(`${key}: ${result.error.message}`);
    if ((result.data ?? []).length > 0) return "migrated" as const;

    const { data: freshState, error: stateError } = await supabase.from("vocab_card_state")
      .select("student_id, card_id, ease_factor, interval_days, repetitions, lapses, status, due_at, last_reviewed_at, scheduler_version, state_version, updated_at")
      .eq("student_id", studentId).eq("card_id", cardId).maybeSingle();
    if (stateError) throw new Error(`${key}: ${stateError.message}`);
    const { data: freshReviews, error: reviewError } = await supabase.from("vocab_reviews")
      .select("id, student_id, card_id, rating, created_at")
      .eq("student_id", studentId).eq("card_id", cardId).eq("mode", "study")
      .order("created_at").order("id");
    if (reviewError) throw new Error(`${key}: ${reviewError.message}`);
    state = freshState as ExistingState | null;
    cardReviews = freshReviews as StudyReview[];
  }
  throw new Error(`${key}: schedule changed repeatedly during migration; rerun the idempotent script.`);
}

let migrated = 0;
for (const row of pending) {
  const result = await migrateCard(row.key, row.state, row.reviews);
  if (result === "migrated") migrated++;
}
console.log(JSON.stringify({ migrated, already_fsrs6: alreadyMigrated, total: keys.size }));
