import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import VocabularyAssignments from "./VocabularyAssignments";
import ClassBadge from "../../components/ClassBadge";
import { fnJson, getToken } from "../../lib/supabase";
import type { FullTestAssignmentBatch, PracticeAssignmentBatch, StudentClass } from "../../lib/types";
import { Button, Pill, Spinner, fmtDate } from "../../components/ui";

type Tab = "practice" | "full" | "vocabulary";

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "vocabulary" ? "vocabulary" : searchParams.get("tab") === "full" ? "full" : "practice";
  const setTab = (value: Tab) => setSearchParams(prev => { const next = new URLSearchParams(prev); if (value === "practice") next.delete("tab"); else next.set("tab", value); return next; });
  const classId = searchParams.get("class_id") ?? "";
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [practice, setPractice] = useState<PracticeAssignmentBatch[] | null>(null);
  const [full, setFull] = useState<FullTestAssignmentBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = searchParams.get("search") ?? "", completion = searchParams.get("completion") ?? "all";
  const update = (key: string, value: string) => setSearchParams(previous => { const next = new URLSearchParams(previous); if (value && (key === "search" || value !== "all")) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const matchesWork = (b: PracticeAssignmentBatch | FullTestAssignmentBatch) => `${b.title} ${b.class_name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (completion === "all" || (completion === "completed" ? b.student_count > 0 && b.completed_count === b.student_count : b.completed_count < b.student_count));
  const returnQuery = `?return_to=${encodeURIComponent(location.pathname + location.search)}`;
  const matchesClass = (b: PracticeAssignmentBatch | FullTestAssignmentBatch) => !classId || (classId === "individual" ? !b.class_id && !b.class_name : b.class_id === classId);
  const visiblePractice = practice?.filter(matchesClass).filter(matchesWork);
  const visibleFull = full?.filter(matchesClass).filter(matchesWork);

  async function deleteBatch(kind: "practice" | "full", batch: PracticeAssignmentBatch | FullTestAssignmentBatch) {
    if (deleting || !window.confirm(`Delete assignment “${batch.title}” for all ${batch.student_count} students? This permanently removes this assignment, its attempts, and scores. The original ${kind === "practice" ? "practice set" : "test"} is kept. This cannot be undone.`)) return;
    setDeleting(batch.id); setError(null); setNotice("");
    try {
      const token = await getToken();
      await fnJson(kind === "practice" ? `admin-practice-assignments/${batch.id}` : `admin-tests/assignment-batches/${batch.id}`, { method: "DELETE", token });
      if (kind === "practice") setPractice(prev => prev?.filter(b => b.id !== batch.id) ?? null);
      else setFull(prev => prev?.filter(b => b.id !== batch.id) ?? null);
      setNotice(`Assignment “${batch.title}” deleted.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete assignment. Please try again."); }
    finally { setDeleting(null); }
  }

  async function load() {
    try {
      const token = await getToken();
      const [p, f, c] = await Promise.all([
        fnJson<{ batches: PracticeAssignmentBatch[] }>("admin-practice-assignments", { token }),
        fnJson<{ batches: FullTestAssignmentBatch[] }>("admin-tests/assignment-batches", { token }),
        fnJson<{ classes: StudentClass[] }>("admin-classes", { token }),
      ]);
      setPractice(p.batches);
      setFull(f.batches);
      setClasses(c.classes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignments");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1 className="page-title"><span className="hl-muted">Assigned</span> <span className="hl-bright">work</span></h1>
      <p className="page-sub">Track assigned practice sets, full-length tests, and daily vocabulary progress.</p>

      {error && <div className="login-error" role="alert">{error}</div>}
      <div role="status" className="muted">{notice}</div>

      <div className="filter-row" style={{ marginBottom: 16 }}>
        <label htmlFor="assignment-class">Filter by class</label>
        <select id="assignment-class" className="select" value={classId} onChange={e => setSearchParams(prev => { const next = new URLSearchParams(prev); if (e.target.value) next.set("class_id", e.target.value); else next.delete("class_id"); return next; })}>
          <option value="">All classes</option>
          {tab !== "vocabulary" && <option value="individual">Individual assignments</option>}
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          {classId && classId !== "individual" && !classes.some(c => c.id === classId) && <option value={classId}>Selected class</option>}

      {tab === "vocabulary" && classId === "individual" && <option value="individual">Individual assignments (tests only)</option>}
        </select>
      </div>

      <div className="score-tabs" style={{ marginBottom: 16 }}>
        <button className={`score-tab${tab === "practice" ? " active" : ""}`} onClick={() => setTab("practice")}>
          Practice Set ({visiblePractice?.length ?? "…"})
        </button>
        <button className={`score-tab${tab === "full" ? " active" : ""}`} onClick={() => setTab("full")}>
          Full-Length Test ({visibleFull?.length ?? "…"})
        </button>
        <button className={`score-tab${tab === "vocabulary" ? " active" : ""}`} onClick={() => setTab("vocabulary")}>Vocabulary</button>
      </div>

      {tab !== "vocabulary" && <div className="toolbar admin-progress-filters"><label>Find assignment<input className="input" type="search" placeholder="Assignment title or class" value={search} onChange={e => update("search", e.target.value)} /></label><label>Completion<select className="select" value={completion} onChange={e => update("completion", e.target.value)}><option value="all">All assignments</option><option value="completed">Everyone completed</option><option value="incomplete">Incomplete</option></select></label></div>}

      {tab === "vocabulary" && (classId === "individual" ? <p className="muted">Vocabulary is assigned to individual students. Choose All classes or a class to view vocabulary progress.</p> : <VocabularyAssignments classId={classId} />)}

      {tab === "practice" && !practice && <Spinner />}
      {tab === "practice" && visiblePractice && visiblePractice.length === 0 && (
        <div className="card card-pad muted" style={{ fontSize: 14 }}>
          {search.trim() || completion !== "all" ? "No practice assignments match your search and filters." : classId ? "No practice assignments match this class filter." : "Nothing assigned yet. Open a current practice set and press Assign."}
        </div>
      )}
      {tab === "practice" && visiblePractice && visiblePractice.length > 0 && (
        <div className="card card-pad" style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr><th>Set</th><th>Assigned</th><th>Timer</th><th>Students</th><th>Avg score</th><th>Explanations</th><th /></tr>
            </thead>
            <tbody>
              {visiblePractice.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600, minWidth: 240 }}>{b.title}<div style={{ marginTop: 4 }}><ClassBadge {...b} /></div></td>
                  <td>{fmtDate(b.assigned_at)}</td>
                  <td>{b.timer_minutes} min · {b.question_count} qs</td>
                  <td>{b.completed_count}/{b.student_count} done</td>
                  <td>{b.avg_accuracy != null ? `${b.avg_accuracy}%` : "—"}</td>
                  <td><Pill tone={b.explanations_released_at ? "green" : "gray"}>{b.explanations_released_at ? "Released" : "Hidden"}</Pill></td>
                  <td><div style={{ display: "flex", gap: 8 }}><Button variant="outline" size="sm" onClick={() => navigate(`/admin/assignments/practice/${b.id}${returnQuery}`)}>Open</Button><Button variant="danger" size="sm" disabled={!!deleting} aria-label={`Delete assignment ${b.title}`} onClick={() => void deleteBatch("practice", b)}>{deleting === b.id ? "Deleting…" : "Delete"}</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "full" && !full && <Spinner />}
      {tab === "full" && visibleFull && visibleFull.length === 0 && (
        <div className="card card-pad muted" style={{ fontSize: 14 }}>
          {search.trim() || completion !== "all" ? "No full-length test assignments match your search and filters." : classId ? "No full-length test assignments match this class filter." : "No full-length tests have been assigned yet. Approved full-length tests stay on the Full-Length Tests page until you assign them."}
        </div>
      )}
      {tab === "full" && visibleFull && visibleFull.length > 0 && (
        <div className="card card-pad" style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr><th>Test</th><th>Assigned</th><th>Scope</th><th>Students</th><th>Avg score</th><th>Due</th><th /></tr>
            </thead>
            <tbody>
              {visibleFull.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600, minWidth: 240 }}>{b.title}<div style={{ marginTop: 4 }}><ClassBadge {...b} /></div></td>
                  <td>{fmtDate(b.assigned_at)}</td>
                  <td>{scopeLabel(b.content_scope)} · {b.question_count} qs</td>
                  <td>{b.completed_count}/{b.student_count} done</td>
                  <td>{b.avg_accuracy != null ? `${b.avg_accuracy}%` : "—"}</td>
                  <td>{b.due_at ? fmtDate(b.due_at) : "—"}</td>
                  <td><div style={{ display: "flex", gap: 8 }}><Button variant="outline" size="sm" onClick={() => navigate(`/admin/assignments/full/${b.id}${returnQuery}`)}>Open</Button><Button variant="danger" size="sm" disabled={!!deleting} aria-label={`Delete assignment ${b.title}`} onClick={() => void deleteBatch("full", b)}>{deleting === b.id ? "Deleting…" : "Delete"}</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function scopeLabel(scope: string) {
  if (scope === "reading_writing") return "Reading & Writing";
  if (scope === "math") return "Math";
  if (scope === "custom_modules") return "Selected modules";
  return "Full test";
}
