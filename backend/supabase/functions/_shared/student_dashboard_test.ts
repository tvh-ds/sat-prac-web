import { assignmentItems, dashboardState, validateTestDate } from "./student_dashboard.ts";
import { dashboardGreeting, dashboardToday, nextDashboardBoundary, summarizeDashboard, testDaysRemaining } from "../../../../frontend/src/lib/studentDashboard.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const now = new Date("2026-09-29T06:00:00Z");
Deno.test("GMT+7 greetings and calendar dates ignore the device timezone", () => {
  for (const [instant, greeting] of [["2026-09-28T21:59:59Z", "Good evening"], ["2026-09-28T22:00:00Z", "Good morning"], ["2026-09-29T04:59:59Z", "Good morning"], ["2026-09-29T05:00:00Z", "Good afternoon"], ["2026-09-29T11:00:00Z", "Good evening"]]) equal(dashboardGreeting(new Date(instant)), greeting);
  equal(dashboardToday(new Date("2026-09-28T17:00:00Z")), "2026-09-29");
  equal(testDaysRemaining("2026-09-30", now), 1);
  equal(testDaysRemaining("2026-09-29", now), 0);
  equal(testDaysRemaining("2026-09-28", now), -1);
  equal(nextDashboardBoundary(new Date("2026-09-29T16:59:59Z")), Date.parse("2026-09-29T17:00:00Z"));
});
Deno.test("completion precedes deadline; overdue includes unfinished in-progress work", () => {
  equal(dashboardState("assigned", "in_progress", "2026-09-29T05:00:00Z", now), "overdue");
  equal(dashboardState("completed", undefined, "2026-09-28T05:00:00Z", now), "complete");
  equal(dashboardState("assigned", "submitted", "2026-09-28T05:00:00Z", now), "complete");
  equal(dashboardState("assigned", "graded", null, now), "complete");
  equal(dashboardState("assigned", undefined, null, now), "assigned");
  equal(dashboardState("assigned", undefined, now.toISOString(), now), "assigned");
});
Deno.test("repeat assignments keep separate latest attempts and scoped destinations", () => {
  const assignments = ["a", "b", "c"].map((id) => ({ id, test_id: "same", due_at: null, status: "assigned", test: { title: "Repeated test", kind: "practice" } }));
  const items = assignmentItems(assignments, [
    { id: "new", assignment_id: "a", started_at: "2026-09-29T06:00:00Z", status: "graded" },
    { id: "old", assignment_id: "a", started_at: "2026-09-28T06:00:00Z", status: "in_progress" },
    { id: "active", assignment_id: "b", started_at: "2026-09-29T06:00:00Z", status: "in_progress" },
    { id: "public", assignment_id: null, started_at: "2026-09-29T07:00:00Z", status: "graded" },
  ], now);
  equal(items.map((item) => item.state), ["complete", "assigned", "assigned"]);
  equal(items.map((item) => item.href), ["/student/scores/new", "/student/attempts/active/session", "/student/practice/same/start?assignment=c"]);
});
Deno.test("counts are exclusive; today's overdue work and due decks count toward greeting", () => {
  const base = { title: "Assignment", kind: "test" as const, href: "/student/tests", due_at: null };
  const result = summarizeDashboard([
    { ...base, id: "today", state: "assigned", due_at: "2026-09-29T05:00:00Z" },
    { ...base, id: "yesterday", state: "overdue", due_at: "2026-09-28T05:00:00Z" },
    { ...base, id: "complete", state: "complete", due_at: "2026-09-29T05:00:00Z" },
    { ...base, id: "future", state: "assigned", due_at: "2026-09-30T05:00:00Z" },
    { ...base, id: "vocab", kind: "vocabulary", state: "assigned" },
  ], now);
  equal(result.counts, { assigned: 2, complete: 1, overdue: 2 });
  equal(result.dueToday, 2);
  equal(summarizeDashboard(result.items.filter((item) => item.kind !== "vocabulary"), now).counts, { assigned: 1, complete: 1, overdue: 2 });
});
Deno.test("test date accepts valid today/future/clear only and rejects spoofed ownership", () => {
  equal(validateTestDate({ test_date: null }, now), null);
  equal(validateTestDate({ test_date: "2026-09-29" }, now), "2026-09-29");
  equal(validateTestDate({ test_date: "2028-02-29" }, now), "2028-02-29");
  for (const body of [{ test_date: "2026-09-28" }, { test_date: "2027-02-29" }, { test_date: "2026-13-01" }, { test_date: "2026-09-30", student_id: "other" }, {}, null, [], { test_date: 123 }, { test_date: "" }]) {
    let rejected = false;
    try { validateTestDate(body, now); } catch { rejected = true; }
    equal(rejected, true);
  }
});
