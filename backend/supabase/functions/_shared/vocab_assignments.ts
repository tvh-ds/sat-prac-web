import { assignedVocabDeckProgress } from "./student_progress.ts";

export type AssignmentDeck = { id: string; name: string; description: string | null; color: string };
export type Assignment = { deck_id: string; student_id: string };
export type AssignmentCard = { id: string; deck_id: string };
export type AssignmentState = { student_id: string; card_id: string; due_at: string };
export type AssignmentReview = { student_id: string; card_id: string; reviewed_on: string; response_ms: number | null };

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
      const remaining_today = progress.due_remaining + due_later_today + new_remaining;
      return { ...progress, student_id, full_name: names.get(student_id) ?? "Student", new_remaining, due_later_today, remaining_today,
        today_status: remaining_today > 0 ? "due_remaining" : progress.today_status };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name));
    const tracked = students.reduce((n, s) => n + s.tracked_review_count, 0);
    return { ...deck, card_count: deckCards.length, students,
      student_count: students.length,
      students_done_today: students.filter(s => s.today_status === "done_today").length,
      students_with_due: students.filter(s => s.remaining_today > 0).length,
      remaining_today: students.reduce((n, s) => n + s.remaining_today, 0),
      reviewed_today: students.reduce((n, s) => n + s.reviewed_today, 0),
      tracked_review_ms: tracked ? students.reduce((n, s) => n + (s.tracked_review_ms ?? 0), 0) : null,
    };
  });
}
