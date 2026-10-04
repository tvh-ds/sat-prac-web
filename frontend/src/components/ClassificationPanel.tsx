import { useCallback, useEffect, useId, useState } from "react";
import { fnJson, getToken } from "../lib/supabase";
import { TAXONOMY, type SectionKey } from "../lib/satTaxonomy";
import { Button } from "./ui";

type Field = { value: string | number | null; confidence: number | null; abstention_reason: string | null };
type Suggestion = {
  id: string; draft_question_id: string; status: string; error_category: string | null;
  prediction: { domain: Field; skill: Field; difficulty: Field; model_version: string } | null;
  input_snapshot: { content: { section: SectionKey; prompt: string }; domain: string | null; skill: string | null; difficulty: number | null };
};
type Summary = { current_job: { id: string; status: string; total: number; processed: number; failed: number; model_version: string } | null; suggestions: Suggestion[] };

export default function ClassificationPanel({ importId, selectedDraftId, onAccepted }: {
  importId: string; selectedDraftId: string | null; onAccepted: () => Promise<void>;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    const token = await getToken();
    setSummary(await fnJson<Summary>(`admin-pdf-imports/${importId}/classification`, { token }));
  }, [importId]);
  useEffect(() => { if (opened) void load().catch((e) => setError(e.message)); }, [load, opened]);
  useEffect(() => {
    if (!opened || !summary?.current_job || !["queued", "running"].includes(summary.current_job.status)) return;
    const timer = window.setInterval(() => void load().catch((e) => setError(e.message)), 3000);
    return () => window.clearInterval(timer);
  }, [opened, summary?.current_job?.status, load]);
  useEffect(() => setPage(0), [selectedDraftId, summary?.current_job?.id]);
  const running = summary?.current_job && ["queued", "running"].includes(summary.current_job.status);
  async function classify(selected: boolean) {
    setBusy(true); setError(null); setOpened(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${importId}/classification`, { method: "POST", token, body: selected ? { draft_ids: [selectedDraftId] } : {} });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to start classification"); }
    finally { setBusy(false); }
  }
  async function decide(suggestion: Suggestion, decision: "accept" | "dismiss", labels: object, replace: boolean) {
    setBusy(true); setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${importId}/classification/suggestions/${suggestion.id}/decision`, {
        method: "POST", token, body: { decision, labels, replace_existing: replace },
      });
      await load();
      if (decision === "accept") await onAccepted();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save classification"); }
    finally { setBusy(false); }
  }
  const suggestions = (summary?.suggestions ?? []).filter((s) => !selectedDraftId || s.draft_question_id === selectedDraftId);
  return <section className="panel" aria-label="Question classification" style={{ marginTop: 18 }}>
    <h3 style={{ margin: "0 0 7px" }}>Question classification</h3>
    <p className="muted">Optional ML suggestions for reviewed, unpublished full-length drafts. Accept or edit labels before using them.</p>
    <div className="card-row" style={{ gap: 8, flexWrap: "wrap" }}>
      <Button variant="outline" disabled={busy || Boolean(running)} onClick={() => void classify(false)}>Classify import</Button>
      {selectedDraftId && <Button variant="outline" disabled={busy || Boolean(running)} onClick={() => void classify(true)}>Classify question</Button>}
      <Button variant="ghost" disabled={busy} onClick={() => setOpened((v) => !v)}>{opened ? "Hide suggestions" : "Show suggestions"}</Button>
    </div>
    {error && <p role="alert" className="login-error">{error} <button className="btn btn-secondary" onClick={() => void load().then(() => setError(null)).catch((e) => setError(e.message))}>Retry status</button></p>}
    {opened && summary?.current_job && <p role="status">{summary.current_job.status} · {summary.current_job.processed}/{summary.current_job.total} processed · {summary.current_job.failed} skipped or failed · {summary.current_job.model_version}</p>}
    {opened && summary && !summary.current_job && <p className="muted">No classification has been run for this import.</p>}
    {opened && suggestions.slice(page * 10, page * 10 + 10).map((s) => <SuggestionEditor key={s.id} suggestion={s} busy={busy} onDecide={decide} />)}
    {opened && suggestions.length > 10 && <div className="card-row" style={{ gap: 8 }}><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous suggestions</Button><Button variant="outline" disabled={(page + 1) * 10 >= suggestions.length} onClick={() => setPage(page + 1)}>Next suggestions</Button></div>}
  </section>;
}

