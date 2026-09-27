import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { pdfImportCreateSchema, approveDraftSchema, updateDraftSchema, saveDraftEditorSchema, manualImportDraftCreateSchema, aiFindingDecisionSchema } from "../_shared/validation.ts";
import { approveDraft } from "../_shared/drafts.ts";
import { moduleGroup, groupByModuleKey } from "../_shared/modules.ts";
import { summarizePdfImportReadiness, type ImportReadinessDraft } from "../_shared/importReadiness.ts";

const WORKER_URL = Deno.env.get("WORKER_URL");
const WORKER_AUTH_TOKEN = Deno.env.get("WORKER_AUTH_TOKEN");

async function triggerWorker(importId: string): Promise<void> {
  if (!WORKER_URL) return;
  if (!WORKER_AUTH_TOKEN) throw new HttpError(500, "WORKER_AUTH_TOKEN is not configured");
  await fetch(`${WORKER_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_AUTH_TOKEN}` },
    body: JSON.stringify({ import_id: importId }),
  }).catch((e) => console.error("Worker trigger failed:", e.message));
}

async function triggerAiReview(importId: string, force = false): Promise<void> {
  if (!WORKER_URL) throw new HttpError(503, "AI review worker is not configured");
  if (!WORKER_AUTH_TOKEN) throw new HttpError(500, "WORKER_AUTH_TOKEN is not configured");
  const response = await fetch(`${WORKER_URL}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_AUTH_TOKEN}` },
    body: JSON.stringify({ import_id: importId, force }),
  });
  if (!response.ok) throw new HttpError(502, "AI review worker could not accept the job");
}

async function loadReviewSummary(svc: ReturnType<typeof serviceClient>, importId: string) {
  const [{ data: job, error: jobErr }, { data: routes, error: routeErr }, { data: imp, error: importErr }] = await Promise.all([
    svc.from("ai_ingestion_review_jobs")
      .select("id,status,model,prompt_version,reviewed_drafts,failed_drafts,estimated_cost_usd,started_at,finished_at,error_category")
      .eq("pdf_import_id", importId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    svc.from("draft_questions").select("review_state,status,suggested_answer,has_visual_stimulus,stimulus_crop_status,assigned_module_name").eq("pdf_import_id", importId),
    svc.from("pdf_imports").select("deterministic_review_status,text_quality").eq("id", importId).maybeSingle(),
  ]);
  if (jobErr) throw new HttpError(500, jobErr.message);
  if (routeErr) throw new HttpError(500, routeErr.message);
  if (importErr) throw new HttpError(500, importErr.message);
  const counts = { complete: 0, review: 0, failed: 0 };
  for (const row of routes ?? []) {
    const state = row.review_state as keyof typeof counts | null;
    if (state && state in counts) counts[state] += 1;
  }
  const drafts = routes ?? [];
  const assignedCountsValid = fullTestAssignedCountsError(imp?.text_quality, drafts) === null;
  const canApproveImport = imp?.deterministic_review_status === "passed" && assignedCountsValid && drafts.length > 0 && drafts.every((draft) =>
    draft.review_state === "complete" && draft.status !== "rejected" && Boolean(draft.suggested_answer?.trim()) &&
    (!draft.has_visual_stimulus || draft.stimulus_crop_status === "confirmed")
  );
  return { current_job: job ?? null, state_counts: counts, total_questions: drafts.length, can_approve_import: canApproveImport };
}

const FULL_TEST_MODULE_COUNTS: Record<string, number> = {
  "Reading and Writing Module 1": 27,
  "Reading and Writing Module 2": 27,
  "Math Module 1": 22,
  "Math Module 2": 22,
};

function fullTestAssignedCountsError(quality: unknown, drafts: Array<{ assigned_module_name?: string | null }>): string | null {
  if ((quality as { document_family?: string } | null)?.document_family !== "full_test") return null;
  const counts = new Map<string, number>();
  for (const draft of drafts) counts.set(draft.assigned_module_name ?? "", (counts.get(draft.assigned_module_name ?? "") ?? 0) + 1);
  const mismatches = Object.entries(FULL_TEST_MODULE_COUNTS)
    .filter(([module, expected]) => (counts.get(module) ?? 0) !== expected)
    .map(([module, expected]) => `${module}: ${counts.get(module) ?? 0}/${expected}`);
  return drafts.length !== 98 || mismatches.length > 0 ? `Full-test module counts must be 27/27/22/22 (${mismatches.join(", ")})` : null;
}

async function attachDraftStimulusUrls(svc: ReturnType<typeof serviceClient>, drafts: Array<Record<string, unknown>>): Promise<void> {
  for (const draft of drafts) {
    const path = draft.stimulus_image_path;
    if (typeof path === "string" && path) {
      const { data } = await svc.storage.from("question-assets").createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) draft.stimulus_image_url = data.signedUrl;
    }
    // Immutable full-page source for the crop review UI ("View full page" /
    // "Adjust crop"). Missing for legacy rows backfilled before the worker
    // wrote source paths — the UI falls back to the crop image.
    const sourcePath = draft.stimulus_source_image_path;
    if (typeof sourcePath === "string" && sourcePath) {
      const { data } = await svc.storage.from("question-assets").createSignedUrl(sourcePath, 60 * 60);
      if (data?.signedUrl) draft.stimulus_source_image_url = data.signedUrl;
    }
    const reviewSourcePath = draft.review_source_image_path;
    if (typeof reviewSourcePath === "string" && reviewSourcePath) {
      const { data } = await svc.storage.from("question-assets").createSignedUrl(reviewSourcePath, 60 * 60);
      if (data?.signedUrl) draft.review_source_image_url = data.signedUrl;
    }
  }
}

