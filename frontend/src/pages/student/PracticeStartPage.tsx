import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { Test } from "../../lib/types";
import { Button, Spinner } from "../../components/ui";
import TestThemeToggle from "../../components/TestThemeToggle";

interface StartResult {
  attempt_id: string;
  test: Test;
}

export default function PracticeStartPage() {
  const { testId } = useParams<{ testId: string }>();
  const [params] = useSearchParams();
  const assignmentId = params.get("assignment");
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ questions: number; minutes: number | null } | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const res = await fnJson<{ tests: Array<{ id: string; assignment_id: string | null; questions: number; time_limit_minutes: number | null }> }>("student-tests", { token }).catch(() => ({ tests: [] }));
      const list = res.tests.filter((x) => x.id === testId);
      const t = (assignmentId ? list.find((x) => x.assignment_id === assignmentId) : list[0]) ?? list[0];
      if (t) setMeta({ questions: t.questions, minutes: t.time_limit_minutes ?? null });
    })();
  }, [testId, assignmentId]);

  async function start() {
    if (!testId || starting) return;
    setStarting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fnJson<StartResult>("student-attempts", { method: "POST", token, body: { test_id: testId, ...(assignmentId ? { assignment_id: assignmentId } : {}) } });
      navigate(`/student/attempts/${res.attempt_id}/session`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start practice";
      if (msg.includes("already exists")) {
        navigate("/student/practice");
      } else {
        setError(msg);
        setStarting(false);
      }
    }
  }

  return (
    <div className="app-layout navy-shell prep-shell">
      <header className="app-header scrolled prep-header">
        <div className="brand"><span className="student-wordmark">Grit</span></div>
        <span className="prep-header-note">Practice set · Before you begin</span>
      </header>
      <main className="app-content prep-content page-fade">
        <section className="prep-stage">
          <div className="prep-lead">
            <span className="prep-eyebrow">A focused session</span>
            <h1>Small set.<br /><em>Strong finish.</em></h1>
            <p>A short practice run with one timer and instant feedback. Choose a calm moment, then work through the questions at your pace.</p>
            <div className="prep-rule" aria-hidden="true"><span>01</span><i /><span>03</span></div>
            <div className="prep-lead-note">Your answers save as you go.</div>
          </div>
          <div className="prep-panel">
            <div className="prep-panel-top"><span>Practice set</span><span>Ready when you are</span></div>
            <h2>Before you begin</h2>
            {meta === null && <Spinner />}
            {meta && (
              <div className="prep-facts">
                <div><strong>{meta.questions}</strong><span>Question{meta.questions === 1 ? "" : "s"}</span></div>
                {meta.minutes != null && <div><strong>{meta.minutes}</strong><span>Minutes</span></div>}
              </div>
            )}
            <div className="prep-steps">
              {[
                { title: "One timer for the whole set", body: "The countdown starts when you begin. When it reaches zero, the set submits automatically." },
                { title: "Free navigation", body: "Move between questions freely and mark any you want to double-check. Your work saves automatically." },
                { title: "Instant grading", body: "When you finish, your answers are graded right away and your score report opens immediately." },
              ].map((s, i) => (
                <div className="prep-step" key={s.title}>
                  <span className="prep-step-number">0{i + 1}</span>
                  <div><strong>{s.title}</strong><p>{s.body}</p></div>
                </div>
              ))}
            </div>
            {error && <div className="login-error">{error}</div>}
            <div className="prep-theme"><TestThemeToggle /></div>
            <div className="prep-actions">
              <Button variant="outline" onClick={() => navigate("/student/practice")}>← Back to practice</Button>
              <Button size="lg" onClick={() => void start()} disabled={starting}>{starting ? "Starting…" : "Start practice"}</Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
