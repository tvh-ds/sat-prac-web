import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { pdfImportCreateSchema, approveDraftSchema, updateDraftSchema } from "../_shared/validation.ts";
import { approveDraft } from "../_shared/drafts.ts";
import { moduleGroup, groupByModuleKey } from "../_shared/modules.ts";

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
      .order("page_number")
      .order("source_question_number")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (err) throw new HttpError(500, err.message);
    drafts.push(...((batch ?? []) as unknown as Array<Record<string, unknown>>));
    if ((batch?.length ?? 0) < PAGE) break;
  }
  return drafts;
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

      const countRows: Array<{ pdf_import_id: string; status: string }> = [];
      {
        let offset = 0;
        const PAGE = 1000;
        for (;;) {
          const { data: batch, error: bErr } = await svc
            .from("draft_questions")
            .select("pdf_import_id, status")
            .range(offset, offset + PAGE - 1);
          if (bErr) return error(bErr.message, 500);
          countRows.push(...((batch ?? []) as Array<{ pdf_import_id: string; status: string }>));
          if ((batch?.length ?? 0) < PAGE) break;
          offset += PAGE;
        }
      }
      const countsByImport = new Map<string, Record<string, number>>();
      for (const r of countRows) {
        const m = countsByImport.get(r.pdf_import_id) ?? {};
        m[r.status] = (m[r.status] ?? 0) + 1;
        countsByImport.set(r.pdf_import_id, m);
      }
      const imports = (data ?? []).map((row) => ({ ...row, draft_counts: countsByImport.get(row.id) ?? {} }));
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

        let query = svc
          .from("draft_questions")
          .select("id, pdf_import_id, page_number, section, question_type, prompt, status, source_question_number, source_module_name, has_visual_stimulus");
        if (applyStatus) query = query.eq("status", status);
        if (applyModule) query = query.eq("source_module_name", module);
        const { data: batch, error: sErr } = await query
          .eq("pdf_import_id", id)
          .order("page_number")
          .order("source_question_number")
          .range(offset, offset + limit - 1);
        if (sErr) return error(sErr.message, 500);

        let countQuery = svc.from("draft_questions").select("id", { count: "exact", head: true });
        if (applyStatus) countQuery = countQuery.eq("status", status);
        if (applyModule) countQuery = countQuery.eq("source_module_name", module);
        const { count: total, error: cErr } = await countQuery.eq("pdf_import_id", id);
        if (cErr) return error(cErr.message, 500);

        const draft_counts: Record<string, number> = {};
        const moduleSummaryRows: Array<{ section: string; module: string; status: string; with_key: boolean }> = [];
        let stOffset = 0;
        for (;;) {
          const { data: statusRows, error: stErr } = await svc
            .from("draft_questions")
            .select("status, section, source_module_name, suggested_answer")
            .eq("pdf_import_id", id)
            .range(stOffset, stOffset + PAGE - 1);
          if (stErr) return error(stErr.message, 500);
          for (const row of (statusRows ?? []) as Array<{ status: string; section: string; source_module_name: string | null; suggested_answer: string | null }>) {
            draft_counts[row.status] = (draft_counts[row.status] ?? 0) + 1;
            const group = moduleGroup(row.source_module_name, row.section);
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
          .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*)")
          .eq("pdf_import_id", id)
          .order("page_number")
          .order("source_question_number")
          .range(offset, offset + PAGE - 1);
        if (dErr) return error(dErr.message, 500);
        drafts.push(...((batch ?? []) as Array<Record<string, unknown>>));
        if ((batch?.length ?? 0) < PAGE) break;
      }
      await attachDraftStimulusUrls(svc, drafts);
      return json({ import: imp, pages, drafts });
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
      await triggerWorker(id);
      return json({ ok: true, note: WORKER_URL ? "Worker notified" : "No WORKER_URL configured; worker will poll" });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "generate-test") {
      const { data: imp, error: impErr } = await svc
        .from("pdf_imports")
        .select("id, status, original_filename, generated_test_id")
        .eq("id", id)
        .maybeSingle();
      if (impErr) return error(impErr.message, 500);
      if (!imp) return error("Import not found", 404);
      if (imp.generated_test_id) return json({ ok: true, test_id: imp.generated_test_id, already_generated: true });

      const drafts = await loadAllDrafts(svc, id, "*, choices:draft_question_choices(*)");
      const usable = drafts.filter((d) => d.status !== "rejected");
      if (usable.length === 0) return error("No reviewable drafts on this import; generate a test needs at least one draft", 422);

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
            description: `Auto-assembled from PDF import "${imp.original_filename}" — approve individual drafts to link new questions.`,
            is_public: false,
            created_by: ctx.user.id,
            kind: "full",
          })
          .select("id")
          .single();
        if (tErr) throw new HttpError(500, tErr.message);
        testId = test.id;

        // Group by module key (Map, not Set — see _shared/modules.ts).
        const groupedBySection = groupByModuleKey(usable);

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
          const group = moduleGroup(d.source_module_name as string | null | undefined, d.section as string | null | undefined);
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

      if (req.method === "GET" && seg.length === 4) {
        const { data: draft, error: gErr } = await svc
          .from("draft_questions")
          .select("*, choices:draft_question_choices(*), answer_keys:draft_answer_keys(*)")
          .eq("id", draftId)
          .maybeSingle();
        if (gErr) return error(gErr.message, 500);
        if (!draft) return error("Draft not found", 404);
        if (typeof draft.stimulus_image_path === "string" && draft.stimulus_image_path) {
          const { data } = await svc.storage.from("question-assets").createSignedUrl(draft.stimulus_image_path, 60 * 60);
          if (data?.signedUrl) draft.stimulus_image_url = data.signedUrl;
        }
        if (typeof draft.stimulus_source_image_path === "string" && draft.stimulus_source_image_path) {
          const { data } = await svc.storage.from("question-assets").createSignedUrl(draft.stimulus_source_image_path, 60 * 60);
          if (data?.signedUrl) draft.stimulus_source_image_url = data.signedUrl;
        }
        return json({ draft });
      }

      if (req.method === "POST" && seg[4] === "approve") {
        const body = approveDraftSchema.parse(await req.json());
        const { question_id } = await approveDraft(svc, ctx.user.id, draftId, body);
        return json({ ok: true, question_id });
      }

      if (req.method === "POST" && seg[4] === "confirm-crop") {
        const { data: draft, error: cErr } = await svc
          .from("draft_questions")
          .select("id, has_visual_stimulus")
          .eq("id", draftId)
          .maybeSingle();
        if (cErr) return error(cErr.message, 500);
        if (!draft) return error("Draft not found", 404);
        if (!draft.has_visual_stimulus) return error("Only visual drafts require crop review", 422);
        const { error: uErr } = await svc
          .from("draft_questions")
          .update({ stimulus_crop_status: "confirmed" })
          .eq("id", draftId);
        if (uErr) return error(uErr.message, 500);
        await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "draft_question.crop_confirmed", entity_type: "draft_question", entity_id: draftId });
        return json({ ok: true });
      }

      if (req.method === "POST" && seg[4] === "reject") {
        await svc.from("draft_questions").update({ status: "rejected" }).eq("id", draftId);
        await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "draft_question.rejected", entity_type: "draft_question", entity_id: draftId });
        return json({ ok: true });
      }

      if (req.method === "PATCH") {
        const body = updateDraftSchema.parse(await req.json());
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
        const { error: uErr } = await svc.from("draft_questions").update(updates).eq("id", draftId);
        if (uErr) return error(uErr.message, 500);
        if (updates.stimulus_image_path !== undefined || updates.has_visual_stimulus === false) {
          const { data: linked } = await svc.from("draft_questions").select("question_id").eq("id", draftId).maybeSingle();
          if (linked?.question_id) {
            const { error: pErr } = await svc.from("questions").update({ stimulus_image_path: updates.stimulus_image_path ?? null }).eq("id", linked.question_id);
            if (pErr) return error(pErr.message, 500);
          }
        }
        if (choices && choices.length > 0) {
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