const MODULE_TIME_LIMITS: Record<"reading_writing" | "math", number> = { reading_writing: 32, math: 35 };

/**
 * Turn a SAT PDF filename into a polished test title, e.g.
 *   202604int1.pdf   -> "2026 April Int 1"
 *   202408asia2.pdf  -> "2024 August Int 2"
 *   202408usv2.pdf   -> "2024 August US 2"
 * Unknown shapes fall back to the filename without the .pdf suffix.
 */
export function polishTestTitle(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").trim();
  if (/^\d{4}\s+[A-Za-z]+\s+(Int|US)\s+\d{1,3}$/.test(base)) return base;
  const m = base.match(/^[^a-z0-9]*(\d{4})[^0-9]{0,2}(\d{2})[^0-9]{0,2}(int|asia|us|usa)[_ .\-,]?v?(\d{0,3})$/i);
  if (!m) return base;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return base;
  const monthName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const variant = /^us$/i.test(m[3]) ? "US" : "Int";
  return `${m[1]} ${monthName} ${variant}${m[4] ? ` ${m[4]}` : ""}`;
}

async function loadAllDrafts(svc: ReturnType<typeof serviceClient>, importId: string, select: string) {
  const PAGE = 500;
  const drafts: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data: batch, error: err } = await svc
      .from("draft_questions")
      .select(select)
      .eq("pdf_import_id", importId)
      .order("section", { ascending: false })
      .order("assigned_module_name")
      .order("display_order")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (err) throw new HttpError(500, err.message);
    drafts.push(...((batch ?? []) as unknown as Array<Record<string, unknown>>));
    if ((batch?.length ?? 0) < PAGE) break;
  }
  return drafts;
}

