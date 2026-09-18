import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import {
  testCreateSchema,
  testUpdateSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  moduleCreateSchema,
  moduleUpdateSchema,
  linkQuestionSchema,
  linkUpdateSchema,
  assignTestSchema,
  assignManySchema,
} from "../_shared/validation.ts";

async function ensureModulesValid(
  svc: ReturnType<typeof serviceClient>,
  testId: string,
  contentScope: string | undefined,
  moduleIds: string[] | undefined,
): Promise<void> {
  if (contentScope !== "custom_modules") return;
  if (!moduleIds || moduleIds.length === 0) throw new HttpError(422, "custom_modules scope requires module_ids");
  const { data: sections, error: sErr } = await svc.from("test_sections").select("id").eq("test_id", testId);
  if (sErr) throw new HttpError(500, sErr.message);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: modules, error: err } = await svc
    .from("test_modules")
    .select("id")
    .in("section_id", sectionIds.length > 0 ? sectionIds : [""]);
  if (err) throw new HttpError(500, err.message);
  const valid = new Set((modules ?? []).map((m) => m.id));
  for (const mid of moduleIds) {
    if (!valid.has(mid)) throw new HttpError(422, `module ${mid} is not part of this test`);
  }
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
        .select("*, sections:test_sections(*, modules:test_modules(*))")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);
      return json({ tests: data });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data, error: err } = await svc
        .from("tests")
        .select("*, sections:test_sections(*, modules:test_modules(*, questions:test_module_questions(*, question:questions(*, choices:question_choices(*)))))")
        .eq("id", id)
        .maybeSingle();
      if (err) return error(err.message, 500);
      if (!data) return error("Test not found", 404);
      return json({ test: data });
    }

    if (req.method === "POST" && seg.length === 1) {
      const body = testCreateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("tests")
        .insert({ ...body, created_by: ctx.user.id })
        .select("id, title, description, status, is_public")
        .single();
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "test.created",
        entity_type: "test",
        entity_id: data.id,
        details: { title: data.title },
      });
      return json({ test: data }, 201);
    }

    if (!id) return error("Not found", 404);

    if (req.method === "PATCH" && seg.length === 2) {
      const body = testUpdateSchema.parse(await req.json());
      const { data, error: err } = await svc.from("tests").update(body).eq("id", id).select("id, title, status, is_public").single();
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "test.updated",
        entity_type: "test",
        entity_id: id,
        details: body,
      });
      return json({ test: data });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "sections") {
      const body = sectionCreateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("test_sections")
        .insert(body)
        .select("id, name, section_type, position")
        .single();
      if (err) return error(err.message, 500);
      return json({ section: data }, 201);
    }

    if (req.method === "PATCH" && seg.length === 4 && seg[2] === "sections") {
      const body = sectionUpdateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("test_sections")
        .update(body)
        .eq("id", seg[3])
        .select("id, name, section_type, position")
        .single();
      if (err) return error(err.message, 500);
      if (!data) return error("Section not found", 404);
      return json({ section: data });
    }

    if (req.method === "DELETE" && seg.length === 4 && seg[2] === "sections") {
      const { data, error: err } = await svc.from("test_sections").delete().eq("id", seg[3]).select("id").maybeSingle();
      if (err) return error(err.message, 500);
      if (!data) return error("Section not found", 404);
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "modules") {
      const body = moduleCreateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("test_modules")
        .insert(body)
        .select("id, name, time_limit_minutes, position, is_adaptive")
        .single();
      if (err) return error(err.message, 500);
      return json({ module: data }, 201);
    }

    if (req.method === "PATCH" && seg.length === 4 && seg[2] === "modules") {
      const body = moduleUpdateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("test_modules")
        .update(body)
        .eq("id", seg[3])
        .select("id, name, time_limit_minutes, position, is_adaptive")
        .single();
      if (err) return error(err.message, 500);
      if (!data) return error("Module not found", 404);
      return json({ module: data });
    }

    if (req.method === "DELETE" && seg.length === 4 && seg[2] === "modules") {
      const { data, error: err } = await svc.from("test_modules").delete().eq("id", seg[3]).select("id").maybeSingle();
      if (err) return error(err.message, 500);
      if (!data) return error("Module not found", 404);
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "questions") {
      const body = linkQuestionSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("test_module_questions")
        .insert(body)
        .select("id, module_id, question_id, position, points")
        .single();
      if (err) return error(err.message, 500);
      return json({ link: data }, 201);
    }

    if (req.method === "PATCH" && seg.length === 4 && seg[2] === "questions") {
      const body = linkUpdateSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("test_module_questions")
        .update(body)
        .eq("id", seg[3])
        .select("id, module_id, question_id, position, points")
        .single();
      if (err) return error(err.message, 500);
      if (!data) return error("Question link not found", 404);
      return json({ link: data });
    }

    if (req.method === "DELETE" && seg.length === 4 && seg[2] === "questions") {
      const { error: err } = await svc.from("test_module_questions").delete().eq("id", seg[3]);
      if (err) return error(err.message, 500);
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "publish") {
      const { data, error: err } = await svc.from("tests").update({ status: "published" }).eq("id", id).select("id, status").single();
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "test.published", entity_type: "test", entity_id: id });
      return json({ test: data });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "assign") {
      const body = assignTestSchema.parse(await req.json());
      await ensureModulesValid(svc, body.test_id, body.content_scope, body.module_ids);
      const { data, error: err } = await svc
        .from("test_assignments")
        .upsert(
          {
            test_id: body.test_id,
            student_id: body.student_id,
            due_at: body.due_at ?? null,
            assigned_by: ctx.user.id,
            content_scope: body.content_scope,
            module_ids: body.content_scope === "custom_modules" ? (body.module_ids ?? []) : [],
          },
          { onConflict: "test_id,student_id" },
        )
        .select("id, test_id, student_id, due_at, content_scope, module_ids")
        .single();
      if (err) return error(err.message, 500);
      return json({ assignment: data }, 201);
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "assignees") {
      const body = assignManySchema.parse(await req.json());
      await ensureModulesValid(svc, id, body.content_scope, body.module_ids);

      const rows = body.student_ids.map((student_id) => ({
        test_id: id,
        student_id,
        due_at: body.due_at ?? null,
        assigned_by: ctx.user.id,
        content_scope: body.content_scope,
        module_ids: body.content_scope === "custom_modules" ? (body.module_ids ?? []) : [],
      }));

      const { data, error: err } = await svc
        .from("test_assignments")
        .upsert(rows, { onConflict: "test_id,student_id", ignoreDuplicates: false })
        .select("id, test_id, student_id, content_scope");
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "test.assigned",
        entity_type: "test",
        entity_id: id,
        details: { count: body.student_ids.length, content_scope: body.content_scope, module_ids: body.module_ids ?? [] },
      });
      return json({ assigned: (data ?? []).length }, 201);
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