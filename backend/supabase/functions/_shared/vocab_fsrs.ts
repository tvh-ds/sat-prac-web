import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type RecordLogItem,
} from "npm:ts-fsrs@5.4.2";

export const VOCAB_SCHEDULER_VERSION = 6;
export const VOCAB_REQUEST_RETENTION = 0.95;

export const vocabScheduler = fsrs({
  request_retention: VOCAB_REQUEST_RETENTION,
  maximum_interval: 36_500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export interface FsrsStoredState {
  due_at?: string | null;
  stability?: number | null;
  difficulty?: number | null;
  learning_steps?: number | null;
  scheduled_days?: number | null;
  repetitions?: number | null;
  lapses?: number | null;
  fsrs_state?: string | null;
  last_reviewed_at?: string | null;
}

export interface FsrsStateSnapshot {
  due_at: string;
  stability: number;
  difficulty: number;
  learning_steps: number;
  scheduled_days: number;
  repetitions: number;
  lapses: number;
  fsrs_state: "new" | "learning" | "review" | "relearning";
  last_reviewed_at: string | null;
}

export interface FsrsHistoricalReview {
  id: string;
  rating: number;
  created_at: string;
}

const stateByName = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
} as const;

const nameByState = new Map<number, FsrsStateSnapshot["fsrs_state"]>([
  [State.New, "new"],
  [State.Learning, "learning"],
  [State.Review, "review"],
  [State.Relearning, "relearning"],
]);

export function toFsrsCard(stored: FsrsStoredState | null | undefined, now: Date): Card {
  if (!stored?.stability || !stored.difficulty || !stored.due_at) {
    return createEmptyCard(now);
  }

  const lastReview = stored.last_reviewed_at ? new Date(stored.last_reviewed_at) : undefined;
  return {
    due: new Date(stored.due_at),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: lastReview ? Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86_400_000)) : 0,
    scheduled_days: stored.scheduled_days ?? 0,
    learning_steps: stored.learning_steps ?? 0,
    reps: stored.repetitions ?? 0,
    lapses: stored.lapses ?? 0,
    state: stateByName[stored.fsrs_state as keyof typeof stateByName] ?? State.New,
    ...(lastReview ? { last_review: lastReview } : {}),
  } satisfies Card;
}

export function snapshotFsrsCard(card: Card): FsrsStateSnapshot {
  const state = nameByState.get(card.state);
  if (!state) throw new Error(`Unsupported FSRS card state: ${card.state}`);
  return {
    due_at: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    learning_steps: card.learning_steps,
    scheduled_days: card.scheduled_days,
    repetitions: card.reps,
    lapses: card.lapses,
    fsrs_state: state,
    last_reviewed_at: card.last_review?.toISOString() ?? null,
  };
}

export function ratingFor(value: number): 1 | 2 | 3 | 4 {
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  throw new Error("Rating must be an integer from 1 to 4");
}

export function previewFsrsRatings(card: Card, now: Date) {
  const preview = vocabScheduler.repeat(card, now);
  return ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map((rating) => {
    const entry = preview[rating] as RecordLogItem;
    return {
      rating,
      due_at: entry.card.due.toISOString(),
      scheduled_days: entry.log.scheduled_days,
      state: nameByState.get(entry.card.state) ?? "new",
    };
  });
}

export function replayFsrsHistory(reviews: FsrsHistoricalReview[], now: Date): FsrsStateSnapshot {
  const ordered = [...reviews].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  if (ordered.length === 0) return snapshotFsrsCard(createEmptyCard(now));
  let card = createEmptyCard(new Date(ordered[0].created_at));
  for (const review of ordered) {
    card = vocabScheduler.next(card, new Date(review.created_at), ratingFor(review.rating)).card;
  }
  return snapshotFsrsCard(card);
}
