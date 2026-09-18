import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { AdminVocabDeck } from "../../lib/types";
import { Button, EmptyState, Modal, Spinner, fmtDate } from "../../components/ui";

export default function AdminVocabPage() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<AdminVocabDeck[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#7f1d1d");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ decks: AdminVocabDeck[] }>("admin-vocab/decks", { token }).catch((e) => {
        setError(e.message);
        return null;
      });
      setDecks(d?.decks ?? []);
    })();
  }, []);

  useEffect(load, [load]);

  const createDeck = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const token = await getToken();
      const { deck } = await fnJson<{ deck: AdminVocabDeck }>("admin-vocab/decks", {
        method: "POST",
        body: { name: name.trim(), description: description.trim() || null, color },
        token,
      });
      setCreating(false);
      setName("");
      setDescription("");
      navigate(`/admin/vocabulary/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create deck");
    }
  };

  const archive = async (deck: AdminVocabDeck) => {
    if (!window.confirm(`Archive "${deck.name}"? Students will lose access immediately.`)) return;
    const token = await getToken();
    await fnJson<{ deck: AdminVocabDeck }>(`admin-vocab/decks/${deck.id}`, { method: "PATCH", body: { status: "archived" }, token });
    load();
  };

  const restore = async (deck: AdminVocabDeck) => {
    const token = await getToken();
    await fnJson<{ deck: AdminVocabDeck }>(`admin-vocab/decks/${deck.id}`, { method: "PATCH", body: { status: "active" }, token });
    load();
  };

  const remove = async (deck: AdminVocabDeck) => {
    if (!window.confirm(`Permanently delete "${deck.name}"? All cards and assignments will be removed.`)) return;
    const token = await getToken();
    await fnJson<{ ok: boolean }>(`admin-vocab/decks/${deck.id}`, { method: "DELETE", token });
    load();
  };

  if (!decks) return <Spinner />;

  return (
    <div>
      <div className="section-label">[ Vocabulary ]</div>
      <div className="page-head-row">
        <div>
          <h1 className="page-title"><span className="hl-muted">Admin</span> <span className="hl-bright">vocabulary</span></h1>
          <p className="page-sub">Create decks, import word cards, and assign them to students.</p>
        </div>
        <Button onClick={() => setCreating(true)}>New Deck</Button>
      </div>

      {error && <div className="login-error">{error}</div>}

      {decks.length === 0 && (
        <EmptyState title="No admin decks yet" body="Create a deck, import word/definition cards via CSV, then assign it to students." />
      )}

      {decks.filter((d) => d.status === "active").length > 0 && (
        <>
          <h3 className="t-title" style={{ marginTop: 8 }}>Active</h3>
          <div className="deck-grid">
            {decks.filter((d) => d.status === "active").map((deck) => (
              <div className="card deck-card" key={deck.id}>
                <div className="deck-color" style={{ background: deck.color }} />
                <h3 className="t-title">{deck.name}</h3>
                <p className="t-desc">{deck.description ?? "Word deck"}</p>
                <p className="t-desc">
                  <a href={`/admin/vocabulary/decks/${deck.id}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/vocabulary/decks/${deck.id}`); }} style={{ color: "var(--accent)" }}>Manage</a>
                </p>
                <div className="deck-actions">
                  <Button variant="outline" onClick={() => navigate(`/admin/vocabulary/decks/${deck.id}`)}>Open</Button>
                  <Button variant="ghost" onClick={() => void archive(deck)}>Archive</Button>
                  <Button variant="danger" onClick={() => void remove(deck)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {decks.filter((d) => d.status === "archived").length > 0 && (
        <>
          <h3 className="t-title" style={{ marginTop: 24 }}>Archived</h3>
          <div className="card card-pad">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Assigned</th><th>Archived</th><th /></tr>
              </thead>
              <tbody>
                {decks.filter((d) => d.status === "archived").map((deck) => (
                  <tr key={deck.id}>
                    <td>{deck.name}</td>
                    <td>{deck.assigned_count} students</td>
                    <td>{fmtDate(deck.created_at)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="outline" size="sm" onClick={() => void restore(deck)}>Restore</Button>
                        <Button variant="danger" size="sm" onClick={() => void remove(deck)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {creating && (
        <Modal
          title="New Deck"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={createDeck}>Create</Button>
            </>
          }
        >
          <label className="f-label">Name</label>
          <input className="f-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SAT High-Frequency Words" autoFocus />
          <label className="f-label">Description (optional)</label>
          <input className="f-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note" />
          <label className="f-label">Color</label>
          <div className="color-row">
            {["#7f1d1d", "#b91c1c", "#c2410c", "#b45309", "#1d4ed8", "#0f766e", "#15803d", "#6d28d9"].map((c) => (
              <button
                key={c}
                className={`color-dot${color === c ? " color-dot-on" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}