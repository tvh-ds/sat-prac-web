import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import QuestionAnnotationBoard, { BoardSurface } from "./QuestionAnnotationBoard";
import type { AnnotationQuestion } from "./QuestionAnnotationBoard";
import { loadAnnotations, saveAnnotation } from "../lib/reviewAnnotationStorage";
import type { ReviewAnnotation } from "../lib/reviewAnnotations";

async function fingerprint(question: AnnotationQuestion) {
  // Signed image URLs expire: exclude their tokens from the content fingerprint.
  const content = { prompt: question.prompt, passage: question.passage?.content, choices: question.choices,
    correct_answer: question.correct_answer, your_answer: question.your_answer,
    image_path: question.stimulus_image_url?.split("?")[0] };
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(content)));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function useAssignmentAnnotations(scope: string, questions: AnnotationQuestion[], title: string) {
  const [annotations, setAnnotations] = useState<Record<string, ReviewAnnotation>>({});
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [active, setActive] = useState<AnnotationQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);
  const questionKey = useMemo(() => JSON.stringify(questions), [questions]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setAnnotations({}); setActive(null);
    void (async () => {
      try {
        const current: AnnotationQuestion[] = JSON.parse(questionKey);
        const [rows, pairs] = await Promise.all([loadAnnotations(scope), Promise.all(current.map(async q => [q.question_id, await fingerprint(q)] as const))]);
        if (cancelled) return;
        const h = Object.fromEntries(pairs);
        setHashes(h); setAnnotations(Object.fromEntries(rows.filter(row => row.content_hash === h[row.question_id]).map(row => [row.question_id, row.document])));
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load annotations."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [scope, questionKey, reload]);
  const savedQuestions = questions.filter(q => annotations[q.question_id]);
  const annotate = useCallback((q: AnnotationQuestion) => setActive(q), []);
  return {
    annotate,
    button: (q: AnnotationQuestion) => <Button size="sm" variant="outline" disabled={loading || Boolean(error)} onClick={() => annotate(q)}>{annotations[q.question_id] ? "Edit annotation" : "Annotate"}</Button>,
    toolbar: <div className="annotation-review-toolbar">
      <Button variant="outline" disabled={loading || Boolean(error) || !savedQuestions.length} onClick={() => setExporting(true)}>Export reviews ({savedQuestions.length})</Button>
      <span role="status" className="muted">{loading ? "Loading annotations…" : "Saved privately to your administrator account."}</span>
      {error && <div role="alert">{error} <Button size="sm" variant="ghost" onClick={() => setReload(r => r + 1)}>Retry</Button></div>}
    </div>,
    overlay: <>
      {active && <QuestionAnnotationBoard key={`${scope}:${active.question_id}`} question={active} initial={annotations[active.question_id]} onClose={() => setActive(null)} onSave={async document => {
        await saveAnnotation(scope, active.question_id, hashes[active.question_id], document);
        setAnnotations(a => ({ ...a, [active.question_id]: document }));
      }} />}
      {exporting && <AnnotationExport title={title} questions={savedQuestions} annotations={annotations} onClose={() => setExporting(false)} />}
    </>,
  };
}

export function AnnotationExport({ title, questions, annotations, onClose }: {
  title: string; questions: AnnotationQuestion[]; annotations: Record<string, ReviewAnnotation>; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousTitle = document.title;
    document.title = `${title} — annotated reviews`;
    document.body.classList.add("annotation-export-active");
    root.current?.focus();
    let cancelled = false;
    void (async () => {
      await document.fonts.ready;
      const images = [...(root.current?.querySelectorAll("img") ?? [])];
      await Promise.all(images.map(image => image.decode().catch(() => {})));
      if (!cancelled) setReady(true);
    })();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons?.[0], last = buttons?.[buttons.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { cancelled = true; document.title = previousTitle; document.body.classList.remove("annotation-export-active"); document.removeEventListener("keydown", key, true); previous?.focus(); };
  }, [onClose, title]);
  return createPortal(<div className="annotation-export" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Export annotated reviews">
    <div className="annotation-export-toolbar"><div><strong>Export {questions.length} saved reviews</strong><p>Select “Save as PDF” in the print dialog. Enable background graphics for blackboards.</p></div>
      <Button disabled={!ready} onClick={() => window.print()}>{ready ? "Print / Save as PDF" : "Preparing…"}</Button><Button variant="outline" onClick={onClose}>Close export</Button></div>
    {questions.map(q => <section className="annotation-export-page" key={q.question_id}><h2>{title} · Question {q.question_number}</h2><BoardSurface question={q} annotation={annotations[q.question_id]} /></section>)}
  </div>, document.body);
}
