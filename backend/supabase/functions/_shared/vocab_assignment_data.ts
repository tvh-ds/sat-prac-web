import { serviceClient } from "./supabase.ts";
import { HttpError } from "./auth.ts";
import { vocabularyAssignments, type AssignmentDeck, type Assignment, type AssignmentCard, type AssignmentState, type AssignmentReview } from "./vocab_assignments.ts";

// Page every source: Supabase's default response limit must not undercount large decks.
async function allRows<T>(query: (start: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await query(start);
    if (result.error) throw new HttpError(500, result.error.message);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function loadVocabularyAssignments(svc: ReturnType<typeof serviceClient>, now: Date, deckId?: string) {
  const today = now.toISOString().slice(0, 10);
  const decks = await allRows<AssignmentDeck>(start => {
    let query = svc.from("vocab_decks").select("id, name, description, color").is("student_id", null).eq("status", "active");
    if (deckId) query = query.eq("id", deckId);
    return query.order("id").range(start, start + 499);
  });
  const assignments: Assignment[] = [], cards: AssignmentCard[] = [];
  for (let i = 0; i < decks.length; i += 200) {
    const ids = decks.slice(i, i + 200).map(d => d.id);
    const [a, c] = await Promise.all([
      allRows<Assignment>(start => svc.from("vocab_deck_assignments").select("deck_id, student_id").in("deck_id", ids).order("deck_id").order("student_id").range(start, start + 499)),
      allRows<AssignmentCard>(start => svc.from("vocab_cards").select("id, deck_id").in("deck_id", ids).order("id").range(start, start + 499)),
    ]);
    assignments.push(...a); cards.push(...c);
  }
  const states: AssignmentState[] = [], reviews: AssignmentReview[] = [];
  for (let i = 0; i < cards.length; i += 200) {
    const ids = cards.slice(i, i + 200).map(c => c.id);
    const [s, r] = await Promise.all([
      allRows<AssignmentState>(start => svc.from("vocab_card_state").select("student_id, card_id, due_at").in("card_id", ids).order("student_id").order("card_id").range(start, start + 499)),
      allRows<AssignmentReview>(start => svc.from("vocab_reviews").select("student_id, card_id, reviewed_on, response_ms").in("card_id", ids).eq("reviewed_on", today).order("id").range(start, start + 499)),
    ]);
    states.push(...s); reviews.push(...r);
  }
  const studentIds = [...new Set(assignments.map(a => a.student_id))];
  const profiles: Array<{ id: string; full_name: string }> = [];
  for (let i = 0; i < studentIds.length; i += 200) {
    profiles.push(...await allRows<{ id: string; full_name: string }>(start => svc.from("profiles").select("id, full_name").in("id", studentIds.slice(i, i + 200)).order("id").range(start, start + 499)));
  }
  return { date: today, decks: vocabularyAssignments(decks, assignments, cards, states, reviews, profiles, now) };
}
