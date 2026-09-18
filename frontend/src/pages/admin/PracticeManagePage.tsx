import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { PracticeSetDetail, Question } from "../../lib/types";
import { Button, Modal, Pill, Spinner } from "../../components/ui";
import {
  type SectionKey,
  type Domain,
  type DifficultyLabel,
  SECTIONS,
  DIFFICULTIES,
  domainsForSection,
  skillsForDomain,
  difficultyLabel,
  sectionLabel,
} from "../../lib/satTaxonomy";

function EditModal({
  set,
  onClose,
  onSaved,
}: {
  set: PracticeSetDetail["set"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(set.title);
  const [description, setDescription] = useState(set.description ?? "");
  const [minutes, setMinutes] = useState(set.time_limit_minutes ?? 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${set.id}`, {
        method: "PATCH",
        token,
        body: {
          title: title.trim(),
          description: description.trim() || null,
          time_limit_minutes: minutes,
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Practice Set" onClose={onClose}>
      {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}
      <label className="field-label">Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="field-label" style={{ marginTop: 12 }}>Description</label>
      <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      <label className="field-label" style={{ marginTop: 12 }}>Time limit (minutes)</label>
      <input
        className="input"
        type="number"
        min={1}
        max={600}
        value={minutes}
        onChange={(e) => setMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
      />
      <div className="modal-foot" style={{ marginTop: 18 }}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function AddQuestionsModal({
  set,
  linkedIds,
  onClose,
  onSaved,
}: {
  set: PracticeSetDetail["set"];
  linkedIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyLabel | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ questions: Question[] }>("admin-questions?limit=500", { token }).catch(() => null);
      setQuestions(d?.questions ?? []);
    })();
  }, []);

  const sectionKey = (section || null) as SectionKey | null;

  const domainOptions = useMemo(
    () => (sectionKey ? domainsForSection(sectionKey) : []),
    [sectionKey],
  );

  const skillOptions = useMemo(
    () => (sectionKey && domain ? skillsForDomain(sectionKey, domain as Domain) : []),
    [sectionKey, domain],
  );

  const filtered = useMemo(() => {
    if (!questions) return [];
    const needle = q.trim().toLowerCase();
    return questions.filter((x) => {
      if (linkedIds.has(x.id)) return false;
      if (section && x.section !== section) return false;
      if (domain && x.domain !== domain) return false;
      if (skill && x.skill !== skill) return false;
      if (difficulty && difficultyLabel(x.difficulty) !== difficulty) return false;
      if (needle && !`${x.prompt} ${x.domain ?? ""} ${x.skill ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [questions, q, section, domain, skill, difficulty, linkedIds]);

  const visible = filtered.slice(0, 60);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((x) => next.add(x.id));
      return next;
    });
  }

  async function add() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${set.id}/questions`, {
        method: "POST",
        token,
        body: { question_ids: Array.from(selected) },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add questions");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Add Questions — ${set.title}`} onClose={onClose}>
      {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input className="input" placeholder="Search prompt, domain, skill…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={section} onChange={(e) => { setSection(e.target.value); setDomain(""); setSkill(""); }}>
          <option value="">All sections</option>
          {SECTIONS.map((s) => (
            <option key={s} value={s}>{sectionLabel(s)}</option>
          ))}
        </select>
        <select className="select" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }} disabled={!sectionKey}>
          <option value="">All domains</option>
          {domainOptions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
          <option value="">All skills</option>
          {skillOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value as DifficultyLabel | "")}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
          ))}
        </select>
      </div>
      {!questions ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No matching questions. Adjust the search.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <Button variant="outline" size="sm" onClick={selectAllVisible}>Select all shown ({visible.length})</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear ({selected.size})</Button>
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {visible.map((x) => (
            <label key={x.id} className="question-row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{x.prompt.length > 90 ? `${x.prompt.slice(0, 90)}…` : x.prompt}</span>
                  <Pill tone={x.question_type === "student_produced" ? "amber" : "gray"}>{x.question_type === "student_produced" ? "Grid-in" : "MC"}</Pill>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {[x.domain, x.skill].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
            </label>
          ))}
          </div>
        </>
      )}
      <div className="modal-foot" style={{ marginTop: 16 }}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void add()} disabled={busy || selected.size === 0}>
          {busy ? "Adding…" : `Add selected (${selected.size})`}
        </Button>
      </div>
    </Modal>
  );
}

