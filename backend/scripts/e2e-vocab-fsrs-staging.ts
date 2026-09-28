import { createClient } from "npm:@supabase/supabase-js@2";

const STAGING_REF = "wgkggknyndgaoyazdhdf";
const projectRef = Deno.args.find((arg) => arg.startsWith("--project-ref="))?.slice("--project-ref=".length);
if (projectRef !== STAGING_REF) throw new Error(`Require --project-ref=${STAGING_REF}; refusing any other target.`);

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const expectedHost = `${STAGING_REF}.supabase.co`;
if (new URL(url).hostname !== expectedHost) throw new Error(`SUPABASE_URL must target ${expectedHost}.`);

const frontendEnv = await Deno.readTextFile(new URL("../../frontend/.env", import.meta.url));
const anonKey = frontendEnv.match(/^VITE_SUPABASE_ANON_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
const frontendUrl = frontendEnv.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
if (!anonKey || !frontendUrl || new URL(frontendUrl).hostname !== expectedHost) {
  throw new Error(`frontend/.env must also target ${expectedHost} and contain its anon key.`);
}

const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const email = `fsrs-smoke-${crypto.randomUUID()}@example.invalid`;
const password = `${crypto.randomUUID()}-A1!`;
let userId: string | null = null;
let deckId: string | null = null;

async function must<T>(label: string, promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (data === null) throw new Error(`${label}: no data returned`);
  return data as NonNullable<T>;
}

async function call<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${url}/functions/v1/student-vocab/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}

