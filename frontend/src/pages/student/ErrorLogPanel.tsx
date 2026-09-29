import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  NotebookPen,
  Save,
} from "lucide-react";
import { EmptyState, Pill } from "../../components/ui";
import MathText from "../../components/MathText";
import PassageBlock from "../../components/PassageBlock";
import { fnJson, getToken } from "../../lib/supabase";
import type { ErrorLogItem, ErrorLogPage } from "../../lib/types";

interface ErrorLogPanelProps {
  studentName: string;
}

interface SavedReview {
  note_text: string;
  reviewed_at: string | null;
}

export default function ErrorLogPanel({ studentName }: ErrorLogPanelProps) {
  const [data, setData] = useState<ErrorLogPage | null>(null);
  const [page, setPage] = useState(1);
  const [domain, setDomain] = useState("all");
  const [skill, setSkill] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const params = new URLSearchParams({ page: String(page) });
        if (domain !== "all") params.set("domain", domain);
        if (skill !== "all") params.set("skill", skill);
        const result = await fnJson<ErrorLogPage>(`student-scores/error-log?${params.toString()}`, { token });
        if (current) setData(result);
      } catch (loadError) {
        if (current) setError(loadError instanceof Error ? loadError.message : "Unable to load your error log.");
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [page, domain, skill, retry]);

  const handleSaved = useCallback((itemId: string, review: SavedReview) => {
    setData((previous) => {
      if (!previous) return previous;
      const existing = previous.items.find((item) => item.item_id === itemId);
      if (!existing) return previous;
      const wasNeedsReview = existing.reviewed_at === null;
      const isNeedsReview = review.reviewed_at === null;
      return {
        ...previous,
        needs_review_count: Math.max(0, previous.needs_review_count + Number(isNeedsReview) - Number(wasNeedsReview)),
        items: previous.items.map((item) => item.item_id === itemId ? { ...item, ...review } : item),
      };
    });
  }, []);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.page_size ?? 10)));
  const firstItem = data && data.total > 0 ? (page - 1) * data.page_size + 1 : 0;
  const lastItem = data ? Math.min(page * data.page_size, data.total) : 0;
  const filtersAvailable = useMemo(() => Boolean(data?.domains.length || data?.skills.length), [data]);

  return (
    <div className="error-log-section" aria-busy={loading}>
      <div className="error-log-intro">
        <div className="error-log-welcome">
          <div className="section-label">Error Log</div>
          <h2>Hey {studentName}, time to do some reviewing!</h2>
        </div>
        <div className="error-log-count" aria-live="polite">
          <span className="error-log-count-label">Need Review</span>
          <strong>{data ? data.needs_review_count : "—"}</strong>
          <span>{data?.needs_review_count === 1 ? "question to revisit" : "questions to revisit"}</span>
        </div>
        <div className="error-log-toolbar">
          <div className="filter-row error-log-filters">
            <label>
              <span>Domain</span>
              <select
                className="input"
                value={domain}
                onChange={(event) => { setDomain(event.target.value); setSkill("all"); setPage(1); }}
                disabled={loading && !data}
              >
                <option value="all">All domains</option>
                {(data?.domains ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Skill</span>
              <select
                className="input"
                value={skill}
                onChange={(event) => { setSkill(event.target.value); setPage(1); }}
                disabled={loading && !data}
              >
                <option value="all">All skills</option>
                {(data?.skills ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-log-load-error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      )}

      {loading && !data ? (
        <div className="error-log-placeholder" role="status">Loading questions to review…</div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          title={filtersAvailable ? "No questions match these filters" : "Nothing to review yet"}
          body={filtersAvailable ? "Choose another domain or skill to see more questions." : "Incorrect and unanswered questions from your completed attempts will appear here."}
        />
      ) : data ? (
        <>
          {loading && <div className="error-log-updating" role="status">Updating list…</div>}
          <div className="error-log-list">
            {data.items.map((item) => (
              <ErrorLogCard key={item.item_id} item={item} onSaved={handleSaved} />
            ))}
          </div>
          <nav className="error-log-pagination" aria-label="Error log pagination">
            <span>Showing {firstItem}–{lastItem} of {data.total}</span>
            <div className="error-log-page-controls">
              <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
                Previous
              </button>
              <span>Page {page} of {pageCount}</span>
              <button className="btn btn-secondary btn-sm" type="button" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>
                Next
              </button>
            </div>
          </nav>
        </>
      ) : null}
    </div>
  );
}

function ErrorLogCard({ item, onSaved }: { item: ErrorLogItem; onSaved: (itemId: string, review: SavedReview) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.note_text);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setNoteDraft(item.note_text), [item.note_text]);

  const saveReview = async (reviewed: boolean) => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getToken();
      const result = await fnJson<{ review: SavedReview }>("student-scores/error-log/review", {
        method: "POST",
        token,
        body: {
          attempt_id: item.attempt_id,
          question_id: item.question_id,
          note: noteDraft,
          reviewed,
        },
      });
      onSaved(item.item_id, result.review);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save your note. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const isReviewed = Boolean(item.reviewed_at);
  const selectedChoice = item.choices.find((choice) => choice.id === item.selected_choice_id);
  const correctAnswerText = item.correct_answers.length > 0
    ? item.correct_answers.map((answer) => `${answer.label}. ${answer.text}`).join(" · ")
    : item.correct_answer ?? "Answer unavailable";

  return (
    <article className={`error-log-item${expanded ? " is-expanded" : ""}`}>
      <div className="error-log-item-head">
        <button
          className="error-log-question-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="error-log-question-number">Q{item.question_number}</span>
          <span className="error-log-question-prompt"><MathText text={item.prompt ?? "Question text unavailable"} /></span>
          {expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
        </button>
        {expanded && (
          <div className="error-log-item-actions">
            <span className={`error-log-state${isReviewed ? " reviewed" : " needs-review"}`}>
              {isReviewed ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {isReviewed ? "Reviewed" : "Needs Review"}
            </span>
            <button
              className={`error-log-notes-toggle${notesOpen ? " active" : ""}`}
              type="button"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((value) => !value)}
            >
              <NotebookPen size={15} /> Notes
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="error-log-item-meta">
          <span>{item.attempt_title}</span>
          {item.submitted_at && <><span aria-hidden="true">·</span><span>{new Date(item.submitted_at).toLocaleDateString()}</span></>}
          <span aria-hidden="true">·</span>
          <span>{[item.domain, item.skill].filter(Boolean).join(" · ") || "No topic"}</span>
          <Pill tone={item.unanswered ? "amber" : "red"}>{item.unanswered ? "Unanswered" : "Incorrect"}</Pill>
          {item.marked_for_review && <Pill tone="amber"><Bookmark size={12} /> Flagged</Pill>}
        </div>
      )}

      {notesOpen && (
        <div className="error-log-note-panel">
          <label htmlFor={`error-note-${item.item_id}`}>Notes for this question</label>
          <textarea
            id={`error-note-${item.item_id}`}
            className="input error-log-note-input"
            value={noteDraft}
            maxLength={3000}
            placeholder="What will you remember next time?"
            onChange={(event) => setNoteDraft(event.target.value)}
          />
          <div className="error-log-note-footer">
            <span>{noteDraft.length}/3000</span>
            <div>
              <button className="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={() => void saveReview(isReviewed)}>
                <Save size={14} /> {saving ? "Saving…" : "Save note"}
              </button>
              <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={() => void saveReview(!isReviewed)}>
                {saving ? "Saving…" : isReviewed ? "Mark needs review" : "Mark reviewed"}
              </button>
            </div>
          </div>
          {saveError && <p className="error-log-note-error" role="alert">{saveError}</p>}
        </div>
      )}

      {expanded && (
        <div className="error-log-question-detail">
          {item.passage && <PassageBlock passage={item.passage} compact />}
          {item.stimulus_image_url && (
            <img className="error-log-stimulus" src={item.stimulus_image_url} alt="Question stimulus" />
          )}
          {item.question_type === "multiple_choice" ? (
            <div className="review-choices">
              {item.choices.map((choice) => {
                const selected = choice.id === item.selected_choice_id;
                const style = choice.is_correct ? "correct-ans" : selected ? "wrong-sel" : "";
                return (
                  <div className={`rev-choice ${style}`} key={choice.id}>
                    <span className="letter">{choice.label}</span>
                    <span className="error-log-choice-text"><MathText text={choice.text} /></span>
                    {choice.is_correct && <span className="error-log-answer-label correct">Correct answer</span>}
                    {selected && !choice.is_correct && <span className="error-log-answer-label incorrect">Your answer</span>}
                  </div>
                );
              })}
              {item.unanswered && <div className="error-log-unanswered">Your answer: Not answered</div>}
            </div>
          ) : (
            <div className="answer-chips">
              <div className={`chip ${item.unanswered ? "chip-muted" : "chip-bad"}`}>
                Your answer: {selectedChoice ? `${selectedChoice.label}. ${selectedChoice.text}` : item.your_answer ?? "Not answered"}
              </div>
              <div className="chip chip-ok">Correct: {item.correct_answer ?? "—"}</div>
            </div>
          )}
          {!item.unanswered && item.question_type === "multiple_choice" && (
            <div className="error-log-answer-summary">
              <span><strong>Correct:</strong> {correctAnswerText}</span>
              <span><strong>Your answer:</strong> {item.your_answer ?? "Not answered"}</span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
