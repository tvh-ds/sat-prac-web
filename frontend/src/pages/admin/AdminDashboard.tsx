import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { PdfImport } from "../../lib/types";
import { Spinner, fmtDate } from "../../components/ui";
import { initReveal, initCountup } from "../../lib/reveal";
import KeyStatusBadge from "../../components/KeyStatusBadge";

interface ProgressStudent {
  id: string;
  full_name: string;
  grade_level: string | null;
  total_attempts: number;
  completed_attempts: number;
  total_questions_attempted: number;
  total_questions_correct: number;
  accuracy: number | null;
}

interface AdminStudent {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<{
    students: AdminStudent[];
    progress: ProgressStudent[];
    imports: PdfImport[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const [s, p, i] = await Promise.all([
        fnJson<{ students: AdminStudent[] }>("admin-students", { token }).catch(() => ({ students: [] })),
        fnJson<{ students: ProgressStudent[] }>("admin-progress/students", { token }).catch(() => ({ students: [] })),
        fnJson<{ imports: PdfImport[] }>("admin-pdf-imports", { token }).catch(() => ({ imports: [] })),
      ]);
      setStats({ students: s.students, progress: p.students, imports: i.imports });
    })();
  }, []);

  useEffect(() => { if (stats) requestAnimationFrame(() => { initReveal(); initCountup(); }); }, [stats]);

  if (!stats) return <Spinner />;

  const pendingImports = stats.imports.filter((im) => !["completed", "failed", "cancelled"].includes(im.status)).length;
  const activeStudents = stats.students.filter((s) => s.is_active).length;
  const totalCorrect = stats.progress.reduce((a, s) => a + s.total_questions_correct, 0);
  const totalAttempted = stats.progress.reduce((a, s) => a + s.total_questions_attempted, 0);
  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 1000) / 10 : null;

  return (
    <div>
      <div className="section-label">[ Overview ]</div>
      <h1 className="page-title"><span className="hl-muted">Command</span> <span className="hl-bright">center</span></h1>
      <p className="page-sub">Platform health and recent activity.</p>

      <div className="stat-grid">
        <div className="stat-card reveal">
          <div className="ico">◈</div>
          <div className="num" data-countup={activeStudents}>{activeStudents}</div>
          <div className="lbl">Active students</div>
          <div className="arch-meta">ROSTER // ACTIVE: {activeStudents} // TOTAL: {stats.students.length}</div>
        </div>
        <div className="stat-card reveal">
          <div className="ico">⬢</div>
          <div className="num" data-countup={stats.progress.reduce((a, s) => a + s.completed_attempts, 0)}>{stats.progress.reduce((a, s) => a + s.completed_attempts, 0)}</div>
          <div className="lbl">Completed attempts</div>
          <div className="arch-meta">ATTEMPTS // COMPLETED</div>
        </div>
        <div className="stat-card reveal">
          <div className="ico">⬣</div>
          <div className="num">{overallAccuracy === null ? "—" : `${overallAccuracy}%`}</div>
          <div className="lbl">Overall accuracy</div>
          <div className="arch-meta">CORRECT: {totalCorrect} // ATTEMPTED: {totalAttempted}</div>
        </div>
        <div className="stat-card reveal">
          <div className="ico">⬔</div>
          <div className="num" data-countup={pendingImports}>{pendingImports}</div>
          <div className="lbl">Pending PDF imports</div>
          <div className="arch-meta">QUEUE // PENDING: {pendingImports}</div>
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 28 }}>[ PDF Pipeline ]</div>
      <div className="section-head">
        <h2>Recent Imports</h2>
        <Link className="btn btn-secondary btn-sm" to="/admin/imports">All imports</Link>
      </div>
      <div className="card card-pad">
        {stats.imports.length === 0 ? (
          <p className="muted">No PDF imports yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Answer key</th>
                <th>Pages</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.imports.slice(0, 6).map((im) => (
                <tr key={im.id} className="row-link">
                  <td>{im.original_filename}</td>
                  <td>
                    <ImportStatus status={im.status} />
                  </td>
                  <td style={{ fontSize: 12.5 }}>
                    <KeyStatusBadge imp={im} showDetail />
                  </td>
                  <td>{im.page_count ?? "—"}</td>
                  <td>{fmtDate(im.created_at)}</td>
                    <td>
                      <Link className="btn btn-secondary btn-sm" to={`/admin/imports/${im.id}`}>Open</Link>
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ImportStatus({ status }: { status: string }) {
  const tone = (s: string) => {
    if (s === "completed") return "green";
    if (s === "failed") return "red";
    if (["uploaded", "extracting", "parsing"].includes(s)) return "amber";
    return "gray";
  };
  const label = (s: string) => {
    switch (s) {
      case "completed": return "Completed";
      case "failed": return "Failed";
      case "extracting": return "Extracting";
      case "parsing": return "Parsing";
      default: return s.charAt(0).toUpperCase() + s.slice(1);
    }
  };
  return <span className={`pill pill-${tone(status)}`}>{label(status)}</span>;
}