import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken } from "../../lib/supabase";
import type { Attempt, AttemptModule, SavedResponse, Test, TestModule, TestSection } from "../../lib/types";
import { Button, Modal, Spinner, fmtSeconds } from "../../components/ui";
import MathText from "../../components/MathText";

interface CurrentData {
  attempt: Attempt;
  test: Test;
  responses: SavedResponse[];
  modules: AttemptModule[];
}

type ModalKind = "grid" | "directions" | "reference" | "end";

const MATH_REFERENCE = [
  "Area of a circle: A = πr²",
  "Circumference of a circle: C = 2πr",
  "Area of a rectangle: A = lw",
  "Area of a triangle: A = ½bh",
  "Pythagorean theorem: a² + b² = c²",
  "Volume of a cylinder: V = πr²h",
  "Volume of a rectangular prism: V = lwh",
  "Quadratic formula: x = (-b ± √(b² − 4ac)) / 2a",
  "Slope of a line: m = (y₂ − y₁) / (x₂ − x₁)",
];

const RW_DIRECTIONS =
  "Each passage or pair of passages is followed by a number of questions. After reading each passage or pair, choose the best answer to each question based on what is stated or implied in the passage or passages and in any accompanying graphics (such as a table or graph).";

const MATH_DIRECTIONS =
  "For each question, choose the best answer from the four choices. For questions with an answer box, enter your answer as a decimal or a fraction (for example, 3/5). Unless directed otherwise, enter your answer in the format described in the question.";