try {
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Temporary FSRS staging check" },
  });
  if (createError || !created.user) throw new Error(`Could not create temporary staging student: ${createError?.message ?? "missing user"}`);
  userId = created.user.id;
  console.log("Created temporary student on staging.");

  await must("Approve temporary test student", service.from("student_profiles")
    .update({
      phone_number: "+358401234567",
      parent_name: "Temporary test parent",
      parent_phone_number: "+358401234568",
      profile_status: "approved",
      profile_approved_at: new Date().toISOString(),
    }).eq("id", userId).select("id").single());
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw new Error(`Could not sign in temporary staging student: ${signInError?.message ?? "missing session"}`);
  const token = session.session.access_token;

  const deck = await call<{ deck: { id: string } }>(token, "decks", "POST", {
    name: `FSRS staging check ${crypto.randomUUID().slice(0, 8)}`,
    description: "Temporary automated FSRS integration check",
    color: "#7f1d1d",
  });
  deckId = deck.deck.id;
  const card = await call<{ card: { id: string } }>(token, "cards", "POST", {
    deck_id: deckId,
    word: `fsrs-${crypto.randomUUID().slice(0, 12)}`,
    definition: "Temporary FSRS scheduler integration check",
    part_of_speech: "noun",
    tags: ["temporary-test"],
  });
  console.log("Created temporary deck and card.");

  const study = await call<{
    cards: Array<{ card: { id: string }; state: unknown; state_version: number; previews: Array<{ rating: number }> }>;
    due_count: number;
  }>(token, `study?deck_id=${deckId}`);
  if (study.due_count !== 1 || study.cards.length !== 1 || study.cards[0].card.id !== card.card.id) {
    throw new Error("New staging card was not returned as due exactly once.");
  }
  if (study.cards[0].state !== null || study.cards[0].state_version !== 0
      || study.cards[0].previews.map((preview) => preview.rating).join(",") !== "1,2,3,4") {
    throw new Error("New staging card did not return a New state, version 0, and four rating previews.");
  }
  console.log("Verified new-card due queue and four rating previews.");

  const submissionId = crypto.randomUUID();
  const reviewBody = {
    card_id: card.card.id,
    rating: 1,
    mode: "study",
    reviewed_on: new Date().toISOString().slice(0, 10),
    response_ms: 420,
    submission_id: submissionId,
    expected_version: 0,
  };
  const first = await call<{ next_state: { scheduler_version: number; state_version: number; fsrs_state: string; due_at: string }; replayed: boolean }>(
    token, "review", "POST", reviewBody,
  );
  if (first.replayed || first.next_state.scheduler_version !== 6 || first.next_state.state_version !== 1
      || !["learning", "relearning"].includes(first.next_state.fsrs_state)
      || Date.parse(first.next_state.due_at) <= Date.now()) {
    throw new Error("FSRS Study review did not produce a future short-term learning schedule.");
  }
  console.log("Recorded first FSRS Study review.");

  const retry = await call<{ next_state: { state_version: number }; replayed: boolean }>(token, "review", "POST", reviewBody);
  if (!retry.replayed || retry.next_state.state_version !== 1) throw new Error("Repeated Study submission was not idempotent.");
  console.log("Verified Study retry is idempotent.");

  const staleResponse = await fetch(`${url}/functions/v1/student-vocab/review`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...reviewBody, submission_id: crypto.randomUUID() }),
    signal: AbortSignal.timeout(15_000),
  });
  if (staleResponse.status !== 409) throw new Error(`Stale Study submission returned ${staleResponse.status}, expected 409.`);
  console.log("Verified stale Study state is rejected.");

  const sprintId = crypto.randomUUID();
  const sprintBody = {
    card_id: card.card.id,
    rating: 4,
    mode: "sprint",
    reviewed_on: reviewBody.reviewed_on,
    response_ms: reviewBody.response_ms,
    submission_id: sprintId,
  };
  const sprint = await call<{ next_state: null; replayed: boolean }>(token, "review", "POST", sprintBody);
  const sprintRetry = await call<{ next_state: null; replayed: boolean }>(token, "review", "POST", sprintBody);
  if (sprint.next_state !== null || sprint.replayed || !sprintRetry.replayed) {
    throw new Error("Sprint unexpectedly changed FSRS scheduling or failed idempotency.");
  }
  console.log("Verified Sprint logs practice without changing FSRS state.");

  const storedState = await must("Read resulting test schedule", service.from("vocab_card_state")
    .select("scheduler_version, state_version, due_at").eq("student_id", userId).eq("card_id", card.card.id).single());
  const storedStateRow = storedState as unknown as { scheduler_version: number; state_version: number };
  if (storedStateRow.scheduler_version !== 6 || storedStateRow.state_version !== 1) {
    throw new Error("Sprint changed or Study failed to persist the expected schedule version.");
  }
  const reviews = await must("Read test review history", service.from("vocab_reviews")
    .select("mode, response_ms, scheduler_version, submission_id").eq("student_id", userId).eq("card_id", card.card.id));
  const reviewRows = reviews as unknown as Array<{ mode: string; response_ms: number | null }>;
  if (reviewRows.length !== 2 || reviewRows.filter((row) => row.mode === "study").length !== 1
      || reviewRows.filter((row) => row.mode === "sprint").length !== 1
      || reviewRows.find((row) => row.mode === "study")?.response_ms !== 420) {
    throw new Error("Review history contains duplicate rows or lost response telemetry.");
  }
  const activity = await must("Read test activity", service.from("vocab_daily_activity")
    .select("cards_reviewed").eq("student_id", userId));
  const activityRows = activity as unknown as Array<{ cards_reviewed: number }>;
  if (activityRows.reduce((total, row) => total + row.cards_reviewed, 0) !== 2) {
    throw new Error("Idempotent retries changed the activity total more than once.");
  }
  const stillDue = await call<{ due_count: number }>(token, `study?deck_id=${deckId}`);
  if (stillDue.due_count !== 0) throw new Error("A card scheduled for a short-term future step was returned as due early.");

  console.log("FSRS staging integration passed: due queue, four previews, Study transition, idempotent retry, stale version, Sprint isolation, and history/activity.");
} finally {
  if (deckId) await service.from("vocab_decks").delete().eq("id", deckId);
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Could not remove temporary staging test student: ${error.message}`);
  }
}
