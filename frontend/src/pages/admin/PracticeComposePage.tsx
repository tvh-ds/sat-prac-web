import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { Question } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner } from "../../components/ui";
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

interface PickItem {
  source: "bank";
  id: string;
  prompt: string;
  section: string;
  qtype: string;
  hasKey: boolean;
  passage?: { title: string | null; content: string } | null;
  page?: number | null;
  qnum?: number | null;
}

interface BankResponse {
  questions: Question[];
  question_total: number;
}

const PAGE_SIZE = 10;

export default function PracticeComposePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"details" | "pick" | "review">("details");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(10);

  const [picks, setPicks] = useState<PickItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Question[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("");
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyLabel | "">("");
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    setPage(0);
  }, [search, section, domain, skill, difficulty]);

  useEffect(() => {
    if (step !== "pick") return;
    const id = ++requestId.current;
    setLoading(true);
    setListError(null);
    void (async () => {
      try {
        const token = await getToken();
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        if (section) params.set("section", section);
        if (domain) params.set("domain", domain);
        if (skill) params.set("skill", skill);
        if (difficulty) params.set("difficulty", String(difficultyValue(difficulty)));
        if (search) params.set("search", search);
        const d = await fnJson<BankResponse>(`admin-questions?${params.toString()}`, { token });
        if (requestId.current !== id) return;
        setRows(d.questions);
        setTotal(d.question_total);
      } catch (e) {
        if (requestId.current !== id) return;
        setRows([]);
        setTotal(0);
        setListError(e instanceof Error ? e.message : "Failed to load questions");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    })();
  }, [step, page, search, section, domain, skill, difficulty]);

  const pickedIds = useMemo(() => new Set(picks.map((p) => `${p.source}:${p.id}`)), [picks]);
  const togglePick = (item: PickItem) => {
    const key = `${item.source}:${item.id}`;
    setPicks((prev) => {
      const current = new Set(prev.map((p) => `${p.source}:${p.id}`));
      if (current.has(key)) return prev.filter((p) => `${p.source}:${p.id}` !== key);
      return [...prev, item];
    });
  };

  const movePick = (i: number, dir: -1 | 1) => {
    setPicks((prev) => {
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const keyOf = (p: PickItem) => `${p.source}:${p.id}`;

  const toggleMany = (items: PickItem[]) => {
    setPicks((prev) => {
      const keys = new Set(items.map(keyOf));
      const current = new Set(prev.map(keyOf));
      const allPicked = items.length > 0 && items.every((it) => current.has(keyOf(it)));
      if (allPicked) return prev.filter((p) => !keys.has(keyOf(p)));
      return [...prev, ...items.filter((it) => !current.has(keyOf(it)))];
    });
  };

  const clearSource = () => {
    setPicks([]);
  };

  const hasAnswerKey = (x: Question): boolean =>
    x.question_type === "multiple_choice"
      ? (x.choices ?? []).some((c) => c.is_correct)
      : !!String(x.correct_answer ?? "").trim();

  const bankToItem = (x: Question): PickItem => ({
    source: "bank",
    id: x.id,
    prompt: x.prompt,
    section: x.section,
    qtype: x.question_type,
    hasKey: hasAnswerKey(x),
    passage: x.passage ? { title: x.passage.title ?? null, content: x.passage.content } : null,
  });

  const sectionKey = (section || null) as SectionKey | null;
  const bankDomains = useMemo(() => (sectionKey ? domainsForSection(sectionKey) : []), [sectionKey]);
  const bankSkills = useMemo(
    () => (sectionKey && domain ? skillsForDomain(sectionKey, domain as Domain) : []),
    [sectionKey, domain],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE + (rows?.length ?? 0), total);

  async function create() {
    if (picks.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const body = { title: title.trim(), description: description.trim() || null, time_limit_minutes: minutes };
      const bankIds = picks.filter((p) => p.source === "bank").map((p) => p.id);
      const res = await fnJson<{ set: { id: string } }>("admin-practice", {
        method: "POST",
        token,
        body: { ...body, question_ids: bankIds },
      });
      const setId = res.set.id;
      navigate(`/admin/practice/${setId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create practice set");
      setCreating(false);
    }
  }

  const typePill = (t: string) => (t === "student_produced" ? "Grid-in" : "MC");
  const formatDifficulty = (d: number | null) => {
    if (d == null) return "—";
    const label = difficultyLabel(d);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to="/admin/practice" className="muted" style={{ textDecoration: "none" }}>← Practice Sets</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Generate Practice Set</h1>
      </div>
      <p className="page-sub">Pick questions from the Practice Question Bank, then set a single timer for the whole set.</p>

      {error && <div className="login-error">{error}</div>}

      {step === "details" && (
        <div className="card card-pad" style={{ maxWidth: 560 }}>
          <label className="field-label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. R&W Module 1 Warm-up" />
          <label className="field-label" style={{ marginTop: 14 }}>Description</label>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" rows={2} />
          <label className="field-label" style={{ marginTop: 14 }}>Time limit (minutes)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
          />
          <div style={{ marginTop: 18, display: "flex", gap: 12 }}>
            <Button size="lg" disabled={!title.trim()} onClick={() => setStep("pick")}>Choose questions</Button>
          </div>
        </div>
      )}

      {step === "pick" && (
        <div className="card card-pad">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <Pill tone="blue">Practice Question Bank only</Pill>
            <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>{picks.length} selected</span>
          </div>

          <>
              <div className="toolbar" style={{ marginBottom: 12 }}>
                <input className="input" placeholder="Search prompts…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                <select className="input" value={section} onChange={(e) => { setSection(e.target.value); setDomain(""); setSkill(""); }}>
                  <option value="">All sections</option>
                  {SECTIONS.map((s) => <option key={s} value={s}>{sectionLabel(s)}</option>)}
                </select>
                <select className="input" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }} disabled={!sectionKey}>
                  <option value="">All domains</option>
                  {bankDomains.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="input" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!domain}>
                  <option value="">All skills</option>
                  {bankSkills.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as DifficultyLabel | "")}>
                  <option value="">Any difficulty</option>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
                {(rows?.length ?? 0) > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => toggleMany((rows ?? []).map(bankToItem).filter((p) => p.hasKey))}>
                      Select all shown ({(rows ?? []).filter(hasAnswerKey).length})
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => clearSource()}>Clear</Button>
                  </>
                )}
              </div>

              {listError && <div className="login-error">{listError}</div>}
              <div className="draft-filter" style={{ justifyContent: "flex-start", marginBottom: 10 }}>
                <span className="muted">Showing {rangeStart}–{rangeEnd} of {total} questions</span>
              </div>
              {loading && !rows ? (
                <Spinner />
              ) : (rows?.length ?? 0) === 0 ? (
                <EmptyState title="No matching questions" body="Adjust the filters or create questions in the Practice Question Bank first." />
              ) : (
                <>
                  <div style={{ maxHeight: 430, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {(rows ?? []).map((x) => {
                      const key = `bank:${x.id}`;
                      const on = pickedIds.has(key);
                      const keyOk = hasAnswerKey(x);
                      return (
                        <label key={x.id} className="question-row" style={{ cursor: keyOk ? "pointer" : "not-allowed", opacity: keyOk ? 1 : 0.55 }}>
                          <input type="checkbox" checked={on} disabled={!keyOk} title={keyOk ? undefined : "Missing answer key"} onChange={() => togglePick(bankToItem(x))} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span>{x.prompt.length > 90 ? `${x.prompt.slice(0, 90)}…` : x.prompt}</span>
                              <Pill tone={x.question_type === "student_produced" ? "amber" : "gray"}>{typePill(x.question_type)}</Pill>
                              {x.passage?.content && <Pill tone="blue">Passage</Pill>}
                              {!keyOk && <Pill tone="red">no key</Pill>}
                            </div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {[x.domain, x.skill].filter(Boolean).join(" · ") || "—"} · {formatDifficulty(x.difficulty)}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="draft-filter" style={{ justifyContent: "space-between", marginTop: 12 }}>
                    <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</Button>
                    <span className="muted">Page {page + 1} of {pageCount}</span>
                    <Button variant="outline" size="sm" disabled={loading || page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
                  </div>
                </>
              )}
          </>

          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <Button variant="outline" onClick={() => setStep("details")}>← Back</Button>
            <Button size="lg" disabled={picks.length === 0} onClick={() => setStep("review")}>Review selection ({picks.length})</Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="card card-pad">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <strong style={{ fontSize: 15 }}>{title}</strong>
            <Pill tone="amber">{minutes}-minute timer</Pill>
            <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>{picks.length} question(s)</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {picks.map((p, i) => (
              <div key={`${p.source}:${p.id}`} className="question-row">
                <span className="muted" style={{ fontSize: 12, width: 26 }}>Q{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{p.prompt.length > 90 ? `${p.prompt.slice(0, 90)}…` : p.prompt}</span>
                    <Pill tone="blue">Practice bank</Pill>
                    <Pill tone={p.qtype === "student_produced" ? "amber" : "gray"}>{typePill(p.qtype)}</Pill>
                    {!p.hasKey && <Pill tone="red">no key</Pill>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {p.section.replace(/_/g, " ")}
                  </div>
                  {p.passage?.content && (
                    <div style={{ marginTop: 8 }}>
                      <PassageBlock passage={p.passage} compact />
                    </div>
                  )}
                </div>
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => movePick(i, -1)}>↑</Button>
                <Button size="sm" variant="ghost" disabled={i === picks.length - 1} onClick={() => movePick(i, 1)}>↓</Button>
                <Button size="sm" variant="danger" onClick={() => togglePick(p)}>Remove</Button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <Button variant="outline" onClick={() => setStep("pick")}>← Back</Button>
            <Button size="lg" disabled={creating} onClick={() => void create()}>
              {creating ? "Creating…" : "Create practice set"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
