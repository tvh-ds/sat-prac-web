import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../../lib/supabase";
import type { VocabCard, VocabDashboard, VocabDeck } from "../../../lib/types";
import { Button, EmptyState, Spinner } from "../../../components/ui";

export default function SprintSession() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deckId = params.get("deck_id");
  const [decks, setDecks] = useState<VocabDeck[] | null>(null);
  const [cards, setCards] = useState<VocabCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(0);
  const [missed, setMissed] = useState(0);
  const [startedAt] = useState(Date.now());

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      if (deckId) {
        const res = await fnJson<{ cards: VocabCard[] }>(`student-vocab/sprint?deck_id=${deckId}`, { token }).catch(() => null);
        setCards(res?.cards ?? []);
      } else {
        const d = await fnJson<VocabDashboard>(`student-vocab`, { token }).catch(() => null);
        setDecks(d?.decks ?? []);
      }
    })();
  }, [deckId]);

  const startSprint = async (targetDeck: string | null) => {
    const token = await getToken();
    const q = targetDeck ? `?deck_id=${targetDeck}` : "";
    const res = await fnJson<{ cards: VocabCard[] }>(`student-vocab/sprint${q}`, { token }).catch(() => null);
    setCards(res?.cards ?? []);
  };

  const record = async (rating: number) => {
    if (busy || cards === null) return;
    setBusy(true);
    const card = cards[idx];
    try {
      const token = await getToken();
      await fnJson<{ ok: boolean }>("student-vocab/review", {
        method: "POST",
        body: {
          card_id: card.id,
          rating,
          mode: "sprint",
          reviewed_on: new Date().toLocaleDateString("en-CA"),
        },
        token,
      });
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (rating >= 3) setGot((g) => g + 1);
    else setMissed((m) => m + 1);
    if (idx + 1 < cards.length) {
      setIdx((i) => i + 1);
      setFlipped(false);
    } else {
      setIdx(cards.length);
    }
  };

  if (!deckId && decks !== null && decks.length === 0) {
    return (
      <div>
        <EmptyState title="No decks" body="Create a deck with cards first, then sprint through it." />
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Button variant="outline" onClick={() => navigate("/student/vocabulary")}>Back to Vocabulary</Button>
        </div>
      </div>
    );
  }

  if (!deckId && cards === null && decks !== null) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 className="page-title">Sprint</h1>
        <p className="page-sub">Pick a deck to sprint through (or all cards shuffled). Sprint does not change your review schedule.</p>
        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          <div className="card test-card">
            <div style={{ minWidth: 0 }}>
              <h3 className="t-title">All decks</h3>
              <p className="t-desc">Every card you own, shuffled</p>
            </div>
            <Button onClick={() => void startSprint(null)}>Start</Button>
          </div>
          {decks.map((d) => (
            <div className="card test-card" key={d.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{d.name}</h3>
                <p className="t-desc">{d.card_count} cards</p>
              </div>
              <Button disabled={d.card_count === 0} onClick={() => void startSprint(d.id)}>Start</Button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (cards === null) return <Spinner />;

  if (cards.length === 0) {
    return (
      <div>
        <EmptyState title="No cards to sprint" />
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Button variant="outline" onClick={() => navigate("/student/vocabulary")}>Back to Vocabulary</Button>
        </div>
      </div>
    );
  }

  const finished = idx >= cards.length;
  if (finished) {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const acc = cards.length > 0 ? Math.round((got / cards.length) * 100) : 0;
    return (
      <div style={{ maxWidth: 460, margin: "60px auto", textAlign: "center" }}>
        <h1 className="page-title">Sprint finished</h1>
        <p className="page-sub">
          {cards.length} cards · {got} got it ({acc}%) · {missed} missed · {Math.round(elapsed / 60)}m {elapsed % 60}s
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <Button variant="outline" onClick={() => navigate("/student/vocabulary")}>Done</Button>
        </div>
      </div>
    );
  }

  const card = cards[idx];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="session-top">
        <span className="muted">Sprint · {idx + 1} of {cards.length} · {got}✓ {missed}✗</span>
        <Button variant="ghost" onClick={() => navigate("/student/vocabulary")}>Exit</Button>
      </div>
      <div className="progress-bar"><div style={{ width: `${(idx / cards.length) * 100}%` }} /></div>

      <div className="flash-scene">
        <div key={card.id} className={`flash-card${flipped ? " flipped" : ""}`} onClick={() => setFlipped(true)}>
          <div className="flash-face flash-front-face">
            <span className="flash-pos">{card.part_of_speech ?? "word"}</span>
            <h2>{card.word}</h2>
            <p className="muted">Click or press Space to reveal</p>
          </div>
          <div className="flash-face flash-back-face">
            <h3>{card.word}</h3>
            <p className="flash-def">{card.definition}</p>
            {card.example_sentence && <p className="muted">“{card.example_sentence}”</p>}
          </div>
        </div>
      </div>

      {flipped && (
        <div className="rating-row">
          <button className="rating-btn" style={{ borderColor: "var(--red)", color: "var(--red)" }} disabled={busy} onClick={() => void record(1)}>
            <strong>Missed</strong>
            <span className="muted">1</span>
          </button>
          <button className="rating-btn" style={{ borderColor: "var(--green)", color: "var(--green)" }} disabled={busy} onClick={() => void record(4)}>
            <strong>Got it</strong>
            <span className="muted">4</span>
          </button>
        </div>
      )}
    </div>
  );
}
