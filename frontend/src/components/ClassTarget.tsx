import { useEffect, useState } from "react";
import { fnJson, getToken } from "../lib/supabase";
import type { StudentClass } from "../lib/types";

export default function ClassTarget({ value, onChange, disabled = false }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getToken().then((token) => fnJson<{ classes: StudentClass[] }>("admin-classes", { token }))
      .then((data) => { if (live) setClasses(data.classes); })
      .catch(() => { if (live) setError("Classes could not be loaded. Reopen this dialog to retry."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  const selected = classes.find((cls) => cls.id === value);
  return <div style={{ marginBottom: 16 }}>
    <label className="field-label" htmlFor="assignment-class">Assign to</label>
    <select id="assignment-class" className="input" value={value} disabled={disabled || loading} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose individual students</option>
      {classes.map((cls) => <option key={cls.id} value={cls.id} disabled={!cls.student_ids.length}>{cls.name} · {cls.student_ids.length} {cls.student_ids.length === 1 ? "student" : "students"}{!cls.student_ids.length ? " (empty)" : ""}</option>)}
    </select>
    {loading && <p className="muted" role="status">Loading classes…</p>}
    {error && <p role="alert" className="login-error">{error}</p>}
    {!loading && !error && !classes.length && <p className="muted">Create a class in Classes to assign work to a group.</p>}
    {selected && <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>{selected.student_ids.length === 1 ? "The current member" : `All ${selected.student_ids.length} current members`} of {selected.name} will receive this assignment. Later membership changes won’t change it.</p>}
  </div>;
}
