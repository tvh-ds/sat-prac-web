import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../../lib/supabase";
import { extractVocabFile } from "../../../lib/vocabFileImport";
import type { VocabCard, VocabDeck } from "../../../lib/types";
import { Button, EmptyState, Modal, Spinner, Pill } from "../../../components/ui";

export default function DeckCards() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [deck, setDeck] = useState<VocabDeck | null>(null);
  const [cards, setCards] = useState<VocabCard[] | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<VocabCard | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ word: "", definition: "", example_sentence: "", part_of_speech: "", tags: "" });
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!deckId) return;
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const [d, c] = await Promise.all([
        fnJson<{ decks: VocabDeck[] }>("student-vocab", { token }).catch(() => null),
        fnJson<{ cards: VocabCard[] }>(`student-vocab/decks/${deckId}/cards`, { token }).catch(() => null),
      ]);
      setDeck(d?.decks.find((x) => x.id === deckId) ?? null);
      setCards(c?.cards ?? null);
    })();
  }, [deckId]);

  useEffect(load, [load]);

  const saveCard = async () => {
    if (!deckId || !form.word.trim() || !form.definition.trim()) return;
    setError(null);
    try {
      const token = await getToken();
      const body = {
        word: form.word.trim(),
        definition: form.definition.trim(),
        example_sentence: form.example_sentence.trim() || null,
        part_of_speech: form.part_of_speech.trim() || null,
        tags: form.tags.split(";").map((t) => t.trim()).filter(Boolean),
      };
      if (editing === "new") {
        await fnJson<{ card: VocabCard }>("student-vocab/cards", { method: "POST", body: { ...body, deck_id: deckId }, token });
      } else if (editing) {
        await fnJson<{ card: VocabCard }>(`student-vocab/cards/${editing.id}`, { method: "PATCH", body, token });
      }
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const removeCard = async (card: VocabCard) => {
    if (!window.confirm(`Delete "${card.word}"?`)) return;
    try {
      const token = await getToken();
      await fnJson<{ ok: boolean }>(`student-vocab/cards/${card.id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onImportFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setImportResult(null);
    setImportNote(null);
    setImportLoading(true);
    try {
      const r = await extractVocabFile(f);
      setImportText(r.text);
      setImportNote(`${r.rows} row(s)${r.pages > 0 ? ` from ${r.pages} page(s)` : ""} loaded — review below, then Import.${r.note ? ` ${r.note}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read file");
    } finally {
      setImportLoading(false);
    }
  };

  const doImport = async () => {
    if (!deckId || !importText.trim()) return;
    setError(null);
    try {
      const token = await getToken();
      const res = await fnJson<{ imported: number; skipped: number; total: number }>("student-vocab/cards/import", {
        method: "POST",
        body: { deck_id: deckId, text: importText },
        token,
      });
      setImportResult(`${res.imported} imported${res.skipped > 0 ? `, ${res.skipped} skipped (duplicates or invalid)` : ""}.`);
      setImportText("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  if (!deck || !cards) return <Spinner />;

  const filtered = q.trim()
    ? cards.filter((c) => `${c.word} ${c.definition} ${c.part_of_speech ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    : cards;

  return (
    <div>
      <div className="page-head-row">
        <div>
          <h1 className="page-title">{deck.name}</h1>
          <p className="page-sub">
            {deck.description ?? "Word deck"} · {deck.card_count} cards · {deck.due_count} due · {deck.new_count} new
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!deck.assigned && <Button variant="outline" onClick={() => setImporting(true)}>Import</Button>}
          {!deck.assigned && <Button onClick={() => { setForm({ word: "", definition: "", example_sentence: "", part_of_speech: "", tags: "" }); setEditing("new"); }}>Add Card</Button>}
          {deck.assigned && <Pill tone="blue">assigned by admin · read-only</Pill>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <input className="f-input" style={{ maxWidth: 320 }} placeholder="Search cards…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="ghost" onClick={() => navigate("/student/vocabulary")}>Back to decks</Button>
        <div style={{ flex: 1 }} />
        <Button disabled={cards.length === 0} onClick={() => navigate(`/student/vocabulary/study?deck_id=${deck.id}`)}>Study</Button>
        <Button variant="outline" disabled={cards.length === 0} onClick={() => navigate(`/student/vocabulary/sprint?deck_id=${deck.id}`)}>Sprint</Button>
      </div>

      {filtered.length === 0 && (
        <EmptyState
          title="No cards"
          body={deck.assigned ? "This assigned deck has no cards yet." : "Add cards one at a time or paste a bulk list (word, definition per line)."}
        />
      )}

      <div className="card-table">
        {filtered.map((c) => (
          <div className="card-table-row" key={c.id}>
            <div className="vocab-word">
              <strong>{c.word}</strong>
              {c.part_of_speech && <span className="muted"> · {c.part_of_speech}</span>}
              {c.tags.map((t) => <Pill key={t}>{t}</Pill>)}
            </div>
            <div className="vocab-def">
              <span>{c.definition}</span>
              {c.example_sentence && <span className="muted">“{c.example_sentence}”</span>}
            </div>
            {!deck.assigned && (
              <div style={{ display: "flex", gap: 6 }}>
                <Button variant="ghost" size="sm" onClick={() => { setForm({ word: c.word, definition: c.definition, example_sentence: c.example_sentence ?? "", part_of_speech: c.part_of_speech ?? "", tags: c.tags.join(";") }); setEditing(c); }}>Edit</Button>
                <Button variant="danger" size="sm" onClick={() => void removeCard(c)}>Delete</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <Modal
          title={editing === "new" ? "Add Card" : `Edit ${editing.word}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveCard}>{editing === "new" ? "Add" : "Save"}</Button>
            </>
          }
        >
          <label className="f-label">Word</label>
          <input className="f-input" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} autoFocus />
          <label className="f-label">Definition</label>
          <textarea className="f-input" rows={3} value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} />
          <label className="f-label">Example sentence (optional)</label>
          <input className="f-input" value={form.example_sentence} onChange={(e) => setForm({ ...form, example_sentence: e.target.value })} />
          <label className="f-label">Part of speech (optional)</label>
          <input className="f-input" value={form.part_of_speech} onChange={(e) => setForm({ ...form, part_of_speech: e.target.value })} placeholder="noun, verb, adjective…" />
          <label className="f-label">Tags (optional, semicolon-separated)</label>
          <input className="f-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="sat;academic" />
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}

      {importing && (
        <Modal
          title="Import Cards"
          onClose={() => { setImporting(false); setImportResult(null); setImportNote(null); }}
          footer={
            <>
              <Button variant="ghost" onClick={() => { setImporting(false); setImportResult(null); setImportNote(null); }}>Close</Button>
              <Button onClick={doImport} disabled={!importText.trim() || importLoading}>Import</Button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 8 }}>
            Upload a file or paste rows below. PDF: two-column text tables (word, then definition). CSV/TXT: one card per line, <code>word, definition</code> (comma- or tab-separated). Review the extracted rows before importing.
          </p>
          <input
            type="file"
            accept=".pdf,.csv,.tsv,.txt"
            disabled={importLoading}
            onChange={(e) => { void onImportFile(e.target.files?.[0]); e.target.value = ""; }}
            style={{ marginBottom: 8 }}
          />
          {importLoading && <p className="muted">Reading file…</p>}
          {importNote && <p className="ok-text">{importNote}</p>}
          <textarea className="f-input" rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={"meticulous\tshowing great attention to detail\npragmatic\tdealing with things sensibly"} />
          {importResult && <p className="ok-text">{importResult}</p>}
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}