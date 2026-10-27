// Fetch code only on navigation intent. Do not fetch private data or preload
// every destination on mount, especially on metered connections.
const loaders: Record<string, () => Promise<unknown>> = {
  "/admin/classes": () => import("../pages/admin/ClassesPanel"),
  "/admin/students": () => import("../pages/admin/StudentsPage"),
  "/admin/assignments": () => import("../pages/admin/AssignmentsPage"),
  "/admin/practice": () => import("../pages/admin/PracticePage"),
  "/admin/tests": () => import("../pages/admin/TestsPage"),
  "/admin/vocabulary": () => import("../pages/admin/AdminVocabPage"),
  "/admin/questions": () => import("../pages/admin/QuestionsPage"),
  "/admin/imports": () => import("../pages/admin/ImportsPage"),
  "/student/dashboard": () => import("../pages/student/StudentDashboardPage"),
  "/student/practice": () => import("../pages/student/PracticePage"),
  "/student/tests": () => import("../pages/student/StudentTestsPage"),
  "/student/results": () => import("../pages/student/ResultsPage"),
  "/student/vocabulary": () => import("../pages/student/vocab/VocabularyPage"),
  "/student/profile": () => import("../pages/student/StudentProfilePage"),
};
const pending = new Map<string, Promise<unknown>>();

export function preloadRoute(path: string): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return;
  const load = loaders[path];
  if (!load || pending.has(path)) return;
  pending.set(path, load().catch(() => { pending.delete(path); }));
}
