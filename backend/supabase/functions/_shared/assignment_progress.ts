import type { serviceClient } from "./supabase.ts";
import { HttpError } from "./auth.ts";
import { latestAttempt, practiceAssignmentStatus, sumModuleTimeSeconds } from "./student_progress.ts";

// Stable ordering and explicit paging keep completed history beyond the API row cap.
export async function allProgressRows<T>(query: (start: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await query(start);
    if (result.error) throw new HttpError(500, "Unable to load student progress");
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

type Assignment = { id: string; student_id: string; test_id: string; assignment_batch_id: string | null; assigned_at: string; due_at: string | null; status: string };
type Test = { id: string; title: string; kind: "practice" | "full" };
type Attempt = { id: string; assignment_id: string | null; status: string; started_at: string; submitted_at: string | null };
type Score = { attempt_id: string; raw_score: number; total_questions: number };
type Batch = { id: string; snapshot_test_id: string; title: string; timer_minutes: number; class_id: string | null; class_name: string | null };
type FullBatch = { id: string; title: string; class_id: string | null; class_name: string | null };
type ModuleTime = { id: string; attempt_id: string; time_spent_seconds: number | null };

export async function progressRowsByIds<T>(svc: ReturnType<typeof serviceClient>, table: string, columns: string, column: string, ids: string[], order: string | string[] = "id"): Promise<T[]> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) rows.push(...await allProgressRows<T>(start => {
    let query = svc.from(table).select(columns).in(column, unique.slice(i, i + 200));
    for (const key of Array.isArray(order) ? order : [order]) query = query.order(key);
    return query.range(start, start + 499);
  }));
  return rows;
}

export async function progressUserEmails(svc: ReturnType<typeof serviceClient>) {
  const emails = new Map<string, string | undefined>();
  for (let page = 1; ; page++) {
    const users = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (users.error) throw new HttpError(500, "Unable to load student accounts");
    for (const user of users.data.users) emails.set(user.id, user.email);
    if (users.data.users.length < 1000) return emails;
  }
}

export async function loadAssignmentProgress(svc: ReturnType<typeof serviceClient>, now: Date, studentId?: string, includeTime = false) {
  const assignments = await allProgressRows<Assignment>(start => {
    let q = svc.from("test_assignments").select("id,student_id,test_id,assignment_batch_id,assigned_at,due_at,status");
    if (studentId) q = q.eq("student_id", studentId);
    return q.order("id").range(start, start + 499);
  });
  const tests: Test[] = [], batches: Batch[] = [], fullBatches: FullBatch[] = [], attempts: Attempt[] = [];
  const testIds = [...new Set(assignments.map(a => a.test_id))];
  const fullIds = [...new Set(assignments.flatMap(a => a.assignment_batch_id ? [a.assignment_batch_id] : []))];
  for (let i = 0; i < testIds.length; i += 200) {
    const ids = testIds.slice(i, i + 200);
    const [t, b] = await Promise.all([
      allProgressRows<Test>(start => svc.from("tests").select("id,title,kind").in("id", ids).order("id").range(start, start + 499)),
      allProgressRows<Batch>(start => svc.from("practice_assignment_batches").select("id,snapshot_test_id,title,timer_minutes,class_id,class_name").in("snapshot_test_id", ids).order("id").range(start, start + 499)),
    ]);
    tests.push(...t); batches.push(...b);
  }
  for (let i = 0; i < fullIds.length; i += 200) fullBatches.push(...await allProgressRows<FullBatch>(start => svc.from("full_test_assignment_batches").select("id,title,class_id,class_name").in("id", fullIds.slice(i, i + 200)).order("id").range(start, start + 499)));
  for (let i = 0; i < assignments.length; i += 200) attempts.push(...await allProgressRows<Attempt>(start => svc.from("attempts").select("id,assignment_id,status,started_at,submitted_at").in("assignment_id", assignments.slice(i, i + 200).map(a => a.id)).order("id").range(start, start + 499)));
  const byAssignment = Map.groupBy(attempts, a => a.assignment_id);
  const latest = assignments.flatMap(a => { const row = latestAttempt(byAssignment.get(a.id) ?? []); return row ? [row] : []; });
  const scores: Score[] = [], times: ModuleTime[] = [];
  for (let i = 0; i < latest.length; i += 200) {
    const ids = latest.slice(i, i + 200).map(a => a.id);
    scores.push(...await allProgressRows<Score>(start => svc.from("scores").select("attempt_id,raw_score,total_questions").in("attempt_id", ids).order("attempt_id").range(start, start + 499)));
    if (includeTime) times.push(...await allProgressRows<ModuleTime>(start => svc.from("attempt_modules").select("id,attempt_id,time_spent_seconds").in("attempt_id", ids).order("id").range(start, start + 499)));
  }
  const testMap = new Map(tests.map(t => [t.id, t]));
  const practiceMap = new Map(batches.map(b => [b.snapshot_test_id, b]));
  const fullMap = new Map(fullBatches.map(b => [b.id, b]));
  const scoreMap = new Map(scores.map(s => [s.attempt_id, s]));
  const timeMap = Map.groupBy(times, t => t.attempt_id);
  return assignments.map(a => {
    const test = testMap.get(a.test_id), attempt = latestAttempt(byAssignment.get(a.id) ?? []);
    const batch = test?.kind === "practice" ? practiceMap.get(a.test_id) : fullMap.get(a.assignment_batch_id ?? "");
    const score = attempt ? scoreMap.get(attempt.id) : null;
    return {
      assignment_id: a.id, student_id: a.student_id, test_id: a.test_id, kind: test?.kind ?? "full",
      batch_id: batch?.id ?? null, title: batch?.title ?? test?.title ?? "Assigned test",
      class_id: batch?.class_id ?? null, class_name: batch?.class_name ?? null,
      assigned_at: a.assigned_at, due_at: a.due_at,
      status: practiceAssignmentStatus(a.status, a.due_at, attempt?.status ?? null, now),
      attempt_id: attempt?.id ?? null, attempt_status: attempt?.status ?? null,
      started_at: attempt?.started_at ?? null, submitted_at: attempt?.submitted_at ?? null,
      raw_score: score?.raw_score ?? null, total_questions: score?.total_questions ?? null,
      accuracy: score && score.total_questions > 0 ? Math.round(score.raw_score / score.total_questions * 1000) / 10 : null,
      active_time_seconds: attempt && includeTime ? sumModuleTimeSeconds(timeMap.get(attempt.id) ?? []) : null,
      timer_minutes: batch && "timer_minutes" in batch ? batch.timer_minutes : null,
    };
  }).sort((a, b) => b.assigned_at.localeCompare(a.assigned_at) || a.assignment_id.localeCompare(b.assignment_id));
}
