import { vocabularyAssignments } from "./vocab_assignments.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const now = new Date("2026-10-10T12:00:00Z");
const decks = [{ id: "deck", name: "Words", description: null, color: "#fff" }, { id: "unassigned", name: "Hidden", description: null, color: "#fff" }];
const cards = ["new", "overdue", "later", "tomorrow"].map(id => ({ id, deck_id: "deck" }));

Deno.test("assignment daily work includes new, overdue and later-today cards but excludes tomorrow", () => {
  const report = vocabularyAssignments(decks, [{ deck_id: "deck", student_id: "a" }], cards, [
    { student_id: "a", card_id: "overdue", due_at: "2026-10-09T12:00:00Z" },
    { student_id: "a", card_id: "later", due_at: "2026-10-10T23:59:59Z" },
    { student_id: "a", card_id: "tomorrow", due_at: "2026-10-11T00:00:00Z" },
  ], [], [{ id: "a", full_name: "Alex" }], now);
  equal(report.length, 1);
  const s = report[0].students[0];
  equal([s.due_remaining, s.due_later_today, s.new_remaining, s.remaining_today], [1, 1, 1, 3]);
  equal(s.today_status, "due_remaining");
  equal(report[0].students_with_due, 1);
});

Deno.test("students are isolated and today's reviews preserve missing timing", () => {
  const states = ["a", "b"].flatMap(student_id => cards.map(c => ({ student_id, card_id: c.id, due_at: "2026-10-11T00:00:00Z" })));
  const report = vocabularyAssignments(decks, [{ deck_id: "deck", student_id: "a" }, { deck_id: "deck", student_id: "b" }], cards, states, [
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-10", response_ms: 1200 },
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-10", response_ms: null },
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-09", response_ms: 99000 },
    { student_id: "outsider", card_id: "new", reviewed_on: "2026-10-10", response_ms: 99000 },
  ], [{ id: "a", full_name: "Alex" }, { id: "b", full_name: "Blair" }], now)[0];
  equal(report.students[0].reviewed_today, 2);
  equal(report.students[0].tracked_review_count, 1);
  equal(report.students[0].tracked_review_ms, 1200);
  equal(report.students[0].today_status, "done_today");
  equal(report.students[1].tracked_review_ms, null);
  equal(report.students[1].today_status, "no_cards_due");
  equal([report.reviewed_today, report.tracked_review_ms, report.students_done_today], [2, 1200, 1]);
});

Deno.test("empty decks and duplicate assignment inputs do not inflate counts", () => {
  const report = vocabularyAssignments(decks, [{ deck_id: "deck", student_id: "a" }, { deck_id: "deck", student_id: "a" }], [], [], [], [], now)[0];
  equal([report.student_count, report.remaining_today, report.card_count], [1, 0, 0]);
  equal(report.students[0].today_status, "no_cards_due");
});
