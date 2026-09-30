import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { Test } from "../../lib/types";
import { Button } from "../../components/ui";
import TestThemeToggle from "../../components/TestThemeToggle";

interface StartResult {
  attempt_id: string;
  test: Test;
}

const STEPS = [
  {
    title: "Modules with timers",
    body: "Each module has its own time limit, shown by the timer at the top. When it reaches zero, the module submits automatically.",
  },
  {
    title: "Free navigation",
    body: "Move between questions freely, mark them for review, and double-check your answers before submitting each module. Work saves automatically.",
  },
  {
    title: "Calculator & reference",
    body: "Math modules allow your own calculator. A formula reference sheet is available from the More menu.",
  },
  {
    title: "No going back",
    body: "Once you submit a module you can't return to it. After the final module, your score report is generated instantly.",
  },
];

export default function TestStartPage() {
  const { testId } = useParams<{ testId: string }>();
  const [params] = useSearchParams();
  const assignmentId = params.get("assignment");
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!testId || starting) return;
    setStarting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fnJson<StartResult>("student-attempts", { method: "POST", token, body: { test_id: testId, ...(assignmentId ? { assignment_id: assignmentId } : {}) } });
      navigate(`/student/attempts/${res.attempt_id}/session`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start test";
      if (msg.includes("already exists")) {
        navigate("/student");
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
        <span className="prep-header-note">Full-length test · Before you begin</span>
      </header>
      <main className="app-content prep-content page-fade">
        <section className="prep-stage">
          <div className="prep-lead">
            <span className="prep-eyebrow">Test day, on your terms</span>
            <h1>Set your focus.<br /><em>Then begin.</em></h1>
            <p>Four timed modules. One complete SAT experience. Take a moment to review the essentials before entering the exam.</p>
            <div className="prep-rule" aria-hidden="true"><span>01</span><i /><span>04</span></div>
            <div className="prep-lead-note">Your answers save as you go.</div>
          </div>
          <div className="prep-panel">
            <div className="prep-panel-top"><span>Full-length test</span><span>Ready when you are</span></div>
            <h2>Before you begin</h2>
            <div className="prep-steps">
              {STEPS.map((s, i) => (
                <div className="prep-step" key={s.title}>
                  <span className="prep-step-number">0{i + 1}</span>
                  <div><strong>{s.title}</strong><p>{s.body}</p></div>
                </div>
              ))}
            </div>
            {error && <div className="login-error">{error}</div>}
            <div className="prep-theme"><TestThemeToggle /></div>
            <div className="prep-actions">
              <Button variant="outline" onClick={() => navigate("/student/tests")}>← Back to tests</Button>
              <Button size="lg" onClick={() => void start()} disabled={starting}>{starting ? "Starting…" : "Start full-length test"}</Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
