import { useEffect, useMemo, useState } from "react";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, Spinner } from "../../components/ui";
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

import type { QListRow } from "./QuestionTools";
import { deferComponent } from "../../components/deferComponent";
const QuestionPreview = deferComponent(async () => ({ default: (await import("./QuestionTools")).QuestionPreview }));
const QuestionModal = deferComponent(async () => ({ default: (await import("./QuestionTools")).QuestionModal }));

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
