import { deferComponent } from "../../components/deferComponent";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import { Button, Pill, Spinner, fmtDate, fmtSeconds } from "../../components/ui";
import StudentInfoTab, { type AdminStudentInfo } from "./StudentInfoTab";
const AssignmentReviewModal = deferComponent(() => import("./AssignmentReviewModal"));
import ClassBadge from "../../components/ClassBadge";
import { StudentStudyDays } from "../../components/VocabularyHistory";
import { assignmentCounts, dailyVocabulary, studyDuration, type AssignmentProgress, type VocabStudentProgress } from "../../lib/adminProgress";
import { adminReturnPath } from "../../lib/adminNavigation";
import "../../styles/student-progress.css";
import "../../styles/admin-progress.css";

type Deck = VocabStudentProgress & { deck_id: string; name: string; card_count: number };
interface DetailResponse {
  student: AdminStudentInfo;
  practice_assignments: AssignmentProgress[];
  full_assignments: AssignmentProgress[];
  vocabulary: { decks: Deck[]; streak: { current: number; best: number } };
}

export default function StudentDetailPage() {
  const { studentId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const profileTab = params.get("tab") === "info";
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<AssignmentProgress | null>(null);
  const back = adminReturnPath(params.get("return_to"), "/admin/students");
  const update = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value && value !== "all") next.set(key, value); else next.delete(key); return next; }, { replace: true });
  async function refresh() {
    setData(await fnJson<DetailResponse>(`admin-students/${studentId}`, { token: await getToken() }));
  }
  useEffect(() => {
    let live = true;
    setData(null); setError(""); setReviewing(null);
    void getToken().then(token => fnJson<DetailResponse>(`admin-students/${studentId}`, { token }))
      .then(result => { if (live) setData(result); }).catch(e => { if (live) setError(e instanceof Error ? e.message : "Unable to load student progress"); });
    return () => { live = false; };
  }, [studentId]);
  if (error) return <div role="alert" className="login-error">{error} <Link to={back}>Go back</Link></div>;
  if (!data) return <Spinner />;
  const assignments = [...data.practice_assignments, ...(data.full_assignments ?? [])].sort((a, b) => b.assigned_at.localeCompare(a.assigned_at));
  const kind = params.get("kind") ?? "all", status = params.get("status") ?? "all", search = params.get("search") ?? "";
  const visible = assignments.filter(a => (kind === "all" || a.kind === kind) && (status === "all" || (status === "outstanding" ? a.status !== "completed" : a.status === status)) && a.title.toLowerCase().includes(search.toLowerCase()));
  const daily = dailyVocabulary(data.vocabulary.decks);
  return <div className="student-progress-page">
    <Link to={back} className="student-progress-back muted">← {back.startsWith("/admin/classes") ? "Back to class" : back.startsWith("/admin/assignments") ? "Back to assignment" : "Students"}</Link>
    <div className="student-progress-heading"><div><h1 className="page-title">{data.student.full_name ?? "Student"}</h1><p className="page-sub">{data.student.email} · {data.student.grade_level ?? "No grade"} · {data.student.school ?? "No school"}</p></div><Pill tone={data.student.profile_status === "approved" ? "green" : "gray"}>Profile {data.student.profile_status ?? "incomplete"}</Pill></div>
    <nav className="admin-work-tabs" aria-label="Student details"><button type="button" className="btn btn-outline" aria-current={!profileTab ? "page" : undefined} onClick={() => update("tab", "manage")}>Progress</button><button type="button" className="btn btn-outline" aria-current={profileTab ? "page" : undefined} onClick={() => update("tab", "info")}>Profile</button></nav>
    {profileTab ? <StudentInfoTab student={data.student} onRefresh={refresh} onDeleted={() => navigate("/admin/students", { replace: true })} /> : <>
      <div className="admin-class-summary"><span><strong>{assignmentCounts(assignments, "practice")}</strong>Practice completed / assigned</span><span><strong>{assignmentCounts(assignments, "full")}</strong>Tests completed / assigned</span><span><strong>{daily.remaining}</strong>Vocabulary cards remaining today</span><span><strong>{studyDuration(daily.time)}</strong>Vocabulary study time today</span></div>
      <section aria-labelledby="assignment-progress-title"><h2 id="assignment-progress-title">All assigned practice sets and tests</h2><p className="muted">Complete retained assignment history, including completed work and assignments without attempts.</p>
        <div className="toolbar admin-progress-filters"><label>Find assignment<input className="input" type="search" value={search} placeholder="Assignment title" onChange={e => update("search", e.target.value)} /></label><label>Type<select className="select" value={kind} onChange={e => update("kind", e.target.value)}><option value="all">All types</option><option value="practice">Practice sets</option><option value="full">Full-length tests</option></select></label><label>Status<select className="select" value={status} onChange={e => update("status", e.target.value)}><option value="all">All statuses</option><option value="completed">Completed</option><option value="outstanding">Outstanding</option><option value="in_progress">In progress</option><option value="overdue">Overdue</option></select></label><span className="muted">{visible.length} of {assignments.length} assignments</span></div>
        <div className="admin-progress-scroll"><table className="table admin-progress-table"><thead><tr><th>Assignment</th><th>Type</th><th>Status</th><th>Score</th><th>Recorded active time</th><th>Due</th><th /></tr></thead><tbody>{visible.map(a => <tr key={a.assignment_id}>
          <td><strong>{a.title}</strong><ClassBadge {...a} /><small className="admin-progress-meta">Assigned {fmtDate(a.assigned_at)}</small></td><td>{a.kind === "practice" ? "Practice set" : "Full-length test"}</td>
          <td><Pill tone={a.status === "completed" ? "green" : a.status === "overdue" ? "red" : "gray"}>{a.status === "assigned" ? "Not started" : a.status.replace(/_/g, " ").replace(/^./, c => c.toUpperCase())}</Pill></td>
          <td>{a.raw_score == null ? "—" : <>{a.raw_score}/{a.total_questions}<small className="admin-progress-meta">{a.accuracy}%</small></>}</td>
          <td>{a.active_time_seconds == null ? "Not recorded" : a.active_time_seconds === 0 ? "0s recorded" : fmtSeconds(a.active_time_seconds)}</td><td>{a.due_at ? fmtDate(a.due_at) : "No due date"}</td>
          <td><Button variant="outline" size="sm" disabled={!a.attempt_id || a.raw_score == null} onClick={() => setReviewing(a)}>Review answers</Button></td>
        </tr>)}</tbody></table>{visible.length === 0 && <p className="muted">No assignments match this view.</p>}</div>
        <p className="admin-progress-note">Recorded active time is saved module timing. A recorded zero does not prove that no time was spent studying.</p>
      </section>
      <section className="student-progress-section" aria-labelledby="vocabulary-progress-title"><h2 id="vocabulary-progress-title">Daily vocabulary progress</h2><p className="muted">All assigned decks · today (UTC). New and overdue cards count toward today’s work.</p>
        <div className="admin-progress-scroll"><table className="table admin-progress-table"><thead><tr><th>Deck</th><th>Today</th><th>Due cards reviewed</th><th>Remaining today</th><th>Due now</th><th>Due later today</th><th>Study time</th><th>Avg time / card</th></tr></thead><tbody>{data.vocabulary.decks.map(deck => { const day = dailyVocabulary([deck]); return <tr key={deck.deck_id}>
          <td>{deck.name}</td><td><Pill tone={day.status === "Completed" ? "green" : day.remaining > 0 ? "amber" : "gray"}>{day.status}</Pill></td><td>{day.total == null ? `${day.reviewed} / unknown` : day.total === 0 ? "No cards due" : `${day.reviewed}/${day.total}`}</td><td>{day.remaining}</td><td>{day.dueNow}</td><td>{day.dueLater}</td><td>{studyDuration(day.time)}</td><td>{studyDuration(day.average)}</td>
        </tr>; })}</tbody></table>{data.vocabulary.decks.length === 0 && <p className="muted">No vocabulary decks assigned.</p>}</div>
        <p className="admin-progress-note">Reviews count distinct due cards. Study time sums recorded study responses, and the average uses distinct timed cards. Sprint reviews are excluded. Remaining includes cards scheduled for another review today. No cards due is separate from completed work.</p>
        <p className="admin-progress-note">Overall vocabulary streak: {data.vocabulary.streak.current} days · best: {data.vocabulary.streak.best} days.</p>
        <h3>Last seven days</h3>{data.vocabulary.decks.map(deck => <section className="admin-vocab-details" key={deck.deck_id}><h4>{deck.name}</h4><StudentStudyDays days={deck.history} compactTime /></section>)}
      </section>
    </>}
    {reviewing?.attempt_id && <AssignmentReviewModal title={`Review — ${reviewing.title}`} endpoint={`admin-students/${studentId}/attempts/${reviewing.attempt_id}`} onClose={() => setReviewing(null)} />}
  </div>;
}
