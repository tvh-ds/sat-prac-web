import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../../lib/supabase";
import type { VocabCardState, VocabRatingPreview, VocabStudyCard } from "../../../lib/types";
import { Button, EmptyState, Spinner } from "../../../components/ui";

interface NextSchedule extends VocabCardState {
  due_at: string;
  stability: number;
  difficulty: number;
  fsrs_state: VocabCardState["fsrs_state"];
  state_version: number;
  previews: VocabRatingPreview[];
}

interface ReviewResult {
  ok: boolean;
  next_state: NextSchedule | null;
  server_time: string;
}

const RATINGS = [
  { rating: 1 as const, label: "Again", hint: "1", color: "var(--red)" },
  { rating: 2 as const, label: "Hard", hint: "2", color: "var(--amber)" },
  { rating: 3 as const, label: "Good", hint: "3", color: "var(--green)" },
  { rating: 4 as const, label: "Easy", hint: "4", color: "var(--blue)" },
];

function previewLabel(preview: VocabRatingPreview | undefined, serverTime: string): string {
  if (!preview) return "";
  const remaining = Math.max(0, Date.parse(preview.due_at) - Date.parse(serverTime));
  if (remaining < 60_000) return "now";
  if (remaining < 3_600_000) return `${Math.ceil(remaining / 60_000)}m`;
  if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)}h`;
  return `${Math.ceil(remaining / 86_400_000)}d`;
}

function remainingLabel(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export default function StudySession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deckId = params.get("deck_id");
  const [cards, setCards] = useState<VocabStudyCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [again, setAgain] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [startedAt] = useState(Date.now());
  const pendingSubmission = useRef<string | null>(null);
  const pendingRating = useRef<number | null>(null);
  const revealedAt = useRef(Date.now());

  const load = useCallback(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) {
        setCards([]);
        return;
      }
      const res = await fnJson<{ cards: VocabStudyCard[]; due_count: number; server_time: string }>(
        `student-vocab/study${deckId ? `?deck_id=${deckId}` : ""}`,
        { token },
      ).catch(() => null);
      setCards(res?.cards ?? []);
    })();
  }, [deckId]);

  useEffect(load, [load]);

  const item = cards?.[idx];
  const readyAt = item ? Date.parse(item.ready_at) : 0;
  const waitingMs = item ? readyAt - clock : 0;
  useEffect(() => {
    if (waitingMs <= 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitingMs]);

  const reveal = () => {
    if (!flipped && waitingMs <= 0) {
      revealedAt.current = Date.now();
      setFlipped(true);
    }
  };

  const rate = async (rating: number) => {
    if (busy || cards === null || !item || waitingMs > 0) return;
    if (pendingRating.current !== null && pendingRating.current !== rating) return;
    setBusy(true);
    setSaveError(null);
    const submissionId = pendingSubmission.current ?? crypto.randomUUID();
    pendingSubmission.current = submissionId;
    pendingRating.current = rating;
    try {
      const token = await getToken();
      const res = await fnJson<ReviewResult>("student-vocab/review", {
        method: "POST",
        body: {
          card_id: item.card.id,
          rating,
          mode: "study",
          reviewed_on: new Date().toLocaleDateString("en-CA"),
          response_ms: Math.max(0, Date.now() - revealedAt.current),
          submission_id: submissionId,
          expected_version: item.state_version,
        },
        token,
      });

      pendingSubmission.current = null;
      pendingRating.current = null;
      setAttempts((count) => count + 1);
      if (rating === 1) setAgain((count) => count + 1);

      const next = res.next_state;
      if (next && ["learning", "relearning"].includes(next.fsrs_state)) {
        const queued: VocabStudyCard = {
          ...item,
          state: next,
          state_version: next.state_version,
          previews: next.previews,
          ready_at: next.due_at,
        };
        setCards([...cards, queued]);
      }

      setIdx((current) => current + 1);
      setFlipped(false);
      setClock(Date.now());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save this review. Try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cards === null || !item || waitingMs > 0) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        reveal();
      } else if (flipped && !busy) {
        const rating = RATINGS.find((entry) => entry.hint === e.key);
        if (rating) void rate(rating.rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (cards === null) return <Spinner />;

  if (cards.length === 0) {
    return (
      <div>
        <EmptyState
          title="Nothing due right now"
          body="All caught up. New cards become due when you add them; reviewed cards come back on their schedule."
        />
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Button variant="outline" onClick={() => navigate("/student/vocabulary")}>Back to Vocabulary</Button>
        </div>
      </div>
    );
  }

  if (idx >= cards.length) {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    return (
      <div style={{ maxWidth: 460, margin: "60px auto", textAlign: "center" }}>
        <h1 className="page-title">Session complete</h1>
        <p className="page-sub">
          {attempts} review{attempts === 1 ? "" : "s"} · {again} again · {Math.round(elapsed / 60)}m {elapsed % 60}s
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <Button variant="outline" onClick={() => navigate("/student/vocabulary")}>Done</Button>
        </div>
      </div>
    );
  }

  const activeItem = cards[idx];
  const percent = Math.min(100, (idx / Math.max(cards.length, 1)) * 100);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="session-top">
        <span className="muted">Study · {idx + 1} of {cards.length}</span>
        <Button variant="ghost" onClick={() => navigate("/student/vocabulary")}>Exit</Button>
      </div>
      <div className="progress-bar"><div style={{ width: `${percent}%` }} /></div>

      {waitingMs > 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 36, marginTop: 24 }} aria-live="polite">
          <h2>Next learning step</h2>
          <p className="muted">Continue when this card is ready in {remainingLabel(waitingMs)}.</p>
          <p className="muted">Other due cards in this session are already reviewed.</p>
        </div>
      ) : (
        <>
          <div className="flash-scene">
            <div key={`${activeItem.card.id}-${idx}`} className={`flash-card${flipped ? " flipped" : ""}`} onClick={reveal}>
              <div className="flash-face flash-front-face">
                <span className="flash-pos">{activeItem.card.part_of_speech ?? "word"}</span>
                <h2>{activeItem.card.word}</h2>
                <p className="muted">Click or press Space to reveal the definition</p>
                {activeItem.state && (activeItem.state.legacy_lapses >= 4 || activeItem.state.lapses >= 4) && <span className="pill pill-red">leech — re-learn</span>}
              </div>
              <div className="flash-face flash-back-face">
                <h3>{activeItem.card.word}</h3>
                <p className="flash-def">{activeItem.card.definition}</p>
                {activeItem.card.example_sentence && <p className="muted">“{activeItem.card.example_sentence}”</p>}
                <p className="muted" style={{ marginTop: 8 }}>How well did you recall it?</p>
              </div>
            </div>
          </div>

          {flipped && (
            <div className="rating-row">
              {RATINGS.map((rating) => {
                const preview = activeItem.previews.find((entry) => entry.rating === rating.rating);
                return (
                  <button
                    key={rating.rating}
                    className="rating-btn"
                    style={{ borderColor: rating.color, color: rating.color }}
                    disabled={busy || (pendingRating.current !== null && pendingRating.current !== rating.rating)}
                    onClick={() => void rate(rating.rating)}
                    title={rating.rating === 2 ? "You recalled it, but with difficulty" : undefined}
                  >
                    <strong>{rating.label}</strong>
                    <span>{previewLabel(preview, new Date().toISOString())}</span>
                    <span className="muted">{rating.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {saveError && (
        <p role="alert" style={{ color: "var(--red)", textAlign: "center", marginTop: 14 }}>
          {saveError}{" "}
          {saveError.toLowerCase().includes("reload") || saveError.toLowerCase().includes("elsewhere")
            ? <Button variant="outline" onClick={() => window.location.reload()}>Reload session</Button>
            : "Select the same rating again to retry."}
        </p>
      )}
    </div>
  );
}
