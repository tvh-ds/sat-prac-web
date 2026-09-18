import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { ScoreEntry, TestListItem } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import { initReveal } from "../../lib/reveal";
import { Clock, FileText, Sparkles } from "lucide-react";

const WORDS = ["sharper.", "faster.", "stronger."];

export default function StudentTestsPage() {
  const navigate = useNavigate();
  const [tests, setTests] = useState<TestListItem[] | null>(null);
  const [history, setHistory] = useState<ScoreEntry[]>([]);
  const [wordIdx, setWordIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setWordIdx((i) => (i + 1) % WORDS.length), 2600);
    return () => clearInterval(id);
  }, []);

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
      {/* Hero */}
      <section className="student-hero reveal">
        <div className="hero-orb" />
        <div className="hero-badge"><span className="hero-badge-dot" /> Bluebook-style · Timed · Auto-graded</div>
        <div className="section-label">[ Full-Length Tests ]</div>
        <h1 className="display-headline" style={{ fontSize: "clamp(28px,4vw,46px)", lineHeight: 1.1 }}>
          <span className="hl-muted">Practice </span>
          <span className="hl-bright">without</span>
          <span className="hl-muted"> pressure.</span>
          <br />
          <span className="hl-muted">Perform </span>
          <span className="hl-bright cycling-word" style={{ background: "rgba(212,160,60,0.12)", padding: "0 6px", borderRadius: 6 }}>{WORDS[wordIdx]}</span>
        </h1>
        <p className="hero-sub">Authentic timing, instant scoring, and per-question review — built for focused SAT preparation.</p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => document.getElementById("available")?.scrollIntoView({ behavior: "smooth" })}>
            <Sparkles size={16} strokeWidth={1.7} /> View Available
          </button>
          <button className="btn btn-secondary" onClick={() => navigate("/student/practice")}>
            <FileText size={16} strokeWidth={1.6} /> Browse Practice
          </button>
        </div>
        <div className="hero-meta">
          <Pill tone="amber"><Clock size={12} /> Timed modules</Pill>
          <Pill tone="gray">Instant grading</Pill>
          <Pill tone="gray">Domain breakdowns</Pill>
        </div>
        <p className="arch-meta" style={{ marginTop: 18 }}>8A3F2 // CONTEXT DEPTH: 12.4 // INSIGHT HASH: 7B · {fullTests.length} tests · {history.length} attempts</p>
      </section>

      {!tests && <Spinner />}

      {tests && available.length === 0 && inProgress.length === 0 && (
        <div className="reveal"><EmptyState title="No full-length tests available" body="Your teacher has not assigned any full-length tests yet." /></div>
      )}

      {tests && available.length > 0 && (
        <section id="available" style={{ marginBottom: 34 }}>
          <div className="section-label">[ Available ]</div>
          <div className="section-head">
            <h2>Available Full-Length Tests</h2>
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{available.length} AVAILABLE</span>
          </div>
          {available.map((t) => (
            <div className="card test-card reveal" key={t.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{t.title}</h3>
                <p className="t-desc">{t.description ?? "Full-length test"}</p>
                <p className="arch-meta">{t.id.slice(0, 6).toUpperCase()} // MODULES: {t.modules} // QS: {t.questions}</p>
                <div className="card-row" style={{ marginTop: 8 }}>
                  {t.sections > 0 && <Pill tone="gray">{t.sections} section{t.sections === 1 ? "" : "s"}</Pill>}
                  {t.modules > 0 && <Pill tone="gray">{t.modules} module{t.modules === 1 ? "" : "s"}</Pill>}
                  {t.questions > 0 && <Pill tone="amber">{t.questions} qs</Pill>}
                  {t.due_at && <Pill tone="amber">Due {fmtDate(t.due_at)}</Pill>}
                </div>
              </div>
              <Button onClick={() => navigate(`/student/tests/${t.id}/start`)}>Start →</Button>
            </div>
          ))}
        </section>
      )}

      {tests && inProgress.length > 0 && (
        <section style={{ marginBottom: 34 }}>
          <div className="section-label">[ In Progress ]</div>
          <div className="section-head">
            <h2>In Progress</h2>
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{inProgress.length} ONGOING</span>
          </div>
          {inProgress.map((h) => (
            <div className="card test-card reveal" key={h.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{h.test?.title ?? "Attempt"}</h3>
                <p className="t-desc">Started {fmtDate(h.started_at)}</p>
              </div>
              <div className="card-row">
                <Pill tone="amber">In progress</Pill>
                <Button onClick={() => navigate(`/student/attempts/${h.id}/session`)}>Resume →</Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tests && graded.length > 0 && (
        <section>
          <div className="section-label">[ Completed ]</div>
          <div className="section-head">
            <h2>Completed</h2>
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{graded.length} FINISHED</span>
          </div>
          {graded.map((h) => (
            <div className="card test-card reveal" key={h.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{h.test?.title ?? "Attempt"}</h3>
                <p className="t-desc">
                  Submitted {fmtDate(h.submitted_at)}
                  {h.score ? ` · ${h.score.accuracy}% accuracy` : ""}
                </p>
              </div>
              <div className="card-row">
                <Pill tone="green">Graded</Pill>
                <Button variant="outline" onClick={() => navigate(`/student/scores/${h.id}`)}>View Results</Button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
