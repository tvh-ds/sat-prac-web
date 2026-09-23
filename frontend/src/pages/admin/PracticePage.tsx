import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { PracticeSet } from "../../lib/types";
import { Button, Modal, Spinner, fmtDate } from "../../components/ui";

interface StudentOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

export function AssignModal({ set, onClose, onDone }: { set: PracticeSet; onClose: () => void; onDone: () => void }) {
  const [students, setStudents] = useState<StudentOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [minutes, setMinutes] = useState(set.time_limit_minutes ?? 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken();
        const d = await fnJson<{ students: Array<StudentOption & { is_active: boolean }> }>("admin-students", { token });
        setStudents((d.students ?? []).filter((s) => s.is_active !== false));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load students");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return students ?? [];
    return (students ?? []).filter((s) =>
      `${s.full_name ?? ""} ${s.email ?? ""}`.toLowerCase().includes(needle),
    );
  }, [students, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (selected.size === 0) {
      setError("Select at least one student");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const d = await fnJson<{ batch: { assigned_count: number } }>("admin-practice-assignments", {
        method: "POST",
        token,
        body: { set_id: set.id, student_ids: [...selected], timer_minutes: minutes },
      });
      setSuccess(`Assigned to ${d.batch.assigned_count} student(s) with a ${minutes}-minute timer. Students can take it as many times as you assign it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Assign — ${set.title}`}
      onClose={onClose}
      footer={
        <>
          {success && <span style={{ color: "var(--color-success)", fontSize: 13, marginRight: "auto" }}>{success}</span>}
          {!success && <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>}
          {!success && <Button disabled={busy || selected.size === 0} onClick={() => void save()}>{busy ? "Assigning…" : `Assign (${selected.size})`}</Button>}
          {success && <Button onClick={() => { onClose(); onDone(); }}>Done</Button>}
        </>
      }
    >
      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <h4 style={{ margin: "0 0 8px" }}>1. Students ({selected.size} selected)</h4>
      {!students && <Spinner />}
      {students && (
        <>
          <input
            className="input"
            placeholder="Search students…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filtered.map((s) => s.id)))}>
              Select all shown ({filtered.length})
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            {filtered.map((s) => (
              <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 13.5 }}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span style={{ fontWeight: 500 }}>{s.full_name ?? "Unnamed"}</span>
                <span className="muted">{s.email}</span>
              </label>
            ))}
            {filtered.length === 0 && <span className="muted">No students match.</span>}
          </div>
        </>
      )}

      <h4 style={{ margin: "16px 0 8px" }}>2. Timer (minutes)</h4>
      <input
        className="input"
        type="number"
        min={1}
        max={600}
        value={minutes}
        onChange={(e) => setMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
        style={{ maxWidth: 160 }}
      />
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Each Assign creates a separate immutable copy with this timer. Assign the same set again any time —
        to the same or different students — with a different timer if you like.
      </p>
    </Modal>
  );
}

export default function PracticePage() {
  const [sets, setSets] = useState<PracticeSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<PracticeSet | null>(null);

  async function load() {
    try {
      const token = await getToken();
      const s = await fnJson<{ sets: PracticeSet[] }>("admin-practice", { token });
      setSets(s.sets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load practice sets");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(s: PracticeSet) {
    if (!window.confirm(`Delete "${s.title}"? Previously assigned copies, attempts, and results are kept.`)) return;
    try {
      const token = await getToken();
      await fnJson(`admin-practice/${s.id}`, { method: "DELETE", token });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete practice set");
    }
  }

  return (
    <div>
      <div className="section-label">Practice</div>
      <h1 className="page-title"><span className="hl-muted">Practice</span> <span className="hl-bright">sets</span></h1>
      <p className="page-sub">
        Current sets are admin-only templates — assigning publishes a copy to the students you choose. Assigned copies live under Assignments.
      </p>

      <div className="toolbar">
        <Link to="/admin/practice/new">
          <Button>+ Generate Practice Set</Button>
        </Link>
        <Link to="/admin/assignments" style={{ marginLeft: "auto" }} className="muted">
          View assignments →
        </Link>
      </div>

      {error && <div className="login-error">{error}</div>}

      {!sets && <Spinner />}
      {sets && sets.length === 0 && (
        <div className="card card-pad muted" style={{ fontSize: 14 }}>
          No practice sets yet. Generate one from the Practice Question Bank.
        </div>
      )}

      {sets && sets.length > 0 && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
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
                  <td>{s.question_count}</td>
                  <td>{s.time_limit_minutes != null ? `${s.time_limit_minutes} min` : "—"}</td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Link to={`/admin/practice/${s.id}`}>
                        <Button variant="outline" size="sm">Review</Button>
                      </Link>
                      <Button variant="outline" size="sm" onClick={() => setAssigning(s)}>Assign</Button>
                      <Button variant="ghost" size="sm" onClick={() => void remove(s)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <AssignModal
          set={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
