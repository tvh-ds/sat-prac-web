import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, EmptyState, Pill, Spinner } from "../../components/ui";
import "../../styles/student-progress.css";

interface StudentProgress {
  student_id: string;
  full_name: string;
  due_remaining: number;
  due_later_today: number;
  new_remaining: number;
  remaining_today: number;
  reviewed_today: number;
  tracked_review_ms: number | null;
  tracked_review_count: number;
  today_status: string;
}
interface DeckProgress {
  id: string;
  name: string;
  description: string | null;
  card_count: number;
  student_count: number;
  students_done_today: number;
  students_with_due: number;
  remaining_today: number;
  reviewed_today: number;
  tracked_review_ms: number | null;
  students: StudentProgress[];
}
interface Report { date: string; decks: DeckProgress[] }

function trackedTime(ms: number | null) {
  if (ms == null) return "Not recorded";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
}

export default function VocabularyAssignments({ classId: selectedClassId }: { classId?: string } = {}) {
  const { deckId } = useParams<{ deckId: string }>();
  const [searchParams] = useSearchParams();
  const classId = selectedClassId ?? searchParams.get("class_id") ?? "";
  const classQuery = classId ? `?class_id=${encodeURIComponent(classId)}` : "";
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allAssigned, setAllAssigned] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      setData(await fnJson<Report>(`admin-vocab/assignments${deckId ? `/${deckId}` : ""}${classQuery}`, { token }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load vocabulary assignments"); }
    finally { setLoading(false); }
  }, [deckId, classQuery]);
  useEffect(() => { setData(null); void load(); }, [load]);

  const deck = deckId ? data?.decks[0] : null;
  const decks = data?.decks.filter(d => allAssigned || d.remaining_today > 0 || d.reviewed_today > 0) ?? [];
  async function deleteAssignments(d: DeckProgress) {
    if (deleting || !window.confirm(`Delete vocabulary assignment “${d.name}” for ${classId ? "students in the selected class" : "all assigned students"}? The deck and review history are kept. Students will lose access to this assigned deck.`)) return;
    setDeleting(d.id); setError(null); setNotice("");
    try {
      const token = await getToken();
      await fnJson(`admin-vocab/assignments/${d.id}${classQuery}`, { method: "DELETE", token });
      setData(prev => prev ? { ...prev, decks: prev.decks.filter(row => row.id !== d.id) } : null);
      setNotice(`Vocabulary assignment “${d.name}” deleted.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete vocabulary assignments. Please try again."); }
    finally { setDeleting(null); }
  }
  return <div className="student-progress-page">
    {deckId && <Link className="student-progress-back muted" to={`/admin/assignments?tab=vocabulary${classId ? `&class_id=${encodeURIComponent(classId)}` : ""}`}>← Vocabulary assignments</Link>}
    <div className="student-progress-heading">
      <div>
        {deckId ? <h1 className="page-title">{deck?.name ?? "Vocabulary progress"}</h1> : <h2>Assigned vocabulary decks</h2>}
        <p className="page-sub">{data ? `Today · ${data.date} (UTC)` : "Today's vocabulary work"}. Due work includes new cards, overdue cards, and cards scheduled later today.</p>
      </div>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</Button>
    </div>
    {error && <div className="login-error" role="alert">{error}<Button variant="ghost" onClick={() => void load()}>Try again</Button></div>}
    <div role="status" className="muted">{notice}</div>
    {classId && <p className="muted">Showing vocabulary progress for current members of the selected class.</p>}
    {!data && loading && <Spinner />}
    {data && !deckId && <>
      <div className="filter-row" style={{ marginTop: 16 }}>
        <Button variant={!allAssigned ? "primary" : "ghost"} onClick={() => setAllAssigned(false)}>Due today</Button>
        <Button variant={allAssigned ? "primary" : "ghost"} onClick={() => setAllAssigned(true)}>All assigned ({data.decks.length})</Button>
      </div>
      {decks.length === 0 ? <EmptyState title={allAssigned ? "No vocabulary decks assigned" : "No decks due today"} body={allAssigned ? "Assign a deck from Vocabulary to see student progress here." : "No assigned decks have work due or reviews today. Choose All assigned to see every assigned deck."} /> :
        <div className="card card-pad student-progress-panel"><div className="student-progress-table-wrap">
          <table className="table student-progress-table">
            <thead><tr><th>Deck</th><th>Students with work due</th><th>Done today</th><th>Cards remaining today</th><th>Reviews today</th><th /></tr></thead>
            <tbody>{decks.map(d => <tr key={d.id}>
              <td><Link className="student-progress-name" to={`/admin/assignments/vocabulary/${d.id}${classQuery}`}>{d.name}</Link><span className="student-progress-meta">{d.card_count} cards · {d.student_count} students</span></td>
              <td>{d.students_with_due}</td><td>{d.students_done_today}/{d.student_count}</td><td>{d.remaining_today}</td><td>{d.reviewed_today}</td>
              <td><div style={{ display: "flex", gap: 8 }}><Link className="btn btn-outline btn-sm" to={`/admin/assignments/vocabulary/${d.id}${classQuery}`}>View progress</Link><Button variant="danger" size="sm" disabled={!!deleting} aria-label={`Delete vocabulary assignment ${d.name}`} onClick={() => void deleteAssignments(d)}>{deleting === d.id ? "Deleting…" : "Delete"}</Button></div></td>
            </tr>)}</tbody>
          </table>
        </div></div>}
      <p className="student-progress-footnote">Decks reviewed today stay visible after their work is completed.</p>
    </>}
    {deck && <section className="student-progress-section">
      <div className="student-progress-section-head"><div><h2>Student progress today</h2><p>{deck.student_count} students · {deck.students_done_today} done today · {deck.reviewed_today} reviews · {trackedTime(deck.tracked_review_ms)} tracked</p></div></div>
      <div className="card card-pad student-progress-panel"><div className="student-progress-table-wrap">
        <table className="table student-progress-table">
          <thead><tr><th>Student</th><th>Today</th><th>Cards due now</th><th>Due later today</th><th>New cards</th><th>Reviews today</th><th>Tracked time today</th></tr></thead>
          <tbody>{deck.students.map(s => <tr key={s.student_id}>
            <td><Link className="student-progress-name" to={`/admin/students/${s.student_id}`}>{s.full_name}</Link></td>
            <td><Pill tone={s.remaining_today > 0 ? "amber" : s.today_status === "done_today" ? "green" : "gray"}>{s.remaining_today > 0 ? "Work remaining" : s.today_status === "done_today" ? "Done today" : "No cards due today"}</Pill></td>
            <td>{s.due_remaining}</td><td>{s.due_later_today}</td><td>{s.new_remaining}</td><td>{s.reviewed_today}</td>
            <td>{trackedTime(s.tracked_review_ms)}{s.tracked_review_ms != null && s.tracked_review_count < s.reviewed_today && <span className="student-progress-meta">{s.tracked_review_count}/{s.reviewed_today} timed</span>}</td>
          </tr>)}</tbody>
        </table>
      </div></div>
      <p className="student-progress-footnote">Review time sums recorded responses, not elapsed session time. Click a student's name to open their full progress.</p>
    </section>}
  </div>;
}
