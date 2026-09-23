import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { BatchStudent, FullTestBatchDetail } from "../../lib/types";
import { Button, Pill, Spinner, fmtDate } from "../../components/ui";
import AssignmentReviewModal from "./AssignmentReviewModal";

function statusTone(s: string): "green" | "amber" | "gray" {
  if (s === "graded" || s === "completed") return "green";
  if (s === "in_progress" || s === "submitted") return "amber";
  return "gray";
}

function statusLabel(s: string): string {
  if (s === "graded" || s === "completed") return "Completed";
  if (s === "in_progress" || s === "submitted") return "In progress";
  return "Not started";
}

function scopeLabel(scope: string) {
  if (scope === "reading_writing") return "Reading & Writing";
  if (scope === "math") return "Math";
  if (scope === "custom_modules") return "Selected modules";
  return "Full test";
}

export default function FullLengthBatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [data, setData] = useState<FullTestBatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<BatchStudent | null>(null);

  async function load() {
    try {
      const token = await getToken();
      setData(await fnJson<FullTestBatchDetail>(`admin-tests/assignment-batches/${batchId}`, { token }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignment");
    }
  }

  useEffect(() => {
    void load();
  }, [batchId]);

  if (!data && !error) return <Spinner />;
  if (!data) return <div><h1 className="page-title">Error</h1><div className="login-error">{error}</div></div>;

  const b = data.batch;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Link to="/admin/assignments" className="muted" style={{ textDecoration: "none" }}>← Assignments</Link>
        <h1 className="page-title" style={{ margin: 0 }}>Assigned Full-Length Test</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: "4px 0", fontWeight: 700 }}>{b.title}</h2>
        <Pill tone="blue">{scopeLabel(b.content_scope)}</Pill>
        <span className="muted" style={{ fontSize: 13 }}>Assigned {fmtDate(b.assigned_at)} · {b.question_count} question(s) · {data.students.length} student(s)</span>
      </div>
      {error && <div className="login-error">{error}</div>}

      <div className="card card-pad">
        <table className="table">
          <thead>
            <tr><th>Student</th><th>Status</th><th>Started</th><th>Submitted</th><th>Score</th><th>Accuracy</th><th /></tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.assignment_id}>
                <td><div style={{ fontWeight: 600 }}>{s.full_name || "Unnamed"}</div>{s.email && <div className="muted" style={{ fontSize: 12 }}>{s.email}</div>}</td>
                <td><Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill></td>
                <td>{s.started_at ? fmtDate(s.started_at) : "—"}</td>
                <td>{s.submitted_at ? fmtDate(s.submitted_at) : "—"}</td>
                <td>{s.raw_score != null && s.total_questions != null ? `${s.raw_score}/${s.total_questions}` : "—"}</td>
                <td>{s.accuracy != null ? `${s.accuracy}%` : "—"}</td>
                <td><Button variant="outline" size="sm" disabled={!s.review_attempt_id} onClick={() => setReviewing(s)}>Review</Button></td>
              </tr>
            ))}
            {data.students.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No students in this assignment.</td></tr>}
          </tbody>
        </table>
      </div>

      {reviewing?.review_attempt_id && (
        <AssignmentReviewModal
          title={`Review — ${reviewing.full_name || reviewing.email || "Student"}`}
          endpoint={`admin-tests/assignment-batches/${batchId}/attempts/${reviewing.review_attempt_id}`}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
