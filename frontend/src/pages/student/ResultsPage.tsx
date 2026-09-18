import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { ScoreEntry } from "../../lib/types";
import { EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import { initReveal } from "../../lib/reveal";
import { Trophy, Target, CheckCircle2 } from "lucide-react";

export default function ResultsPage() {
  const [history, setHistory] = useState<ScoreEntry[] | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const h = await fnJson<{ history: ScoreEntry[] }>("student-scores", { token }).catch(() => ({ history: [] }));
      setHistory(h.history.filter((x) => x.status === "graded"));
    })();
  }, []);

  useEffect(() => { if (history) requestAnimationFrame(() => initReveal()); }, [history]);

  if (!history) return <Spinner />;

  const withScore = history.filter((h) => h.score);
  const avg = withScore.length > 0 ? Math.round(withScore.reduce((n, h) => n + (h.score?.accuracy ?? 0), 0) / withScore.length) : 0;
  const totalCorrect = withScore.reduce((n, h) => n + (h.score?.raw_score ?? 0), 0);
  const totalAnswered = withScore.reduce((n, h) => n + (h.score?.total_questions ?? 0), 0);

  return (
    <div>
      <div className="section-label">[ Results ]</div>
      <h1 className="page-title"><span className="hl-muted">Your</span> <span className="hl-bright">results</span></h1>
      <p className="page-sub">Completed attempts with full answer reviews.</p>

      {history.length === 0 && (
        <EmptyState title="No results yet" body="Complete a full-length test and your score report will appear here." />
      )}

      {history.length > 0 && (
        <>
          <div className="stat-grid">
            <div className="stat-card reveal">
              <div className="ico"><Trophy size={18} strokeWidth={1.6} /></div>
              <div className="num" data-countup={history.length}>{history.length}</div>
              <div className="lbl">Completed</div>
              <div className="arch-meta">ATTEMPTS // GRADED: {withScore.length}</div>
            </div>
            <div className="stat-card reveal">
              <div className="ico"><Target size={18} strokeWidth={1.6} /></div>
              <div className="num">{avg}%</div>
              <div className="lbl">Average accuracy</div>
              <div className="arch-meta">MEAN // n={withScore.length}</div>
            </div>
            <div className="stat-card reveal">
              <div className="ico"><CheckCircle2 size={18} strokeWidth={1.6} /></div>
              <div className="num">
                {totalCorrect}<span className="muted"> / {totalAnswered}</span>
              </div>
              <div className="lbl">Questions correct</div>
              <div className="arch-meta">CORRECT // TOTAL: {totalAnswered}</div>
            </div>
          </div>

          <div className="section-label" style={{ marginTop: 28 }}>[ Attempts ]</div>
          <div className="section-head">
            <h2>All Attempts</h2>
            <span className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{history.length} GRADED</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {history.map((h) => {
              const sc = h.score;
              const secs = sc?.section_scores ?? {};
              const pct = sc && sc.total_questions > 0 ? Math.round((sc.raw_score / sc.total_questions) * 100) : 0;
              return (
                <div className="card card-pad reveal" key={h.id} style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h3 className="t-title" style={{ fontSize: 15, margin: 0 }}>{h.test?.title ?? "Full-Length Test"}</h3>
                      {h.test?.kind === "practice" && <Pill tone="amber">Practice</Pill>}
                    </div>
                    <p className="t-desc" style={{ margin: "2px 0 8px" }}>Submitted {fmtDate(h.submitted_at)}</p>
                    <div className="score-bar" style={{ maxWidth: 320 }}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 190 }}>
                    {Object.keys(secs).length === 0 && <span className="muted" style={{ fontSize: 13 }}>No section data</span>}
                    {Object.entries(secs).map(([name, s]) => (
                      <div key={name} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 14 }}>
                        <span style={{ color: "var(--text-body)" }}>{name === "reading_writing" ? "Reading & Writing" : "Math"}</span>
                        <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{s.correct}/{s.total}</strong>
                      </div>
                    ))}
                  </div>
                  <div style={{ textAlign: "center", minWidth: 110 }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent)" }}>
                      {sc ? `${sc.accuracy}%` : "—"}
                    </div>
                    <div className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                      {sc ? `${sc.raw_score} / ${sc.total_questions}` : "NO SCORE"}
                    </div>
                  </div>
                  <Link className="btn btn-secondary" to={`/student/scores/${h.id}`}>Open Report</Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
