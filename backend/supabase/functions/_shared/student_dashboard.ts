export type DashboardState = "assigned" | "complete" | "overdue";
export type DashboardAttempt = { id: string; assignment_id: string | null; started_at: string; status: string };
export type DashboardAssignment = { id: string; test_id: string; due_at: string | null; status: string; test: { title: string; kind: string } | null };

export function dashboardState(status: string, attemptStatus: string | undefined, dueAt: string | null, now: Date): DashboardState {
  if (status === "completed" || attemptStatus === "submitted" || attemptStatus === "graded") return "complete";
  return dueAt && Date.parse(dueAt) < now.getTime() ? "overdue" : "assigned";
}

export function assignmentItems(assignments: DashboardAssignment[], attempts: DashboardAttempt[], now: Date) {
  const latest = new Map<string, DashboardAttempt>();
  for (const attempt of attempts) {
    if (!attempt.assignment_id) continue;
    const previous = latest.get(attempt.assignment_id);
    if (!previous || attempt.started_at > previous.started_at || (attempt.started_at === previous.started_at && attempt.id > previous.id)) {
      latest.set(attempt.assignment_id, attempt);
    }
  }
  return assignments.map((assignment) => {
    const attempt = latest.get(assignment.id);
    const kind = assignment.test?.kind === "practice" ? "practice" : "test";
    const state = dashboardState(assignment.status, attempt?.status, assignment.due_at, now);
    const href = attempt?.status === "in_progress"
      ? `/student/attempts/${attempt.id}/session`
      : attempt && (attempt.status === "graded" || attempt.status === "submitted")
      ? `/student/scores/${attempt.id}`
      : state === "complete" || !assignment.test
      ? `/student/${kind === "practice" ? "practice" : "tests"}`
      : `/student/${kind === "practice" ? "practice" : "tests"}/${assignment.test_id}/start?assignment=${assignment.id}`;
    return { id: assignment.id, title: assignment.test?.title ?? "Unavailable assignment", kind, due_at: assignment.due_at, state, href };
  });
}

export function validateTestDate(body: unknown, now: Date): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("test_date" in body)) {
    throw new Error("Provide only a test_date field.");
  }
  const value = (body as { test_date: unknown }).test_date;
  if (value === null) return null;
  const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today) {
    throw new Error("Choose today or a future test date.");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Choose a valid test date.");
  return value;
}
