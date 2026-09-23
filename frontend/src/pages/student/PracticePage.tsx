import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { TestListItem } from "../../lib/types";
import { Button, EmptyState, Pill, Spinner, fmtDate } from "../../components/ui";
import { initReveal } from "../../lib/reveal";

export default function PracticePage() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<TestListItem[] | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const res = await fnJson<{ tests: TestListItem[] }>("student-tests", { token }).catch(() => ({ tests: [] }));
      setSets(res.tests.filter((t) => t.kind === "practice"));
    })();
  }, []);

  useEffect(() => { if (sets) requestAnimationFrame(() => initReveal()); }, [sets]);

  const available = (sets ?? []).filter((t) => !t.attempt);
  const inProgress = (sets ?? []).filter((t) => t.attempt?.status === "in_progress");
  const completed = (sets ?? []).filter((t) => t.attempt?.status === "graded");

  return (
    <div>
      <div className="section-label">Practice</div>
      <h1 className="page-title"><span className="hl-muted">Focused </span><span className="hl-bright">practice</span></h1>
      <p className="page-sub">Short, single-timer sets — graded instantly when you finish.</p>

      {!sets && <Spinner />}

      {sets && available.length === 0 && inProgress.length === 0 && completed.length === 0 && (
        <EmptyState title="No practice sets yet" body="Your teacher has not published any practice sets." />
      )}

      {sets && available.length > 0 && (
        <section style={{ marginBottom: 34 }}>
          <div className="section-label">Ready</div>
          <div className="section-head">
            <h2>Available</h2>
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{available.length} READY</span>
          </div>
          {available.map((t) => (
            <div className="card test-card reveal" key={t.assignment_id ?? t.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{t.title}</h3>
                <p className="t-desc">{t.description ?? "Practice set"}</p>
                <p className="arch-meta">{t.questions} questions · {t.time_limit_minutes ?? "—"} minutes</p>
                <div className="card-row" style={{ marginTop: 8 }}>
                  <Pill tone="amber">{t.questions} qs</Pill>
                  {t.time_limit_minutes != null && <Pill tone="gray">{t.time_limit_minutes}-min timer</Pill>}
                </div>
              </div>
              <Button onClick={() => navigate(`/student/practice/${t.id}/start${t.assignment_id ? `?assignment=${t.assignment_id}` : ""}`)}>Start practice</Button>
            </div>
          ))}
        </section>
      )}

      {sets && inProgress.length > 0 && (
        <section style={{ marginBottom: 34 }}>
          <div className="section-label">Active</div>
          <div className="section-head">
            <h2>In Progress</h2>
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{inProgress.length} ONGOING</span>
          </div>
          {inProgress.map((t) => (
            <div className="card test-card reveal" key={t.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{t.title}</h3>
                <p className="t-desc">Started {fmtDate(t.attempt!.started_at)}</p>
              </div>
              <div className="card-row">
                <Pill tone="amber">In progress</Pill>
                <Button onClick={() => navigate(`/student/attempts/${t.attempt!.id}/session`)}>Resume</Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {sets && completed.length > 0 && (
        <section>
          <div className="section-label">Done</div>
          <div className="section-head">
            <h2>Completed</h2>
            <span className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{completed.length} FINISHED</span>
          </div>
          {completed.map((t) => (
            <div className="card test-card reveal" key={t.id}>
              <div style={{ minWidth: 0 }}>
                <h3 className="t-title">{t.title}</h3>
                <p className="t-desc">Completed — review your answers anytime</p>
              </div>
              <div className="card-row">
                <Pill tone="green">Graded</Pill>
                <Button variant="outline" onClick={() => navigate(`/student/scores/${t.attempt!.id}`)}>View Results</Button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
