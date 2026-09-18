import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { PracticeSet } from "../../lib/types";
import { Button, Pill, Spinner, fmtDate } from "../../components/ui";

export default function PracticePage() {
  const [sets, setSets] = useState<PracticeSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const token = await getToken();
      const d = await fnJson<{ sets: PracticeSet[] }>("admin-practice", { token });
      setSets(d.sets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load practice sets");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function archive(s: PracticeSet) {
    if (!window.confirm(`Archive "${s.title}"? Students will no longer see it.`)) return;
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${s.id}`, { method: "PATCH", token, body: { status: "archived" } });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive practice set");
    }
  }

  return (
    <div>
      <div className="section-label">[ Practice ]</div>
      <h1 className="page-title"><span className="hl-muted">Practice</span> <span className="hl-bright">sets</span></h1>
      <p className="page-sub">
        Single-timer sets from the bank or PDF drafts · published to students.
      </p>

      <div className="toolbar">
        <Link to="/admin/practice/new">
          <Button>+ Generate Practice Set</Button>
        </Link>
      </div>

      {error && <div className="login-error">{error}</div>}
      {!sets && <Spinner />}

      {sets && sets.length === 0 && (
        <div className="card card-pad muted" style={{ fontSize: 14 }}>
          No practice sets yet. Generate one from the question bank or a PDF import.
        </div>
      )}

      {sets && sets.length > 0 && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Questions</th>
                <th>Timer</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td>
                    <Pill tone={s.status === "published" ? "green" : s.status === "archived" ? "gray" : "amber"}>{s.status}</Pill>
                  </td>
                  <td>{s.question_count}</td>
                  <td>{s.time_limit_minutes != null ? `${s.time_limit_minutes} min` : "—"}</td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Link to={`/admin/practice/${s.id}`}>
                        <Button variant="outline" size="sm">Manage</Button>
                      </Link>
                      {s.status === "published" && (
                        <Button variant="ghost" size="sm" onClick={() => void archive(s)}>Archive</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}