import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, Clock3, Flame, ListChecks } from "lucide-react";
import { fnJson, getToken } from "../../lib/supabase";
import { EmptyState, Pill, Spinner, fmtDate, fmtSeconds } from "../../components/ui";
import "../../styles/student-progress.css";
import StudentInfoTab, { type AdminStudentInfo } from "./StudentInfoTab";

interface DetailStudent {
  id: string;
  email: string | null;
  full_name: string | null;
  phone_number: string | null;
  parent_name: string | null;
  parent_phone_number: string | null;
  profile_status: "incomplete" | "pending" | "approved" | null;
  profile_submitted_at: string | null;
  profile_approved_at: string | null;
  grade_level: string | null;
  school: string | null;
  created_at: string;
}

interface PracticeAssignmentProgress {
  assignment_id: string;
  test_id: string;
  title: string;
  assigned_at: string;
  due_at: string | null;
  status: string;
  attempt_status: string | null;
  started_at: string | null;
  submitted_at: string | null;
  raw_score: number | null;
  total_questions: number | null;
  accuracy: number | null;
  active_time_seconds: number | null;
  timer_minutes: number | null;
}

interface AssignedVocabDeckProgress {
  deck_id: string;
  name: string;
  card_count: number;
  due_remaining: number;
  reviewed_today: number;
  tracked_review_ms: number | null;
  tracked_review_count: number;
  today_status: "done_today" | "no_cards_due" | "due_remaining";
}

interface VocabularySummary {
  assigned_deck_count: number;
  decks_done_today: number;
  decks_with_due: number;
  cards_due_now: number;
  reviews_today: number;
  tracked_review_ms: number | null;
  tracked_review_count: number;
}

interface DetailResponse {
  student: DetailStudent;
  practice_assignments: PracticeAssignmentProgress[];
  vocabulary: {
    decks: AssignedVocabDeckProgress[];
    today: VocabularySummary;
    streak: { current: number; best: number };
  };
}

function formatTrackedTime(milliseconds: number | null): string {
  if (milliseconds == null) return "Not recorded";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function practiceStatusTone(status: string): "gray" | "green" | "amber" | "red" {
  if (status === "completed") return "green";
  if (status === "overdue" || status === "expired") return "red";
  if (status === "in_progress" || status === "submitted") return "amber";
  return "gray";
}

function practiceStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  return status.replace(/_/g, " ").replace(/^\w/, (first) => first.toUpperCase());
}

function vocabStatusLabel(deck: AssignedVocabDeckProgress): string {
  if (deck.today_status === "done_today") return "Done today";
  if (deck.today_status === "no_cards_due") return "No cards due today";
  return `${deck.due_remaining} due`;
}