export default function PracticeManagePage() {
  const { setId } = useParams<{ setId: string }>();
  const [data, setData] = useState<PracticeSetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    try {
      const token = await getToken();
      const d = await fnJson<PracticeSetDetail>(`admin-practice/${setId}`, { token });
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load practice set");
    }
  }

  useEffect(() => {
    void load();
  }, [setId]);

  async function archive() {
    if (!data || !window.confirm(`Archive "${data.set.title}"? Students will no longer see it.`)) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${data.set.id}`, { method: "PATCH", token, body: { status: "archived" } });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!data) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${data.set.id}`, { method: "PATCH", token, body: { status: "published" } });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish");
    } finally {
      setBusy(false);
    }
  }

  async function remove(linkId: string) {
    if (!window.confirm("Remove this question from the set?")) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${setId}/questions/${linkId}`, { method: "DELETE", token });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove question");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Spinner />;

  if (!data) {
    return (
      <div>
        <h1 className="page-title">Error</h1>
        <div className="login-error">{error}</div>
      </div>
    );
  }

  const linkedIds = new Set(data.questions.map((l) => l.question.id));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to="/admin/practice" className="muted" style={{ textDecoration: "none" }}>← Practice Sets</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Practice Set</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: "4px 0", fontWeight: 700 }}>{data.set.title}</h2>
        <Pill tone={data.set.status === "published" ? "green" : data.set.status === "archived" ? "gray" : "amber"}>{data.set.status}</Pill>
        <span className="muted" style={{ fontSize: 13 }}>
          {data.questions.length} question(s) · {data.set.time_limit_minutes ?? "—"} min
        </span>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <Button variant="outline" onClick={() => setShowEdit(true)} disabled={busy}>Edit Details</Button>
        <Button variant="outline" onClick={() => setShowAdd(true)} disabled={busy}>+ Add Questions</Button>
        {data.set.status === "published" && (
          <Button variant="ghost" onClick={() => void archive()} disabled={busy}>Archive</Button>
        )}
        {data.set.status === "archived" && (
          <Button onClick={() => void publish()} disabled={busy}>Publish</Button>
        )}
      </div>

      {error && <div className="login-error">{error}</div>}

      {data.questions.length === 0 ? (
        <div className="card card-pad muted" style={{ marginTop: 16, fontSize: 14 }}>
          No questions yet. Add some from the question bank or from a PDF import.
        </div>
      ) : (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.questions.map((l, i) => (
              <div key={l.id} className="question-row">
                <span className="muted" style={{ fontSize: 12, width: 26 }}>Q{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{l.question.prompt.length > 90 ? `${l.question.prompt.slice(0, 90)}…` : l.question.prompt}</span>
                    <Pill tone="blue">{l.question.section === "math" ? "Math" : "R&W"}</Pill>
                    <Pill tone={l.question.question_type === "student_produced" ? "amber" : "gray"}>
                      {l.question.question_type === "student_produced" ? "Grid-in" : "MC"}
                    </Pill>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {[l.question.domain, l.question.skill].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <Button size="sm" variant="danger" onClick={() => void remove(l.id)} disabled={busy}>Remove</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showEdit && data && <EditModal set={data.set} onClose={() => setShowEdit(false)} onSaved={() => void load()} />}
      {showAdd && data && <AddQuestionsModal set={data.set} linkedIds={linkedIds} onClose={() => setShowAdd(false)} onSaved={() => void load()} />}
    </div>
  );
}