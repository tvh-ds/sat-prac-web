import { Rating, State, createEmptyCard } from "npm:ts-fsrs@5.4.2";
import {
  VOCAB_REQUEST_RETENTION,
  previewFsrsRatings,
  replayFsrsHistory,
  snapshotFsrsCard,
  toFsrsCard,
  vocabScheduler,
} from "./vocab_fsrs.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("FSRS settings use selected retention and four ordered previews", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  const previews = previewFsrsRatings(createEmptyCard(now), now);
  assertEquals(VOCAB_REQUEST_RETENTION, 0.95);
  assertEquals(previews.map((item) => item.rating), [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
  assert(previews.every((item) => Number.isFinite(Date.parse(item.due_at))));
});

Deno.test("an Again review enters a short relearning step", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  let result = vocabScheduler.next(createEmptyCard(now), now, Rating.Good);
  result = vocabScheduler.next(result.card, new Date("2026-09-28T12:10:00.000Z"), Rating.Good);
  const reviewAt = new Date("2026-09-30T12:10:00.000Z");
  result = vocabScheduler.next(result.card, reviewAt, Rating.Again);
  assertEquals(result.card.state, State.Relearning);
  assert(result.card.due.getTime() > reviewAt.getTime());
  assert(result.card.due.getTime() - reviewAt.getTime() <= 10 * 60_000);
});

Deno.test("stored FSRS state round trips and defaults to a New card", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  const fresh = snapshotFsrsCard(toFsrsCard(null, now));
  assertEquals(fresh.fsrs_state, "new");
  const reviewed = vocabScheduler.next(createEmptyCard(now), now, Rating.Good).card;
  const saved = snapshotFsrsCard(reviewed);
  const restored = toFsrsCard(saved, new Date("2026-09-29T12:00:00.000Z"));
  assertEquals(restored.state, reviewed.state);
  assertEquals(restored.stability, reviewed.stability);
  assertEquals(restored.difficulty, reviewed.difficulty);
  assertEquals(restored.last_review?.toISOString(), reviewed.last_review?.toISOString());
});

Deno.test("history replay is chronological, deterministic, and keeps the latest review time", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  const history = [
    { id: "b", rating: 3, created_at: "2026-09-28T12:10:00.000Z" },
    { id: "a", rating: 3, created_at: "2026-09-28T12:00:00.000Z" },
  ];
  const first = replayFsrsHistory(history, now);
  const second = replayFsrsHistory([...history].reverse(), now);
  assertEquals(first, second);
  assertEquals(first.last_reviewed_at, "2026-09-28T12:10:00.000Z");
});
