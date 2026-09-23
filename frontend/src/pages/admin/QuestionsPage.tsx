import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, Modal, Spinner } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";
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

interface QListRow {
  id: string;
  prompt: string;
  section: string;
  question_type: string;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  choices: { id: string; label: string; text: string; is_correct: boolean }[];
  correct_answer: string | null;
  explanation?: string | null;
  passage?: { id: string; title: string | null; content: string | null } | null;
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
  source_question_id?: string | null;
}

interface AdminQuestionsResponse {
  questions: QListRow[];
  question_total: number;
  question_limit: number;
  question_offset: number;
}

const PAGE_SIZE = 20;

export default function QuestionsPage() {
  const [rows, setRows] = useState<QListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("");
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [editing, setEditing] = useState<QListRow | null>(null);
  const [preview, setPreview] = useState<QListRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    setPage(0);
  }, [search, section, domain, skill, difficulty]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function load() {
    const offset = page * PAGE_SIZE;
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (section) params.set("section", section);
    if (domain) params.set("domain", domain);
    if (skill) params.set("skill", skill);
    if (difficulty) params.set("difficulty", String(difficultyValue(difficulty as DifficultyLabel)));
    if (search) params.set("search", search);
    const token = await getToken();
    const d = await fnJson<AdminQuestionsResponse>(`admin-questions?${params.toString()}`, { token });
    setRows(d.questions);
    setTotal(d.question_total);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [page, search, section, domain, skill, difficulty]);

  async function remove(q: QListRow) {
    if (!confirm(`Delete question: ${q.prompt.slice(0, 60)}…?`)) return;
    const token = await getToken();
    await fnJson(`admin-questions/${q.id}`, { method: "DELETE", token });
    void load();
  }

  const sectionKey = (section || null) as SectionKey | null;

  const domainOptions = useMemo(
    () => (sectionKey ? domainsForSection(sectionKey) : []),
    [sectionKey],
  );

  const skillOptions = useMemo(
    () => (sectionKey && domain ? skillsForDomain(sectionKey, domain as Domain) : []),
    [sectionKey, domain],
  );

  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE + (rows?.length ?? 0), total);

  return (
    <div>
      <div className="section-label">Practice Question Bank</div>
      <h1 className="page-title"><span className="hl-muted">Practice Question</span> <span className="hl-bright">Bank</span></h1>
      <p className="page-sub">Reusable practice questions only. PDF full-length test questions stay with their generated tests.</p>

      <div className="toolbar">
        <input className="input" placeholder="Search prompts…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
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
        <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
          ))}
        </select>
        <Button onClick={() => setEditing({} as QListRow)}>+ New Question</Button>
      </div>

      {error && <div className="login-error">{error}</div>}
      {!rows && <Spinner />}

      {rows && (
        <>
          <div className="draft-filter" style={{ justifyContent: "flex-start", marginBottom: 10 }}>
            <span className="muted">Showing {rangeStart}–{rangeEnd} of {total} questions</span>
          </div>
          <div className="card card-pad">
            <table className="table">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Section</th>
                  <th>Type</th>
                  <th>Domain</th>
                  <th>Skill</th>
                  <th>Difficulty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td style={{ maxWidth: 380 }}>{q.prompt.length > 90 ? `${q.prompt.slice(0, 90)}…` : q.prompt}</td>
                    <td>{q.section === "math" ? "Math" : "R & W"}</td>
                    <td>{q.question_type === "multiple_choice" ? "MC" : "Student-produced"}</td>
                    <td>{q.domain ?? "—"}</td>
                    <td>{q.skill ?? "—"}</td>
                    <td>{q.difficulty ? difficultyLabel(q.difficulty).charAt(0).toUpperCase() + difficultyLabel(q.difficulty).slice(1) : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="outline" size="sm" onClick={() => setPreview(q)}>Preview</Button>
                        <Button variant="outline" size="sm" onClick={() => setEditing(q)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => void remove(q)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 30 }}>No questions found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="draft-filter" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
            <span className="muted">Page {page + 1} of {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
          </div>
        </>
      )}

      {editing && (
        <QuestionModal
          question={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {preview && (
        <QuestionPreview
          q={preview}
          onClose={() => setPreview(null)}
          onEdit={() => {
            const q = preview;
            setPreview(null);
            setEditing(q);
          }}
        />
      )}
    </div>
  );
}

function QuestionPreview({ q, onClose, onEdit }: { q: QListRow; onClose: () => void; onEdit: () => void }) {
  const correctLabel =
    q.choices.find((c) => c.is_correct)?.label ?? (q.correct_answer ? q.correct_answer.toUpperCase() : null);

  return (
    <Modal
      title="Question Preview"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={onEdit}>Edit</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span className="chip">{q.section === "math" ? "Math" : "R & W"}</span>
          <span className="chip">{q.question_type === "multiple_choice" ? "Multiple choice" : "Student-produced"}</span>
          {q.difficulty ? <span className="chip">{difficultyLabel(q.difficulty).charAt(0).toUpperCase() + difficultyLabel(q.difficulty).slice(1)}</span> : null}
          {q.domain ? <span className="chip">{q.domain}</span> : null}
          {q.skill ? <span className="chip">{q.skill}</span> : null}
          {q.source_question_id ? <span className="chip chip-muted">Source {q.source_question_id}</span> : null}
        </div>

        {q.stimulus_image_url && (
          <img src={q.stimulus_image_url} alt="Stimulus" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", border: "1px solid var(--border, #333)", borderRadius: 8, alignSelf: "center" }} />
        )}

        <PassageBlock passage={q.passage} />

        <div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}><MathText text={q.prompt} /></p>
          {q.question_type === "multiple_choice" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {q.choices.map((c) => {
                const isCorrect = c.label.toUpperCase() === correctLabel?.toUpperCase() || c.is_correct;
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: isCorrect
                        ? "1px solid var(--accent, #4ade80)"
                        : "1px solid rgba(255,255,255,0.12)",
                      background: isCorrect ? "rgba(74,222,128,0.08)" : "transparent",
                    }}
                  >
                    <span style={{ fontWeight: 600, minWidth: 18 }}>{c.label}</span>
                    <span style={{ lineHeight: 1.5 }}><MathText text={c.text} /></span>
                    {isCorrect && <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--accent, #4ade80)" }}>✓</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ lineHeight: 1.5 }}>
              <span className="muted">Correct answer: </span>
              <span style={{ fontWeight: 600 }}>{q.correct_answer ?? "—"}</span>
            </p>
          )}

          {q.explanation && (
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>Explanation</p>
              <p style={{ lineHeight: 1.5 }}>{q.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function QuestionModal({ question, onClose, onSaved }: { question: QListRow | null; onClose: () => void; onSaved: () => void }) {
  const [section, setSection] = useState<SectionKey>((question?.section as SectionKey) ?? "reading_writing");
  const [qtype, setQtype] = useState(question?.question_type ?? "multiple_choice");
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [domain, setDomain] = useState(question?.domain ?? "");
  const [skill, setSkill] = useState(question?.skill ?? "");
  const [diffLabel, setDiffLabel] = useState<DifficultyLabel>(difficultyLabel(question?.difficulty ?? null));
  const [correctAnswer, setCorrectAnswer] = useState(question?.correct_answer ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [choices, setChoices] = useState(
    question?.choices?.map((c) => ({ label: c.label, text: c.text, is_correct: c.is_correct })) ??
      ["A", "B", "C", "D"].map((l) => ({ label: l, text: "", is_correct: false })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domainOptions = domainsForSection(section);
  const skillOptions = domain ? skillsForDomain(section, domain as Domain) : [];

  async function submit(e?: FormEvent) {
    if (e) e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const body = {
        section,
        question_type: qtype,
        prompt,
        domain: domain || null,
        skill: skill || null,
        difficulty: difficultyValue(diffLabel),
        correct_answer: correctAnswer || null,
        explanation: explanation || null,
        choices: qtype === "multiple_choice" ? choices.map((c, i) => ({ label: c.label, text: c.text, is_correct: c.label.toUpperCase() === (correctAnswer || "").toUpperCase(), position: i + 1 })) : [],
      };
      if (question) {
        await fnJson(`admin-questions/${question.id}`, { method: "PATCH", token, body });
      } else {
        await fnJson("admin-questions", { method: "POST", token, body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={question ? "Edit Question" : "New Question"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            <select className="select" value={qtype} onChange={(e) => setQtype(e.target.value)}>
              <option value="multiple_choice">Multiple choice</option>
              <option value="student_produced">Student-produced</option>
            </select>
          </div>
          <div>
            <label className="field-label">Difficulty</label>
            <select className="select" value={diffLabel} onChange={(e) => setDiffLabel(e.target.value as DifficultyLabel)}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        {question?.passage?.content && <PassageBlock passage={question.passage} compact />}
        <div>
          <label className="field-label">Prompt</label>
          <textarea className="textarea" rows={3} required value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Domain</label>
            <select className="select" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }}>
              <option value="">—</option>
              {domainOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Skill</label>
            <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
              <option value="">—</option>
              {skillOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {qtype === "multiple_choice" ? (
          <div>
            <label className="field-label">Choices — set the correct answer by choosing the right label below</label>
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
                  checked={c.label.toUpperCase() === correctAnswer.toUpperCase()}
                  onChange={() => setCorrectAnswer(c.label)}
                  title="Correct answer"
                />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <label className="field-label">Correct answer</label>
            <input className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder="e.g. 24 or 3/5" />
          </div>
        )}

        <div>
          <label className="field-label">Explanation</label>
          <textarea className="textarea" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Optional explanation" />
        </div>

        {error && <div className="login-error">{error}</div>}
      </form>
    </Modal>
  );
}
