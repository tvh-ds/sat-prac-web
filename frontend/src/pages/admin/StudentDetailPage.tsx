import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import AssignmentReviewModal from "./AssignmentReviewModal";

interface DetailAttempt {
  id: string;
  test_id: string;
  assignment_id: string | null;
  status: string;
  started_at: string;
  submitted_at: string | null;
  test: { id: string; title: string; kind?: string } | null;
  score: { raw_score: number; total_questions: number; accuracy?: number | null } | null;
}

interface DetailStudent {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  grade_level: string | null;
  school: string | null;
  created_at: string;
}

interface DetailResponse {
  student: DetailStudent;
  attempts: DetailAttempt[];
  topics: Array<{ domain: string; skill: string | null; attempted: number; correct: number }>;
}

export default function StudentDetailPage() {
  const { studentId = "" } = useParams();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<DetailAttempt | null>(null);
  const [kind, setKind] = useState<"all" | "full" | "practice">("all");

  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken();
        setData(await fnJson<DetailResponse>(`admin-students/${studentId}`, { token }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load student");
      }
    })();
  }, [studentId]);

  const attempts = useMemo(() => {
    const list = data?.attempts ?? [];
    if (kind === "all") return list;
    return list.filter((a) => (a.test?.kind ?? "full") === kind);
  }, [data, kind]);

  if (error) return <div className="login-error">{error}</div>;
  if (!data) return <Spinner />;

  const graded = attempts.filter((a) => a.status === "graded" && a.score);
  const totalCorrect = graded.reduce((n, a) => n + Number(a.score?.raw_score ?? 0), 0);
  const totalQuestions = graded.reduce((n, a) => n + Number(a.score?.total_questions ?? 0), 0);
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 1000) / 10 : null;

  return (
    <div>
      <Link to="/admin/students" className="muted" style={{ textDecoration: "none" }}>← Students</Link>
      <h1 className="page-title" style={{ margin: "4px 0" }}>{data.student.full_name ?? "Student"}</h1>
      <p className="page-sub">{data.student.email ?? "No email"} · {data.student.grade_level ?? "No grade"} · {data.student.school ?? "No school"}</p>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Pill tone={data.student.is_active ? "green" : "gray"}>{data.student.is_active ? "Active" : "Inactive"}</Pill>
        <span className="muted" style={{ fontSize: 12.5 }}>Joined {fmtDate(data.student.created_at)}</span>
        <span className="muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>
          {graded.length} graded · {totalCorrect}/{totalQuestions} right{accuracy != null ? ` · ${accuracy}%` : ""}
        </span>
      </div>

      <div className="score-tabs" style={{ margin: "0 0 12px" }}>
        <button className={`score-tab${kind === "all" ? " active" : ""}`} onClick={() => setKind("all")}>All ({(data.attempts ?? []).length})</button>
        <button className={`score-tab${kind === "full" ? " active" : ""}`} onClick={() => setKind("full")}>
          Full-length ({(data.attempts ?? []).filter((a) => (a.test?.kind ?? "full") === "full").length})
        </button>
        <button className={`score-tab${kind === "practice" ? " active" : ""}`} onClick={() => setKind("practice")}>
          Practice ({(data.attempts ?? []).filter((a) => a.test?.kind === "practice").length})
        </button>
      </div>

      {attempts.length === 0 ? (
        <EmptyState title="No attempts yet" body="This student has not taken any tests or practice sets in this view." />
      ) : (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Type</th>
                <th>Status</th>
                <th>Score</th>
                <th>Right / Wrong</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => {
                const raw = a.score ? Number(a.score.raw_score) : null;
                const total = a.score ? Number(a.score.total_questions) : null;
                const wrong = raw != null && total != null ? total - raw : null;
                const pct = a.score?.accuracy ?? (raw != null && total ? Math.round((raw / total) * 1000) / 10 : null);
                return (
                  <tr key={a.id}>
                    <td>{a.test?.title ?? "Test"}</td>
                    <td><Pill tone={a.test?.kind === "practice" ? "amber" : "blue"}>{a.test?.kind === "practice" ? "Practice" : "Full-length"}</Pill></td>
                    <td>
                      <Pill tone={a.status === "graded" ? "green" : "amber"}>
                        {a.status === "graded" ? "Completed" : a.status.replace(/_/g, " ")}
                      </Pill>
                    </td>
                    <td>{raw != null && total != null ? `${raw}/${total}` : "—"}</td>
                    <td>{raw != null && wrong != null ? `${raw} right · ${wrong} wrong` : "—"}</td>
                    <td>{a.submitted_at ? fmtDate(a.submitted_at) : "—"}{pct != null ? ` · ${pct}%` : ""}</td>
                    <td>
                      <Button variant="outline" size="sm" disabled={a.status !== "graded"} onClick={() => setReviewing(a)}>
                        Review
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reviewing && (
        <AssignmentReviewModal
          title={`Review — ${reviewing.test?.title ?? "Attempt"}`}
          endpoint={`admin-students/${studentId}/attempts/${reviewing.id}`}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
