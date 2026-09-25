import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { requireApprovedStudent } from "../_shared/auth.ts";
import {
  deckCreateSchema,
  deckUpdateSchema,
  cardCreateSchema,
  cardUpdateSchema,
  importCardsSchema,
  vocabReviewSchema,
} from "../_shared/validation.ts";

const DAY_MS = 86_400_000;

/** Anki-style SM-2 scheduler. Isolated so it can be swapped later. */
function schedule(rating: number, state: {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
}): { ease_factor: number; interval_days: number; repetitions: number; lapses: number; status: string; due_at: string } {
  let ef = state.ease_factor;
  let ivl = state.interval_days;
  let reps = state.repetitions;
  let lapses = state.lapses;

  // Anki button semantics: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
  if (rating === 1) {
    reps = 0;
    ivl = 0;
    lapses += 1;
    ef = Math.max(1.3, ef - 0.2);
  } else if (rating === 2) {
    reps += 1;
    ivl = reps === 1 ? 1 : Math.max(1, Math.ceil(ivl * 1.2));
    ef = Math.max(1.3, ef - 0.15);
  } else if (rating === 3) {
    reps += 1;
    ivl = reps === 1 ? 1 : reps === 2 ? 6 : Math.ceil(ivl * ef);
  } else {
    reps += 1;
    ivl = reps === 1 ? 1 : reps === 2 ? 7 : Math.ceil(ivl * ef * 1.3);
    ef = Math.min(3.0, ef + 0.15);
  }

  const status = lapses >= 4 ? "leech" : ivl <= 1 ? "learning" : "review";
  const dueAt = new Date(Date.now() + ivl * DAY_MS).toISOString();
  return {
    ease_factor: Math.round(ef * 100) / 100,
    interval_days: ivl,
    repetitions: reps,
    lapses,
    status,
    due_at: dueAt,
  };
}

interface DeckRow { id: string; name: string; description: string | null; color: string; student_id: string | null; status: string }
interface CardRow {
  id: string;
  deck_id: string;
  word: string;
  definition: string;
  example_sentence: string | null;
  part_of_speech: string | null;
  tags: string[];
}
interface StateRow {
  card_id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  status: string;
  due_at: string;
}

