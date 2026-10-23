import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, EmptyState, Pill, Spinner } from "../../components/ui";
import "../../styles/student-progress.css";

import { DeckStudyHistory, StudentStudyDays } from "../../components/VocabularyHistory";

import { dailyVocabulary, studyDuration, type VocabDeckProgress as DeckProgress, type VocabReport as Report } from "../../lib/adminProgress";
import { adminReturnPath } from "../../lib/adminNavigation";

function trackedTime(ms: number | null) {
  if (ms == null) return "Not recorded";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
}

function completionSummary(deck: DeckProgress) {
  const eligible = deck.students.filter(student => (student.history.at(-1)?.total_due ?? 0) > 0);
  return eligible.length ? `${eligible.filter(student => student.remaining_today === 0 && student.reviewed_today > 0).length}/${eligible.length}` : "—";
}

export default function VocabularyAssignments({ classId: selectedClassId, returnTo }: { classId?: string; returnTo?: string } = {}) {
  const location = useLocation();
  const { deckId } = useParams<{ deckId: string }>();
  const [searchParams] = useSearchParams();
  const classId = selectedClassId ?? searchParams.get("class_id") ?? "";
  const classQuery = classId ? `?class_id=${encodeURIComponent(classId)}` : "";
  const source = returnTo ?? location.pathname + location.search;
  const back = adminReturnPath(searchParams.get("return_to"), `/admin/assignments?tab=vocabulary${classId ? `&class_id=${encodeURIComponent(classId)}` : ""}`);
  const deckLink = (id: string) => `/admin/assignments/vocabulary/${id}?${new URLSearchParams({ ...(classId ? { class_id: classId } : {}), return_to: source })}`;
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allAssigned, setAllAssigned] = useState(true);
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
    {deckId && <Link className="student-progress-back muted" to={back}>← Back to vocabulary assignments</Link>}
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
            <thead><tr><th>Deck</th><th>Students with cards remaining</th><th>Completed / known due today</th><th>Cards remaining today</th><th>Reviews today</th><th>Last 7 days · studied / due students</th><th /></tr></thead>
            <tbody>{decks.map(d => <tr key={d.id}>
              <td><Link className="student-progress-name" to={deckLink(d.id)}>{d.name}</Link><span className="student-progress-meta">{d.card_count} cards · {d.student_count} students</span></td>
              <td>{d.students_with_due}</td><td>{completionSummary(d)}</td><td>{d.remaining_today}</td><td>{d.reviewed_today}</td><td><DeckStudyHistory deck={d} /></td>
              <td><div style={{ display: "flex", gap: 8 }}><Link className="btn btn-outline btn-sm" to={deckLink(d.id)}>View progress</Link><Button variant="danger" size="sm" disabled={!!deleting} aria-label={`Delete vocabulary assignment ${d.name}`} onClick={() => void deleteAssignments(d)}>{deleting === d.id ? "Deleting…" : "Delete"}</Button></div></td>
          </tr>)}</tbody>
          </table>
        </div></div>}
      <p className="student-progress-footnote">Each day shows students who studied out of students with due cards. Select a day to view names. Days with no due cards are excluded. Daily completion ratios exclude unavailable due history; every student is still listed below. All dates use UTC.</p>
    </>}
    {(deck ? [deck] : decks).map(deck => <section key={deck.id} className="student-progress-section">
      {!deckId && <h2>{deck.name} · all students</h2>}
      {deckId && <><h2>Last 7 days</h2><p className="muted">Students who studied / students with cards due. Select a day to see who studied and who did not. Students with no due cards are excluded.</p><DeckStudyHistory key={deck.id} deck={deck} /></>}
      <div className="student-progress-section-head"><div><h2>Student progress today</h2><p>{deck.student_count} students · {deck.students_done_today} done today · {deck.reviewed_today} reviews · {trackedTime(deck.tracked_review_ms)} tracked</p></div></div>
      <div className="card card-pad student-progress-panel"><div className="student-progress-table-wrap">
        <table className="table student-progress-table">
          <thead><tr><th>Student</th><th>Today</th><th>Due cards reviewed today</th><th>Remaining today</th><th>Due now</th><th>Due later today</th><th>New cards</th><th>Study time today</th><th>Avg time / card</th><th>Last 7 days · cards studied / due</th></tr></thead>
          <tbody>{deck.students.map(s => { const day = dailyVocabulary([s]); return <tr key={s.student_id}>
            <td><Link className="student-progress-name" to={`/admin/students/${s.student_id}?return_to=${encodeURIComponent(location.pathname + location.search)}`}>{s.full_name}</Link></td>
            <td><Pill tone={day.status === "Completed" ? "green" : day.remaining > 0 ? "amber" : "gray"}>{day.status}</Pill></td>
            <td>{day.total == null ? `${day.reviewed} / unknown` : day.total === 0 ? "No cards due" : `${day.reviewed}/${day.total}`}</td>
            <td>{s.remaining_today}</td><td>{s.due_remaining + s.new_remaining}</td><td>{s.due_later_today}</td><td>{s.new_remaining}</td>
            <td>{studyDuration(day.time)}</td><td>{studyDuration(day.average)}</td>
            <td><details><summary>Study history and daily time</summary><StudentStudyDays days={s.history ?? []} /></details></td>
          </tr>; })}</tbody>
        </table>
      </div></div>
      <p className="student-progress-footnote">Review time sums recorded responses, not elapsed session time. Click a student's name to open their full progress.</p>
    </section>)}
  </div>;
}
