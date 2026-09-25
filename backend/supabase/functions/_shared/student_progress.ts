export type AttemptSummary = {
  id: string;
  started_at: string;
  status: string;
};

export function latestAttempt<T extends AttemptSummary>(
  attempts: T[],
): T | null {
  return attempts.reduce<T | null>((latest, attempt) => {
    if (!latest) return attempt;
    const attemptTime = Date.parse(attempt.started_at);
    const latestTime = Date.parse(latest.started_at);
    if (
      attemptTime > latestTime ||
      (attemptTime === latestTime && attempt.id > latest.id)
    ) return attempt;
    return latest;
  }, null);
}

export function practiceAssignmentStatus(
  assignmentStatus: string,
  dueAt: string | null,
  latestAttemptStatus: string | null,
  now: Date,
): string {
  if (latestAttemptStatus) {
    return latestAttemptStatus === "graded" ? "completed" : latestAttemptStatus;
  }
  if (assignmentStatus !== "assigned") return assignmentStatus;
  if (dueAt && Date.parse(dueAt) < now.getTime()) return "overdue";
  return assignmentStatus;
}

export function sumModuleTimeSeconds(
  rows: Array<{ time_spent_seconds: number | null }>,
): number | null {
  if (rows.length === 0) return null;
  return rows.reduce(
    (total, row) => total + Math.max(0, Number(row.time_spent_seconds) || 0),
    0,
  );
}

export type AssignedVocabDeck = { id: string; name: string };
export type VocabCard = { id: string; deck_id: string };
export type VocabCardState = { card_id: string; due_at: string };
export type VocabReview = {
  card_id: string;
  reviewed_on: string;
  response_ms: number | null;
};

export type AssignedVocabDeckProgress = {
  deck_id: string;
  name: string;
  card_count: number;
  due_remaining: number;
  reviewed_today: number;
  tracked_review_ms: number | null;
  tracked_review_count: number;
  today_status: "done_today" | "no_cards_due" | "due_remaining";
};

export function assignedVocabDeckProgress(
  decks: AssignedVocabDeck[],
  cards: VocabCard[],
  states: VocabCardState[],
  reviews: VocabReview[],
  now: Date,
): AssignedVocabDeckProgress[] {
  const today = now.toISOString().slice(0, 10);
  const dueAtByCard = new Map(
    states.map((state) => [state.card_id, state.due_at]),
  );

  return decks.map((deck) => {
    const deckCards = cards.filter((card) => card.deck_id === deck.id);
    const cardIds = new Set(deckCards.map((card) => card.id));
    const dueRemaining = deckCards.filter((card) => {
      const dueAt = dueAtByCard.get(card.id);
      return dueAt != null && Date.parse(dueAt) <= now.getTime();
    }).length;
    const todayReviews = reviews.filter((review) =>
      cardIds.has(review.card_id) && review.reviewed_on === today
    );
    const timedReviews = todayReviews.filter((review) =>
      review.response_ms != null
    );
    const trackedReviewMs = timedReviews.length > 0
      ? timedReviews.reduce(
        (total, review) => total + Math.max(0, Number(review.response_ms) || 0),
        0,
      )
      : null;

    return {
      deck_id: deck.id,
      name: deck.name,
      card_count: deckCards.length,
      due_remaining: dueRemaining,
      reviewed_today: todayReviews.length,
      tracked_review_ms: trackedReviewMs,
      tracked_review_count: timedReviews.length,
      today_status: dueRemaining > 0
        ? "due_remaining"
        : todayReviews.length > 0
        ? "done_today"
        : "no_cards_due",
    };
  });
}

export function vocabularyStreak(
  activityDates: string[],
  today: string,
): { current: number; best: number } {
  const dates = new Set(activityDates);
  let current = 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);
  if (!dates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    current++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let best = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const day of [...dates].sort()) {
    const date = new Date(`${day}T00:00:00.000Z`);
    const gap = previous
      ? (date.getTime() - previous.getTime()) / 86_400_000
      : null;
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return { current, best };
}
