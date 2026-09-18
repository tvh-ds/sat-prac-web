import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import {
  practiceCreateSchema,
  practiceFromImportSchema,
  practiceUpdateSchema,
  practiceAddQuestionsSchema,
} from "../_shared/validation.ts";
import { approveDraft } from "../_shared/drafts.ts";

async function moduleForSet(svc: ReturnType<typeof serviceClient>, set: { id: string }): Promise<{ id: string } | null> {
  const { data: sections } = await svc.from("test_sections").select("id").eq("test_id", set.id).order("position");
  if (!sections || sections.length === 0) return null;
  const { data: modules } = await svc
    .from("test_modules")
    .select("id")
    .eq("section_id", sections[0].id)
    .order("position");
  return modules && modules.length > 0 ? modules[0] : null;
}

async function nextPosition(svc: ReturnType<typeof serviceClient>, moduleId: string): Promise<number> {
  const { data, error: err } = await svc
    .from("test_module_questions")
    .select("position")
    .eq("module_id", moduleId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  return (data ? data.position : 0) + 1;
}

async function createSet(svc: ReturnType<typeof serviceClient>, adminId: string, body: {
  title: string;
  description: string | null;
  time_limit_minutes: number;
  question_ids: string[];
}): Promise<{ id: string }> {
  const { data: test, error: tErr } = await svc
    .from("tests")
    .insert({
      title: body.title,
      description: body.description,
      status: "published",
      is_public: true,
      kind: "practice",
      created_by: adminId,
    })
    .select("id")
    .single();
  if (tErr) throw new HttpError(500, tErr.message);

  const { data: firstQ } = await svc.from("questions").select("section").eq("id", body.question_ids[0]).maybeSingle();
  const sectionType = firstQ?.section === "math" ? "math" : "reading_writing";

  const { data: section, error: sErr } = await svc
    .from("test_sections")
    .insert({ test_id: test.id, name: "Practice", section_type: sectionType, position: 1 })
    .select("id")
    .single();
  if (sErr) throw new HttpError(500, sErr.message);

  const { data: module, error: mErr } = await svc
    .from("test_modules")
    .insert({ section_id: section.id, name: "Practice", time_limit_minutes: body.time_limit_minutes, position: 1, is_adaptive: false })
    .select("id")
    .single();
  if (mErr) throw new HttpError(500, mErr.message);

  const { error: lErr } = await svc.from("test_module_questions").insert(
    body.question_ids.map((qid, i) => ({ module_id: module.id, question_id: qid, position: i + 1, points: 1 })),
  );
  if (lErr) throw new HttpError(500, lErr.message);

  await svc.from("audit_logs").insert({
    actor_id: adminId,
    action: "practice.created",
    entity_type: "test",
    entity_id: test.id,
    details: { question_count: body.question_ids.length, time_limit_minutes: body.time_limit_minutes },
  });

  return { id: test.id };
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
        .from("tests")
        .select("id, title, description, status, is_public, created_at, sections:test_sections(modules:test_modules(time_limit_minutes, questions:test_module_questions(question_id)))")
        .eq("kind", "practice")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);
      const sets = (data ?? []).map((row: Record<string, unknown>) => {
        const sections = (row.sections ?? []) as Array<{ modules: Array<{ questions: unknown[] }> }>;
        const modules = sections.flatMap((s) => s.modules);
        const question_count = modules.reduce((n, m) => n + m.questions.length, 0);
        const time_limit_minutes = modules[0] ? (modules[0] as Record<string, unknown>).time_limit_minutes : null;
        const { sections: _drop, ...rest } = row;
        return { ...rest, time_limit_minutes, question_count };
      });
      return json({ sets });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data: set, error: sErr } = await svc
        .from("tests")
        .select("id, title, description, status, is_public, created_at, updated_at")
        .eq("id", id)
        .eq("kind", "practice")
        .maybeSingle();
      if (sErr) return error(sErr.message, 500);
      if (!set) return error("Practice set not found", 404);

      const module = await moduleForSet(svc, set);
      let questions: Array<Record<string, unknown>> = [];
      let time_limit_minutes: number | null = null;
      if (module) {
        const { data: mod } = await svc.from("test_modules").select("time_limit_minutes").eq("id", module.id).maybeSingle();
        time_limit_minutes = mod?.time_limit_minutes ?? null;
        const { data: links } = await svc
          .from("test_module_questions")
          .select("id, position, points, question:questions(*, choices:question_choices(*), passage:passages(*))")
          .eq("module_id", module.id)
          .order("position");
        questions = links ?? [];
      }
      return json({ set: { ...set, time_limit_minutes }, questions });
    }

    if (req.method === "POST" && seg.length === 1) {
      const body = practiceCreateSchema.parse(await req.json());
      const { data: found, error: fErr } = await svc.from("questions").select("id").in("id", body.question_ids);
      if (fErr) return error(fErr.message, 500);
      if ((found ?? []).length !== body.question_ids.length) {
        return error("One or more question ids do not exist", 422);
      }
      const set = await createSet(svc, ctx.user.id, { ...body, description: body.description ?? null });
      return json({ set }, 201);
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "from-import") {
      const body = practiceFromImportSchema.parse(await req.json());
      const { data: drafts, error: dErr } = await svc
        .from("draft_questions")
        .select("id, status, suggested_answer, question_id")
        .in("id", body.draft_ids);
      if (dErr) return error(dErr.message, 500);
      if ((drafts ?? []).length !== body.draft_ids.length) {
        return error("One or more draft ids do not exist", 422);
      }
      if (!body.include_missing_key) {
        const missing = (drafts ?? []).filter((d) => d.status === "missing_key" && !d.question_id);
        if (missing.length > 0) {
          return error(`Skip drafts without an answer key or enable "include drafts without keys": ${missing.map((d) => d.id).join(", ")}`, 422);
        }
      }

      let created = 0;
      const questionIds: string[] = [];
      for (const draft of drafts ?? []) {
        if (draft.question_id) {
          questionIds.push(draft.question_id);
          continue;
        }
        const { question_id } = await approveDraft(svc, ctx.user.id, draft.id, {});
        questionIds.push(question_id);
        created += 1;
      }

      const set = await createSet(svc, ctx.user.id, { ...body, description: body.description ?? null, question_ids: questionIds });
      return json({ set, created_questions: created, reused_questions: questionIds.length - created }, 201);
    }

    if (!id) return error("Not found", 404);

    if (req.method === "PATCH" && seg.length === 2) {
      const body = practiceUpdateSchema.parse(await req.json());
      const { data: set, error: sErr } = await svc
        .from("tests")
        .select("id, title, description, status")
        .eq("id", id)
        .eq("kind", "practice")
        .maybeSingle();
      if (sErr) return error(sErr.message, 500);
      if (!set) return error("Practice set not found", 404);

      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.status !== undefined) updates.status = body.status;
      const { error: uErr } = await svc.from("tests").update(updates).eq("id", id);
      if (uErr) return error(uErr.message, 500);

      if (body.time_limit_minutes !== undefined) {
        const module = await moduleForSet(svc, set);
        if (module) {
          const { error: mErr } = await svc.from("test_modules").update({ time_limit_minutes: body.time_limit_minutes }).eq("id", module.id);
          if (mErr) return error(mErr.message, 500);
        }
      }

      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "practice.updated", entity_type: "test", entity_id: id });
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "questions") {
      const body = practiceAddQuestionsSchema.parse(await req.json());
      const { data: set, error: sErr } = await svc.from("tests").select("id").eq("id", id).eq("kind", "practice").maybeSingle();
      if (sErr) return error(sErr.message, 500);
      if (!set) return error("Practice set not found", 404);
      const { data: found, error: fErr } = await svc.from("questions").select("id").in("id", body.question_ids);
      if (fErr) return error(fErr.message, 500);
      if ((found ?? []).length !== body.question_ids.length) {
        return error("One or more question ids do not exist", 422);
      }
      const module = await moduleForSet(svc, set);
      if (!module) return error("Practice set has no module", 500);
      let pos = await nextPosition(svc, module.id);
      const { error: lErr } = await svc.from("test_module_questions").insert(
        body.question_ids.map((qid) => ({ module_id: module.id, question_id: qid, position: pos++, points: 1 })),
      );
      if (lErr) return error(lErr.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "practice.question_added", entity_type: "test", entity_id: id, details: { count: body.question_ids.length } });
      return json({ ok: true, added: body.question_ids.length });
    }

    if (req.method === "DELETE" && seg.length === 4 && seg[2] === "questions") {
      const linkId = seg[3];
      const { data: link, error: lErr } = await svc.from("test_module_questions").select("id").eq("id", linkId).maybeSingle();
      if (lErr) return error(lErr.message, 500);
      if (!link) return error("Question link not found", 404);
      const { error: dErr } = await svc.from("test_module_questions").delete().eq("id", linkId);
      if (dErr) return error(dErr.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "practice.question_removed", entity_type: "test", entity_id: id });
      return json({ ok: true });
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