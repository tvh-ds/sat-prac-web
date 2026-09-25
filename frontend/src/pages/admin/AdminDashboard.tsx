import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { PdfImport } from "../../lib/types";
import { Spinner, fmtDate } from "../../components/ui";
import { initReveal, initCountup } from "../../lib/reveal";
import KeyStatusBadge from "../../components/KeyStatusBadge";
import { Activity, FileClock, GraduationCap, Percent } from "lucide-react";

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
  profile_status: "incomplete" | "pending" | "approved" | null;
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
  const studentCount = stats.students.length;
  const totalCorrect = stats.progress.reduce((a, s) => a + s.total_questions_correct, 0);
  const totalAttempted = stats.progress.reduce((a, s) => a + s.total_questions_attempted, 0);
  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 1000) / 10 : null;
  const completedAttempts = stats.progress.reduce((a, s) => a + s.completed_attempts, 0);
  const latestImport = stats.imports[0];

  return (
    <div>
      <section className="admin-hero reveal">
        <div className="admin-hero-grid">
          <div>
            <div className="section-label">Overview</div>
            <h1>Assessment operations, cleaned up.</h1>
            <p>Track student activity, import health, test readiness, and recent PDF pipeline work from one executive-grade dashboard.</p>
          </div>
          <div className="admin-pipeline-card">
            <span className="arch-meta">Import queue</span>
            <strong>{pendingImports}</strong>
            <span className="muted">{latestImport ? `Latest: ${latestImport.original_filename}` : "No imports yet"}</span>
          </div>
        </div>
      </section>

      <div className="stat-grid">
        <div className="stat-card reveal">
          <div className="ico"><GraduationCap size={20} strokeWidth={1.7} /></div>
          <div className="num" data-countup={studentCount}>{studentCount}</div>
          <div className="lbl">Students on roster</div>
          <div className="arch-meta">All student accounts</div>
        </div>
        <div className="stat-card reveal">
          <div className="ico"><Activity size={20} strokeWidth={1.7} /></div>
          <div className="num" data-countup={completedAttempts}>{completedAttempts}</div>
          <div className="lbl">Completed attempts</div>
          <div className="arch-meta">Submitted and graded work</div>
        </div>
        <div className="stat-card reveal">
          <div className="ico"><Percent size={20} strokeWidth={1.7} /></div>
          <div className="num">{overallAccuracy === null ? "—" : `${overallAccuracy}%`}</div>
          <div className="lbl">Overall accuracy</div>
          <div className="arch-meta">{totalCorrect} correct of {totalAttempted} attempted</div>
        </div>
        <div className="stat-card reveal">
          <div className="ico"><FileClock size={20} strokeWidth={1.7} /></div>
          <div className="num" data-countup={pendingImports}>{pendingImports}</div>
          <div className="lbl">Pending PDF imports</div>
          <div className="arch-meta">Still processing or queued</div>
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 28 }}>PDF pipeline</div>
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
