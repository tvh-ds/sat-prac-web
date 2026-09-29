import { HttpError, pathSegments, requireApprovedStudent } from "../_shared/auth.ts";
import { corsHeaders, error, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { assignmentItems, type DashboardAssignment, type DashboardAttempt, validateTestDate } from "../_shared/student_dashboard.ts";

// Range through every page: dashboard counts must not silently stop at the API row limit.
async function allRows<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await query(start, start + 499);
    if (result.error) throw new HttpError(500, "Unable to load dashboard. Please try again.");
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const seg = pathSegments(req);
    if (seg[0] !== "student-dashboard" || seg.length > 2 || (seg.length === 2 && seg[1] !== "test-date")) return error("Not found", 404);
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const now = new Date();

    if (seg.length === 2) {
      if (req.method !== "GET" && req.method !== "PATCH") return error("Method not allowed", 405);
      if (req.method === "PATCH") {
        let testDate: string | null;
        try { testDate = validateTestDate(await req.json(), now); }
        catch (e) { return error(e instanceof SyntaxError ? "Invalid JSON body" : (e as Error).message, 422); }
        const result = await svc.from("student_profiles").update({ test_date: testDate }).eq("id", ctx.user.id).select("test_date").single();
        if (result.error) return error("Unable to save your test date. Please try again.", 500);
        return json({ test_date: result.data.test_date });
      }
      const result = await svc.from("student_profiles").select("test_date").eq("id", ctx.user.id).single();
      if (result.error) return error("Unable to load your test date. Please try again.", 500);
      return json({ test_date: result.data.test_date });
    }
    if (req.method !== "GET") return error("Method not allowed", 405);

    const [assignments, attempts, ownDecks, deckAssignments] = await Promise.all([
      allRows<DashboardAssignment>((start, end) => svc.from("test_assignments").select("id, test_id, due_at, status, test:tests(title, kind)").eq("student_id", ctx.user.id).order("id").range(start, end) as unknown as PromiseLike<{ data: DashboardAssignment[] | null; error: unknown }>),
      allRows<DashboardAttempt>((start, end) => svc.from("attempts").select("id, assignment_id, started_at, status").eq("student_id", ctx.user.id).not("assignment_id", "is", null).order("id").range(start, end)),
      allRows<{ id: string; name: string }>((start, end) => svc.from("vocab_decks").select("id, name").eq("student_id", ctx.user.id).eq("status", "active").order("id").range(start, end)),
      allRows<{ deck_id: string }>((start, end) => svc.from("vocab_deck_assignments").select("deck_id").eq("student_id", ctx.user.id).order("deck_id").range(start, end)),
    ]);
    const deckMap = new Map(ownDecks.map((deck) => [deck.id, deck]));
    // Chunk .in filters to keep request URLs bounded for large accounts.
    const assignedIds = [...new Set(deckAssignments.map((row) => row.deck_id))];
    for (let i = 0; i < assignedIds.length; i += 100) {
      const decks = await allRows<{ id: string; name: string }>((start, end) => svc.from("vocab_decks").select("id, name").in("id", assignedIds.slice(i, i + 100)).eq("status", "active").order("id").range(start, end));
      for (const deck of decks) deckMap.set(deck.id, deck);
    }
    const dueDeckIds = new Set<string>();
    const ids = [...deckMap.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const states = await allRows<{ card: { deck_id: string } }>((start, end) => svc.from("vocab_card_state").select("card:vocab_cards!inner(deck_id)").eq("student_id", ctx.user.id).lte("due_at", now.toISOString()).or("fsrs_state.neq.new,status.neq.new").in("card.deck_id", ids.slice(i, i + 100)).order("card_id").range(start, end) as unknown as PromiseLike<{ data: { card: { deck_id: string } }[] | null; error: unknown }>);
      for (const state of states) dueDeckIds.add(state.card.deck_id);
    }
    const items = assignmentItems(assignments, attempts, now);
    for (const id of dueDeckIds) {
      items.push({ id: `vocab:${id}`, title: deckMap.get(id)!.name, kind: "vocabulary", due_at: null, state: "assigned", href: `/student/vocabulary/decks/${id}` });
    }
    return json({ items });
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error("Student dashboard request failed");
    return error("Unable to load dashboard. Please try again.", 500);
  }
});
