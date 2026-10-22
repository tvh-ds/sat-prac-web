import { assignedVocabDeckProgress } from "./student_progress.ts";

export type AssignmentDeck = { id: string; name: string; description: string | null; color: string };
export type Assignment = { deck_id: string; student_id: string; assigned_at?: string };
export type AssignmentCard = { id: string; deck_id: string; created_at?: string };
export type AssignmentState = { student_id: string; card_id: string; due_at: string; last_reviewed_at?: string | null };
export type AssignmentReview = { student_id: string; card_id: string; reviewed_on: string; response_ms: number | null; mode?: string; created_at?: string; state_before?: { due_at?: string; fsrs_state?: string } | null };

export function vocabularyAssignments(
  decks: AssignmentDeck[], assignments: Assignment[], cards: AssignmentCard[],
  states: AssignmentState[], reviews: AssignmentReview[],
  profiles: Array<{ id: string; full_name: string }>, now: Date,
) {
  const today = now.toISOString().slice(0, 10);
  const end = Date.parse(`${today}T00:00:00Z`) + 86400000;
  const names = new Map(profiles.map(p => [p.id, p.full_name]));
  const statesByStudent = Map.groupBy(states, s => s.student_id);
  const reviewsByStudent = Map.groupBy(reviews, r => r.student_id);
  const cardsByDeck = Map.groupBy(cards, c => c.deck_id);
  const assignmentsByDeck = Map.groupBy(assignments, a => a.deck_id);
  return decks.filter(d => assignmentsByDeck.has(d.id)).map(deck => {
    const deckCards = cardsByDeck.get(deck.id) ?? [];
    const students = [...new Set((assignmentsByDeck.get(deck.id) ?? []).map(a => a.student_id))].map(student_id => {
      const studentStates = statesByStudent.get(student_id) ?? [];
      const dueByCard = new Map(studentStates.map(s => [s.card_id, s.due_at]));
      const progress = assignedVocabDeckProgress([deck], deckCards, studentStates, reviewsByStudent.get(student_id) ?? [], now)[0];
      const new_remaining = deckCards.filter(c => !dueByCard.has(c.id)).length;
      const due_later_today = deckCards.filter(c => {
        const due = Date.parse(dueByCard.get(c.id) ?? "");
        return due > now.getTime() && due < end;
      }).length;
      const history = vocabularyStudyHistory(deckCards, studentStates, reviewsByStudent.get(student_id) ?? [],
        (assignmentsByDeck.get(deck.id) ?? []).find(a => a.student_id === student_id)?.assigned_at, now);
      const remaining_today = progress.due_remaining + due_later_today + new_remaining;
      return { ...progress, history, student_id, full_name: names.get(student_id) ?? "Student", new_remaining, due_later_today, remaining_today,
        today_status: remaining_today > 0 ? "due_remaining" : progress.today_status };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name));
    const tracked = students.reduce((n, s) => n + s.tracked_review_count, 0);
    const history = students[0]?.history.map((day, i) => ({
      date: day.date,
      students_studied: students.filter(s => (s.history[i].total_due ?? 0) > 0 && s.history[i].studied_due > 0).length,
      students_with_due: students.filter(s => (s.history[i].total_due ?? 0) > 0).length,
      students_unknown: students.filter(s => s.history[i].total_due == null).length,
    })) ?? Array.from({ length: 7 }, (_, i) => ({ date: new Date(end - (7 - i) * 86400000).toISOString().slice(0, 10), students_studied: 0, students_with_due: 0, students_unknown: 0 }));
    return { ...deck, history, card_count: deckCards.length, students,
      student_count: students.length,
      students_done_today: students.filter(s => s.today_status === "done_today").length,
      students_with_due: students.filter(s => s.remaining_today > 0).length,
      remaining_today: students.reduce((n, s) => n + s.remaining_today, 0),
      reviewed_today: students.reduce((n, s) => n + s.reviewed_today, 0),
      tracked_review_ms: tracked ? students.reduce((n, s) => n + (s.tracked_review_ms ?? 0), 0) : null,
    };
  });
}


// Rewind each card using the first subsequent FSRS before-snapshot. Current
// schedules alone cannot describe past due work after a card was rescheduled.
export function vocabularyStudyHistory(cards: AssignmentCard[], states: AssignmentState[], reviews: AssignmentReview[], assignedAt: string | undefined, now: Date) {
  const todayStart = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const byCard = Map.groupBy(reviews.filter(r => r.mode === "study"), r => r.card_id);
  for (const rows of byCard.values()) rows.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const stateByCard = new Map(states.map(s => [s.card_id, s]));
  const cardIds = new Set(cards.map(c => c.id));
  return Array.from({ length: 7 }, (_, index) => {
    const start = todayStart - (6 - index) * 86400000, end = start + 86400000;
    const date = new Date(start).toISOString().slice(0, 10);
    const dailyReviews = reviews.filter(r => cardIds.has(r.card_id) && r.mode === "study" && r.reviewed_on === date &&
      (!assignedAt || (r.created_at != null && Date.parse(r.created_at) >= Date.parse(assignedAt))));
    let total_due = 0, studied_due = 0, unknown = false;
    for (const card of cards) {
      const available = Math.max(Date.parse(assignedAt ?? "1970-01-01"), Date.parse(card.created_at ?? "1970-01-01"));
      if (available >= end) continue;
      const cutoff = Math.max(start, available);
      const next = (byCard.get(card.id) ?? []).find(r => Date.parse(r.created_at ?? "") >= cutoff);
      const current = stateByCard.get(card.id);
      const before = next?.state_before;
      if ((next && !before) || (!next && current?.last_reviewed_at && Date.parse(current.last_reviewed_at) >= cutoff)) {
        unknown = true; continue;
      }
      const due = next ? before?.due_at : current?.due_at;
      if (!due || before?.fsrs_state === "new" || Date.parse(due) < end) {
        total_due++;
        if (dailyReviews.some(r => r.card_id === card.id)) studied_due++;
      }
    }
    const timed = dailyReviews.filter(r => r.response_ms != null);
    const tracked_ms = timed.length ? timed.reduce((sum, r) => sum + Math.max(0, r.response_ms!), 0) : null;
    return { date, total_due: unknown ? null : total_due, studied_due,
      studied_cards: new Set(dailyReviews.map(r => r.card_id)).size,
      review_count: dailyReviews.length, tracked_review_count: timed.length, tracked_ms,
      average_card_ms: tracked_ms == null ? null : Math.round(tracked_ms / new Set(timed.map(r => r.card_id)).size) };
  });
}
