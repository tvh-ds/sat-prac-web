import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { Test } from "../../lib/types";
import { Button, Spinner } from "../../components/ui";

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
    <div className="app-layout">
      <header className="app-header scrolled" style={{ position: "sticky" }}>
        <div className="brand">
          <span className="logo">S</span>
          SAT Practice
        </div>
      </header>
      <div className="app-content" style={{ maxWidth: 760 }}>
        <div className="page-fade">
          <div className="card card-pad" style={{ padding: 34 }}>
            <h1 className="page-title">Practice Set</h1>
            <p className="page-sub">A short set with a single timer. Answers save automatically as you go.</p>

            {meta === null && <Spinner />}

            {meta && (
              <div className="card-row" style={{ marginTop: 4, marginBottom: 22 }}>
                <span className="pill" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                  {meta.questions} question{meta.questions === 1 ? "" : "s"}
                </span>
                {meta.minutes != null && (
                  <span className="pill" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                    {meta.minutes}-minute timer
                  </span>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
              {[
                { title: "One timer for the whole set", body: "The countdown starts when you begin. When it reaches zero, the set submits automatically." },
                { title: "Free navigation", body: "Move between questions freely and mark any you want to double-check. Your work saves automatically." },
                { title: "Instant grading", body: "When you finish, your answers are graded right away and your score report opens immediately." },
              ].map((s, i) => (
                <div key={s.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span className="avatar" style={{ width: 28, height: 28, fontSize: 13, flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 14.5 }}>{s.title}</strong>
                    <p style={{ margin: "2px 0 0", fontSize: 14, color: "var(--muted)" }}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="login-error">{error}</div>}

            <div style={{ display: "flex", gap: 12 }}>
              <Button variant="outline" onClick={() => navigate("/student/practice")}>← Back</Button>
              <Button size="lg" onClick={() => void start()} disabled={starting}>
                {starting ? "Starting…" : "Start practice"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
