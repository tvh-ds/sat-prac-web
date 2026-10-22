import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { StudentClass } from "../../lib/types";
import { Button, Modal, Spinner, fmtDate } from "../../components/ui";

import VocabularyAssignments from "./VocabularyAssignments";

type Student = { id: string; full_name: string | null; email: string | null };
type Assignment = { id: string; title: string; kind: "practice" | "full"; assigned_at: string; timer_minutes?: number };

export default function ClassesPanel({ students }: { students: Student[] | null }) {
  const [params, setParams] = useSearchParams(), selectedId = params.get("class_id");
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [editing, setEditing] = useState<StudentClass | "new" | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  async function load() {
    try { setError(null); const token = await getToken(); setClasses((await fnJson<{ classes: StudentClass[] }>("admin-classes", { token })).classes); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load classes"); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let live = true;
    setAssignments(null); setHistoryError(null);
    if (selectedId) void getToken().then((token) => fnJson<{ assignments: Assignment[] }>(`admin-classes/${selectedId}`, { token }))
      .then((data) => { if (live) setAssignments(data.assignments); })
      .catch((e) => { if (live) setHistoryError(e instanceof Error ? e.message : "Unable to load assignments"); });
    return () => { live = false; };
  }, [selectedId]);
  const selected = classes?.find((cls) => cls.id === selectedId);
  const members = (students ?? []).filter((s) => selected?.student_ids.includes(s.id));
  return <section aria-label="Student classes">
    <div className="toolbar" style={{ justifyContent: "space-between" }}><p className="muted" style={{ margin: 0 }}>Group students and assign work to a whole class.</p><Button onClick={() => setEditing("new")} disabled={!students}>New Class</Button></div>
    {error && <div className="login-error" role="alert">{error} <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>}
    {!classes && !error && <Spinner />}
    {classes && !classes.length && <div className="card card-pad"><h2 style={{ marginTop: 0 }}>Create your first class</h2><p className="muted">Choose a class name and add students. Select the class when assigning a practice set or full-length test.</p></div>}
    {classes && classes.length > 0 && <div className="card card-pad" style={{ overflowX: "auto" }}><table className="table" style={{ minWidth: 640 }}><thead><tr><th>Class</th><th>Students</th><th>Created</th><th /></tr></thead><tbody>
      {classes.map((cls) => <tr key={cls.id} aria-selected={cls.id === selectedId}><td style={{ fontWeight: 600, minWidth: 220 }}>{cls.name}</td><td>{cls.student_ids.length}</td><td>{fmtDate(cls.created_at)}</td><td><Button variant={cls.id === selectedId ? "secondary" : "outline"} size="sm" onClick={() => setParams({ tab: "classes", class_id: cls.id })}>View class</Button></td></tr>)}
    </tbody></table></div>}
    {selected && <section style={{ marginTop: 28 }} aria-label={`${selected.name} details`}>
      <div className="toolbar" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0, overflowWrap: "anywhere" }}>{selected.name}</h2><Button variant="outline" onClick={() => setEditing(selected)} disabled={!students}>Edit class</Button></div>
      <h3>Students ({selected.student_ids.length})</h3>
      {students ? members.length ? <ul style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", paddingLeft: 20 }}>{members.map((s) => <li key={s.id}><Link to={`/admin/students/${s.id}?tab=manage`}>{s.full_name || s.email || "Student"}</Link></li>)}</ul> : <p className="muted">No members yet. Use Edit class to add students.</p> : <Spinner />}
      <h3 style={{ marginTop: 28 }}>All assigned practice sets and tests</h3><p className="muted">Original recipients stay the same when class members change.</p>
      {historyError && <div className="login-error" role="alert">{historyError}</div>}
      {!assignments && !historyError && <Spinner />}
      {assignments && !assignments.length && <p className="muted">No work assigned to this class yet. Select it in a practice set or test’s Assign dialog.</p>}
      {assignments && assignments.length > 0 && <div className="card card-pad" style={{ overflowX: "auto" }}><table className="table" style={{ minWidth: 640 }}><thead><tr><th>Assignment</th><th>Type</th><th>Assigned</th><th /></tr></thead><tbody>
        {assignments.map((a) => <tr key={`${a.kind}-${a.id}`}><td style={{ minWidth: 240 }}>{a.title}</td><td>{a.kind === "practice" ? `Practice · ${a.timer_minutes} min` : "Full-length test"}</td><td>{fmtDate(a.assigned_at)}</td><td><Link className="btn btn-outline btn-sm" to={`/admin/assignments/${a.kind}/${a.id}`}>Open assignment</Link></td></tr>)}
      </tbody></table></div>}
      <VocabularyAssignments key={selected.id} classId={selected.id} />
    </section>}
    {editing && students && <ClassEditor cls={editing === "new" ? null : editing} students={students} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await load(); setParams({ tab: "classes", class_id: id }); }} />}
  </section>;
}

function ClassEditor({ cls, students, onClose, onSaved }: { cls: StudentClass | null; students: Student[]; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [name, setName] = useState(cls?.name ?? ""), [selected, setSelected] = useState(new Set(cls?.student_ids ?? []));
  const [search, setSearch] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const filtered = students.filter((s) => `${s.full_name ?? ""} ${s.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const token = await getToken();
      const result = await fnJson<{ id: string }>(cls ? `admin-classes/${cls.id}` : "admin-classes", { method: cls ? "PUT" : "POST", token, body: { name: name.trim(), student_ids: [...selected] } });
      await onSaved(result.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save class"); setBusy(false); }
  }
  return <Modal title={cls ? "Edit class" : "New class"} onClose={busy ? () => {} : onClose}><form onSubmit={(e) => void save(e)} style={{ display: "grid", gap: 14 }}>
    <div><label htmlFor="class-name" className="field-label">Class name</label><input id="class-name" autoFocus className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="e.g. SAT Saturday" /></div>
    <div><label htmlFor="class-student-search" className="field-label">Students · {selected.size} selected</label><input id="class-student-search" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" /></div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setSelected((prev) => new Set([...prev, ...filtered.map((s) => s.id)]))}>Select all shown</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</Button></div>
    <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 10 }}>{filtered.map((s) => <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, overflowWrap: "anywhere" }}><input type="checkbox" disabled={busy} checked={selected.has(s.id)} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} /><span>{s.full_name || "Unnamed student"}<span className="muted" style={{ display: "block", fontSize: 12 }}>{s.email}</span></span></label>)}{!filtered.length && <p className="muted">{students.length ? "No students match this search." : "Create student accounts before adding members."}</p>}</div>
    {error && <div className="login-error" role="alert">{error}</div>}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save class"}</Button></div>
  </form></Modal>;
}
