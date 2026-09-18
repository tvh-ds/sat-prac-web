import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { Test } from "../../lib/types";
import { Button } from "../../components/ui";

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
    body: "Math modules allow your own calculator. A formula reference sheet is available from the Reference button.",
  },
  {
    title: "No going back",
    body: "Once you submit a module you can't return to it. After the final module, your score report is generated instantly.",
  },
];

export default function TestStartPage() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!testId || starting) return;
    setStarting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fnJson<StartResult>("student-attempts", { method: "POST", token, body: { test_id: testId } });
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
            <h1 className="page-title">Starting a Full-Length Test</h1>
            <p className="page-sub">Read the instructions before you begin.</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
              {STEPS.map((s, i) => (
                <div key={s.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span
                    className="avatar"
                    style={{ width: 28, height: 28, fontSize: 13, flexShrink: 0 }}
                  >
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
              <Button variant="outline" onClick={() => navigate("/student")}>← Back</Button>
              <Button size="lg" onClick={() => void start()} disabled={starting}>
                {starting ? "Starting…" : "Start full-length test"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
