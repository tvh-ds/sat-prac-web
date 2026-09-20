import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { extractVocabFile } from "../../lib/vocabFileImport";
import type { AdminVocabDeck, VocabAssignmentStudent, VocabCard } from "../../lib/types";
import { Button, EmptyState, Modal, Pill, Spinner } from "../../components/ui";

export default function AdminVocabDeckPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [deck, setDeck] = useState<AdminVocabDeck | null>(null);
  const [cards, setCards] = useState<VocabCard[] | null>(null);
  const [students, setStudents] = useState<VocabAssignmentStudent[] | null>(null);
  const [tab, setTab] = useState<"cards" | "assignments">("cards");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<VocabCard | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ word: "", definition: "", example_sentence: "", part_of_speech: "", tags: "" });
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDeck = useCallback(() => {
    if (!deckId) return;
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ deck: AdminVocabDeck }>(`admin-vocab/decks/${deckId}`, { token }).catch(() => null);
      setDeck(d?.deck ?? null);
    })();
  }, [deckId]);

  const loadCards = useCallback(() => {
    if (!deckId) return;
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ cards: VocabCard[] }>(`admin-vocab/decks/${deckId}/cards`, { token }).catch(() => null);
      setCards(d?.cards ?? []);
    })();
  }, [deckId]);

  const loadStudents = useCallback(() => {
    if (!deckId) return;
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ students: VocabAssignmentStudent[] }>(`admin-vocab/decks/${deckId}/assignments`, { token }).catch(() => null);
      setStudents(d?.students ?? []);
    })();
  }, [deckId]);

  useEffect(() => { loadDeck(); loadCards(); }, [loadDeck, loadCards]);
  useEffect(() => { if (tab === "assignments") loadStudents(); }, [tab, loadStudents]);

  const visibleCards = useMemo(() => {
    if (!q.trim()) return cards ?? [];
    const needle = q.trim().toLowerCase();
    return (cards ?? []).filter((c) => `${c.word} ${c.definition} ${c.part_of_speech ?? ""}`.toLowerCase().includes(needle));
  }, [cards, q]);

  const changeSelected = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

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
        await fnJson<{ card: VocabCard }>(`admin-vocab/decks/${deckId}/cards`, { method: "POST", body, token });
      } else if (editing) {
        await fnJson<{ card: VocabCard }>(`admin-vocab/decks/${deckId}/cards/${editing.id}`, { method: "PATCH", body, token });
      }
      setEditing(null);
      loadCards();
      loadDeck();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const removeCard = async (card: VocabCard) => {
    if (!window.confirm(`Delete "${card.word}"?`)) return;
    try {
      const token = await getToken();
      await fnJson<{ ok: boolean }>(`admin-vocab/decks/${deckId}/cards/${card.id}`, { method: "DELETE", token });
      loadCards();
      loadDeck();
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
    setImportResult(null);
    try {
      const token = await getToken();
      const res = await fnJson<{ imported: number; skipped: number; total: number }>(`admin-vocab/decks/${deckId}/cards/import`, {
        method: "POST",
        body: { text: importText },
        token,
      });
      setImportResult(`${res.imported} imported${res.skipped > 0 ? `, ${res.skipped} skipped (duplicates or invalid)` : ""}.`);
      setImportText("");
      loadCards();
      loadDeck();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  const saveAssignments = async () => {
    if (!deckId) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fnJson<{ ok: boolean; added: number; removed: number }>(`admin-vocab/decks/${deckId}/assignments`, {
        method: "POST",
        body: { student_ids: [...selected] },
        token,
      });
      setNotice(`${res.added} added, ${res.removed} removed.`);
      loadDeck();
      loadStudents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!deck || !window.confirm(`Archive "${deck.name}"? Students lose access immediately.`)) return;
    const token = await getToken();
    await fnJson(`admin-vocab/decks/${deck.id}`, { method: "PATCH", body: { status: deck.status === "active" ? "archived" : "active" }, token });
    loadDeck();
  };

  const remove = async () => {
    if (!deck || !window.confirm(`Permanently delete "${deck.name}"? All cards and assignments will be removed.`)) return;
    const token = await getToken();
    await fnJson<{ ok: boolean }>(`admin-vocab/decks/${deck.id}`, { method: "DELETE", token });
    navigate("/admin/vocabulary");
  };

  if (!deck || !cards) return <Spinner />;

  const allOn = (students ?? []).length > 0 && selected.size === (students ?? []).length;

  return (
    <div>
      <div className="section-label">Vocabulary deck</div>
      <div className="page-head-row">
        <div>
          <h1 className="page-title">
            <span className="deck-color" style={{ background: deck.color, display: "inline-block", width: 14, height: 14, borderRadius: 4, verticalAlign: 2 }} />{" "}
            {deck.name}
          </h1>
          <p className="page-sub">
            {deck.description ?? "Word deck"} · {deck.card_count ?? 0} cards · {deck.assigned_count} students
            {deck.status === "archived" && " · ARCHIVED (students can't access)"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" onClick={() => navigate("/admin/vocabulary")}>Back</Button>
          <Button variant="ghost" onClick={() => void archive()}>{deck.status === "active" ? "Archive" : "Restore"}</Button>
          <Button variant="danger" onClick={() => void remove()}>Delete Deck</Button>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {notice && <div className="ok-text" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="toolbar">
        <button className={`btn ${tab === "cards" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("cards")}>Cards ({cards.length})</button>
        <button className={`btn ${tab === "assignments" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("assignments")}>Assignments ({deck.assigned_count})</button>
      </div>

      {tab === "cards" ? (
        <>
          <div className="filter-row">
            <input className="f-input" style={{ maxWidth: 320 }} placeholder="Search cards…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ flex: 1 }} />
            <Button variant="outline" disabled={deck.status === "archived"} onClick={() => { setImporting(true); setImportResult(null); setImportNote(null); }}>Import file</Button>
            <Button disabled={deck.status === "archived"} onClick={() => { setForm({ word: "", definition: "", example_sentence: "", part_of_speech: "", tags: "" }); setEditing("new"); }}>Add Card</Button>
          </div>

          {visibleCards.length === 0 && (
            <EmptyState title="No cards" body="Add cards one at a time or import a PDF/CSV file with word, definition columns." />
          )}

          <div className="card-table">
            {visibleCards.map((c) => (
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
                <div style={{ display: "flex", gap: 6 }}>
                  <Button variant="ghost" size="sm" onClick={() => { setForm({ word: c.word, definition: c.definition, example_sentence: c.example_sentence ?? "", part_of_speech: c.part_of_speech ?? "", tags: c.tags.join(";") }); setEditing(c); }}>Edit</Button>
                  <Button variant="danger" size="sm" disabled={deck.status === "archived"} onClick={() => void removeCard(c)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        !students ? <Spinner /> : (
          <>
            <div className="filter-row">
              <Button variant="outline" onClick={() => setSelected(allOn ? new Set() : new Set((students ?? []).map((s) => s.id)))}>
                {allOn ? "Clear all" : "Select all"}
              </Button>
              <span className="muted">{selected.size} of {students.length} students selected</span>
              <div style={{ flex: 1 }} />
              <Button onClick={() => void saveAssignments()} disabled={saving || deck.status === "archived"}>
                {saving ? "Saving…" : "Save assignments"}
              </Button>
            </div>
            <div className="card card-pad">
              <div className="check-list">
                {students.map((s) => (
                  <label key={s.id} className={`check-row${s.assigned ? "" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={(e) => changeSelected(s.id, e.target.checked)}
                    />
                    <span>
                      <strong>{s.full_name}</strong>
                      <span className="muted"> · {s.email ?? "no email"}</span>
                    </span>
                    {s.assigned && !selected.has(s.id) && <Pill tone="green">assigned</Pill>}
                  </label>
                ))}
                {students.length === 0 && <EmptyState title="No active students" body="Create students on the Students page first." />}
              </div>
            </div>
          </>
        )
      )}

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
            Upload a file or paste rows below. PDF: two-column text tables (word, then definition). CSV/TXT: one card per line, <code>word, definition</code> (comma- or tab-separated). A header row is detected and skipped; duplicate words are ignored. Review the extracted rows before importing.
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
          <textarea className="f-input" rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={"word,definition\nmeticulous,showing great attention to detail\npragmatic,dealing with things sensibly"} />
          {importResult && <p className="ok-text">{importResult}</p>}
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
