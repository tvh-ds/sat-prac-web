import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, Modal, Pill, Spinner, fmtDate } from "../../components/ui";

interface AdminStudent {
  id: string;
  email: string | null;
  full_name: string | null;
  profile_status: "incomplete" | "pending" | "approved" | null;
  created_at: string;
  attempts?: { id: string; status: string }[];
}

export default function StudentsPage() {
  const navigate = useNavigate();
  const [students, setStudents] = useState<AdminStudent[] | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const token = await getToken();
    const d = await fnJson<{ students: AdminStudent[] }>("admin-students", { token });
    setStudents(d.students);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load students"));
  }, []);

  const filtered = (students ?? []).filter(
    (s) => !search || `${s.email ?? ""} ${s.full_name ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="section-label">Roster</div>
      <h1 className="page-title"><span className="hl-muted">Student</span> <span className="hl-bright">roster</span></h1>
      <p className="page-sub">Admin-created accounts · no self-registration.</p>

      <div className="toolbar">
        <input className="input" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button onClick={() => setShowCreate(true)}>+ New Student</Button>
      </div>

      {error && <div className="login-error">{error}</div>}
      {!students && <Spinner />}

      {students && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Profile</th>
                <th>Attempts</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>{s.full_name ?? "—"}</td>
                  <td>{s.email ?? "—"}</td>
                  <td>
                    <Pill tone={s.profile_status === "approved" ? "green" : s.profile_status === "pending" ? "amber" : "gray"}>
                      {s.profile_status === "approved" ? "Approved" : s.profile_status === "pending" ? "Pending" : "Incomplete"}
                    </Pill>
                  </td>
                  <td>{(s.attempts ?? []).length}</td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/admin/students/${s.id}?tab=manage`)}>Manage</Button>
                      <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/students/${s.id}?tab=info`)}>Info</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 30 }}>
                    No students found. <Link to="/admin">Create one from the dashboard?</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateStudentModal onClose={() => setShowCreate(false)} onCreated={() => void load()} />}
    </div>
  );
}

function CreateStudentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson("admin-students", {
        method: "POST",
        token,
        body: { email, temporary_password: password, full_name: name || "Student", grade_level: grade || null },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  }

  return (
    <Modal title="Create Student" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="field-label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Temporary password</label>
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div>
            <label className="field-label">Full name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Grade</label>
            <input className="input" type="number" min={9} max={12} value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>
        </div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create Student"}</Button>
        </div>
      </form>
    </Modal>
  );
}
