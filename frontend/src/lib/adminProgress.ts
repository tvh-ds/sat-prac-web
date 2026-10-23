export interface StudyDay {
  date: string;
  total_due: number | null;
  studied_due: number;
  studied_cards: number;
  review_count: number;
  tracked_review_count: number;
  timed_card_count?: number;
  tracked_ms: number | null;
  average_card_ms: number | null;
}
export interface DeckDay { date: string; students_studied: number; students_with_due: number; students_unknown: number }

export interface AssignmentProgress {
  assignment_id: string; student_id: string; test_id: string; kind: "practice" | "full";
  batch_id: string | null; title: string; class_id: string | null; class_name: string | null;
  assigned_at: string; due_at: string | null; status: string; attempt_id: string | null;
  raw_score: number | null; total_questions: number | null; accuracy: number | null;
  active_time_seconds: number | null;
}
export interface ProgressStudent {
  id: string; full_name: string | null; email: string | null;
  assignment_progress?: AssignmentProgress[];
}
export interface VocabStudentProgress {
  student_id: string; full_name: string; history: StudyDay[];
  due_remaining: number; due_later_today: number; new_remaining: number; remaining_today: number;
  reviewed_today: number; tracked_review_ms: number | null; tracked_review_count: number;
  today_status: string;
}
export interface VocabDeckProgress {
  id: string; name: string; history: DeckDay[]; students: VocabStudentProgress[];
  description: string | null; card_count: number; student_count: number;
  students_done_today: number; students_with_due: number; remaining_today: number;
  reviewed_today: number; tracked_review_ms: number | null;
}
export interface VocabReport { date: string; decks: VocabDeckProgress[] }

export function dailyVocabulary(rows: VocabStudentProgress[]) {
  const days = rows.map(row => row.history[row.history.length - 1]);
  const known = days.every(day => day != null && day.total_due != null);
  const reviewed = days.reduce((sum, day) => sum + (day?.studied_due ?? 0), 0);
  const total = known ? days.reduce((sum, day) => sum + day.total_due!, 0) : null;
  const remaining = rows.reduce((sum, row) => sum + row.remaining_today, 0);
  const timed = days.reduce((sum, day) => sum + (day?.tracked_review_count ?? 0), 0);
  const time = timed ? days.reduce((sum, day) => sum + (day?.tracked_ms ?? 0), 0) : null;
  // Average time is weighted by distinct timed cards, not by reviews or decks.
  const timedCards = days.reduce((sum, day) => sum + (day?.timed_card_count ?? 0), 0);
  const started = rows.some(row => row.reviewed_today > 0);
  const status = !rows.length ? "No decks assigned" : remaining > 0 ? started ? "In progress" : "Not started" : started ? "Completed" : !known ? "History unavailable" : "No cards due";
  return { total, reviewed, remaining, time, average: timedCards > 0 && time != null ? Math.round(time / timedCards) : null,
    dueNow: rows.reduce((sum, row) => sum + row.due_remaining + row.new_remaining, 0),
    dueLater: rows.reduce((sum, row) => sum + row.due_later_today, 0), status };
}

export function studyDuration(ms: number | null) {
  if (ms == null) return "Not recorded";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function assignmentCounts(rows: AssignmentProgress[], kind: "practice" | "full") {
  const assigned = rows.filter(row => row.kind === kind);
  return `${assigned.filter(row => row.status === "completed").length}/${assigned.length}`;
}
