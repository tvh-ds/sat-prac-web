import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { ScoreEntry, TestListItem } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import { initReveal } from "../../lib/reveal";
import { Clock, FileText, Sparkles } from "lucide-react";

export default function StudentTestsPage() {
  const navigate = useNavigate();
  const [tests, setTests] = useState<TestListItem[] | null>(null);
  const [history, setHistory] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const [t, h] = await Promise.all([
        fnJson<{ tests: TestListItem[] }>("student-tests", { token }).catch(() => ({ tests: [] })),
        fnJson<{ history: ScoreEntry[] }>("student-scores", { token }).catch(() => ({ history: [] })),
      ]);
      setTests(t.tests);
      setHistory(h.history);
    })();
  }, []);

  useEffect(() => { if (tests) requestAnimationFrame(() => initReveal()); }, [tests, history]);

  const inProgress = history.filter((h) => h.status === "in_progress");
  const graded = history.filter((h) => h.status === "graded");
  const attemptedIds = new Set(history.map((h) => h.test_id));
  const fullTests = (tests ?? []).filter((t) => t.kind !== "practice");
  const available = fullTests.filter((t) => !attemptedIds.has(t.id));

  return (
    <div>
      <section className="premium-hero reveal">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-badge"><span className="hero-badge-dot" /> Timed modules with automatic scoring</div>
            <div className="section-label">Full-length tests</div>
            <h1>Practice like the room is already silent.</h1>
            <p>Start a full-length test, resume an active attempt, or review completed work from a focused SAT cockpit built around timing, pacing, and question-level feedback.</p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => document.getElementById("available")?.scrollIntoView({ behavior: "smooth" })}>
                <Sparkles size={16} strokeWidth={1.7} /> View available tests
              </button>
              <button className="btn btn-secondary" onClick={() => navigate("/student/practice")}>
                <FileText size={16} strokeWidth={1.6} /> Browse practice
              </button>
            </div>
            <div className="hero-meta">
              <Pill tone="amber"><Clock size={12} /> Timed modules</Pill>
              <Pill tone="gray">Auto-save</Pill>
              <Pill tone="gray">Question review</Pill>
            </div>
          </div>
          <div className="hero-metrics" aria-label="Test activity summary">
            <div className="hero-metric"><strong>{available.length}</strong><span>Available tests</span></div>
            <div className="hero-metric"><strong>{inProgress.length}</strong><span>In progress</span></div>
            <div className="hero-metric"><strong>{graded.length}</strong><span>Completed</span></div>
            <div className="hero-metric"><strong>{fullTests.length}</strong><span>Total assigned</span></div>
          </div>
        </div>
      </section>

      {!tests && <Spinner />}

      {tests && available.length === 0 && inProgress.length === 0 && (
        <div className="reveal"><EmptyState title="No full-length tests available" body="Your teacher has not assigned any full-length tests yet." /></div>
      )}

      {tests && available.length > 0 && (
        <section id="available" className="premium-section">
          <div className="section-label">Available</div>
          <div className="section-head">
            <h2>Available Full-Length Tests</h2>
            <span className="muted" style={{ fontSize: 12 }}>{available.length} ready</span>
          </div>
          <div className="suite-list">
            {available.map((t) => (
              <div className="card test-card premium-test-card reveal" key={t.id}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="t-title">{t.title}</h3>
                  <p className="t-desc">{t.description ?? "Full-length test"}</p>
                  <p className="arch-meta">{t.modules} module{t.modules === 1 ? "" : "s"} · {t.questions} questions</p>
                  <div className="card-row" style={{ marginTop: 10 }}>
                    {t.sections > 0 && <Pill tone="gray">{t.sections} section{t.sections === 1 ? "" : "s"}</Pill>}
                    {t.modules > 0 && <Pill tone="gray">{t.modules} module{t.modules === 1 ? "" : "s"}</Pill>}
                    {t.questions > 0 && <Pill tone="amber">{t.questions} questions</Pill>}
                    {t.due_at && <Pill tone="amber">Due {fmtDate(t.due_at)}</Pill>}
                  </div>
                </div>
                <Button onClick={() => navigate(`/student/tests/${t.id}/start`)}>Start test</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tests && inProgress.length > 0 && (
        <section className="premium-section">
          <div className="section-label">In progress</div>
          <div className="section-head">
            <h2>In Progress</h2>
            <span className="muted" style={{ fontSize: 12 }}>{inProgress.length} ongoing</span>
          </div>
          <div className="suite-list">
            {inProgress.map((h) => (
              <div className="card test-card premium-test-card reveal" key={h.id}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="t-title">{h.test?.title ?? "Attempt"}</h3>
                  <p className="t-desc">Started {fmtDate(h.started_at)}</p>
                </div>
                <div className="card-row">
                  <Pill tone="amber">In progress</Pill>
                  <Button onClick={() => navigate(`/student/attempts/${h.id}/session`)}>Resume</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tests && graded.length > 0 && (
        <section className="premium-section">
          <div className="section-label">Completed</div>
          <div className="section-head">
            <h2>Completed</h2>
            <span className="muted" style={{ fontSize: 12 }}>{graded.length} finished</span>
          </div>
          <div className="suite-list">
            {graded.map((h) => (
              <div className="card test-card premium-test-card reveal" key={h.id}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="t-title">{h.test?.title ?? "Attempt"}</h3>
                  <p className="t-desc">
                    Submitted {fmtDate(h.submitted_at)}
                    {h.score ? ` · ${h.score.accuracy}% accuracy` : ""}
                  </p>
                </div>
                <div className="card-row">
                  <Pill tone="green">Graded</Pill>
                  <Button variant="outline" onClick={() => navigate(`/student/scores/${h.id}`)}>View results</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
