import assert from "node:assert/strict";
function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.strictEqual(actual, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
    toMatchObject: (expected: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(expected)) assert.deepStrictEqual((actual as Record<string, unknown>)[key], value, key);
    },
    rejects: { toThrow: (message: string) => assert.rejects(actual as Promise<unknown>, new RegExp(message)) },
  };
}
import { vocabularyAssignments, type AssignmentState, type AssignmentReview } from "./vocab_assignments.ts";
import { dailyVocabulary, assignmentCounts } from "../../../../frontend/src/lib/adminProgress.ts";
import { adminReturnPath } from "../../../../frontend/src/lib/adminNavigation.ts";

import { allProgressRows } from "./assignment_progress.ts";

const now = new Date("2026-10-22T12:00:00Z");
const deck = { id: "deck", name: "Vocabulary", description: null, color: "blue" };
const cards = ["a", "b", "c"].map(id => ({ id, deck_id: "deck", created_at: "2026-10-01T00:00:00Z" }));
const assignments = [{ deck_id: "deck", student_id: "student", assigned_at: "2026-10-20T00:00:00Z" }];
const profiles = [{ id: "student", full_name: "Student" }];
const review = (response_ms: number, mode = "study"): AssignmentReview => ({ student_id: "student", card_id: "a", reviewed_on: "2026-10-22", response_ms, mode, created_at: "2026-10-22T10:00:00Z", state_before: { due_at: "2026-10-22T00:00:00Z" } });
function progress(states: AssignmentState[], reviews: AssignmentReview[] = []) {
  return vocabularyAssignments([deck], assignments, cards, states, reviews, profiles, now)[0]!.students[0]!;
}

Deno.test("pages beyond the default database response cap without losing history", async () => {
    const rows = Array.from({ length: 1251 }, (_, id) => ({ id }));
    const starts: number[] = [];
    expect(await allProgressRows(start => { starts.push(start); return Promise.resolve({ data: rows.slice(start, start + 500), error: null }); })).toEqual(rows);
    expect(starts).toEqual([0, 500, 1000]);
  });
Deno.test("fails rather than presenting a partial list as complete", async () => {
    await expect(allProgressRows(() => Promise.resolve({ data: null, error: { message: "database unavailable" } }))).rejects.toThrow("Unable to load student progress");
  });
Deno.test("includes untouched new cards and cards due later today in remaining work", () => {
    const student = progress([
      { student_id: "student", card_id: "a", due_at: "2026-10-24T00:00:00Z", last_reviewed_at: "2026-10-22T10:00:00Z" },
      { student_id: "student", card_id: "c", due_at: "2026-10-22T18:00:00Z" },
    ], [review(1000), review(2000), review(90000, "sprint")]);
    expect(student.remaining_today).toBe(2);
    expect(student.new_remaining).toBe(1);
    expect(student.due_later_today).toBe(1);
    const day = dailyVocabulary([student]);
    expect(day).toMatchObject({ reviewed: 1, total: 3, remaining: 2, dueNow: 1, dueLater: 1, time: 3000, average: 3000, status: "In progress" });
    expect(student.reviewed_today).toBe(2); // two study responses, one unique due card
  });
Deno.test("keeps no-due students and never calls them completed", () => {
    const student = progress(cards.map(card => ({ student_id: "student", card_id: card.id, due_at: "2026-10-25T00:00:00Z" })));
    expect(dailyVocabulary([student])).toMatchObject({ reviewed: 0, total: 0, remaining: 0, status: "No cards due", time: null });
    expect(dailyVocabulary([]).status).toBe("No decks assigned");
  });
Deno.test("does not mark all unique cards reviewed as complete while a repeat is still due", () => {
  const student = progress(cards.map(card => ({ student_id: "student", card_id: card.id, due_at: card.id === "a" ? "2026-10-22T18:00:00Z" : "2026-10-25T00:00:00Z" })), [review(1000)]);
  expect(dailyVocabulary([student])).toMatchObject({ reviewed: 1, total: 1, remaining: 1, dueLater: 1, status: "In progress" });
});
Deno.test("shows not started when a student still has all new cards", () => {
    expect(dailyVocabulary([progress([])])).toMatchObject({ total: 3, reviewed: 0, remaining: 3, status: "Not started" });
  });
Deno.test("retains completed students and supports genuinely recorded zero timing", () => {
    const student = progress(cards.map(card => ({ student_id: "student", card_id: card.id, due_at: "2026-10-25T00:00:00Z" })), [review(0)]);
    expect(dailyVocabulary([student])).toMatchObject({ total: 1, reviewed: 1, remaining: 0, status: "Completed", time: 0, average: 0 });
  });
Deno.test("does not turn unavailable scheduling history into no cards due", () => {
    const student = progress(cards.map(card => ({ student_id: "student", card_id: card.id, due_at: "2026-10-25T00:00:00Z", last_reviewed_at: "2026-10-22T10:00:00Z" })));
    expect(dailyVocabulary([student])).toMatchObject({ total: null, status: "History unavailable" });
  });
Deno.test("weights average timing by distinct timed cards, not deck averages", () => {
    const student = progress([], [review(1000)]);
    const other = { ...student, history: student.history.map(day => day.date === "2026-10-22" ? { ...day, tracked_ms: 9000, timed_card_count: 3, average_card_ms: 3000 } : day) };
    expect(dailyVocabulary([student, other]).average).toBe(2500);
  });
Deno.test("only accepts supported local admin return routes", () => {
    const valid = "/admin/classes/example?tab=students&student_status=Completed";
    expect(adminReturnPath(valid, "/admin/classes")).toBe(valid);
    for (const value of ["https://example.com", "//example.com", "/admin/students\\example", "javascript:alert(1)"]) expect(adminReturnPath(value, "/admin/classes")).toBe("/admin/classes");
  });
Deno.test("separates practice and full-length completion counts", () => {
    const rows = [{ kind: "practice", status: "completed" }, { kind: "practice", status: "assigned" }, { kind: "full", status: "completed" }] as Parameters<typeof assignmentCounts>[0];
    expect(assignmentCounts(rows, "practice")).toBe("1/2");
    expect(assignmentCounts(rows, "full")).toBe("1/1");
  });
