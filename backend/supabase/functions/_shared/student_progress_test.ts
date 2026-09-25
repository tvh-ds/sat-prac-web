import {
  assignedVocabDeckProgress,
  latestAttempt,
  practiceAssignmentStatus,
  sumModuleTimeSeconds,
  vocabularyStreak,
} from "./student_progress.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("latestAttempt selects the most recent retake deterministically", () => {
  const attempts = [
    { id: "old", started_at: "2026-09-23T10:00:00Z", status: "graded" },
    { id: "newer", started_at: "2026-09-24T10:00:00Z", status: "in_progress" },
    { id: "tie-z", started_at: "2026-09-24T10:00:00Z", status: "submitted" },
  ];
  assertEquals(latestAttempt(attempts)?.id, "tie-z");
  assertEquals(latestAttempt([]), null);
});

Deno.test("practice assignment status prefers the latest attempt and identifies overdue work", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  assertEquals(
    practiceAssignmentStatus("assigned", "2026-09-24T12:00:00Z", "graded", now),
    "completed",
  );
  assertEquals(
    practiceAssignmentStatus(
      "assigned",
      "2026-09-24T12:00:00Z",
      "in_progress",
      now,
    ),
    "in_progress",
  );
  assertEquals(
    practiceAssignmentStatus("assigned", "2026-09-24T12:00:00Z", null, now),
    "overdue",
  );
  assertEquals(
    practiceAssignmentStatus("assigned", "2026-09-26T12:00:00Z", null, now),
    "assigned",
  );
  assertEquals(practiceAssignmentStatus("expired", null, null, now), "expired");
});

Deno.test("practice active time sums module records but stays unavailable without records", () => {
  assertEquals(sumModuleTimeSeconds([]), null);
  assertEquals(
    sumModuleTimeSeconds([{ time_spent_seconds: 30 }, {
      time_spent_seconds: 45,
    }, { time_spent_seconds: null }]),
    75,
  );
});

Deno.test("assigned vocabulary progress distinguishes caught-up, due, and no-due decks", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const progress = assignedVocabDeckProgress(
    [
      { id: "reviewed", name: "Reviewed" },
      { id: "due", name: "Due" },
      { id: "untimed", name: "Untimed" },
      { id: "empty", name: "Empty" },
    ],
    [
      { id: "a", deck_id: "reviewed" },
      { id: "b", deck_id: "due" },
      { id: "offset-boundary", deck_id: "due" },
      { id: "c", deck_id: "untimed" },
    ],
    [
      { card_id: "a", due_at: "2026-09-26T12:00:00Z" },
      { card_id: "b", due_at: "2026-09-25T11:00:00Z" },
      { card_id: "offset-boundary", due_at: "2026-09-25T13:00:00+01:00" },
      { card_id: "c", due_at: "2026-09-26T12:00:00Z" },
    ],
    [
      { card_id: "a", reviewed_on: "2026-09-25", response_ms: 1200 },
      { card_id: "a", reviewed_on: "2026-09-25", response_ms: null },
      { card_id: "c", reviewed_on: "2026-09-25", response_ms: null },
      { card_id: "a", reviewed_on: "2026-09-24", response_ms: 9000 },
    ],
    now,
  );

  assertEquals(
    progress.map((deck) => ({
      id: deck.deck_id,
      due: deck.due_remaining,
      reviews: deck.reviewed_today,
      time: deck.tracked_review_ms,
      tracked: deck.tracked_review_count,
      status: deck.today_status,
    })),
    [
      {
        id: "reviewed",
        due: 0,
        reviews: 2,
        time: 1200,
        tracked: 1,
        status: "done_today",
      },
      {
        id: "due",
        due: 2,
        reviews: 0,
        time: null,
        tracked: 0,
        status: "due_remaining",
      },
      {
        id: "untimed",
        due: 0,
        reviews: 1,
        time: null,
        tracked: 0,
        status: "done_today",
      },
      {
        id: "empty",
        due: 0,
        reviews: 0,
        time: null,
        tracked: 0,
        status: "no_cards_due",
      },
    ],
  );
});

Deno.test("vocabulary streak includes today or falls back to yesterday and calculates best run", () => {
  assertEquals(
    vocabularyStreak(
      [
        "2026-09-18",
        "2026-09-19",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-25",
      ],
      "2026-09-25",
    ),
    { current: 1, best: 3 },
  );
  assertEquals(vocabularyStreak(["2026-09-23", "2026-09-24"], "2026-09-25"), {
    current: 2,
    best: 2,
  });
});
