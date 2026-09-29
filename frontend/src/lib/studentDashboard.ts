import type { StudentDashboardItem } from "./types.ts";

const DAY_MS = 86_400_000;
const OFFSET_MS = 7 * 3_600_000;
export function dashboardToday(now: Date): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}
export function dashboardGreeting(now: Date): string {
  const hour = new Date(now.getTime() + OFFSET_MS).getUTCHours();
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
}
export function testDaysRemaining(testDate: string, now: Date): number {
  return Math.round((Date.parse(`${testDate}T00:00:00Z`) - Date.parse(`${dashboardToday(now)}T00:00:00Z`)) / DAY_MS);
}
export function nextDashboardBoundary(now: Date): number {
  const shifted = new Date(now.getTime() + OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return [5, 12, 18, 24].map((hour) => midnight + hour * 3_600_000 - OFFSET_MS).find((at) => at > now.getTime())!;
}
export function summarizeDashboard(items: StudentDashboardItem[], now: Date) {
  const counts = { assigned: 0, complete: 0, overdue: 0 };
  let dueToday = 0;
  const current = items.map((item) => {
    const state = item.state === "complete" ? "complete" : item.kind === "vocabulary" ? "assigned" : item.due_at && Date.parse(item.due_at) < now.getTime() ? "overdue" : "assigned";
    counts[state]++;
    if (state !== "complete" && (item.kind === "vocabulary" || (item.due_at && dashboardToday(new Date(item.due_at)) === dashboardToday(now)))) dueToday++;
    return { ...item, state } as StudentDashboardItem;
  });
  return { items: current, counts, dueToday };
}