async function recomputeFullTestKeySummary(svc: ReturnType<typeof serviceClient>, testId: string): Promise<void> {
  const { data: sections, error: sectionErr } = await svc.from("test_sections")
    .select("section_type, modules:test_modules(id, name, questions:test_module_questions(id, question:questions(correct_answer)))")
    .eq("test_id", testId);
  if (sectionErr) throw new HttpError(500, sectionErr.message);

  const summary: Record<string, { questions: number; keys: number; status: string }> = {};
  let total = 0;
  let keyed = 0;
  for (const section of (sections ?? []) as unknown as Array<{
    modules: Array<{
      name: string;
      questions: Array<{ question: { correct_answer: string | null } | Array<{ correct_answer: string | null }> | null }>;
    }>;
  }>) {
    for (const module of section.modules ?? []) {
      const stats = summary[module.name] ?? { questions: 0, keys: 0, status: "missing" };
      for (const link of module.questions ?? []) {
        stats.questions += 1;
        total += 1;
        const question = Array.isArray(link.question) ? link.question[0] : link.question;
        if (question?.correct_answer) {
          stats.keys += 1;
          keyed += 1;
        }
      }
      stats.status = stats.keys === 0 ? "missing" : stats.keys === stats.questions ? "complete" : "partial";
      summary[module.name] = stats;
    }
  }
  const status = total === 0 || keyed === 0 ? "missing" : keyed === total ? "complete" : "partial";
  const { error: updateErr } = await svc.from("tests")
    .update({ answer_key_status: status, answer_key_summary: summary })
    .eq("id", testId);
  if (updateErr) throw new HttpError(500, updateErr.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient();
    const seg = pathSegments(req);
    const id = seg[1];

    if (req.method === "GET" && seg.length === 1) {
      const { data, error: err } = await svc
        .from("pdf_imports")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);

      const countRows: Array<ImportReadinessDraft & { pdf_import_id: string; status: string }> = [];
      {
        let offset = 0;
        const PAGE = 1000;
        for (;;) {
          const { data: batch, error: bErr } = await svc
            .from("draft_questions")
            .select("id, pdf_import_id, status, page_number, section, source_question_number, source_module_name, source_module_position, suggested_answer, parser_metadata, created_at, answer_keys:draft_answer_keys(detected_answer,status)")
            .order("pdf_import_id")
            .order("page_number")
            .order("source_question_number")
            .order("created_at")
            .order("id")
            .range(offset, offset + PAGE - 1);
          if (bErr) return error(bErr.message, 500);
          countRows.push(...((batch ?? []) as unknown as Array<ImportReadinessDraft & { pdf_import_id: string; status: string }>));
          if ((batch?.length ?? 0) < PAGE) break;
          offset += PAGE;
        }
      }
      const rowsByImport = new Map<string, Array<ImportReadinessDraft & { pdf_import_id: string; status: string }>>();
      for (const r of countRows) {
        const rows = rowsByImport.get(r.pdf_import_id) ?? [];
        rows.push(r);
        rowsByImport.set(r.pdf_import_id, rows);
      }
      const imports = (data ?? []).map((row) => {
        const rows = rowsByImport.get(row.id) ?? [];
        const draft_counts: Record<string, number> = {};
        for (const draft of rows) draft_counts[draft.status] = (draft_counts[draft.status] ?? 0) + 1;
        const quality = (row.text_quality ?? {}) as { key_entries?: number | null };
        return {
          ...row,
          draft_counts,
          import_readiness: summarizePdfImportReadiness({
            importStatus: row.status,
            drafts: rows,
            rawKeyEntries: quality.key_entries,
          }),
        };
      });
      return json({ imports });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data: imp, error: err } = await svc.from("pdf_imports").select("*").eq("id", id).maybeSingle();
      if (err) return error(err.message, 500);
      if (!imp) return error("Import not found", 404);

      const PAGE = 1000;
      const params = new URL(req.url).searchParams;
      const hasPaging = params.has("draft_limit") || params.has("draft_offset");

      if (hasPaging) {
        const limit = Math.min(Math.max(parseInt(params.get("draft_limit") ?? "", 10) || 50, 1), 200);
        const offset = Math.max(parseInt(params.get("draft_offset") ?? "", 10) || 0, 0);
        const status = params.get("draft_status")?.trim();
        const applyStatus = status && status.length > 0;
        const module = params.get("draft_module")?.trim();
        const applyModule = module && module.length > 0;
        const reviewState = params.get("review_state")?.trim();
        const applyReviewState = reviewState && ["complete", "review", "failed"].includes(reviewState);

        let query = svc
          .from("draft_questions")
          .select("id, pdf_import_id, page_number, section, question_type, prompt, status, source_question_number, source_module_name, assigned_module_name, display_order, has_visual_stimulus, review_state, review_snapshot_hash, deterministic_risks, review_error_category, reviewed_at");
        if (applyStatus) query = query.eq("status", status);
        if (applyModule) query = query.eq("assigned_module_name", module);
        if (applyReviewState) query = query.eq("review_state", reviewState);
        const { data: batch, error: sErr } = await query
          .eq("pdf_import_id", id)
          .order("section", { ascending: false })
          .order("assigned_module_name")
          .order("display_order")
          .order("id")
          .range(offset, offset + limit - 1);
        if (sErr) return error(sErr.message, 500);

        let countQuery = svc.from("draft_questions").select("id", { count: "exact", head: true });
        if (applyStatus) countQuery = countQuery.eq("status", status);
        if (applyModule) countQuery = countQuery.eq("assigned_module_name", module);
        if (applyReviewState) countQuery = countQuery.eq("review_state", reviewState);
        const { count: total, error: cErr } = await countQuery.eq("pdf_import_id", id);
        if (cErr) return error(cErr.message, 500);

        const draft_counts: Record<string, number> = {};
        const moduleSummaryRows: Array<{ section: string; module: string; status: string; with_key: boolean }> = [];
        let stOffset = 0;
        for (;;) {
          const { data: statusRows, error: stErr } = await svc
            .from("draft_questions")
            .select("status, section, assigned_module_name, suggested_answer")
            .eq("pdf_import_id", id)
            .range(stOffset, stOffset + PAGE - 1);
          if (stErr) return error(stErr.message, 500);
          for (const row of (statusRows ?? []) as Array<{ status: string; section: string; assigned_module_name: string | null; suggested_answer: string | null }>) {
            draft_counts[row.status] = (draft_counts[row.status] ?? 0) + 1;
            const group = moduleGroup(row.assigned_module_name, row.section);
            moduleSummaryRows.push({ section: group.sectionType, module: group.label, status: row.status, with_key: !!row.suggested_answer });
          }
          if ((statusRows?.length ?? 0) < PAGE) break;
          stOffset += PAGE;
        }

        const moduleMap = new Map<string, { section: string; module: string; total: number; approved: number; rejected: number; needs_review: number; has_suggested_key: number; missing_key: number; other: number; with_key: number }>();
        for (const r of moduleSummaryRows) {
          const key = `${r.section}::${r.module}`;
          const entry = moduleMap.get(key) ?? { section: r.section, module: r.module, total: 0, approved: 0, rejected: 0, needs_review: 0, has_suggested_key: 0, missing_key: 0, other: 0, with_key: 0 };
          entry.total += 1;
          if (r.with_key) entry.with_key += 1;
          if (r.status === "approved") entry.approved += 1;
          else if (r.status === "rejected") entry.rejected += 1;
          else if (r.status === "needs_review") entry.needs_review += 1;
          else if (r.status === "has_suggested_key") entry.has_suggested_key += 1;
          else if (r.status === "missing_key") entry.missing_key += 1;
          else entry.other += 1;
          moduleMap.set(key, entry);
        }
        const module_summary = [...moduleMap.values()].sort((a, b) =>
          a.section === b.section ? a.module.localeCompare(b.module) : a.section === "reading_writing" ? -1 : 1,
        );

        const ai_review = await loadReviewSummary(svc, id);
        return json({
          import: imp,
          drafts: (batch ?? []) as Array<Record<string, unknown>>,
          draft_total: total ?? 0,
          draft_offset: offset,
          draft_limit: limit,
          draft_counts,
          module_summary,
          draft_status: applyStatus ? status : null,
          draft_module: applyModule ? module : null,
          review_state: applyReviewState ? reviewState : null,
          ai_review,
        });
      }

      const pages: Array<Record<string, unknown>> = [];
      const drafts: Array<Record<string, unknown>> = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data: batch, error: pErr } = await svc
          .from("pdf_import_pages")
          .select("*")
          .eq("pdf_import_id", id)
          .order("page_number")
          .range(offset, offset + PAGE - 1);
        if (pErr) return error(pErr.message, 500);
        pages.push(...((batch ?? []) as Array<Record<string, unknown>>));
        if ((batch?.length ?? 0) < PAGE) break;
      }
      for (let offset = 0; ; offset += PAGE) {
        const { data: batch, error: dErr } = await svc
          .from("draft_questions")
          .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*), review_findings:ai_ingestion_review_findings(*)")
          .eq("pdf_import_id", id)
          .order("section", { ascending: false })
          .order("assigned_module_name")
          .order("display_order")
          .order("id")
          .range(offset, offset + PAGE - 1);
        if (dErr) return error(dErr.message, 500);
        drafts.push(...((batch ?? []) as Array<Record<string, unknown>>));
        if ((batch?.length ?? 0) < PAGE) break;
      }
      await attachDraftStimulusUrls(svc, drafts);
      const ai_review = await loadReviewSummary(svc, id);
      return json({ import: imp, pages, drafts, ai_review });
    }

    if (req.method === "POST" && seg.length === 1) {
      const body = pdfImportCreateSchema.parse(await req.json());
      // Upload-only workflow: the worker always parses the whole PDF and
      // decides OCR itself. Per-import OCR/scope choices are not exposed.
      const { data, error: err } = await svc
        .from("pdf_imports")
        .insert({
          storage_path: body.storage_path,
          original_filename: body.original_filename,
          file_size: body.file_size ?? null,
          ocr_mode: "auto",
          content_scope: "full_test",
          target_module: null,
          created_by: ctx.user.id,
        })
        .select("*")
        .single();
      if (err) return error(err.message, 500);
      await triggerWorker(data.id);
      return json({ import: data }, 201);
    }

    if (!id) return error("Not found", 404);

    if (req.method === "PATCH" && seg.length === 2) {
      const body = await req.json();
      const allowed = ["cancelled", "failed"];
      if (!allowed.includes(body.status ?? "")) return error("Only statuses cancelled/failed are allowed here", 422);
      const { data, error: err } = await svc.from("pdf_imports").update({ status: body.status }).eq("id", id).select("*").single();
      if (err) return error(err.message, 500);
      return json({ import: data });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "process") {
      const { data: imp, error: impErr } = await svc.from("pdf_imports").select("id,status").eq("id", id).maybeSingle();
      if (impErr) return error(impErr.message, 500);
      if (!imp) return error("Import not found", 404);
      if (!["uploaded", "failed", "completed"].includes(imp.status)) return error("Import is already processing", 409);
      if (imp.status === "completed") {
        const { error: resetErr } = await svc.from("pdf_imports").update({
          status: "failed",
          error_message: null,
          deterministic_review_status: "pending",
          deterministic_major_risks: [],
          deterministic_warnings: [],
          deterministic_reviewed_at: null,
        }).eq("id", id);
        if (resetErr) return error(resetErr.message, 500);
      }
      await triggerWorker(id);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "pdf_import.full_reprocess_requested", entity_type: "pdf_import", entity_id: id });
      return json({ ok: true, note: WORKER_URL ? "Worker notified" : "No WORKER_URL configured; worker will poll" });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "ai-review") {
      const { data: imp, error: impErr } = await svc.from("pdf_imports").select("id,status,deterministic_review_status").eq("id", id).maybeSingle();
      if (impErr) return error(impErr.message, 500);
      if (!imp) return error("Import not found", 404);
      if (imp.status !== "completed") return error("AI review requires a completed import", 409);
      if (imp.deterministic_review_status === "failed") return error("Structurally failed imports cannot create AI review jobs", 409);
      const { data: latestJob, error: latestErr } = await svc.from("ai_ingestion_review_jobs")
        .select("status,created_at").eq("pdf_import_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latestErr) return error(latestErr.message, 500);
      if (latestJob && ["queued", "running"].includes(latestJob.status)) return error("An AI review is already in progress", 409);
      if (latestJob && Date.now() - new Date(latestJob.created_at).getTime() < 30_000) return error("Wait 30 seconds before rerunning AI review", 429);
      await triggerAiReview(id, true);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "ai_ingestion_review.requested", entity_type: "pdf_import", entity_id: id });
      return json({ ok: true }, 202);
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "approve-import") {
      const { data, error: rpcErr } = await svc.rpc("approve_complete_ingestion_import", {
        p_import_id: id,
        p_admin_id: ctx.user.id,
      });
      if (rpcErr) {
        return error("Every question must be Complete with a usable answer and confirmed visual crop before approving the import", 409);
      }
      return json({ ok: true, approved: data });
    }

    if (seg[2] === "findings" && seg.length === 5) {
      const findingId = seg[3];
      const action = seg[4];
      if (req.method === "POST" && action === "accept") {
        aiFindingDecisionSchema.parse(await req.json().catch(() => ({})));
        const { data, error: rpcErr } = await svc.rpc("accept_ai_ingestion_finding", {
          p_import_id: id,
          p_finding_id: findingId,
          p_admin_id: ctx.user.id,
        });
        if (rpcErr) return error("The finding is stale, already decided, or requires the question editor", 409);
        await triggerAiReview(id).catch((cause) => console.error("AI reassessment enqueue failed", cause));
        return json({ ok: true, draft_id: data });
      }
      if (req.method === "POST" && action === "dismiss") {
        const body = aiFindingDecisionSchema.parse(await req.json());
        if (!body.reason) return error("A dismissal reason is required", 422);
        const { data: finding, error: fErr } = await svc.from("ai_ingestion_review_findings")
          .update({ status: "dismissed", decided_by: ctx.user.id, decided_at: new Date().toISOString(), decision_reason: body.reason })
          .eq("id", findingId).eq("pdf_import_id", id).eq("status", "open").select("id,draft_question_id").maybeSingle();
        if (fErr) return error(fErr.message, 500);
        if (!finding) return error("Finding not found, stale, or already decided", 409);
        await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "ai_ingestion_finding.dismissed", entity_type: "draft_question", entity_id: finding.draft_question_id, details: { finding_id: findingId, reason: body.reason } });
        await svc.from("draft_questions").update({ review_state: "review", review_route: "individual_review" }).eq("id", finding.draft_question_id);
        await triggerAiReview(id, true).catch((cause) => console.error("AI reassessment enqueue failed", cause));
        return json({ ok: true });
      }
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "drafts") {
      const body = manualImportDraftCreateSchema.parse(await req.json());
      const { data: imp, error: impErr } = await svc.from("pdf_imports").select("id, status").eq("id", id).maybeSingle();
      if (impErr) return error(impErr.message, 500);
      if (!imp) return error("Import not found", 404);
      if (["uploaded", "extracting", "extracted", "needs_ocr", "ocr_pending", "ocr_running", "ocr_completed", "parsing", "parsed"].includes(imp.status)) {
        return error("Wait for PDF ingestion to finish before adding a manual question", 409);
      }

      const stimulusImagePath = body.stimulus_image_path?.trim() || null;
      if (stimulusImagePath) {
        if (!stimulusImagePath.startsWith(`imports/${id}/manual-stimuli/`)) {
          return error("Manual stimulus images must be stored under this import's manual-stimuli folder", 422);
        }
        const { error: imageErr } = await svc.storage.from("question-assets")
          .createSignedUrl(stimulusImagePath, 60);
        if (imageErr) return error("Uploaded stimulus image could not be found", 422);
      }

      const { data: lastDraft, error: lastErr } = await svc.from("draft_questions")
        .select("source_question_number")
        .eq("pdf_import_id", id)
        .eq("source_module_name", body.source_module_name)
        .order("source_question_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastErr) return error(lastErr.message, 500);

      const modulePosition = Number(body.source_module_name.match(/(\d+)$/)?.[1] ?? 1);
      const manualId = crypto.randomUUID();
      const { data: draft, error: dErr } = await svc.from("draft_questions").insert({
        pdf_import_id: id,
        page_number: 0,
        section: body.source_module_name.startsWith("Math") ? "math" : "reading_writing",
        question_type: body.question_type,
        prompt: body.prompt.trim(),
        passage_text: body.passage_text?.trim() || null,
        suggested_answer: body.suggested_answer?.trim() || null,
        status: "needs_review",
        source_question_number: (lastDraft?.source_question_number ?? 0) + 1,
        source_question_id: `manual-${manualId}`,
        source_module_name: body.source_module_name,
        source_module_position: modulePosition,
        has_visual_stimulus: Boolean(stimulusImagePath),
        stimulus_image_path: stimulusImagePath,
        stimulus_source_image_path: stimulusImagePath,
        stimulus_crop_rect: null,
        stimulus_crop_source: stimulusImagePath ? "full_page" : null,
        stimulus_crop_status: stimulusImagePath ? "pending" : null,
        parser_metadata: { manual_entry: true },
      }).select("id").single();
      if (dErr) return error(dErr.message, 500);

      if (body.choices.length > 0) {
        const { error: choiceErr } = await svc.from("draft_question_choices").insert(body.choices.map((choice) => ({
          draft_question_id: draft.id,
          label: choice.label,
          text: choice.text,
          position: choice.position,
        })));
        if (choiceErr) {
          await svc.from("draft_questions").delete().eq("id", draft.id).eq("pdf_import_id", id);
          return error(choiceErr.message, 500);
        }
      }

      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "draft_question.created_manually",
        entity_type: "draft_question",
        entity_id: draft.id,
        details: { pdf_import_id: id, source_module_name: body.source_module_name },
      });
      const { data: created, error: reloadErr } = await svc.from("draft_questions")
        .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*)")
        .eq("id", draft.id)
        .single();
      if (reloadErr) return error(reloadErr.message, 500);
      await attachDraftStimulusUrls(svc, [created as Record<string, unknown>]);
      await triggerAiReview(id, true).catch((cause) => console.error("AI reassessment enqueue failed", cause));
      return json({ draft: created }, 201);
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "generate-test") {
      const { data: imp, error: impErr } = await svc
        .from("pdf_imports")
        .select("id, status, original_filename, generated_test_id, text_quality, deterministic_review_status")
        .eq("id", id)
        .maybeSingle();
      if (impErr) return error(impErr.message, 500);
      if (!imp) return error("Import not found", 404);
      if (imp.deterministic_review_status === "failed") return error("Structurally failed imports cannot generate tests. Run Full Reprocess first.", 409);
      if (imp.generated_test_id) return json({ ok: true, test_id: imp.generated_test_id, already_generated: true });
      if (imp.deterministic_review_status !== "passed") return error("Import must pass deterministic review before generating a test.", 409);

      const body = await req.json().catch(() => ({})) as { acknowledge_incomplete?: boolean };
      const quality = (imp.text_quality ?? {}) as { incomplete_modules?: Array<{ module: string; expected: number; actual: number }> };
      const incompleteModules = quality.incomplete_modules ?? [];
      if (incompleteModules.length > 0 && body.acknowledge_incomplete !== true) {
        const detail = incompleteModules.map((m) => m.module + " " + m.actual + "/" + m.expected).join(", ");
        return error("Parser validation found incomplete or overfull modules (" + detail + "). Review the source and drafts, then explicitly confirm generation.", 422);
      }

      const drafts = await loadAllDrafts(svc, id, "*, choices:draft_question_choices(*)");
      const assignedCountError = fullTestAssignedCountsError(imp.text_quality, drafts);
      if (assignedCountError) return error(assignedCountError, 422);
      const incomplete = drafts.filter((d) =>
        d.review_state !== "complete" || d.status === "rejected" || !String(d.suggested_answer ?? "").trim() ||
        (d.has_visual_stimulus && d.stimulus_crop_status !== "confirmed")
      );
      if (incomplete.length > 0) {
        return error("Every question must be Complete with a usable answer and confirmed visual crop before generating a test.", 422);
      }
      const usable = drafts.filter((d) => d.status !== "rejected");
      if (usable.length === 0) return error("No reviewable drafts on this import; generate a test needs at least one draft", 422);

      const notApproved = usable.filter((d) => d.status !== "approved");
      if (notApproved.length > 0) {
        return error(`${notApproved.length} draft(s) still need approval before generating the full-length test.`, 422);
      }

      const pendingCrops = usable.filter((d) => d.has_visual_stimulus && d.stimulus_crop_status === "pending");
      if (pendingCrops.length > 0) {
        return error(`${pendingCrops.length} visual draft(s) still require crop review. Confirm or adjust each crop, then approve the full draft.`, 422);
      }

      let testId: string | null = null;
      try {
        const title = polishTestTitle(imp.original_filename);
        const { data: test, error: tErr } = await svc
          .from("tests")
          .insert({
            title,
            description: `Auto-assembled from PDF import "${imp.original_filename}".`,
            is_public: false,
            created_by: ctx.user.id,
            kind: "full",
          })
          .select("id")
          .single();
        if (tErr) throw new HttpError(500, tErr.message);
        testId = test.id;

        // Group by module key (Map, not Set — see _shared/modules.ts).
        const groupedBySection = groupByModuleKey(usable.map((draft) => ({
          ...draft, source_module_name: draft.assigned_module_name,
        })));

        const sectionOrder: Array<"reading_writing" | "math"> = groupedBySection.has("reading_writing") ? ["reading_writing"] : [];
        if (groupedBySection.has("math")) sectionOrder.push("math");

        const sectionIds = new Map<"reading_writing" | "math", string>();
        for (const [idx, sectionType] of sectionOrder.entries()) {
          const { data: section, error: sErr } = await svc
            .from("test_sections")
            .insert({
              test_id: testId,
              name: sectionType === "reading_writing" ? "Reading and Writing" : "Math",
              section_type: sectionType,
              position: idx + 1,
            })
            .select("id")
            .single();
          if (sErr) throw new HttpError(500, sErr.message);
          sectionIds.set(sectionType, section.id);
        }

        const moduleIds = new Map<string, string>();
        for (const sectionType of sectionOrder) {
          const groups = [...(groupedBySection.get(sectionType)?.values() ?? [])].sort((a, b) => a.modulePos - b.modulePos);
          for (const group of groups) {
            const { data: module, error: mErr } = await svc
              .from("test_modules")
              .insert({
                section_id: sectionIds.get(sectionType),
                name: group.label,
                time_limit_minutes: MODULE_TIME_LIMITS[group.sectionType],
                position: group.modulePos,
                is_adaptive: false,
              })
              .select("id")
              .single();
            if (mErr) throw new HttpError(500, mErr.message);
            moduleIds.set(group.key, module.id);
          }
        }

        const linkPositions = new Map<string, number>();
        const failed: Array<{ draft_id: string; question_number: number; reason: string }> = [];
        let linked = 0;
        for (const d of usable) {
          const group = moduleGroup(d.assigned_module_name as string | null | undefined, d.section as string | null | undefined);
          const moduleId = moduleIds.get(group.key);
          if (!moduleId) continue;

          let questionId = (d.question_id as string | null) ?? null;
          if (!questionId) {
            try {
              const approved = await approveDraft(svc, ctx.user.id, d.id as string, {});
              questionId = approved.question_id;
            } catch (e) {
              failed.push({
                draft_id: d.id as string,
                question_number: d.source_question_number as number,
                reason: e instanceof HttpError ? e.message : e instanceof Error ? e.message : "unknown error",
              });
              continue;
            }
          }
          if (!questionId) continue;

          const position = (linkPositions.get(moduleId) ?? 0) + 1;
          linkPositions.set(moduleId, position);
          const { error: lErr } = await svc.from("test_module_questions").insert({ module_id: moduleId, question_id: questionId, position });
          if (lErr) throw new HttpError(500, lErr.message);
          linked += 1;
        }

        if (linked === 0) throw new HttpError(422, "None of the drafts could be approved; nothing was linked into the test");

        // Answer-key status for the generated test (best-effort if migration pending)
        const moduleNameById = new Map<string, string>();
        for (const [key, mid] of moduleIds) {
          const group = [...groupedBySection.values()].flatMap((s) => [...s.values()]).find((g) => g.key === key);
          if (group) moduleNameById.set(mid, group.label);
        }
        const { data: linkedRows } = await svc
          .from("test_module_questions")
          .select("module_id, question:questions(correct_answer)")
          .in("module_id", [...moduleIds.values()]);
        const testKeySummary: Record<string, { questions: number; keys: number; status: string }> = {};
        let testKeys = 0;
        let testTotal = 0;
        for (const row of (linkedRows ?? []) as unknown as Array<{ module_id: string; question: { correct_answer: string | null } | Array<{ correct_answer: string | null }> | null }>) {
          const mod = moduleNameById.get(row.module_id) ?? "Unknown";
          const s = testKeySummary[mod] ?? { questions: 0, keys: 0, status: "missing" };
          s.questions += 1;
          testTotal += 1;
          const q = Array.isArray(row.question) ? row.question[0] : row.question;
          if (q?.correct_answer) {
            s.keys += 1;
            testKeys += 1;
          }
          testKeySummary[mod] = s;
        }
        for (const s of Object.values(testKeySummary)) {
          s.status = s.keys === 0 ? "missing" : s.keys >= s.questions ? "complete" : "partial";
        }
        const testKeyStatus = testTotal > 0 && testKeys >= testTotal ? "complete" : testKeys === 0 ? "missing" : "partial";
        const { error: keyErr } = await svc
          .from("tests")
          .update({ answer_key_status: testKeyStatus, answer_key_summary: testKeySummary })
          .eq("id", testId);
        if (keyErr && !/answer_key_status|42703/.test(keyErr.message)) throw new HttpError(500, keyErr.message);

        const { error: uErr } = await svc.from("pdf_imports").update({ generated_test_id: testId }).eq("id", id);
        if (uErr) throw new HttpError(500, uErr.message);
        await svc.from("audit_logs").insert({
          actor_id: ctx.user.id,
          action: "import.generated_test",
          entity_type: "pdf_import",
          entity_id: id,
          details: { test_id: testId, title, linked, failed: failed.length },
        });

        return json({
          ok: true,
          test_id: testId,
          title,
          linked,
          sections: sectionOrder.length,
          modules: moduleIds.size,
          answer_key_status: testKeyStatus,
          failed,
        }, 201);
      } catch (e) {
        if (testId) {
          try {
            await svc.from("tests").delete().eq("id", testId);
          } catch {
            // best-effort rollback of a partially assembled test
          }
        }
        throw e;
      }
    }

    if (seg[2] === "drafts" && seg.length >= 4) {
      const draftId = seg[3];

      if (req.method === "PUT" && seg.length === 5 && seg[4] === "editor") {
        const parsed = saveDraftEditorSchema.safeParse(await req.json());
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return error(`Draft save validation failed: ${issue.path.join(".") || "request"} ${issue.message}`, 422, parsed.error.issues);
        }
        const body = parsed.data;
        const { assigned_module_name, display_order, expected_updated_at, ...patch } = body;
        const updates: Record<string, unknown> = { ...patch };
        if (updates.has_visual_stimulus === false) {
          updates.stimulus_image_path = null;
          updates.stimulus_source_image_path = null;
          updates.stimulus_crop_rect = null;
          updates.stimulus_crop_source = null;
          updates.stimulus_crop_status = null;
        }
        const { error: saveErr } = await svc.rpc("save_import_draft_editor", {
          p_import_id: id,
          p_draft_id: draftId,
          p_actor_id: ctx.user.id,
          p_expected_updated_at: expected_updated_at,
          p_module_name: assigned_module_name,
          p_position: display_order,
          p_patch: updates,
        });
        if (saveErr) return error(saveErr.message, 409);
        await triggerAiReview(id).catch((cause) => console.error("AI reassessment enqueue failed", cause));
        return json({ ok: true });
      }

      if (req.method === "GET" && seg.length === 4) {
        const { data: draft, error: gErr } = await svc
          .from("draft_questions")
          .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*), review_findings:ai_ingestion_review_findings(*)")
          .eq("id", draftId)
          .eq("pdf_import_id", id)
          .maybeSingle();
        if (gErr) return error(gErr.message, 500);
        if (!draft) return error("Draft not found", 404);
        await attachDraftStimulusUrls(svc, [draft as Record<string, unknown>]);
        return json({ draft });
      }

      if (req.method === "POST" && seg[4] === "approve") {
        const body = approveDraftSchema.parse(await req.json());
        const { data: importGate, error: gateErr } = await svc.from("pdf_imports").select("deterministic_review_status").eq("id", id).maybeSingle();
        if (gateErr) return error(gateErr.message, 500);
        if (importGate?.deterministic_review_status === "failed") return error("Questions from a structurally failed import cannot be approved", 409);
        const { data: draft, error: dErr } = await svc
          .from("draft_questions")
          .select("id, pdf_import_id, has_visual_stimulus, stimulus_crop_status, question_id, assigned_module_name, section, review_state")
          .eq("id", draftId)
          .eq("pdf_import_id", id)
          .maybeSingle();
        if (dErr) return error(dErr.message, 500);
        if (!draft) return error("Draft not found", 404);
        if (body.section !== undefined && body.section !== draft.section) {
          return error("Change the assigned module in the question editor to change its section", 422);
        }
        if (draft.has_visual_stimulus && draft.stimulus_crop_status !== "confirmed") {
          return error("Crop review required: confirm or adjust this visual draft's crop before approving", 422);
        }
        if (draft.question_id) {
          const { error: reviewedErr } = await svc.from("draft_questions").update({
            status: "approved", review_state: "complete", review_route: "batch_ready",
            human_review_mode: "individual", human_reviewed_by: ctx.user.id,
            human_reviewed_at: new Date().toISOString(),
          }).eq("id", draftId).eq("pdf_import_id", id);
          if (reviewedErr) return error(reviewedErr.message, 500);
          return json({ ok: true, question_id: draft.question_id, already_approved: true });
        }
        const updates: Record<string, unknown> = {};
        if (body.question_type !== undefined) updates.question_type = body.question_type;
        if (body.passage_text !== undefined) updates.passage_text = body.passage_text;
        if (body.domain !== undefined) updates.domain = body.domain;
        if (body.skill !== undefined) updates.skill = body.skill;
        if (body.difficulty !== undefined) updates.difficulty = body.difficulty;
        if (body.correct_answer !== undefined) updates.suggested_answer = body.correct_answer;
        if (body.explanation !== undefined) updates.explanation = body.explanation;
        const { error: uErr } = await svc.from("draft_questions").update(updates).eq("id", draftId).eq("pdf_import_id", id);
        if (uErr) return error(uErr.message, 500);

        const { data: imp, error: impErr } = await svc.from("pdf_imports").select("generated_test_id").eq("id", id).maybeSingle();
        if (impErr) return error(impErr.message, 500);
        if (imp?.generated_test_id) {
          const sectionType = (body.section ?? draft.section) as string;
          const group = moduleGroup(draft.assigned_module_name, sectionType);
          const { data: sections, error: sectionErr } = await svc.from("test_sections")
            .select("id, section_type")
            .eq("test_id", imp.generated_test_id);
          if (sectionErr) return error(sectionErr.message, 500);
          const sectionIds = (sections ?? []).filter((section) => section.section_type === group.sectionType).map((section) => section.id);
          const { data: modules, error: moduleErr } = await svc.from("test_modules")
            .select("id, name, position, section_id")
            .in("section_id", sectionIds.length ? sectionIds : ["00000000-0000-0000-0000-000000000000"]);
          if (moduleErr) return error(moduleErr.message, 500);
          const targetModule = (modules ?? []).find((module) => moduleGroup(module.name, group.sectionType).key === group.key);
          if (!targetModule) return error(`No ${group.label} module exists in the generated test`, 422);
          const { data: lastLink, error: linkErr } = await svc.from("test_module_questions")
            .select("position")
            .eq("module_id", targetModule.id)
            .order("position", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (linkErr) return error(linkErr.message, 500);
          try {
            const approved = await approveDraft(svc, ctx.user.id, draftId, {
              add_to_module_id: targetModule.id,
              position: (lastLink?.position ?? 0) + 1,
            });
            await svc.from("draft_questions").update({
              review_state: "complete",
              review_route: "batch_ready",
              human_review_mode: "individual",
              human_reviewed_by: ctx.user.id,
              human_reviewed_at: new Date().toISOString(),
            }).eq("id", draftId).is("human_review_mode", null);
            await recomputeFullTestKeySummary(svc, imp.generated_test_id);
            return json({ ok: true, question_id: approved.question_id, added_to_test: true });
          } catch (e) {
            return error(e instanceof HttpError ? e.message : e instanceof Error ? e.message : "Unable to approve and add question", e instanceof HttpError ? e.status : 500);
          }
        }

        const { error: statusErr } = await svc.from("draft_questions").update({
          status: "approved",
          review_state: "complete",
          review_route: "batch_ready",
          human_review_mode: "individual",
          human_reviewed_by: ctx.user.id,
          human_reviewed_at: new Date().toISOString(),
        }).eq("id", draftId).eq("pdf_import_id", id);
        if (statusErr) return error(statusErr.message, 500);
        await svc.from("draft_answer_keys").update({ status: "approved" }).eq("draft_question_id", draftId).eq("status", "suggested");
        await svc.from("audit_logs").insert({
          actor_id: ctx.user.id,
          action: "draft_question.marked_ready",
          entity_type: "draft_question",
          entity_id: draftId,
        });
        return json({ ok: true });
      }

      if (req.method === "POST" && seg[4] === "confirm-crop") {
        const { data: draft, error: cErr } = await svc
          .from("draft_questions")
          .select("id, has_visual_stimulus")
          .eq("id", draftId)
          .eq("pdf_import_id", id)
          .maybeSingle();
        if (cErr) return error(cErr.message, 500);
        if (!draft) return error("Draft not found", 404);
        if (!draft.has_visual_stimulus) return error("Only visual drafts require crop review", 422);
        const { error: uErr } = await svc
          .from("draft_questions")
          .update({ stimulus_crop_status: "confirmed" })
          .eq("id", draftId)
          .eq("pdf_import_id", id);
        if (uErr) return error(uErr.message, 500);
        const { data: linkedDraft } = await svc.from("draft_questions")
          .select("question_id, stimulus_image_path")
          .eq("id", draftId)
          .eq("pdf_import_id", id)
          .maybeSingle();
        if (linkedDraft?.question_id) {
          const { error: imageErr } = await svc.from("questions")
            .update({ stimulus_image_path: linkedDraft.stimulus_image_path ?? null })
            .eq("id", linkedDraft.question_id);
          if (imageErr) return error(imageErr.message, 500);
        }
        await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "draft_question.crop_confirmed", entity_type: "draft_question", entity_id: draftId });
        await triggerAiReview(id).catch((cause) => console.error("AI reassessment enqueue failed", cause));
        return json({ ok: true });
      }

      if (req.method === "POST" && seg[4] === "reject") {
        const { data: rejected, error: rejectErr } = await svc.from("draft_questions").update({ status: "rejected" }).eq("id", draftId).eq("pdf_import_id", id).select("id").maybeSingle();
        if (rejectErr) return error(rejectErr.message, 500);
        if (!rejected) return error("Draft not found", 404);
        await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "draft_question.rejected", entity_type: "draft_question", entity_id: draftId });
        return json({ ok: true });
      }

      if (req.method === "PATCH") {
        const body = updateDraftSchema.parse(await req.json());
        if (body.section !== undefined) return error("Change the assigned module in the question editor to change its section", 422);
        const { prompt, choices, ...rest } = body;
        const updates: Record<string, unknown> = { ...rest };
        if (prompt !== undefined) updates.prompt = prompt;
        // Removing the visual flag detaches the image: clear every image/crop
        // field so no stale crop review requirement or orphan path remains.
        // Storage objects are kept — full-page sources may be shared.
        if (updates.has_visual_stimulus === false) {
          updates.stimulus_image_path = null;
          updates.stimulus_source_image_path = null;
          updates.stimulus_crop_rect = null;
          updates.stimulus_crop_source = null;
          updates.stimulus_crop_status = null;
        }
        const { error: uErr } = await svc.from("draft_questions").update(updates).eq("id", draftId).eq("pdf_import_id", id);
        if (uErr) return error(uErr.message, 500);
        const cropIsApproved = updates.stimulus_crop_status !== "pending";
        if ((updates.stimulus_image_path !== undefined && cropIsApproved) || updates.has_visual_stimulus === false) {
          const { data: linked } = await svc.from("draft_questions").select("question_id").eq("id", draftId).eq("pdf_import_id", id).maybeSingle();
          if (linked?.question_id) {
            const { error: pErr } = await svc.from("questions").update({ stimulus_image_path: updates.stimulus_image_path ?? null }).eq("id", linked.question_id);
            if (pErr) return error(pErr.message, 500);
          }
        }
        if (choices !== undefined) {
          const { error: dErr } = await svc.from("draft_question_choices").delete().eq("draft_question_id", draftId);
          if (dErr) return error(dErr.message, 500);
          const { error: iErr } = await svc.from("draft_question_choices").insert(
            choices.map((c, i) => ({
              draft_question_id: draftId,
              label: c.label ?? String.fromCharCode(65 + i),
              text: c.text,
              position: c.position ?? i + 1,
            })),
          );
          if (iErr) return error(iErr.message, 500);
        }
        await triggerAiReview(id).catch((cause) => console.error("AI reassessment enqueue failed", cause));
        return json({ ok: true });
      }
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});