export default function StudentDetailPage() {
  const { studentId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "info" ? "info" : "manage";
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    void (async () => {
      try {
        const token = await getToken();
        const detail = await fnJson<DetailResponse>(`admin-students/${studentId}`, { token });
        if (alive) setData(detail);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load student progress");
      }
    })();
    return () => { alive = false; };
  }, [studentId]);

  async function refresh() {
    const token = await getToken();
    const detail = await fnJson<DetailResponse>(`admin-students/${studentId}`, { token });
    setData(detail);
  }

  if (error) return <div className="login-error" role="alert">{error}</div>;
  if (!data) return <Spinner />;

  const practice = data.practice_assignments ?? [];
  const vocabulary = data.vocabulary;
  const completedPractice = practice.filter((assignment) => assignment.status === "completed").length;
  const today = vocabulary.today;
  const caughtUpDecks = Math.max(0, today.assigned_deck_count - today.decks_with_due);
  const timedReviewCaption = today.reviews_today === 0
    ? "No assigned-deck reviews today"
    : `${today.tracked_review_count} of ${today.reviews_today} reviews timed`;

  return (
    <div className="student-progress-page">
      <Link to="/admin/students" className="muted student-progress-back">← Students</Link>
      <div className="student-progress-heading">
        <div>
          <h1 className="page-title">{data.student.full_name ?? "Student"}</h1>
          <p className="page-sub">
            {data.student.email ?? "No email"} · {data.student.grade_level ?? "No grade"} · {data.student.school ?? "No school"}
          </p>
        </div>
        <Pill tone={data.student.profile_status === "approved" ? "green" : data.student.profile_status === "pending" ? "amber" : "gray"}>
          {data.student.profile_status === "approved" ? "Profile approved" : data.student.profile_status === "pending" ? "Profile pending" : "Profile incomplete"}
        </Pill>
      </div>
      <div className="student-detail-tabs" role="tablist" aria-label="Student details">
        <button type="button" role="tab" aria-selected={activeTab === "manage"} className={activeTab === "manage" ? "active" : ""} onClick={() => setSearchParams({ tab: "manage" })}>Manage</button>
        <button type="button" role="tab" aria-selected={activeTab === "info"} className={activeTab === "info" ? "active" : ""} onClick={() => setSearchParams({ tab: "info" })}>Info</button>
      </div>
      {activeTab === "info" ? (
        <StudentInfoTab
          student={data.student as AdminStudentInfo}
          onRefresh={refresh}
          onDeleted={() => navigate("/admin/students", { replace: true })}
        />
      ) : <>
      <p className="student-progress-joined">Student since {fmtDate(data.student.created_at)}</p>

      <section className="student-progress-summary" aria-label="Progress summary">
        <article className="student-progress-metric">
          <div className="student-progress-metric-label"><ListChecks size={17} aria-hidden="true" /> Practice sets</div>
          <div className="student-progress-metric-value">{completedPractice}<span> / {practice.length}</span></div>
          <p>{plural(practice.length, "assignment")} completed</p>
        </article>
        <article className="student-progress-metric">
          <div className="student-progress-metric-label"><BookOpen size={17} aria-hidden="true" /> Decks caught up</div>
          <div className="student-progress-metric-value">
            {today.assigned_deck_count > 0 ? <>{caughtUpDecks}<span> / {today.assigned_deck_count}</span></> : "—"}
          </div>
          <p>
            {today.assigned_deck_count === 0
              ? "No assigned decks"
              : `${today.decks_done_today} finished today · ${plural(today.cards_due_now, "card")} due now`}
          </p>
        </article>
        <article className="student-progress-metric">
          <div className="student-progress-metric-label"><Clock3 size={17} aria-hidden="true" /> Tracked review time today</div>
          <div className="student-progress-metric-value student-progress-time">{formatTrackedTime(today.tracked_review_ms)}</div>
          <p>{timedReviewCaption}</p>
        </article>
        <article className="student-progress-metric">
          <div className="student-progress-metric-label"><Flame size={17} aria-hidden="true" /> Overall vocab streak</div>
          <div className="student-progress-metric-value">{plural(vocabulary.streak.current, "day")}</div>
          <p>Best: {plural(vocabulary.streak.best, "day")}</p>
        </article>
      </section>

      <section className="student-progress-section" aria-labelledby="practice-progress-title">
        <div className="student-progress-section-head">
          <div>
            <h2 id="practice-progress-title">Assigned practice sets</h2>
            <p>Latest attempt status, score, and saved active time for each assignment.</p>
          </div>
          <span className="student-progress-count">{practice.length}</span>
        </div>
        {practice.length === 0 ? (
          <div className="card card-pad"><EmptyState title="No practice sets assigned" body="Practice-set assignments for this student will appear here." /></div>
        ) : (
          <div className="card card-pad student-progress-panel">
            <div className="student-progress-table-wrap">
              <table className="table student-progress-table">
                <thead>
                  <tr><th>Practice set</th><th>Status</th><th>Latest score</th><th>Active time</th><th>Due</th></tr>
                </thead>
                <tbody>
                  {practice.map((assignment) => (
                    <tr key={assignment.assignment_id}>
                      <td>
                        <strong className="student-progress-name">{assignment.title}</strong>
                        <span className="student-progress-meta">Assigned {fmtDate(assignment.assigned_at)}</span>
                      </td>
                      <td><Pill tone={practiceStatusTone(assignment.status)}>{practiceStatusLabel(assignment.status)}</Pill></td>
                      <td>
                        {assignment.raw_score != null && assignment.total_questions != null
                          ? <>{assignment.raw_score}/{assignment.total_questions}{assignment.accuracy != null ? <span className="student-progress-meta">{assignment.accuracy}%</span> : null}</>
                          : "—"}
                      </td>
                      <td>{assignment.active_time_seconds == null ? "Not recorded" : fmtSeconds(assignment.active_time_seconds)}</td>
                      <td>{assignment.due_at ? fmtDate(assignment.due_at) : "No due date"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="student-progress-section" aria-labelledby="vocabulary-progress-title">
        <div className="student-progress-section-head">
          <div>
            <h2 id="vocabulary-progress-title">Assigned vocabulary decks</h2>
            <p>Due cards and review activity for today (UTC). Time sums recorded card-response durations.</p>
          </div>
          <span className="student-progress-count">{vocabulary.decks.length}</span>
        </div>
        {vocabulary.decks.length === 0 ? (
          <div className="card card-pad"><EmptyState title="No vocabulary decks assigned" body="Assigned active decks will appear here, with daily review status and tracked time." /></div>
        ) : (
          <div className="card card-pad student-progress-panel">
            <div className="student-progress-table-wrap">
              <table className="table student-progress-table student-vocab-progress-table">
                <thead>
                  <tr><th>Deck</th><th>Today</th><th>Cards due</th><th>Reviews today</th><th>Tracked time today</th></tr>
                </thead>
                <tbody>
                  {vocabulary.decks.map((deck) => (
                    <tr key={deck.deck_id}>
                      <td>
                        <strong className="student-progress-name">{deck.name}</strong>
                        <span className="student-progress-meta">{plural(deck.card_count, "card")} total</span>
                      </td>
                      <td>
                        <Pill tone={deck.today_status === "done_today" ? "green" : deck.today_status === "due_remaining" ? "amber" : "gray"}>
                          {vocabStatusLabel(deck)}
                        </Pill>
                      </td>
                      <td>{deck.due_remaining}</td>
                      <td>{deck.reviewed_today}</td>
                      <td>
                        {formatTrackedTime(deck.tracked_review_ms)}
                        {deck.tracked_review_ms != null && deck.tracked_review_count < deck.reviewed_today && (
                          <span className="student-progress-meta">{deck.tracked_review_count}/{deck.reviewed_today} timed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="student-progress-footnote">Review time is an estimate from recorded responses, not elapsed session time. The streak includes activity across all vocabulary decks.</p>
      </section>
      </>}
    </div>
  );
}