function SuggestionEditor({ suggestion: s, busy, onDecide }: {
  suggestion: Suggestion; busy: boolean;
  onDecide: (s: Suggestion, decision: "accept" | "dismiss", labels: object, replace: boolean) => Promise<void>;
}) {
  const taxonomy = TAXONOMY[s.input_snapshot.content.section] as Record<string, readonly string[]>;
  const fieldId = useId();
  const predicted = s.prediction;
  const [domain, setDomain] = useState(String(predicted?.domain.value ?? s.input_snapshot.domain ?? ""));
  const [skill, setSkill] = useState(String(predicted?.skill.value ?? s.input_snapshot.skill ?? ""));
  const [difficulty, setDifficulty] = useState(String(predicted?.difficulty.value ?? s.input_snapshot.difficulty ?? ""));
  const [replace, setReplace] = useState(false);
  useEffect(() => {
    if (s.status !== "ready" || !predicted) return;
    const proposedSkill = String(predicted.skill.value ?? s.input_snapshot.skill ?? "");
    const proposedDomain = String(predicted.domain.value ?? s.input_snapshot.domain ?? Object.keys(taxonomy).find((d) => taxonomy[d]?.includes(proposedSkill)) ?? "");
    setDomain(proposedDomain); setSkill(proposedSkill);
    setDifficulty(String(predicted.difficulty.value ?? s.input_snapshot.difficulty ?? ""));
    // Scalar dependencies preserve edits while the parent refreshes job status.
  }, [s.status, predicted?.domain.value, predicted?.skill.value, predicted?.difficulty.value]);
  if (s.status !== "ready" || !predicted) return <p className="muted">{s.input_snapshot.content.prompt.slice(0, 100)} — {s.status}{s.error_category ? ` (${s.error_category})` : ""}</p>;
  return <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
    <p>{s.input_snapshot.content.prompt.slice(0, 220)}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
      <div><label htmlFor={`${fieldId}-domain`}>Domain</label><select id={`${fieldId}-domain`} className="input" value={domain} onChange={(e) => { setDomain(e.target.value); setSkill(""); }}><option value="">Leave unresolved</option>{Object.keys(taxonomy).map((d) => <option key={d}>{d}</option>)}</select></div>
      <div><label htmlFor={`${fieldId}-skill`}>Skill</label><select id={`${fieldId}-skill`} className="input" value={skill} onChange={(e) => setSkill(e.target.value)}><option value="">Leave unresolved</option>{(taxonomy[domain] ?? []).map((v) => <option key={v}>{v}</option>)}</select></div>
      <div><label htmlFor={`${fieldId}-difficulty`}>Difficulty</label><select id={`${fieldId}-difficulty`} className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Leave unresolved</option><option value="1">Easy</option><option value="3">Medium</option><option value="5">Hard</option></select></div>
    </div>
    <p className="muted">{(["domain", "skill", "difficulty"] as const).map((field) => `${field}: ${predicted[field].confidence === null ? "uncalibrated" : `${Math.round(predicted[field].confidence! * 100)}%`}${predicted[field].abstention_reason ? ` — ${predicted[field].abstention_reason.replaceAll("_", " ")}` : ""}`).join(" · ")}</p>
    <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace any existing labels that differ</label>
    <div className="card-row" style={{ gap: 8 }}>
      <Button disabled={busy || (!domain && !skill && !difficulty) || Boolean(skill && !taxonomy[domain]?.includes(skill))} onClick={() => void onDecide(s, "accept", { ...(domain ? { domain } : {}), ...(skill ? { skill } : {}), ...(difficulty ? { difficulty: Number(difficulty) } : {}) }, replace)}>Accept selected labels</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void onDecide(s, "dismiss", {}, false)}>Dismiss</Button>
    </div>
  </div>;
}
