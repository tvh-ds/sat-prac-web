import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { PracticeLinkQuestion, PracticeSetDetail, Question } from "../../lib/types";
import { Button, Modal, Pill, Spinner } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";
import { AssignModal } from "./PracticePage";
import {
  type SectionKey,
  type Domain,
  type DifficultyLabel,
  SECTIONS,
  DIFFICULTIES,
  domainsForSection,
  skillsForDomain,
  difficultyLabel,
  difficultyValue,
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

function EditQuestionModal({
  setId,
  link,
  onClose,
  onSaved,
}: {
  setId: string;
  link: PracticeLinkQuestion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const q = link.question;
  const [section, setSection] = useState<SectionKey>(q.section);
  const [qtype, setQtype] = useState(q.question_type);
  const [prompt, setPrompt] = useState(q.prompt);
  const [domain, setDomain] = useState(q.domain ?? "");
  const [skill, setSkill] = useState(q.skill ?? "");
  const [diffLabel, setDiffLabel] = useState<DifficultyLabel>(difficultyLabel(q.difficulty));
  const [correctAnswer, setCorrectAnswer] = useState(q.correct_answer ?? "");
  const [explanation, setExplanation] = useState(q.explanation ?? "");
  const [choices, setChoices] = useState(
    q.choices.length > 0
      ? q.choices.map((c) => ({ label: c.label, text: c.text }))
      : ["A", "B", "C", "D"].map((l) => ({ label: l, text: "" })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domainOptions = domainsForSection(section);
  const skillOptions = domain ? skillsForDomain(section, domain as Domain) : [];

  async function save() {
    if (qtype === "multiple_choice" && choices.length < 2) {
      setError("Multiple choice questions need at least 2 choices");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${setId}/questions/${link.id}`, {
        method: "PATCH",
        token,
        body: {
          section,
          question_type: qtype,
          prompt,
          domain: domain || null,
          skill: skill || null,
          difficulty: difficultyValue(diffLabel),
          correct_answer: correctAnswer || null,
          explanation: explanation || null,
          choices: qtype === "multiple_choice"
            ? choices.map((c, i) => ({
              label: c.label,
              text: c.text,
              is_correct: c.label.toUpperCase() === (correctAnswer || "").toUpperCase(),
              position: i + 1,
            }))
            : [],
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save question");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit Question — ${q.section === "math" ? "Math" : "Reading & Writing"}`} onClose={onClose}>
      {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        Edits apply to this set only. If this question is shared with another test or an assigned copy,
        it is duplicated first so nothing else changes.
      </p>
      <PassageBlock passage={q.passage} compact />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">Section</label>
          <select className="select" value={section} onChange={(e) => { setSection(e.target.value as SectionKey); setDomain(""); setSkill(""); }}>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>{sectionLabel(s)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Type</label>
          <select className="select" value={qtype} onChange={(e) => setQtype(e.target.value as Question["question_type"])}>
            <option value="multiple_choice">Multiple choice</option>
            <option value="student_produced">Student-produced</option>
          </select>
        </div>
        <div>
          <label className="field-label">Difficulty</label>
          <select className="select" value={diffLabel} onChange={(e) => setDiffLabel(e.target.value as DifficultyLabel)}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="field-label">Prompt</label>
        <textarea className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="field-label">Domain</label>
          <select className="select" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }}>
            <option value="">—</option>
            {domainOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Skill</label>
          <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
            <option value="">—</option>
            {skillOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {qtype === "multiple_choice" ? (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Choices — pick the radio of the correct answer</label>
          {choices.map((c, i) => (
            <div className="choice-edit" key={i}>
              <input
                className="input"
                style={{ width: 70 }}
                value={c.label}
                onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <input
                className="input"
                value={c.text}
                onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              />
              <input
                type="radio"
                name="correct-choice"
                checked={c.label.toUpperCase() === correctAnswer.toUpperCase() && correctAnswer !== ""}
                onChange={() => setCorrectAnswer(c.label)}
                title="Correct answer"
              />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Correct answer</label>
          <input className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder="e.g. 24 or 3/5" />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <label className="field-label">Explanation</label>
        <textarea className="textarea" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Shown to students only after you release explanations for their assignment" />
      </div>
      <div className="modal-foot" style={{ marginTop: 16 }}>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy || !prompt.trim()}>{busy ? "Saving…" : "Save question"}</Button>
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
                  {x.passage?.content && <Pill tone="blue">Passage</Pill>}
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
  const [showAssign, setShowAssign] = useState(false);
  const [editingLink, setEditingLink] = useState<PracticeLinkQuestion | null>(null);

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

  async function move(links: PracticeLinkQuestion[], i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= links.length) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${setId}/questions/${links[i].id}`, {
        method: "PATCH",
        token,
        body: { position: links[j].position },
      });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reorder question");
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
  const sorted = [...data.questions].sort((a, b) => a.position - b.position);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to="/admin/practice" className="muted" style={{ textDecoration: "none" }}>← Practice Sets</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Review Practice Set</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: "4px 0", fontWeight: 700 }}>{data.set.title}</h2>
        <span className="muted" style={{ fontSize: 13 }}>
          {data.questions.length} question(s) · {data.set.time_limit_minutes ?? "—"} min
        </span>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <Button onClick={() => setShowAssign(true)} disabled={busy}>Assign</Button>
        <Button variant="outline" onClick={() => setShowEdit(true)} disabled={busy}>Edit Details</Button>
        <Button variant="outline" onClick={() => setShowAdd(true)} disabled={busy}>+ Add Questions</Button>
      </div>

      {error && <div className="login-error">{error}</div>}

      {sorted.length === 0 ? (
        <div className="card card-pad muted" style={{ marginTop: 16, fontSize: 14 }}>
          No questions yet. Add some from the Practice Question Bank.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {sorted.map((l, i) => (
            <div key={l.id} className="card card-pad">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>Q{i + 1}</span>
                <Pill tone="blue">{l.question.section === "math" ? "Math" : "R&W"}</Pill>
                <Pill tone={l.question.question_type === "student_produced" ? "amber" : "gray"}>
                  {l.question.question_type === "student_produced" ? "Grid-in" : "MC"}
                </Pill>
                {l.question.difficulty != null && (
                  <Pill tone="gray">{difficultyLabel(l.question.difficulty).charAt(0).toUpperCase() + difficultyLabel(l.question.difficulty).slice(1)}</Pill>
                )}
                {(l.question.domain || l.question.skill) && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {[l.question.domain, l.question.skill].filter(Boolean).join(" · ")}
                  </span>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <Button size="sm" variant="ghost" disabled={busy || i === 0} onClick={() => void move(sorted, i, -1)} title="Move up">↑</Button>
                  <Button size="sm" variant="ghost" disabled={busy || i === sorted.length - 1} onClick={() => void move(sorted, i, 1)} title="Move down">↓</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingLink(l)}>Edit</Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(l.id)}>Remove</Button>
                </div>
              </div>
              {l.question.passage?.content && (
                <div style={{ marginBottom: 10 }}>
                  <PassageBlock passage={l.question.passage} compact />
                </div>
              )}
              <p style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.6, margin: "0 0 10px" }}>
                <MathText text={l.question.prompt} />
              </p>
              {l.question.question_type === "multiple_choice" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...l.question.choices].sort((a, b) => a.position - b.position).map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "8px 10px",
                        borderRadius: 8,
                        fontSize: 13.5,
                        border: c.is_correct ? "1px solid var(--accent, #4ade80)" : "1px solid rgba(255,255,255,0.12)",
                        background: c.is_correct ? "rgba(74,222,128,0.08)" : "transparent",
                      }}
                    >
                      <span style={{ fontWeight: 600, minWidth: 18 }}>{c.label}</span>
                      <span style={{ lineHeight: 1.5 }}><MathText text={c.text} /></span>
                      {c.is_correct && <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--accent, #4ade80)" }}>✓</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13.5, margin: 0 }}>
                  <span className="muted">Correct answer: </span>
                  <span style={{ fontWeight: 600 }}>{l.question.correct_answer ?? "—"}</span>
                </p>
              )}
              {l.question.explanation && (
                <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.6 }}>
                  <p className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>Explanation</p>
                  <MathText text={l.question.explanation} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showEdit && data && <EditModal set={data.set} onClose={() => setShowEdit(false)} onSaved={() => void load()} />}
      {showAdd && data && <AddQuestionsModal set={data.set} linkedIds={linkedIds} onClose={() => setShowAdd(false)} onSaved={() => void load()} />}
      {showAssign && data && (
        <AssignModal
          set={data.set}
          onClose={() => setShowAssign(false)}
          onDone={() => {
            setShowAssign(false);
            void load();
          }}
        />
      )}
      {editingLink && (
        <EditQuestionModal
          setId={data.set.id}
          link={editingLink}
          onClose={() => setEditingLink(null)}
          onSaved={() => {
            setEditingLink(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
