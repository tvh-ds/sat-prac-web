import { Link, useSearchParams } from "react-router-dom";
import { Pill } from "./ui";
import { assignmentCounts, dailyVocabulary, studyDuration, type ProgressStudent, type VocabReport } from "../lib/adminProgress";

export default function AdminStudentProgressTable({ students, vocabulary, returnTo }: { students: ProgressStudent[]; vocabulary: VocabReport | null; returnTo: string }) {
  const [params, setParams] = useSearchParams();
  const search = params.get("student_search") ?? "", status = params.get("student_status") ?? "all";
  const update = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value && value !== "all") next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const rows = students.map(student => ({ student, vocabulary: dailyVocabulary((vocabulary?.decks ?? []).flatMap(deck => deck.students.filter(row => row.student_id === student.id))) }));
  const visible = rows.filter(({ student, vocabulary: day }) => `${student.full_name ?? ""} ${student.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (status === "all" || vocabulary != null && day.status === status));
  return <>
    <div className="toolbar admin-progress-filters">
      <label>Find student<input className="input" type="search" value={search} onChange={event => update("student_search", event.target.value)} placeholder="Name or email" /></label>
      <label>Vocabulary today<select className="select" value={status} onChange={event => update("student_status", event.target.value)}><option value="all">All students</option>{["Not started", "In progress", "Completed", "No cards due", "No decks assigned", "History unavailable"].map(value => <option key={value}>{value}</option>)}</select></label>
      <span className="muted">{visible.length} of {students.length} students · {vocabulary?.date ?? "Today"} (UTC)</span>
    </div>
    <div className="admin-progress-scroll"><table className="table admin-progress-table">
      <thead><tr><th>Student</th><th>Practice completed</th><th>Tests completed</th><th>Vocabulary today</th><th>Due cards reviewed</th><th>Remaining today</th><th>Study time</th><th>Avg time / card</th><th /></tr></thead>
      <tbody>{visible.map(({ student, vocabulary: day }) => <tr key={student.id}>
        <td><Link to={`/admin/students/${student.id}?return_to=${encodeURIComponent(returnTo)}`}>{student.full_name || student.email || "Unnamed student"}</Link><small className="admin-progress-meta" title={student.email ?? undefined}>{student.email}</small></td>
        <td>{student.assignment_progress ? assignmentCounts(student.assignment_progress, "practice") : "Unavailable"}</td>
        <td>{student.assignment_progress ? assignmentCounts(student.assignment_progress, "full") : "Unavailable"}</td>
        <td>{vocabulary ? <Pill tone={day.status === "Completed" ? "green" : day.remaining > 0 ? "amber" : "gray"}>{day.status}</Pill> : "Unavailable"}</td>
        <td>{vocabulary ? day.total == null ? `${day.reviewed} / unknown` : day.total === 0 ? "No cards due" : `${day.reviewed}/${day.total}` : "—"}</td>
        <td>{vocabulary ? <>{day.remaining}<small className="admin-progress-meta">{day.dueNow} due now · {day.dueLater} later</small></> : "—"}</td>
        <td>{vocabulary ? studyDuration(day.time) : "—"}</td><td>{vocabulary ? studyDuration(day.average) : "—"}</td>
        <td><Link className="btn btn-outline btn-sm" to={`/admin/students/${student.id}?return_to=${encodeURIComponent(returnTo)}`}>View progress</Link></td>
      </tr>)}</tbody>
    </table>{visible.length === 0 && <p className="muted">{students.length ? "No students match these filters." : "No students yet."}</p>}</div>
    <p className="muted admin-progress-note">Completed / assigned includes all retained assignments for each student, including individual work and other classes. Vocabulary covers all their assigned decks. Remaining includes cards scheduled for another review today. No cards due and unavailable history are shown separately. Study time measures recorded study responses.</p>
  </>;
}
