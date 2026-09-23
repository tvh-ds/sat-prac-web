import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { Spinner } from "./components/ui";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const StudentLayout = lazy(() => import("./pages/student/StudentLayout"));
const StudentTestsPage = lazy(() => import("./pages/student/StudentTestsPage"));
const ResultsPage = lazy(() => import("./pages/student/ResultsPage"));
const TestStartPage = lazy(() => import("./pages/student/TestStartPage"));
const TestSessionPage = lazy(() => import("./pages/student/TestSessionPage"));
const ScoreReportPage = lazy(() => import("./pages/student/ScoreReportPage"));
const VocabularyPage = lazy(() => import("./pages/student/vocab/VocabularyPage"));
const DeckCards = lazy(() => import("./pages/student/vocab/DeckCards"));
const StudySession = lazy(() => import("./pages/student/vocab/StudySession"));
const SprintSession = lazy(() => import("./pages/student/vocab/SprintSession"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const StudentsPage = lazy(() => import("./pages/admin/StudentsPage"));
const ImportsPage = lazy(() => import("./pages/admin/ImportsPage"));
const ImportDetailPage = lazy(() => import("./pages/admin/ImportDetailPage"));
const QuestionsPage = lazy(() => import("./pages/admin/QuestionsPage"));
const TestsPage = lazy(() => import("./pages/admin/TestsPage"));
const TestBuilderPage = lazy(() => import("./pages/admin/TestBuilderPage"));
const PracticePage = lazy(() => import("./pages/admin/PracticePage"));
const PracticeComposePage = lazy(() => import("./pages/admin/PracticeComposePage"));
const PracticeManagePage = lazy(() => import("./pages/admin/PracticeManagePage"));
const PracticeBatchPage = lazy(() => import("./pages/admin/PracticeBatchPage"));
const PracticeStudentPage = lazy(() => import("./pages/student/PracticePage"));
const PracticeStartPage = lazy(() => import("./pages/student/PracticeStartPage"));
const AdminVocabPage = lazy(() => import("./pages/admin/AdminVocabPage"));
const AdminVocabDeckPage = lazy(() => import("./pages/admin/AdminVocabDeckPage"));

function RequireRole({ role, children }: { role: "admin" | "student"; children: React.ReactNode }) {
  const { loading, user, profile } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.role !== role) return <Navigate to={profile?.role === "admin" ? "/admin" : "/student"} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/student" replace />} />

            <Route
              path="/student"
              element={
                <RequireRole role="student">
                  <StudentLayout />
                </RequireRole>
              }
            >
              <Route index element={<Navigate to="tests" replace />} />
              <Route path="tests" element={<StudentTestsPage />} />
              <Route path="practice" element={<PracticeStudentPage />} />
              <Route path="results" element={<ResultsPage />} />
              <Route path="scores/:attemptId" element={<ScoreReportPage />} />
              <Route path="vocabulary" element={<VocabularyPage />} />
              <Route path="vocabulary/decks/:deckId" element={<DeckCards />} />
              <Route path="vocabulary/study" element={<StudySession />} />
              <Route path="vocabulary/sprint" element={<SprintSession />} />
            </Route>

            <Route
              path="/student/tests/:testId/start"
              element={
                <RequireRole role="student">
                  <TestStartPage />
                </RequireRole>
              }
            />
            <Route
              path="/student/practice/:testId/start"
              element={
                <RequireRole role="student">
                  <PracticeStartPage />
                </RequireRole>
              }
            />
            <Route
              path="/student/attempts/:attemptId/session"
              element={
                <RequireRole role="student">
                  <TestSessionPage />
                </RequireRole>
              }
            />

            <Route
              path="/admin"
              element={
                <RequireRole role="admin">
                  <AdminLayout />
                </RequireRole>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="students" element={<StudentsPage />} />
              <Route path="imports" element={<ImportsPage />} />
              <Route path="imports/:importId" element={<ImportDetailPage />} />
              <Route path="questions" element={<QuestionsPage />} />
              <Route path="tests" element={<TestsPage />} />
              <Route path="tests/:testId/build" element={<TestBuilderPage />} />
              <Route path="practice" element={<PracticePage />} />
              <Route path="practice/new" element={<PracticeComposePage />} />
              <Route path="practice/:setId" element={<PracticeManagePage />} />
              <Route path="practice/assigned/:batchId" element={<PracticeBatchPage />} />
              <Route path="vocabulary" element={<AdminVocabPage />} />
              <Route path="vocabulary/decks/:deckId" element={<AdminVocabDeckPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