async function fetchDeck(
  svc: ReturnType<typeof serviceClient>,
  deckId: string,
): Promise<DeckRow> {
  const { data, error: err } = await svc
    .from("vocab_decks")
    .select("id, name, description, color, student_id, status")
    .eq("id", deckId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  if (!data) throw new HttpError(404, "Deck not found");
  return data as DeckRow;
}

/** Deck the student owns (editable). */
async function getOwnDeck(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  deckId: string,
): Promise<DeckRow> {
  const deck = await fetchDeck(svc, deckId);
  if (deck.student_id !== studentId) throw new HttpError(403, "You can only edit decks you created");
  if (deck.status === "archived") throw new HttpError(404, "Deck not found");
  return deck;
}

/** Deck the student can read: owned, or an active admin deck assigned to them. */
async function getReadableDeck(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  deckId: string,
): Promise<DeckRow> {
  const deck = await fetchDeck(svc, deckId);
  if (deck.student_id === studentId) return deck;
  const { data: assigned, error: err } = await svc
    .from("vocab_deck_assignments")
    .select("id")
    .eq("deck_id", deckId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  if (!assigned) throw new HttpError(403, "Deck not found");
  if (deck.status === "archived") throw new HttpError(404, "Deck not found");
  return deck;
}

async function deckIdList(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  deckId: string | null,
): Promise<string[]> {
  if (deckId) {
    await getReadableDeck(svc, studentId, deckId);
    return [deckId];
  }
  const { data: own, error: oErr } = await svc
    .from("vocab_decks")
    .select("id")
    .eq("student_id", studentId)
    .eq("status", "active");
  if (oErr) throw new HttpError(500, oErr.message);
  const { data: assigned, error: aErr } = await svc
    .from("vocab_deck_assignments")
    .select("deck_id")
    .eq("student_id", studentId);
  if (aErr) throw new HttpError(500, aErr.message);
  const ids = new Set<string>([...(own ?? []).map((d: { id: string }) => d.id)]);
  for (const a of assigned ?? []) ids.add((a as { deck_id: string }).deck_id);
  return [...ids];
}

function parseImport(text: string): Array<{
  word: string;
  definition: string;
  example_sentence: string | null;
  part_of_speech: string | null;
  tags: string[];
}> {
  const rows: Array<{ word: string; definition: string; example_sentence: string | null; part_of_speech: string | null; tags: string[] }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = line.includes("\t") ? line.split("\t").map((f) => f.trim()) : line.split(",").map((f) => f.trim());
    const [word, definition, example, pos, tagsRaw] = fields;
    if (!word || !definition) continue;
    rows.push({
      word,
      definition,
      example_sentence: example || null,
      part_of_speech: pos || null,
      tags: tagsRaw ? tagsRaw.split(";").map((t) => t.trim()).filter(Boolean) : [],
    });
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const seg = pathSegments(req);
    const url = new URL(req.url);

    // ---- dashboard ---------------------------------------------------------
    if (req.method === "GET" && seg.length === 1) {
      const { data: own, error: ownErr } = await svc
        .from("vocab_decks")
        .select("id, name, description, color, created_at, student_id")
        .eq("student_id", ctx.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true });
      if (ownErr) return error(ownErr.message, 500);
      const ownIds = new Set((own ?? []).map((d: { id: string }) => d.id));

      const { data: assigned, error: asgErr } = await svc
        .from("vocab_deck_assignments")
        .select("deck_id")
        .eq("student_id", ctx.user.id);
      if (asgErr) return error(asgErr.message, 500);
      const assignedIds = (assigned ?? []).map((a: { deck_id: string }) => a.deck_id);

      let decksOut: Array<Record<string, unknown>> = [];
      if (ownIds.size > 0 || assignedIds.length > 0) {
        const deckIds = [...ownIds, ...assignedIds];
        const { data: deckRows, error: d2Err } = await svc
          .from("vocab_decks")
          .select("id, name, description, color, created_at, student_id")
          .in("id", deckIds)
          .eq("status", "active");
        if (d2Err) return error(d2Err.message, 500);
        decksOut = (deckRows ?? []).map((d) => ({ ...(d as Record<string, unknown>), assigned: ownIds.has((d as { id: string }).id) ? false : true }));
      }

      const deckRows = decksOut as unknown as DeckRow[];
      const ids = deckRows.map((d) => d.id);

      const { data: cards, error: cErr } = await svc
        .from("vocab_cards")
        .select("id, deck_id")
        .in("deck_id", ids.length > 0 ? ids : [""]);
      if (cErr) return error(cErr.message, 500);

      const cardIds = (cards ?? []).map((c: { id: string }) => c.id);
      const { data: states, error: sErr } = await svc
        .from("vocab_card_state")
        .select("card_id, due_at")
        .eq("student_id", ctx.user.id)
        .in("card_id", cardIds.length > 0 ? cardIds : [""]);
      if (sErr) return error(sErr.message, 500);

      const nowIso = new Date().toISOString();
      const stateRows = (states ?? []) as StateRow[];
      const cardCountByDeck = new Map<string, number>();
      const dueSet = new Set<string>(stateRows.filter((s) => s.due_at <= nowIso).map((s) => s.card_id));
      const stateSet = new Set<string>(stateRows.map((s) => s.card_id));
      for (const c of cards ?? []) {
        const row = c as { id: string; deck_id: string };
        cardCountByDeck.set(row.deck_id, (cardCountByDeck.get(row.deck_id) ?? 0) + 1);
      }

      const now = new Date();
      const cutoff = new Date(now.getTime() - 182 * DAY_MS).toISOString().slice(0, 10);
      const { data: activity, error: aErr } = await svc
        .from("vocab_daily_activity")
        .select("activity_date, cards_reviewed")
        .eq("student_id", ctx.user.id)
        .gte("activity_date", cutoff)
        .order("activity_date", { ascending: true });
      if (aErr) return error(aErr.message, 500);

      const dates = new Set((activity ?? []).map((a: { activity_date: string }) => a.activity_date));
      let current = 0;
      let best = 0;
      let cursor = new Date();
      cursor.setUTCHours(0, 0, 0, 0);
      if (!dates.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
      while (dates.has(cursor.toISOString().slice(0, 10))) {
        current++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      const sortedDays = [...dates].sort();
      let run = 0;
      let prev = "";
      for (const day of sortedDays) {
        if (prev && daysBetween(prev, day) === 1) run++;
        else if (prev && daysBetween(prev, day) > 1) run = 0;
        else run = 1;
        best = Math.max(best, run);
        prev = day;
      }

      const todayIso = now.toISOString().slice(0, 10);
      const todayRow = (activity ?? []).find((a: { activity_date: string }) => a.activity_date === todayIso) as
        | { activity_date: string; cards_reviewed: number }
        | undefined;

      const totals = { cards: 0, due: 0, fresh: 0 };
      const decksOut2 = deckRows.map((d) => {
        const total = cardCountByDeck.get(d.id) ?? 0;
        const deckCards = (cards ?? []).filter((c: { deck_id: string }) => (c as { deck_id: string }).deck_id === d.id) as Array<{ id: string }>;
        const due = deckCards.filter((c) => dueSet.has(c.id)).length;
        const fresh = deckCards.filter((c) => !stateSet.has(c.id)).length;
        totals.cards += total;
        totals.due += due;
        totals.fresh += fresh;
        return { ...d, card_count: total, due_count: due, new_count: fresh };
      });

      return json({
        decks: decksOut2,
        heatmap: (activity ?? []).map((a: { activity_date: string; cards_reviewed: number }) => ({ date: a.activity_date, count: a.cards_reviewed })),
        today: todayRow ? { reviewed: todayRow.cards_reviewed } : null,
        streak: { current, best },
        totals,
      });
    }

    // ---- decks -------------------------------------------------------------
    if (req.method === "POST" && seg.length === 2 && seg[1] === "decks") {
      const body = deckCreateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("vocab_decks")
        .insert({ ...body, student_id: ctx.user.id })
        .select("id, name, description, color")
        .single();
      if (err) return error(err.message, 500);
      return json({ deck: data }, 201);
    }

    if (req.method === "PATCH" && seg.length === 3 && seg[1] === "decks") {
      const body = deckUpdateSchema.parse(await req.json());
      await getOwnDeck(svc, ctx.user.id, seg[2]);
      const { data, error: err } = await svc
        .from("vocab_decks")
        .update(body)
        .eq("id", seg[2])
        .select("id, name, description, color")
        .single();
      if (err) return error(err.message, 500);
      return json({ deck: data });
    }

    if (req.method === "DELETE" && seg.length === 3 && seg[1] === "decks") {
      await getOwnDeck(svc, ctx.user.id, seg[2]);
      const { error: err } = await svc.from("vocab_decks").delete().eq("id", seg[2]);
      if (err) return error(err.message, 500);
      return json({ ok: true });
    }

    // ---- cards -------------------------------------------------------------
    if (req.method === "GET" && seg.length === 4 && seg[1] === "decks" && seg[3] === "cards") {
      await getReadableDeck(svc, ctx.user.id, seg[2]);
      const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
      const tag = url.searchParams.get("tag")?.trim() ?? "";
      let query = svc.from("vocab_cards").select("id, deck_id, word, definition, example_sentence, part_of_speech, tags").eq("deck_id", seg[2]).order("word", { ascending: true });
      if (tag) query = query.contains("tags", [tag]);
      const { data, error: err } = await query;
      if (err) return error(err.message, 500);
      const rows = (data ?? []) as CardRow[];
      const filtered = q ? rows.filter((r) => `${r.word} ${r.definition} ${r.part_of_speech ?? ""}`.toLowerCase().includes(q)) : rows;
      return json({ cards: filtered });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "cards") {
      const body = cardCreateSchema.parse(await req.json());
      await getOwnDeck(svc, ctx.user.id, body.deck_id);
      const { data, error: err } = await svc
        .from("vocab_cards")
        .insert(body)
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .single();
      if (err) return error(err.message, 500);
      return json({ card: data }, 201);
    }

    if (req.method === "POST" && seg.length === 3 && seg[1] === "cards" && seg[2] === "import") {
      const body = importCardsSchema.parse(await req.json());
      await getOwnDeck(svc, ctx.user.id, body.deck_id);
      const rows = parseImport(body.text);
      if (rows.length === 0) return error("No valid word/definition pairs found", 422);
      const { data: existing, error: eErr } = await svc
        .from("vocab_cards")
        .select("word")
        .eq("deck_id", body.deck_id);
      if (eErr) return error(eErr.message, 500);
      const have = new Set((existing ?? []).map((r: { word: string }) => r.word.toLowerCase()));
      const toInsert = rows.filter((r) => !have.has(r.word.toLowerCase()));
      let inserted = 0;
      for (const row of toInsert) {
        const { error: iErr } = await svc.from("vocab_cards").insert({ ...row, deck_id: body.deck_id });
        if (iErr) {
          if (iErr.message.includes("vocab_cards_word_deck_unique")) continue;
          return error(iErr.message, 500);
        }
        inserted++;
      }
      return json({ imported: inserted, skipped: rows.length - inserted, total: rows.length });
    }

    if (req.method === "PATCH" && seg.length === 3 && seg[1] === "cards") {
      const body = cardUpdateSchema.parse(await req.json());
      const { data: card, error: cErr } = await svc.from("vocab_cards").select("deck_id").eq("id", seg[2]).maybeSingle();
      if (cErr) return error(cErr.message, 500);
      if (!card) return error("Card not found", 404);
      await getOwnDeck(svc, ctx.user.id, card.deck_id);
      const { data, error: err } = await svc
        .from("vocab_cards")
        .update(body)
        .eq("id", seg[2])
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .single();
      if (err) return error(err.message, 500);
      return json({ card: data });
    }

    if (req.method === "DELETE" && seg.length === 3 && seg[1] === "cards") {
      const { data: card, error: cErr } = await svc.from("vocab_cards").select("deck_id").eq("id", seg[2]).maybeSingle();
      if (cErr) return error(cErr.message, 500);
      if (!card) return error("Card not found", 404);
      await getOwnDeck(svc, ctx.user.id, card.deck_id);
      const { error: err } = await svc.from("vocab_cards").delete().eq("id", seg[2]);
      if (err) return error(err.message, 500);
      return json({ ok: true });
    }

    // ---- study / sprint queues ---------------------------------------------
    if (req.method === "GET" && seg.length === 2 && seg[1] === "study") {
      const ids = await deckIdList(svc, ctx.user.id, url.searchParams.get("deck_id"));
      const { data: cards, error: cErr } = await svc
        .from("vocab_cards")
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .in("deck_id", ids.length > 0 ? ids : [""])
        .limit(400);
      if (cErr) return error(cErr.message, 500);
      const cardRows = (cards ?? []) as CardRow[];
      const { data: states, error: sErr } = await svc
        .from("vocab_card_state")
        .select("card_id, ease_factor, interval_days, repetitions, lapses, status, due_at")
        .eq("student_id", ctx.user.id)
        .in("card_id", cardRows.map((c) => c.id).length > 0 ? cardRows.map((c) => c.id) : [""]);
      if (sErr) return error(sErr.message, 500);
      const stateMap = new Map<string, StateRow>((states ?? []).map((s) => [s.card_id, s as StateRow]));
      const nowIso = new Date().toISOString();
      const due = cardRows.filter((c) => {
        const s = stateMap.get(c.id);
        return !s || s.due_at <= nowIso;
      });
      due.sort((a, b) => {
        const sa = stateMap.get(a.id);
        const sb = stateMap.get(b.id);
        const da = sa ? sa.due_at : null;
        const db = sb ? sb.due_at : null;
        if (da && db) return da < db ? -1 : da > db ? 1 : 0;
        if (da) return 1;
        if (db) return -1;
        return 0;
      });
      const out = due.map((c) => {
        const s = stateMap.get(c.id);
        return {
          card: c,
          state: s
            ? {
                ease_factor: s.ease_factor,
                interval_days: s.interval_days,
                repetitions: s.repetitions,
                lapses: s.lapses,
                status: s.status,
                due_at: s.due_at,
              }
            : null,
        };
      });
      return json({ cards: out, due_count: due.length });
    }

    if (req.method === "GET" && seg.length === 2 && seg[1] === "sprint") {
      const ids = await deckIdList(svc, ctx.user.id, url.searchParams.get("deck_id"));
      const { data, error: err } = await svc
        .from("vocab_cards")
        .select("id, deck_id, word, definition, example_sentence, part_of_speech, tags")
        .in("deck_id", ids.length > 0 ? ids : [""])
        .limit(250);
      if (err) return error(err.message, 500);
      const rows = (data ?? []) as CardRow[];
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      return json({ cards: rows });
    }

    // ---- reviews -------------------------------------------------------------
    if (req.method === "POST" && seg.length === 2 && seg[1] === "review") {
      const body = vocabReviewSchema.parse(await req.json());
      const { data: card, error: cErr } = await svc
        .from("vocab_cards")
        .select("id, deck_id")
        .eq("id", body.card_id)
        .maybeSingle();
      if (cErr) return error(cErr.message, 500);
      if (!card) return error("Card not found", 404);
      await getReadableDeck(svc, ctx.user.id, card.deck_id);

      let nextState: { ease_factor: number; interval_days: number; repetitions: number; lapses: number; status: string; due_at: string } | null = null;
      if (body.mode === "study") {
        const { data: existing, error: stErr } = await svc
          .from("vocab_card_state")
          .select("ease_factor, interval_days, repetitions, lapses")
          .eq("student_id", ctx.user.id)
          .eq("card_id", body.card_id)
          .maybeSingle();
        if (stErr) return error(stErr.message, 500);
        const base = existing
          ? {
              ease_factor: Number(existing.ease_factor),
              interval_days: existing.interval_days,
              repetitions: existing.repetitions,
              lapses: existing.lapses,
            }
          : { ease_factor: 2.5, interval_days: 0, repetitions: 0, lapses: 0 };
        nextState = schedule(body.rating, base);
        const { error: uErr } = await svc
          .from("vocab_card_state")
          .upsert(
            {
              student_id: ctx.user.id,
              card_id: body.card_id,
              ...nextState,
              last_reviewed_at: new Date().toISOString(),
            },
            { onConflict: "student_id,card_id" },
          );
        if (uErr) return error(uErr.message, 500);
      }

      const reviewedOn = body.reviewed_on ?? new Date().toISOString().slice(0, 10);
      const { error: rErr } = await svc.from("vocab_reviews").insert({
        student_id: ctx.user.id,
        card_id: body.card_id,
        rating: body.rating,
        mode: body.mode,
        response_ms: body.response_ms ?? null,
        reviewed_on: reviewedOn,
      });
      if (rErr) return error(rErr.message, 500);

      const { data: day, error: dErr } = await svc
        .from("vocab_daily_activity")
        .select("cards_reviewed, cards_correct")
        .eq("student_id", ctx.user.id)
        .eq("activity_date", reviewedOn)
        .maybeSingle();
      if (dErr) return error(dErr.message, 500);
      const reviewed = (day?.cards_reviewed ?? 0) + 1;
      const correct = (day?.cards_correct ?? 0) + (body.rating >= 3 ? 1 : 0);
      const { error: aErr } = await svc
        .from("vocab_daily_activity")
        .upsert(
          { student_id: ctx.user.id, activity_date: reviewedOn, cards_reviewed: reviewed, cards_correct: correct },
          { onConflict: "student_id,activity_date" },
        );
      if (aErr) return error(aErr.message, 500);

      return json({ ok: true, next_state: nextState });
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / DAY_MS);
}