export default function TestSessionPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<CurrentData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [moduleIdx, setModuleIdx] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, SavedResponse>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [autoFlag, setAutoFlag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [typedDraft, setTypedDraft] = useState("");

  const saveTimer = useRef<number | null>(null);
  const pendingTypedSave = useRef<{ qid: string; value: string } | null>(null);
  const enteredAt = useRef(Date.now());
  const moduleStart = useRef(Date.now());

  const allModules = useMemo(() => {
    if (!data) return [];
    return (data.test.sections ?? [])
      .flatMap((s: TestSection) => s.modules ?? [])
      .sort((a, b) => a.position - b.position);
  }, [data]);

  const module = allModules[moduleIdx] as TestModule | undefined;
  const questions = useMemo(() => {
    if (!module) return [];
    return [...module.questions].sort((a, b) => a.position - b.position);
  }, [module]);

  const current = questions[qIndex];

  // ---- load ----
  useEffect(() => {
    if (!attemptId) return;
    void (async () => {
      try {
        const token = await getToken();
        const res = await fnJson<CurrentData>(`student-attempts/current?attempt_id=${encodeURIComponent(attemptId)}`, { token });
        if (res.attempt.id !== attemptId) throw new Error("Loaded attempt does not match the current URL");
        setData(res);

        const mods = (res.test.sections ?? [])
          .flatMap((s: TestSection) => s.modules ?? [])
          .sort((a, b) => a.position - b.position);
        const idx = Math.max(0, mods.findIndex((m) => m.id === res.attempt.current_module_id));
        setModuleIdx(idx);
        setQIndex(Math.max(0, (res.attempt.current_question_position ?? 1) - 1));

        const map: Record<string, SavedResponse> = {};
        for (const r of res.responses) map[r.question_id] = r;
        setResponses(map);

        const am = res.modules.find((m) => m.module_id === mods[idx]?.id);
        if (am && am.seconds_left != null) setDeadline(Date.now() + am.seconds_left * 1000);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load attempt");
      }
    })();
  }, [attemptId]);

  // ---- timer tick ----
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  useEffect(() => {
    if (secondsLeft !== null && secondsLeft === 0 && !autoFlag && !submitting) {
      setAutoFlag(true);
      void submitModule();
    }
  }, [secondsLeft, autoFlag, submitting]);

  // ---- save ----
  const saveResponse = useCallback(
    async (qid: string, patch: Partial<SavedResponse>, waitForRemote = false) => {
      if (!data || !module) return;
      const prev = responses[qid];
      const next: SavedResponse = {
        attempt_id: data.attempt.id,
        question_id: qid,
        module_id: module.id,
        selected_choice_id: prev?.selected_choice_id ?? null,
        typed_answer: prev?.typed_answer ?? null,
        marked_for_review: prev?.marked_for_review ?? false,
        eliminated_choice_ids: prev?.eliminated_choice_ids ?? [],
        is_correct: prev?.is_correct ?? null,
        ...patch,
      };
      setResponses((r) => ({ ...r, [qid]: next }));
      const spent = Math.round((Date.now() - enteredAt.current) / 1000);
      const token = await getToken().catch(() => undefined);
      if (!token) return;
      const request = fnJson("student-responses", {
        method: "POST",
        token,
        body: {
          attempt_id: next.attempt_id,
          question_id: qid,
          module_id: next.module_id,
          selected_choice_id: next.selected_choice_id,
          typed_answer: next.typed_answer,
          marked_for_review: next.marked_for_review,
          eliminated_choice_ids: next.eliminated_choice_ids,
          time_spent_seconds: spent,
        },
      });
      if (waitForRemote) await request;
      else void request.catch(() => undefined);
    },
    [data, module, responses],
  );

  const saveTypedDebounced = useCallback(
    (qid: string, value: string) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      pendingTypedSave.current = { qid, value };
      saveTimer.current = window.setTimeout(() => {
        pendingTypedSave.current = null;
        void saveResponse(qid, { typed_answer: value.trim() || null });
      }, 600);
    },
    [saveResponse],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    setTypedDraft(responses[current.question_id]?.typed_answer ?? "");
  }, [current, responses]);

  async function flushPendingSave() {
    const pending = pendingTypedSave.current;
    if (!pending) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pendingTypedSave.current = null;
    await saveResponse(pending.qid, { typed_answer: pending.value.trim() || null }, true);
  }

  // ---- navigation ----
  function goTo(index: number) {
    setQIndex(Math.max(0, Math.min(questions.length - 1, index)));
    setTypedDraft(responses[questions[index]?.question_id]?.typed_answer ?? "");
    enteredAt.current = Date.now();
  }

  function nextModuleId(): string | null {
    return allModules[moduleIdx + 1]?.id ?? null;
  }

  async function submitModule() {
    if (!data || !module || submitting) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      await flushPendingSave();
      const nextId = nextModuleId();
      const spent = Math.max(1, Math.round((Date.now() - moduleStart.current) / 1000));
      if (nextId) {
        await fnJson("student-attempts/advance", {
          method: "POST",
          token,
          body: { attempt_id: data.attempt.id, module_id: nextId, time_spent_seconds: spent },
        });
        const nextIdx = moduleIdx + 1;
        setModuleIdx(nextIdx);
        setQIndex(0);
        setModal(null);
        setAutoFlag(false);
        moduleStart.current = Date.now();
        const nextAm = data.modules.find((m) => m.module_id === nextId);
        const limit = allModules[nextIdx]?.time_limit_minutes ?? 0;
        setDeadline(Date.now() + (nextAm?.seconds_left ?? limit * 60) * 1000);
      } else {
        await fnJson("student-submit", { method: "POST", token, body: { attempt_id: data.attempt.id } });
        navigate(`/student/scores/${data.attempt.id}`, { replace: true });
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="center-fill">
        <p>{loadError}</p>
        <Button variant="outline" onClick={() => navigate("/student")}>Back to home</Button>
      </div>
    );
  }

  if (!data || !module || !current) return <Spinner />;

  const resp = responses[current.question_id];
  const section = (data.test.sections ?? []).find((s: TestSection) => s.id === module.section_id);
  const answeredCount = questions.filter((q) => responses[q.question_id]?.selected_choice_id || responses[q.question_id]?.typed_answer).length;
  const markedCount = questions.filter((q) => responses[q.question_id]?.marked_for_review).length;
  const unanswered = questions.length - answeredCount;
  const hasPassage = !!current.question.passage?.content;
  const isLastModule = moduleIdx === allModules.length - 1;
  const isMath = section?.section_type === "math";

  const timerClass = secondsLeft === null ? "" : secondsLeft < 60 ? "danger" : secondsLeft < 300 ? "warn" : "";

  return (
    <div className="session-root">
      {/* ---------- top bar ---------- */}
      <div className="session-topbar">
        <div style={{ minWidth: 0 }}>
          <div className="t-title">{data.test.title}</div>
          <div className="t-sub">
            {section?.name ?? "Full-Length Test"} · {module.name} · Question {qIndex + 1} of {questions.length}
          </div>
        </div>
        <div className="session-tools">
          <span className={`timer-pill ${timerClass}`}>⏱ {secondsLeft === null ? "--:--" : fmtSeconds(secondsLeft)}</span>
          <button className="session-tool" onClick={() => setModal("directions")}>Directions</button>
          {isMath && <button className="session-tool" onClick={() => setModal("reference")}>Reference</button>}
          <button className="session-tool" onClick={() => setModal("grid")}>Review</button>
        </div>
      </div>

      {/* ---------- question area ---------- */}
      <div className="session-body">
        <div className="session-question-pane">
          {hasPassage && (
            <div className="session-panel left">
              <div key={current.question_id} className="q-anim">
                <div className="passage-text"><MathText text={current.question.passage!.content} /></div>
              </div>
            </div>
          )}
          <div className={`session-panel right${hasPassage ? "" : " solo"}`}>
            <div key={current.question_id} className="q-anim">
            <div className="q-number">
              <span>Question {qIndex + 1}</span>
              <button
                className={`mark-toggle ${resp?.marked_for_review ? "on" : ""}`}
                onClick={() => void saveResponse(current.question_id, { marked_for_review: !resp?.marked_for_review })}
              >
                {resp?.marked_for_review ? "✦ Marked for Review" : "✧ Mark for Review"}
              </button>
            </div>
            <p className="q-prompt"><MathText text={current.question.prompt} /></p>

            {current.question.stimulus_image_url && (
              <div style={{ margin: "12px 0" }}>
                <img
                  src={current.question.stimulus_image_url}
                  alt="Question stimulus"
                  style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8 }}
                />
              </div>
            )}

            {current.question.question_type === "multiple_choice" ? (
              <div className="choices">
                {[...current.question.choices].sort((a, b) => a.position - b.position).map((c) => {
                  const eliminated = resp?.eliminated_choice_ids?.includes(c.id) ?? false;
                  return (
                    <button
                      key={c.id}
                      className={`choice ${resp?.selected_choice_id === c.id ? "selected" : ""} ${eliminated ? "eliminated" : ""}`}
                      onClick={() => void saveResponse(current.question_id, { selected_choice_id: c.id, eliminated_choice_ids: resp?.eliminated_choice_ids?.filter((id) => id !== c.id) ?? [] })}
                    >
                      <span className="letter">{c.label}</span>
                      <span className="choice-text" style={{ flex: 1 }}><MathText text={c.text} /></span>
                      <span
                        className="eliminate-btn"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          void saveResponse(current.question_id, {
                            eliminated_choice_ids: eliminated
                              ? (resp?.eliminated_choice_ids ?? []).filter((id) => id !== c.id)
                              : [...(resp?.eliminated_choice_ids ?? []), c.id],
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.click();
                        }}
                      >
                        {eliminated ? "Restore" : "Eliminate"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid-in">
                <input
                  value={typedDraft}
                  placeholder="Enter your answer"
                  onChange={(e) => {
                    setTypedDraft(e.target.value);
                    saveTypedDebounced(current.question_id, e.target.value);
                  }}
                />
                <div className="hint">Enter a fraction such as 3/5 or a decimal such as 0.6.</div>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* ---------- bottom bar ---------- */}
        <div className="session-bottombar">
          <Button variant="outline" onClick={() => goTo(qIndex - 1)} disabled={qIndex === 0}>
            ← Back
          </Button>
          <div className="bottombar-center">
            <span className="q-position">
              Question {qIndex + 1} of {questions.length}
            </span>
            <button className="session-tool" style={{ color: "var(--primary-dark)", background: "var(--primary-soft)" }} onClick={() => setModal("grid")}>
              Question Grid
            </button>
          </div>
          {qIndex < questions.length - 1 ? (
            <Button onClick={() => goTo(qIndex + 1)}>Next →</Button>
          ) : (
            <Button onClick={() => setModal("end")}>{isLastModule ? "Submit Full-Length Test" : "Submit Module"}</Button>
          )}
        </div>
      </div>

      {/* ---------- modals ---------- */}
      {modal === "grid" && (
        <Modal title="Review Questions" onClose={() => setModal(null)}>
          <QuestionGrid
            questions={questions}
            qIndex={qIndex}
            responses={responses}
            onJump={(i) => {
              goTo(i);
              setModal(null);
            }}
          />
          <div style={{ display: "flex", gap: 18, marginTop: 20, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
            <span><span className="pill pill-red">A</span> answered</span>
            <span><span className="pill pill-gray">Q</span> unanswered</span>
            <span><span className="pill pill-amber">✦</span> marked for review</span>
          </div>
        </Modal>
      )}

      {modal === "end" && (
        <Modal
          title={isLastModule ? "Submit Full-Length Test" : "Submit Module"}
          onClose={() => {
            setModal(null);
            setAutoFlag(false);
          }}
          footer={
            <>
              <Button variant="outline" onClick={() => setModal(null)}>Back to Full-Length Test</Button>
              <Button disabled={submitting} onClick={() => void submitModule()}>
                {submitting ? "Submitting…" : isLastModule ? "Submit Full-Length Test" : "Submit Module"}
              </Button>
            </>
          }
        >
          <p>
            {autoFlag ? "Time is up. " : ""}You are about to submit this module. You will not be able to return to it.
          </p>
          <QuestionGrid
            questions={questions}
            qIndex={qIndex}
            responses={responses}
            onJump={(i) => {
              goTo(i);
              setModal(null);
            }}
          />
          <div style={{ display: "flex", gap: 18, marginTop: 20, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
            <span><span className="pill pill-green">{answeredCount}</span> answered</span>
            <span><span className="pill pill-gray">{unanswered}</span> unanswered</span>
            <span><span className="pill pill-amber">{markedCount}</span> marked</span>
          </div>
          {unanswered > 0 && (
            <div className="login-error" style={{ marginTop: 16 }}>
              You have {unanswered} unanswered question{unanswered === 1 ? "" : "s"}. Unanswered questions will be counted as incorrect.
            </div>
          )}
        </Modal>
      )}

      {modal === "directions" && (
        <Modal title="Directions" onClose={() => setModal(null)}>
          <p style={{ lineHeight: 1.7 }}>{isMath ? MATH_DIRECTIONS : RW_DIRECTIONS}</p>
          <p className="muted" style={{ fontSize: 13 }}>
            This module has {questions.length} questions and a {module.time_limit_minutes}-minute time limit. Your
            answers are saved automatically as you move through the full-length test.
          </p>
        </Modal>
      )}

      {modal === "reference" && (
        <Modal title="Reference — Math" onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {MATH_REFERENCE.map((f) => (
              <div key={f} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 13.5 }}>
                {f}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function QuestionGrid({
  questions,
  qIndex,
  responses,
  onJump,
}: {
  questions: TestModule["questions"];
  qIndex: number;
  responses: Record<string, SavedResponse>;
  onJump: (i: number) => void;
}) {
  return (
    <div className="qgrid">
      {questions.map((mq, i) => {
        const r = responses[mq.question_id];
        const answered = !!r?.selected_choice_id || !!r?.typed_answer;
        return (
          <button
            key={mq.question_id}
            className={`qcell${answered ? " answered" : " unanswered"}${r?.marked_for_review ? " marked" : ""}${i === qIndex ? " current" : ""}`}
            onClick={() => onJump(i)}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
