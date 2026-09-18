import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { DraftQuestion, PdfImport, Question } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner } from "../../components/ui";
import {
  type SectionKey,
  type Domain,
  type DifficultyLabel,
  DIFFICULTIES,
  domainsForSection,
  skillsForDomain,
  difficultyLabel,
} from "../../lib/satTaxonomy";

interface PickItem {
  source: "bank" | "draft";
  id: string;
  prompt: string;
  section: string;
  qtype: string;
  hasKey: boolean;
  page?: number | null;
  qnum?: number | null;
}

const KEYLESS = new Set(["missing_key", "needs_review"]);

function DraftStatus({ status }: { status: string }) {
  const tone = status === "approved" ? "green" : status === "rejected" ? "red" : status === "has_suggested_key" ? "amber" : "gray";
  return <Pill tone={tone}>{status.replace(/_/g, " ")}</Pill>;
}

export default function PracticeComposePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"details" | "pick" | "review">("details");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [source, setSource] = useState<"bank" | "import">("bank");

  const [picks, setPicks] = useState<PickItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bank, setBank] = useState<Question[] | null>(null);
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("");
  const [skill, setSkill] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyLabel | "">("");

  const [imports, setImports] = useState<PdfImport[] | null>(null);
  const [importId, setImportId] = useState("");
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null);
  const [draftFilter, setDraftFilter] = useState("all");
  const [includeMissing, setIncludeMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ questions: Question[] }>("admin-questions?limit=500", { token }).catch(() => null);
      setBank(d?.questions ?? []);
      const im = await fnJson<{ imports: PdfImport[] }>("admin-pdf-imports", { token }).catch(() => null);
      setImports(im?.imports ?? []);
    })();
  }, []);

  useEffect(() => {
    if (source !== "import" || !importId) {
      setDrafts(null);
      return;
    }
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const d = await fnJson<{ drafts: DraftQuestion[] }>(`admin-pdf-imports/${importId}`, { token }).catch(() => null);
      setDrafts(d?.drafts ?? []);
    })();
  }, [source, importId]);

  const pickedIds = new Set(picks.map((p) => `${p.source}:${p.id}`));
  const togglePick = (item: PickItem) => {
    const key = `${item.source}:${item.id}`;
    setPicks((prev) => (pickedIds.has(key) ? prev.filter((p) => `${p.source}:${p.id}` !== key) : [...prev, item]));
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

  const clearSource = (source: PickItem["source"]) => {
    setPicks((prev) => prev.filter((p) => p.source !== source));
  };

  const bankToItem = (x: Question): PickItem => ({
    source: "bank",
    id: x.id,
    prompt: x.prompt,
    section: x.section,
    qtype: x.question_type,
    hasKey: true,
  });

  const draftToItem = (d: DraftQuestion): PickItem => ({
    source: "draft",
    id: d.id,
    prompt: d.prompt,
    section: d.section,
    qtype: d.question_type,
    hasKey: !!d.suggested_answer,
    page: d.page_number,
    qnum: d.source_question_number,
  });

  const filteredBank = useMemo(() => {
    if (!bank) return [];
    const needle = q.trim().toLowerCase();
    return bank.filter((x) => {
      if (needle && !`${x.prompt} ${x.domain ?? ""} ${x.skill ?? ""}`.toLowerCase().includes(needle)) return false;
      if (domain && x.domain !== domain) return false;
      if (skill && x.skill !== skill) return false;
      if (difficulty && difficultyLabel(x.difficulty) !== difficulty) return false;
      return true;
    });
  }, [bank, q, domain, skill, difficulty]);

  const visibleBank = useMemo(() => filteredBank.slice(0, 80), [filteredBank]);

  const visibleDrafts = useMemo(() => {
    if (!drafts) return [];
    return drafts.filter((d) => {
      if (draftFilter !== "all" && d.status !== draftFilter) return false;
      if (!includeMissing && KEYLESS.has(d.status) && !d.question_id) return false;
      return true;
    });
  }, [drafts, draftFilter, includeMissing]);

  const sectionType = (bank?.[0]?.section ?? "reading_writing") as SectionKey;
  const bankDomains = useMemo(() => domainsForSection(sectionType), [sectionType]);
  const bankSkills = useMemo(() => domain ? skillsForDomain(sectionType, domain as Domain) : [], [sectionType, domain]);

  async function create() {
    if (picks.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const body = { title: title.trim(), description: description.trim() || null, time_limit_minutes: minutes };
      const bankIds = picks.filter((p) => p.source === "bank").map((p) => p.id);
      const draftIds = picks.filter((p) => p.source === "draft").map((p) => p.id);
      let setId: string;

      if (draftIds.length > 0) {
        const res = await fnJson<{ set: { id: string } }>("admin-practice/from-import", {
          method: "POST",
          token,
          body: { ...body, draft_ids: draftIds, include_missing_key: includeMissing },
        });
        setId = res.set.id;
        if (bankIds.length > 0) {
          await fnJson(`admin-practice/${setId}/questions`, { method: "POST", token, body: { question_ids: bankIds } });
        }
      } else {
        const res = await fnJson<{ set: { id: string } }>("admin-practice", {
          method: "POST",
          token,
          body: { ...body, question_ids: bankIds },
        });
        setId = res.set.id;
      }
      navigate(`/admin/practice/${setId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create practice set");
      setCreating(false);
    }
  }

  const typePill = (t: string) => (t === "student_produced" ? "Grid-in" : "MC");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to="/admin/practice" className="muted" style={{ textDecoration: "none" }}>← Practice Sets</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Generate Practice Set</h1>
      </div>
      <p className="page-sub">Pick questions from the bank or from a PDF import, then set a single timer for the whole set.</p>

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
            <Button variant={source === "bank" ? "primary" : "outline"} size="sm" onClick={() => setSource("bank")}>From Question Bank</Button>
            <Button variant={source === "import" ? "primary" : "outline"} size="sm" onClick={() => setSource("import")}>From PDF Import</Button>
            <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>{picks.length} selected</span>
          </div>

          {source === "bank" && (
            <>
              <div className="toolbar" style={{ marginBottom: 12 }}>
                <input className="input" placeholder="Search prompt, domain, skill…" value={q} onChange={(e) => setQ(e.target.value)} />
                <select className="input" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }}>
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
                {filteredBank.length > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => toggleMany(visibleBank.map(bankToItem))}>
                      Select all shown ({visibleBank.length})
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => clearSource("bank")}>Clear</Button>
                  </>
                )}
              </div>

              {!bank ? (
                <Spinner />
              ) : filteredBank.length === 0 ? (
                <EmptyState title="No matching questions" body="Adjust the filters or create questions in the Question Bank first." />
              ) : (
                <div style={{ maxHeight: 430, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {visibleBank.map((x) => {
                    const key = `bank:${x.id}`;
                    const on = pickedIds.has(key);
                    return (
                      <label key={x.id} className="question-row" style={{ cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => togglePick({ source: "bank", id: x.id, prompt: x.prompt, section: x.section, qtype: x.question_type, hasKey: true })} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span>{x.prompt.length > 90 ? `${x.prompt.slice(0, 90)}…` : x.prompt}</span>
                            <Pill tone={x.question_type === "student_produced" ? "amber" : "gray"}>{typePill(x.question_type)}</Pill>
                          </div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                            {[x.domain, x.skill].filter(Boolean).join(" · ") || "—"} · difficulty {x.difficulty ?? "—"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {filteredBank.length > 80 && (
                    <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>Showing first 80 - narrow the search to find more.</p>
                  )}
                </div>
              )}
            </>
          )}

          {source === "import" && (
            <>
              <div className="toolbar" style={{ marginBottom: 12 }}>
                <select className="input" value={importId} onChange={(e) => setImportId(e.target.value)}>
                  <option value="">Select a PDF import…</option>
                  {(imports ?? []).map((im) => (
                    <option key={im.id} value={im.id}>{im.original_filename}</option>
                  ))}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={includeMissing} onChange={(e) => setIncludeMissing(e.target.checked)} />
                  Include drafts without answer keys
                </label>
              </div>

              {importId && (
                <div className="toolbar" style={{ marginBottom: 12 }}>
                  {["all", "has_suggested_key", "approved", "missing_key", "rejected"].map((f) => (
                    <Button key={f} variant={draftFilter === f ? "primary" : "outline"} size="sm" onClick={() => setDraftFilter(f)}>
                      {f === "all" ? "All" : f.replace(/_/g, " ")}
                    </Button>
                  ))}
                  {visibleDrafts.length > 0 && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => toggleMany(visibleDrafts.map(draftToItem))}>
                        Select all shown ({visibleDrafts.length})
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => clearSource("draft")}>Clear</Button>
                    </>
                  )}
                </div>
              )}

              {!importId && <p className="muted" style={{ fontSize: 13 }}>Pick the PDF import whose parsed drafts you want to use. Drafts without an answer key are hidden unless you check the box above.</p>}

              {importId && !drafts && <Spinner />}

              {importId && drafts && visibleDrafts.length === 0 && (
                <EmptyState title="No drafts match" body="Try another filter, or include drafts without answer keys." />
              )}

              {importId && drafts && visibleDrafts.length > 0 && (
                <div style={{ maxHeight: 430, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {visibleDrafts.map((d) => {
                    const key = `draft:${d.id}`;
                    const on = pickedIds.has(key);
                    return (
                      <label key={d.id} className="question-row" style={{ cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => togglePick(draftToItem(d))} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span>{d.prompt.length > 90 ? `${d.prompt.slice(0, 90)}…` : d.prompt}</span>
                            <Pill tone={d.question_type === "student_produced" ? "amber" : "gray"}>{typePill(d.question_type)}</Pill>
                            {!d.suggested_answer && <Pill tone="red">no key</Pill>}
                          </div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                            Page {d.page_number} · Q{d.source_question_number} · {d.section.replace(/_/g, " ")} · <DraftStatus status={d.status} />
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}

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
                    <Pill tone="blue">{p.source === "bank" ? "bank" : "import"}</Pill>
                    <Pill tone={p.qtype === "student_produced" ? "amber" : "gray"}>{typePill(p.qtype)}</Pill>
                    {!p.hasKey && <Pill tone="red">no key</Pill>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {p.source === "draft" ? `Page ${p.page} · Q${p.qnum}` : p.section.replace(/_/g, " ")}
                  </div>
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
