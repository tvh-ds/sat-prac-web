import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { FullTestAssignmentBatch, PracticeAssignmentBatch } from "../../lib/types";
import { Button, Pill, Spinner, fmtDate } from "../../components/ui";

type Tab = "practice" | "full";

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("practice");
  const [practice, setPractice] = useState<PracticeAssignmentBatch[] | null>(null);
  const [full, setFull] = useState<FullTestAssignmentBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await getToken();
      const [p, f] = await Promise.all([
        fnJson<{ batches: PracticeAssignmentBatch[] }>("admin-practice-assignments", { token }),
        fnJson<{ batches: FullTestAssignmentBatch[] }>("admin-tests/assignment-batches", { token }),
      ]);
      setPractice(p.batches);
      setFull(f.batches);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignments");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <div className="section-label">Assignments</div>
      <h1 className="page-title"><span className="hl-muted">Assigned</span> <span className="hl-bright">tests</span></h1>
      <p className="page-sub">Track assigned practice sets and full-length test batches, then review student results.</p>

      {error && <div className="login-error">{error}</div>}

      <div className="score-tabs" style={{ marginBottom: 16 }}>
        <button className={`score-tab${tab === "practice" ? " active" : ""}`} onClick={() => setTab("practice")}>
          Practice Set ({practice?.length ?? "…"})
        </button>
        <button className={`score-tab${tab === "full" ? " active" : ""}`} onClick={() => setTab("full")}>
          Full-Length Test ({full?.length ?? "…"})
        </button>
      </div>

      {tab === "practice" && !practice && <Spinner />}
      {tab === "practice" && practice && practice.length === 0 && (
        <div className="card card-pad muted" style={{ fontSize: 14 }}>
          Nothing assigned yet. Open a current practice set and press Assign.
        </div>
      )}
      {tab === "practice" && practice && practice.length > 0 && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr><th>Set</th><th>Assigned</th><th>Timer</th><th>Students</th><th>Avg score</th><th>Explanations</th><th /></tr>
            </thead>
            <tbody>
              {practice.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.title}</td>
                  <td>{fmtDate(b.assigned_at)}</td>
                  <td>{b.timer_minutes} min · {b.question_count} qs</td>
                  <td>{b.completed_count}/{b.student_count} done</td>
                  <td>{b.avg_accuracy != null ? `${b.avg_accuracy}%` : "—"}</td>
                  <td><Pill tone={b.explanations_released_at ? "green" : "gray"}>{b.explanations_released_at ? "Released" : "Hidden"}</Pill></td>
                  <td><Button variant="outline" size="sm" onClick={() => navigate(`/admin/assignments/practice/${b.id}`)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "full" && !full && <Spinner />}
      {tab === "full" && full && full.length === 0 && (
        <div className="card card-pad muted" style={{ fontSize: 14 }}>
          No full-length tests have been assigned yet. Approved full-length tests stay on the Full-Length Tests page until you assign them.
        </div>
      )}
      {tab === "full" && full && full.length > 0 && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr><th>Test</th><th>Assigned</th><th>Scope</th><th>Students</th><th>Avg score</th><th>Due</th><th /></tr>
            </thead>
            <tbody>
              {full.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.title}</td>
                  <td>{fmtDate(b.assigned_at)}</td>
                  <td>{scopeLabel(b.content_scope)} · {b.question_count} qs</td>
                  <td>{b.completed_count}/{b.student_count} done</td>
                  <td>{b.avg_accuracy != null ? `${b.avg_accuracy}%` : "—"}</td>
                  <td>{b.due_at ? fmtDate(b.due_at) : "—"}</td>
                  <td><Button variant="outline" size="sm" onClick={() => navigate(`/admin/assignments/full/${b.id}`)}>Open</Button></td>
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
