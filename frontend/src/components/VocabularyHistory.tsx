import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../lib/supabase";
import { Button, Spinner } from "./ui";
import "../styles/vocabulary-history.css";

export interface StudyDay {
  date: string;
  total_due: number | null;
  studied_due: number;
  studied_cards: number;
  review_count: number;
  tracked_review_count: number;
  tracked_ms: number | null;
  average_card_ms: number | null;
}
export interface DeckDay { date: string; students_studied: number; students_with_due: number; students_unknown: number }
export interface HistoryStudent { student_id: string; full_name: string; history: StudyDay[] }
export interface HistoryDeck { id: string; name: string; history: DeckDay[]; students: HistoryStudent[] }

function dateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
function duration(ms: number | null) {
  if (ms == null) return "Not recorded";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function level(n: number, total: number | null) {
  return total == null ? "unknown" : total === 0 ? "none" : n === 0 ? "missed" : n >= total ? "complete" : "partial";
}

export function StudentStudyDays({ days }: { days: StudyDay[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <div className="vocab-history">
    <div className="vocab-week" role="group" aria-label="Cards studied out of cards due over the last seven days">
      {days.map(day => <button type="button" key={day.date} className={`vocab-day vocab-day--${level(day.studied_due, day.total_due)}`} aria-pressed={selected === day.date} onClick={() => setSelected(selected === day.date ? null : day.date)} title={`${day.date}: ${day.studied_due} of ${day.total_due ?? "unknown"} due cards studied`}>
        <span>{dateLabel(day.date)}</span><strong>{day.total_due == null ? "?" : day.total_due === 0 ? "—" : `${day.studied_due}/${day.total_due}`}</strong>
      </button>)}
    </div>
    <div className="vocab-history-table-wrap"><table className="table vocab-history-table"><caption>Daily study time (UTC)</caption><thead><tr><th>Day</th><th>Cards studied / due</th><th>Study time</th><th>Avg time / card</th><th>Timed reviews</th></tr></thead><tbody>
      {days.filter(d => !selected || d.date === selected).map(day => <tr key={day.date}><td>{dateLabel(day.date)}</td><td>{day.total_due == null ? "History unavailable" : day.total_due === 0 ? "No cards due" : `${day.studied_due} / ${day.total_due}`}</td><td>{duration(day.tracked_ms)}</td><td>{duration(day.average_card_ms)}</td><td>{day.tracked_review_count} / {day.review_count}</td></tr>)}
    </tbody></table></div>
    <p className="student-progress-footnote">Unique due cards, including new and overdue cards. Repeated reviews count once. Time sums recorded study responses; average divides that time by distinct cards with timing. Sprint reviews are excluded. “?” means historical scheduling data is unavailable.</p>
  </div>;
}

export function DeckStudyHistory({ deck }: { deck: HistoryDeck }) {
  const [selected, setSelected] = useState<string | null>(null);
  const day = deck.history?.find(d => d.date === selected);
  const groups = day ? [
    { title: "Studied", match: (d: StudyDay) => (d.total_due ?? 0) > 0 && d.studied_due > 0 },
    { title: "Did not study", match: (d: StudyDay) => (d.total_due ?? 0) > 0 && d.studied_due === 0 },
    { title: "No cards due · excluded", match: (d: StudyDay) => d.total_due === 0 },
    { title: "History unavailable", match: (d: StudyDay) => d.total_due == null },
  ] : [];
  return <div className="vocab-history">
    <div className="vocab-week" role="group" aria-label={`${deck.name}: students who studied over the last seven days`}>
      {deck.history?.map(d => <button type="button" key={d.date} className={`vocab-day vocab-day--${level(d.students_studied, d.students_with_due)}`} aria-pressed={selected === d.date} onClick={() => setSelected(selected === d.date ? null : d.date)} title={`${d.date}: ${d.students_studied} of ${d.students_with_due} students with due cards studied; ${d.students_unknown} unknown`}><span>{dateLabel(d.date)}</span><strong>{d.students_with_due ? `${d.students_studied}/${d.students_with_due}` : "—"}{d.students_unknown > 0 ? " ?" : ""}</strong></button>)}
    </div>
    {day && <section className="vocab-day-roster" aria-label={`Study participation on ${day.date}`}>
      <div className="toolbar"><strong>{dateLabel(day.date)} · {day.students_studied}/{day.students_with_due} students studied</strong><Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close day</Button></div>
      <div className="vocab-roster-groups">{groups.map(group => {
        const students = deck.students.filter(s => { const d = s.history.find(h => h.date === day.date); return d && group.match(d); });
        return <div key={group.title}><h4>{group.title} ({students.length})</h4>{students.length ? <ul>{students.map(s => <li key={s.student_id}><Link to={`/admin/students/${s.student_id}`}>{s.full_name}</Link></li>)}</ul> : <p className="muted">None</p>}</div>;
      })}</div>
    </section>}
  </div>;
}

export function StudentVocabularyHistory({ studentId }: { studentId: string }) {
  const [decks, setDecks] = useState<HistoryDeck[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setDecks(null); setError("");
    void getToken().then(token => fnJson<{ decks: HistoryDeck[] }>(`admin-vocab/assignments?student_id=${encodeURIComponent(studentId)}`, { token }))
      .then(data => { if (live) setDecks(data.decks); }).catch(e => { if (live) setError(e instanceof Error ? e.message : "Unable to load study history"); });
    return () => { live = false; };
  }, [studentId, attempt]);
  return <section className="student-progress-section" aria-label="Seven-day vocabulary study history"><h2>Vocabulary · last 7 days</h2>
    <p className="muted">Daily cards studied out of total due, study time, and average time per card (UTC).</p>
    {error ? <div role="alert" className="login-error">{error} <Button variant="outline" size="sm" onClick={() => setAttempt(n => n + 1)}>Retry</Button></div> : !decks ? <Spinner /> : !decks.length ? <p className="muted">No vocabulary decks assigned.</p> : decks.map(deck => <section key={deck.id} className="student-progress-section"><h3>{deck.name}</h3><StudentStudyDays days={deck.students.find(s => s.student_id === studentId)?.history ?? []} /></section>)}
  </section>;
}
