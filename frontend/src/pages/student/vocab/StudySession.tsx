import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../../lib/supabase";
import type { VocabStudyCard } from "../../../lib/types";
import { Button, EmptyState, Spinner } from "../../../components/ui";

interface ReviewResult {
  ok: boolean;
  next_state: { interval_days: number; status: string; due_at: string } | null;
}

const RATINGS = [
  { rating: 1, label: "Again", hint: "1", color: "var(--red)" },
  { rating: 2, label: "Hard", hint: "2", color: "var(--amber)" },
  { rating: 3, label: "Good", hint: "3", color: "var(--green)" },
  { rating: 4, label: "Easy", hint: "4", color: "var(--blue)" },
] as const;

export default function StudySession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deckId = params.get("deck_id");
  const [cards, setCards] = useState<VocabStudyCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  const [startedAt] = useState(Date.now());

  const load = useCallback(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const res = await fnJson<{ cards: VocabStudyCard[]; due_count: number }>(
        `student-vocab/study${deckId ? `?deck_id=${deckId}` : ""}`,
        { token },
      ).catch(() => null);
      setCards(res?.cards ?? []);
    })();
  }, [deckId]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cards === null || cards.length === 0) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!flipped) setFlipped(true);
      } else if (flipped && !busy) {
        const r = RATINGS.find((x) => x.hint === e.key);
        if (r) void rate(r.rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rate = async (rating: number) => {
    if (busy || cards === null) return;
    setBusy(true);
    const card = cards[idx];
    try {
      const token = await getToken();
      const res = await fnJson<ReviewResult>("student-vocab/review", {
        method: "POST",
        body: {
          card_id: card.card.id,
          rating,
          mode: "study",
          reviewed_on: new Date().toLocaleDateString("en-CA"),
        },
        token,
      });
      void res;
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (rating === 1) setAgain((a) => a + 1);
    if (idx + 1 < cards.length) {
      setIdx((i) => i + 1);
      setFlipped(false);
    } else {
      setDone(cards.length);
    }
  };

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

  if (done >= cards.length) {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    return (
      <div style={{ maxWidth: 460, margin: "60px auto", textAlign: "center" }}>
        <h1 className="page-title">Session complete</h1>
        <p className="page-sub">
          {cards.length} card{cards.length === 1 ? "" : "s"} reviewed · {again} again · {Math.round(elapsed / 60)}m {elapsed % 60}s
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <Button variant="outline" onClick={() => navigate("/student/vocabulary")}>Done</Button>
        </div>
      </div>
    );
  }

  const item = cards[idx];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="session-top">
        <span className="muted">Study · {idx + 1} of {cards.length}</span>
        <Button variant="ghost" onClick={() => navigate("/student/vocabulary")}>Exit</Button>
      </div>
      <div className="progress-bar"><div style={{ width: `${((idx + (flipped ? 1 : 0)) / cards.length) * 100}%` }} /></div>

      <div className="flash-scene">
        <div key={item.card.id} className={`flash-card${flipped ? " flipped" : ""}`} onClick={() => setFlipped(true)}>
          <div className="flash-face flash-front-face">
            <span className="flash-pos">{item.card.part_of_speech ?? "word"}</span>
            <h2>{item.card.word}</h2>
            <p className="muted">Click or press Space to reveal the definition</p>
            {item.state && item.state.lapses >= 4 && <span className="pill pill-red">leech — re-learn</span>}
          </div>
          <div className="flash-face flash-back-face">
            <h3>{item.card.word}</h3>
            <p className="flash-def">{item.card.definition}</p>
            {item.card.example_sentence && <p className="muted">“{item.card.example_sentence}”</p>}
            <p className="muted" style={{ marginTop: 8 }}>How well did you know it?</p>
          </div>
        </div>
      </div>

      {flipped && (
        <div className="rating-row">
          {RATINGS.map((r) => (
            <button
              key={r.rating}
              className="rating-btn"
              style={{ borderColor: r.color, color: r.color }}
              disabled={busy}
              onClick={() => void rate(r.rating)}
            >
              <strong>{r.label}</strong>
              <span className="muted">{r.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}