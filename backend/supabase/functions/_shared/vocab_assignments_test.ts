import { vocabularyAssignments, vocabularyStudyHistory } from "./vocab_assignments.ts";

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
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-10", response_ms: 1200, mode: "study" },
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-10", response_ms: null, mode: "study" },
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-09", response_ms: 99000, mode: "study" },
    { student_id: "a", card_id: "new", reviewed_on: "2026-10-10", response_ms: 99000, mode: "sprint" },
    { student_id: "outsider", card_id: "new", reviewed_on: "2026-10-10", response_ms: 99000, mode: "study" },
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


Deno.test("history rewinds completed schedules, deduplicates cards and excludes sprint timing", () => {
  const result = vocabularyStudyHistory([{ id: "c", deck_id: "deck" }], [
    { student_id: "a", card_id: "c", due_at: "2026-10-20T00:00:00Z", last_reviewed_at: "2026-10-09T12:00:00Z" },
  ], [
    { student_id: "a", card_id: "c", mode: "study", reviewed_on: "2026-10-09", created_at: "2026-10-09T10:00:00Z", response_ms: 2000, state_before: { due_at: "2026-10-09T00:00:00Z" } },
    { student_id: "a", card_id: "c", mode: "study", reviewed_on: "2026-10-09", created_at: "2026-10-09T12:00:00Z", response_ms: 4000, state_before: { due_at: "2026-10-09T11:00:00Z" } },
    { student_id: "a", card_id: "c", mode: "sprint", reviewed_on: "2026-10-09", created_at: "2026-10-09T13:00:00Z", response_ms: 99000 },
  ], "2026-10-04T00:00:00Z", now);
  equal(result.length, 7);
  equal(result[0].date, "2026-10-04");
  equal([result[4].total_due, result[4].studied_due], [0, 0]);
  equal([result[5].total_due, result[5].studied_due, result[5].studied_cards], [1, 1, 1]);
  equal([result[5].tracked_ms, result[5].average_card_ms, result[5].review_count], [6000, 6000, 2]);
  equal([result[6].total_due, result[6].studied_due], [0, 0]);
});

Deno.test("new cards only count after assignment and card creation; missing timing stays null", () => {
  const result = vocabularyStudyHistory([
    { id: "c", deck_id: "deck", created_at: "2026-10-08T12:00:00Z" },
    { id: "d", deck_id: "deck", created_at: "2026-10-10T23:59:59Z" },
  ], [], [], "2026-10-09T12:00:00Z", now);
  equal(result.map(d => d.total_due), [0, 0, 0, 0, 0, 1, 2]);
  equal([result[5].tracked_ms, result[5].average_card_ms], [null, null]);
});

Deno.test("legacy reviews without schedule snapshots show unknown rather than invented due counts", () => {
  const result = vocabularyStudyHistory([{ id: "c", deck_id: "deck" }], [
    { student_id: "a", card_id: "c", due_at: "2026-10-20T00:00:00Z", last_reviewed_at: "2026-10-09T12:00:00Z" },
  ], [{ student_id: "a", card_id: "c", mode: "study", reviewed_on: "2026-10-09", created_at: "2026-10-09T12:00:00Z", response_ms: null }], undefined, now);
  equal(result[5].total_due, null);
  equal(result[5].tracked_ms, null);
  equal(result[6].total_due, 0);
});

Deno.test("deck participation excludes no-due students and never counts another student's reviews", () => {
  const report = vocabularyAssignments(decks, [
    { deck_id: "deck", student_id: "a", assigned_at: "2026-10-10T00:00:00Z" },
    { deck_id: "deck", student_id: "b", assigned_at: "2026-10-10T00:00:00Z" },
    { deck_id: "deck", student_id: "c", assigned_at: "2026-10-10T00:00:00Z" },
  ], [{ id: "word", deck_id: "deck" }], [
    { student_id: "a", card_id: "word", due_at: "2026-10-11T00:00:00Z", last_reviewed_at: "2026-10-10T10:00:00Z" },
    { student_id: "b", card_id: "word", due_at: "2026-10-11T00:00:00Z" },
  ], [{ student_id: "a", card_id: "word", reviewed_on: "2026-10-10", created_at: "2026-10-10T10:00:00Z", mode: "study", response_ms: 1000, state_before: { due_at: "2026-10-10T00:00:00Z" } }], [], now)[0];
  equal(report.history[6], { date: "2026-10-10", students_studied: 1, students_with_due: 2, students_unknown: 0 });
  equal(report.students.find(s => s.student_id === "c")!.history[6].studied_due, 0);
});
