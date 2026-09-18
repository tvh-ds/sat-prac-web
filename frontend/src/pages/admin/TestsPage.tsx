import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, Modal, Pill, Spinner, fmtDate } from "../../components/ui";

interface TestRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_public: boolean;
  created_at: string;
  answer_key_status?: "complete" | "partial" | "missing" | null;
  sections: Array<{ name: string; section_type: string; modules: Array<{ id: string; name: string; time_limit_minutes: number; is_adaptive: boolean }> }>;
}

interface StudentOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

type Scope = "full_test" | "reading_writing" | "math" | "custom_modules";

export default function TestsPage() {
  const [tests, setTests] = useState<TestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<TestRow | null>(null);

  async function load() {
    const token = await getToken();
    const d = await fnJson<{ tests: TestRow[] }>("admin-tests", { token });
    setTests(d.tests);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function publish(t: TestRow) {
    const token = await getToken();
    await fnJson(`admin-tests/${t.id}/publish`, { method: "POST", token });
    void load();
  }

  async function archive(t: TestRow) {
    const token = await getToken();
    await fnJson(`admin-tests/${t.id}`, { method: "PATCH", token, body: { status: "archived" } });
    void load();
  }

  return (
    <div>
      <div className="section-label">Tests</div>
      <h1 className="page-title"><span className="hl-muted">Full-length</span> <span className="hl-bright">tests</span></h1>
      <p className="page-sub">Approving a PDF import's full draft lands it here. Edit it in the builder, then assign students.</p>

      {error && <div className="login-error">{error}</div>}
      {!tests && <Spinner />}

      {tests && (
        <div className="card card-pad">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Answer key</th>
                <th>Visibility</th>
                <th>Structure</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => {
                const modules = t.sections.flatMap((s) => s.modules);
                const moduleNames = modules.map((m) => m.name).join(", ");
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.title}</td>
                    <td>
                      <Pill tone={t.status === "published" ? "green" : t.status === "archived" ? "gray" : "amber"}>
                        {t.status}
                      </Pill>
                    </td>
                    <td>
                      {t.answer_key_status ? (
                        <Pill tone={t.answer_key_status === "complete" ? "green" : t.answer_key_status === "partial" ? "amber" : "red"}>
                          {t.answer_key_status}
                        </Pill>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{t.is_public ? "Public" : "Assigned only"}</td>
                    <td>
                      {t.sections.length === 0
                        ? "No modules yet"
                        : `${t.sections.length} section(s), ${modules.length} module(s)`}
                    </td>
                    <td>
                      {fmtDate(t.created_at)}
                      {moduleNames && <div className="muted" style={{ fontSize: 12, maxWidth: 200 }}>{moduleNames}</div>}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Link to={`/admin/tests/${t.id}/build`}>
                          <Button variant="outline" size="sm">Edit</Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={t.status !== "published"}
                          title={t.status === "published" ? "Assign this test to students" : "Publish the test first"}
                          onClick={() => setAssigning(t)}
                        >
                          Assign
                        </Button>
                        {t.status === "draft" && (
                          <Button variant="outline" size="sm" onClick={() => void publish(t)}>Publish</Button>
                        )}
                        {t.status === "published" && (
                          <Button variant="ghost" size="sm" onClick={() => void archive(t)}>Archive</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tests.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 30 }}>
                    No full-length tests yet. Import a PDF and approve its full draft from the PDF Imports page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <AssignModal
          test={assigning}
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

function AssignModal({ test, onClose, onDone }: { test: TestRow; onClose: () => void; onDone: () => void }) {
  const [students, setStudents] = useState<StudentOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>("full_test");
  const [customModules, setCustomModules] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const modules = test.sections.flatMap((s) => s.modules.map((m) => ({ ...m, section: s.section_type === "math" ? "Math" : "R&W" })));

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

  function toggleStudent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleModule(id: string) {
    setCustomModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const scopeLabel: Record<Scope, string> = {
    full_test: "Full test",
    reading_writing: "Reading & Writing only",
    math: "Math only",
    custom_modules: "Selected modules",
  };

  async function save() {
    if (selected.size === 0) {
      setError("Select at least one student");
      return;
    }
    if (scope === "custom_modules" && customModules.size === 0) {
      setError("Select at least one module");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const d = await fnJson<{ assigned: number }>(`admin-tests/${test.id}/assignees`, {
        method: "POST",
        token,
        body: {
          student_ids: [...selected],
          content_scope: scope,
          ...(scope === "custom_modules" ? { module_ids: [...customModules] } : {}),
        },
      });
      setSuccess(`${d.assigned} student(s) assigned — ${scopeLabel[scope]}${scope === "custom_modules" ? ` (${customModules.size} modules)` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Assign — ${test.title}`}
      onClose={onClose}
      footer={
        <>
          {success && <span style={{ color: "var(--color-success)", fontSize: 13, marginRight: "auto" }}>{success}</span>}
          {!success && <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>}
          {!success && <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Assign"}</Button>}
          {success && <Button onClick={() => { onClose(); onDone(); }}>Done</Button>}
        </>
      }
    >
      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <h4 style={{ margin: "16px 0 8px" }}>1. Students</h4>
      {!students && <Spinner />}
      {students && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
          {students.map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 13.5 }}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleStudent(s.id)} />
              <span style={{ fontWeight: 500 }}>{s.full_name ?? "Unnamed"}</span>
              <span className="muted">{s.email}</span>
            </label>
          ))}
          {students.length === 0 && <span className="muted">No students yet.</span>}
        </div>
      )}

      <h4 style={{ margin: "16px 0 8px" }}>2. Scope</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(Object.keys(scopeLabel) as Scope[]).map((key) => (
          <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 13.5 }}>
            <input type="radio" name="scope" checked={scope === key} onChange={() => setScope(key)} />
            <span style={{ fontWeight: 500 }}>{scopeLabel[key]}</span>
            {key === "reading_writing" && <span className="muted">Math modules hidden from these students</span>}
            {key === "math" && <span className="muted">Reading &amp; Writing modules hidden from these students</span>}
          </label>
        ))}
      </div>

      {scope === "custom_modules" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
          {modules.map((m) => (
            <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 13.5 }}>
              <input type="checkbox" checked={customModules.has(m.id)} onChange={() => toggleModule(m.id)} />
              <span style={{ fontWeight: 500 }}>{m.name}</span>
              <span className="muted">{m.section}</span>
            </label>
          ))}
          {modules.length === 0 && <span className="muted">This test has no modules.</span>}
        </div>
      )}
    </Modal>
  );
}
