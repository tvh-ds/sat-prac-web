import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fnJson, getToken, supabase } from "../../lib/supabase";
import type { DraftQuestion, DraftSummary, ImportDetailSummary, ModuleSummary, PdfImport } from "../../lib/types";
import { Button, Modal, Pill, Spinner, fmtDate } from "../../components/ui";
import { CropImageModal } from "../../components/CropImageModal";
import MathText from "../../components/MathText";
import KeyStatusBadge, { keyStatusInfo } from "../../components/KeyStatusBadge";
import { polishTestTitle, EXPECTED_MODULE_COUNTS } from "../../lib/testTitle";
import { ImportStatus } from "./AdminDashboard";

export default function ImportDetailPage() {
  const { importId } = useParams<{ importId: string }>();
  const navigate = useNavigate();
  const [importInfo, setImportInfo] = useState<PdfImport | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftTotal, setDraftTotal] = useState(0);
  const [draftOffset, setDraftOffset] = useState(0);
  const [draftLimit, setDraftLimit] = useState(50);
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});
  const [moduleSummary, setModuleSummary] = useState<ModuleSummary[]>([]);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftModule, setDraftModule] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DraftQuestion>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ test_id: string; title: string; linked: number; failed: number; already_generated?: boolean } | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const draftStatusRef = useRef<string | null>(null);
  const draftModuleRef = useRef<string | null>(null);
  offsetRef.current = draftOffset;
  selectedRef.current = selectedId;
  draftStatusRef.current = draftStatus;
  draftModuleRef.current = draftModule;

  const loadPage = useCallback(async (offset: number) => {
    if (!importId) return;
    const token = await getToken();
    const params = new URLSearchParams({ draft_limit: "50", draft_offset: String(offset) });
    const status = draftStatusRef.current;
    if (status) params.set("draft_status", status);
    const mod = draftModuleRef.current;
    if (mod) params.set("draft_module", mod);
    const d = await fnJson<ImportDetailSummary>(`admin-pdf-imports/${importId}?${params.toString()}`, { token });
    setImportInfo(d.import);
    setDrafts(d.drafts);
    setDraftTotal(d.draft_total);
    setDraftOffset(d.draft_offset);
    setDraftLimit(d.draft_limit);
    setDraftCounts(d.draft_counts);
    setModuleSummary(d.module_summary ?? []);
  }, [importId]);

  useEffect(() => {
    void loadPage(0).catch((e) => setError(e.message));
  }, [loadPage, draftStatus, draftModule]);

  async function openDraft(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
    if (details[id]) return;
    setLoadingDetailId(id);
    try {
      const token = await getToken();
      const d = await fnJson<{ draft: DraftQuestion }>(`admin-pdf-imports/${importId}/drafts/${id}`, { token });
      setDetails((prev) => ({ ...prev, [id]: d.draft }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load draft");
    } finally {
      setLoadingDetailId((cur) => (cur === id ? null : cur));
    }
  }

  useEffect(() => {
    if (selectedId && details[selectedId] && editorRef.current) {
      editorRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId, details, loadingDetailId]);

  async function refresh() {
    const offset = offsetRef.current;
    await loadPage(offset);
    const sel = selectedRef.current;
    if (sel) {
      const token = await getToken();
      const d = await fnJson<{ draft: DraftQuestion }>(`admin-pdf-imports/${importId}/drafts/${sel}`, { token });
      setDetails((prev) => ({ ...prev, [sel]: d.draft }));
    }
  }

  async function approveFullDraft() {
    setGenerating(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fnJson<{ test_id: string; title: string; linked: number; failed: number; already_generated?: boolean }>(
        `admin-pdf-imports/${importId}/generate-test`,
        { method: "POST", token },
      );
      setGenerateResult(res);
      await loadPage(offsetRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Full-draft approval failed");
    } finally {
      setGenerating(false);
    }
  }

  if (error) {
    return (
      <div className="center-fill">
        <p>{error}</p>
        <Button variant="outline" onClick={() => navigate("/admin/imports")}>Back</Button>
      </div>
    );
  }
  if (!importInfo) return <Spinner />;

  const selectedDetail = selectedId ? details[selectedId] ?? null : null;
  const pageStart = draftOffset + 1;
  const pageEnd = Math.min(draftOffset + draftLimit, draftTotal);
  const pageIdx = Math.floor(draftOffset / draftLimit);
  const maxPageIdx = Math.max(0, Math.ceil(draftTotal / draftLimit) - 1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 className="page-title">{polishTestTitle(importInfo.original_filename)}</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            <span className="muted">{importInfo.original_filename}</span> · Uploaded {fmtDate(importInfo.created_at)} · <ImportStatus status={importInfo.status} /> · {draftTotal} drafts
            <span style={{ marginLeft: 8 }}>
              <Pill tone="gray">{importInfo.extraction_method ?? "text"} extract</Pill>
            </span>
            <span style={{ marginLeft: 8 }}>
              key <KeyStatusBadge imp={importInfo} />
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {importInfo.generated_test_id ? (
            <Button variant="outline" onClick={() => navigate(`/admin/tests/${importInfo.generated_test_id}/build`)}>
              Open Full-Length Test
            </Button>
          ) : (
            importInfo.status === "completed" && (
              <Button disabled={generating || busy} onClick={() => void approveFullDraft()}>
                {generating ? "Assembling…" : "Approve Full Draft"}
              </Button>
            )
          )}
          <Button variant="outline" onClick={() => navigate("/admin/imports")}>Back</Button>
        </div>
      </div>

      {(() => {
        const ks = keyStatusInfo(importInfo);
        if (!ks.status || ks.status === "complete") return null;
        return (
          <div className="panel" style={{ marginTop: 18, borderColor: "var(--border-medium)" }}>
            <h3 style={{ margin: "0 0 8", fontSize: 15 }}>Answer key — {ks.label}{ks.detail ? ` · ${ks.detail}` : ""}</h3>
            {ks.warnings.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                {ks.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{w}</li>
                ))}
              </ul>
            )}
            {ks.warnings.length === 0 && ks.detail && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Check module counts above before trusting suggested keys.</p>
            )}
          </div>
        );
      })()}

      {importInfo.error_message && <div className="login-error" style={{ marginTop: 14 }}>{importInfo.error_message}</div>}

      {(importInfo.text_quality?.parser_warnings?.length ?? 0) > 0 && (
        <div className="panel" style={{ marginTop: 18, borderColor: "var(--border-medium)" }}>
          <h3 style={{ margin: "0 0 8", fontSize: 15 }}>Parser warnings</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
            {(importInfo.text_quality?.parser_warnings ?? []).map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{w}</li>
            ))}
          </ul>
          {(importInfo.text_quality?.incomplete_modules?.length ?? 0) > 0 && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              Incomplete: {(importInfo.text_quality?.incomplete_modules ?? []).map((m) => `${m.module} ${m.actual}/${m.expected}`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {generateResult && generateResult.failed > 0 && !importInfo.generated_test_id && (
        <div className="login-error" style={{ marginTop: 14, borderColor: "var(--border-medium)" }}>
          {generateResult.failed} draft(s) could not be approved and were skipped.
        </div>
      )}

      {importInfo.generated_test_id && (
        <div className="panel" style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: 15 }}>Full-length test generated</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Linked {moduleSummary.reduce((n, m) => n + m.approved, 0)}/{draftTotal} drafts into a test named to match this PDF.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate(`/admin/tests/${importInfo.generated_test_id}/build`)}>Edit test</Button>
        </div>
      )}

      {moduleSummary.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 12", fontSize: 15 }}>Draft modules</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
            {moduleSummary.map((m) => {
              const expected = EXPECTED_MODULE_COUNTS[m.module];
              const ready = m.approved;
              const needsWork = m.total - m.approved - m.rejected;
              return (
                <div key={m.module} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{m.module}</strong>
                    <Pill tone={ready >= (expected ?? Infinity) ? "green" : "amber"}>
                      {ready}/{m.total}
                    </Pill>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
                    {expected ? `${expected} expected` : `${m.section === "math" ? "Math" : "R&W"} drafts`}
                    {` · key ${m.with_key}/${m.total}`}
                    {needsWork > 0 ? ` · ${needsWork} not approved yet` : ""}
                    {m.rejected > 0 ? ` · ${m.rejected} rejected` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Drafts ({draftTotal}{draftStatus ? ` · ${draftStatus.replace(/_/g, " ")}` : ""}{draftModule ? ` · ${draftModule}` : ""})</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`draft-filter${!draftStatus ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setDraftStatus(null);
              }}
            >
              All
            </button>
            <button
              type="button"
              className={`draft-filter${draftStatus === "needs_review" ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setDraftStatus("needs_review");
              }}
            >
              Needs review ({draftCounts.needs_review ?? 0})
            </button>
          </div>
        </div>
        {moduleSummary.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              className={`draft-filter${!draftModule ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                setDraftModule(null);
              }}
            >
              All modules
            </button>
            {moduleSummary.map((m) => (
              <button
                key={m.module}
                type="button"
                className={`draft-filter${draftModule === m.module ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(null);
                  setDraftModule((prev) => (prev === m.module ? null : m.module));
                }}
              >
                {m.module} ({m.total})
              </button>
            ))}
          </div>
        )}
        {drafts.length === 0 && <p className="muted">No drafts yet.</p>}
        {drafts.map((d) => (
          <div key={d.id}>
            <button
              className={`draft-card${d.id === selectedId ? " selected" : ""}`}
              style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}
              onClick={() => void openDraft(d.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <strong>
                  Q{d.source_question_number} · {d.section === "math" ? "Math" : "Reading & Writing"}
                  {d.source_module_name ? ` · ${d.source_module_name}` : ""}
                </strong>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {d.has_visual_stimulus && <Pill tone="amber">Visual</Pill>}
                  <DraftStatus d={d} />
                </div>
              </div>
              <div style={{ fontSize: 13.5, margin: 0 }}><MathText text={d.prompt.slice(0, 120)} /></div>
            </button>
            {d.id === selectedId && (
              <div className="draft-inline-editor" ref={editorRef}>
                {selectedDetail ? (
                  <DraftEditor
                    key={d.id}
                    draft={selectedDetail}
                    onSaved={() => void refresh()}
                    onReject={() => setRejectId(d.id)}
                    busy={busy}
                    setBusy={setBusy}
                    onError={setError}
                  />
                ) : (
                  <div style={{ padding: 18, textAlign: "center" }}>
                    <Spinner />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {pageStart}-{pageEnd} of {draftTotal}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" disabled={pageIdx === 0 || busy} onClick={() => void loadPage((pageIdx - 1) * draftLimit)}>← Prev</Button>
            <Button variant="outline" disabled={pageIdx >= maxPageIdx || busy} onClick={() => void loadPage((pageIdx + 1) * draftLimit)}>Next</Button>
          </div>
        </div>
      </div>

      {rejectId && (
        <Modal
          title="Reject Draft"
          onClose={() => setRejectId(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const token = await getToken();
                      await fnJson(`admin-pdf-imports/${importId}/drafts/${rejectId}/reject`, { method: "POST", token });
                      setRejectId(null);
                      setSelectedId((prev) => (prev === rejectId ? null : prev));
                      await loadPage(offsetRef.current);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Reject failed");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Reject
              </Button>
            </>
          }
        >
          <p>The draft will be marked as rejected and will not be published. You can still edit it before rejecting.</p>
        </Modal>
      )}
    </div>
  );
}

function DraftStatus({ d }: { d: { status: string } }) {
  const map: Record<string, [string, "green" | "amber" | "red" | "gray"]> = {
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    has_suggested_key: ["Suggested key", "amber"],
    missing_key: ["Missing key", "red"],
    needs_review: ["Needs review", "gray"],
  };
  const [label, tone] = map[d.status] ?? [d.status, "gray"];
  return <Pill tone={tone}>{label}</Pill>;
}

function DraftEditor({
  draft,
  onSaved,
  onReject,
  busy,
  setBusy,
  onError,
}: {
  draft: DraftQuestion;
  onSaved: () => void;
  onReject: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (e: string) => void;
}) {
  const [prompt, setPrompt] = useState(draft.prompt);
  const [passage, setPassage] = useState(draft.passage_text ?? "");
  const [choices, setChoices] = useState(draft.choices.map((c) => ({ id: c.id, label: c.label, text: c.text, position: c.position })));
  const [correct, setCorrect] = useState(draft.suggested_answer ?? "");
  const [domain, setDomain] = useState(draft.domain ?? "");
  const [skill, setSkill] = useState(draft.skill ?? "");
  const [explanation, setExplanation] = useState(draft.explanation ?? "");
  const [cropOpen, setCropOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => { setShowFull(false); setCropOpen(false); }, [draft.id]);

  async function saveCrop(blob: Blob, rect: { x: number; y: number; w: number; h: number }) {
    setBusy(true);
    try {
      const token = await getToken();
      const key = draft.source_question_id ?? String(draft.source_question_number);
      const path = `imports/${draft.pdf_import_id}/stimuli/${key}-manual-crop.png`;
      const { error: upErr } = await supabase.storage.from("question-assets").upload(path, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}`, {
        method: "PATCH",
        token,
        body: {
          stimulus_image_path: path,
          stimulus_crop_rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
          stimulus_crop_source: "manual",
          stimulus_crop_status: "confirmed",
        },
      });
      setCropOpen(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Crop save failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCrop() {
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}/confirm-crop`, { method: "POST", token });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetCrop() {
    setBusy(true);
    try {
      const token = await getToken();
      const key = draft.source_question_id ?? String(draft.source_question_number);
      const fullPage = `imports/${draft.pdf_import_id}/stimuli/${key}-page-${draft.page_number}.png`;
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}`, {
        method: "PATCH",
        token,
        body: {
          stimulus_image_path: fullPage,
          stimulus_crop_rect: null,
          stimulus_crop_source: "full_page",
          stimulus_crop_status: "confirmed",
        },
      });
      setShowFull(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    if (!window.confirm("Remove the stimulus image from this draft? The question will become text-only and any crop review requirement will be cleared.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}`, {
        method: "PATCH",
        token,
        body: { has_visual_stimulus: false },
      });
      setShowFull(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  /** Persist every editable field so approval publishes what the admin sees. */
  async function saveDraft() {
    const token = await getToken();
    await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}`, {
      method: "PATCH",
      token,
      body: {
        prompt,
        passage_text: passage.trim() ? passage : null,
        suggested_answer: correct || null,
        domain: domain || null,
        skill: skill || null,
        explanation: explanation || null,
        ...(draft.question_type === "multiple_choice" && { choices: choices.map((c) => ({ label: c.label, text: c.text, position: c.position })) }),
      },
    });
  }

  async function handleSave() {
    setBusy(true);
    setSavedNote(null);
    try {
      await saveDraft();
      setSavedNote("Draft saved.");
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      // Save first: approval reads the draft row, so edited prompt, passage,
      // choices, and key must be persisted before publishing.
      await saveDraft();
      const token = await getToken();
      await fnJson(`admin-pdf-imports/${draft.pdf_import_id}/drafts/${draft.id}/approve`, {
        method: "POST",
        token,
        body: {},
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Q{draft.source_question_number} — {draft.section === "math" ? "Math" : "Reading & Writing"} ({draft.question_type === "multiple_choice" ? "Multiple choice" : "Student-produced"})
          {draft.source_module_name ? <span className="muted" style={{ fontSize: 12.5 }}> · {draft.source_module_name}</span> : null}
        </h3>
        <DraftStatus d={draft} />
      </div>

      <label className="field-label">Prompt</label>
      <textarea className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      {prompt.trim() && (
        <div style={{ marginTop: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 13.5 }}>
          <span className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Preview (equations rendered)</span>
          <MathText text={prompt} />
        </div>
      )}

      <label className="field-label" style={{ marginTop: 12 }}>Passage (editable — clear to remove)</label>
      <textarea className="textarea" rows={4} value={passage} onChange={(e) => setPassage(e.target.value)} placeholder="No passage" />
      {passage.trim() && (
        <div style={{ marginTop: 8, background: "var(--passage-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 13.5, maxHeight: 180, overflowY: "auto" }}>
          <MathText text={passage} />
        </div>
      )}

      {draft.has_visual_stimulus && !draft.stimulus_image_url && (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Stimulus Image</label>
          <div className="draft-visual-missing">
            Visual stimulus detected, but the full-page image has not been rendered yet. Run the stimulus backfill, then this question will show a Crop Graph tool.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeImage()}>Remove image</Button>
          </div>
        </div>
      )}

      {draft.stimulus_image_url && (
        <>
          <label className="field-label" style={{ marginTop: 12 }}>
            Stimulus Image{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {draft.has_visual_stimulus && draft.stimulus_crop_status === "pending" && draft.stimulus_crop_source === "auto" && "(auto-cropped — review required)"}
              {draft.has_visual_stimulus && draft.stimulus_crop_status === "pending" && draft.stimulus_crop_source !== "auto" && "(full page — review required)"}
              {draft.has_visual_stimulus && draft.stimulus_crop_status !== "pending" && draft.stimulus_crop_source === "manual" && "(manually adjusted)"}
              {draft.has_visual_stimulus && draft.stimulus_crop_status !== "pending" && draft.stimulus_crop_source === "auto" && "(auto-cropped)"}
            </span>
          </label>
          <img
            src={showFull ? (draft.stimulus_source_image_url ?? draft.stimulus_image_url) : draft.stimulus_image_url}
            alt={`Stimulus for Q${draft.source_question_number}`}
            style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8, marginTop: 4 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {draft.has_visual_stimulus && draft.stimulus_crop_status === "pending" && (
              <Button size="sm" disabled={busy} onClick={() => void confirmCrop()}>✓ Confirm crop</Button>
            )}
            {draft.stimulus_source_image_url && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowFull((v) => !v)}>
                {showFull ? "View crop" : "View full page"}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy || !draft.stimulus_source_image_url} title={draft.stimulus_source_image_url ? "Adjust on the full-page source" : "Full-page source not available"} onClick={() => setCropOpen(true)}>✂ Adjust crop</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resetCrop()}>Reset to full page</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeImage()}>Remove image</Button>
          </div>
        </>
      )}

      {draft.question_type === "multiple_choice" && (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Choices</label>
          {choices.map((c) => (
            <div className="choice-edit" key={c.id}>
              <span className="letter" style={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid var(--border-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>
                {c.label}
              </span>
              <input
                className="input"
                value={c.text}
                onChange={(e) => setChoices((cs) => cs.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="field-label">Correct answer</label>
          <input className="input" value={correct} onChange={(e) => setCorrect(e.target.value)} placeholder={draft.question_type === "multiple_choice" ? "B" : "24 or 3/5"} />
        </div>
        <div>
          <label className="field-label">Domain</label>
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. Algebra" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="field-label">Skill</label>
        <input className="input" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="e.g. Linear equations" />
      </div>

      {draft.difficulty != null && (
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Difficulty</label>
          <span className="muted">{draft.difficulty === 1 ? "Easy" : draft.difficulty === 3 ? "Medium" : draft.difficulty === 5 ? "Hard" : draft.difficulty}</span>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label className="field-label">Explanation</label>
        <textarea className="textarea" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Optional explanation for this question" />
      </div>

      {draft.source_question_id && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Source ID: {draft.source_question_id}
        </p>
      )}

      {draft.answer_keys.length > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Detected answer{Object.values(draft.answer_keys.map((k) => k.detected_answer)).join(", ")} — confidence{" "}
          {Math.round((draft.answer_keys[0]?.confidence ?? 0) * 100)}%. Verify before approving.
        </p>
      )}

      {savedNote && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{savedNote}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
        <Button variant="danger" disabled={busy} onClick={onReject}>Reject</Button>
        <Button variant="outline" disabled={busy} onClick={() => void handleSave()}>{busy ? "Saving…" : "Save draft"}</Button>
        <Button disabled={busy} onClick={() => void approve()}>{busy ? "Saving…" : "Approve & Publish"}</Button>
      </div>

      {cropOpen && (draft.stimulus_source_image_url ?? draft.stimulus_image_url) && (
        <CropImageModal
          title={`Crop Graph — Q${draft.source_question_number}`}
          src={(draft.stimulus_source_image_url ?? draft.stimulus_image_url)!}
          initialRect={draft.stimulus_crop_source === "auto" ? (draft.stimulus_crop_rect ?? null) : null}
          onCancel={() => {
            if (!busy) setCropOpen(false);
          }}
          onSave={saveCrop}
        />
      )}
    </div>
  );
}
