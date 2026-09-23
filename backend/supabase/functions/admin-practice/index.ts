import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import {
  practiceCreateSchema,
  practiceUpdateSchema,
  practiceAddQuestionsSchema,
  practiceQuestionEditSchema,
} from "../_shared/validation.ts";

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
      // Templates are admin-only: students only see assignment snapshots.
      is_public: false,
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
      const { data: batches } = await svc.from("practice_assignment_batches").select("snapshot_test_id");
      const snapshots = new Set((batches ?? []).map((b) => b.snapshot_test_id));
      const sets = (data ?? []).filter((row) => !snapshots.has(row.id)).map((row: Record<string, unknown>) => {
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
      const { data: found, error: fErr } = await svc
        .from("questions")
        .select("id, source_pdf_id, status")
        .in("id", body.question_ids)
        .is("source_pdf_id", null)
        .eq("status", "active");
      if (fErr) return error(fErr.message, 500);
      if ((found ?? []).length !== body.question_ids.length) {
        return error("One or more questions are not eligible for the Practice Question Bank", 422);
      }
      const set = await createSet(svc, ctx.user.id, { ...body, description: body.description ?? null });
      return json({ set }, 201);
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
      const { data: found, error: fErr } = await svc
        .from("questions")
        .select("id, source_pdf_id, status")
        .in("id", body.question_ids)
        .is("source_pdf_id", null)
        .eq("status", "active");
      if (fErr) return error(fErr.message, 500);
      if ((found ?? []).length !== body.question_ids.length) {
        return error("One or more questions are not eligible for the Practice Question Bank", 422);
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

    // Copy-on-write question edit (plus position reorder) for a template.
    // Shared bank questions are cloned and relinked so other tests, sets,
    // and assignment snapshots keep the original.
    if (req.method === "PATCH" && seg.length === 4 && seg[2] === "questions") {
      const linkId = seg[3];
      const body = practiceQuestionEditSchema.parse(await req.json());
      const { data: link, error: lErr } = await svc
        .from("test_module_questions")
        .select("id, module_id, question_id, position")
        .eq("id", linkId)
        .maybeSingle();
      if (lErr) return error(lErr.message, 500);
      if (!link) return error("Question link not found", 404);

      if (body.position !== undefined && body.position !== link.position) {
        const { data: other, error: oErr } = await svc
          .from("test_module_questions")
          .select("id")
          .eq("module_id", link.module_id)
          .eq("position", body.position)
          .maybeSingle();
        if (oErr) return error(oErr.message, 500);
        if (other) {
          const { error: tErr } = await svc.from("test_module_questions").update({ position: 9999 }).eq("id", other.id);
          if (tErr) return error(tErr.message, 500);
          const { error: u1 } = await svc.from("test_module_questions").update({ position: body.position }).eq("id", linkId);
          if (u1) return error(u1.message, 500);
          const { error: u2 } = await svc.from("test_module_questions").update({ position: link.position }).eq("id", other.id);
          if (u2) return error(u2.message, 500);
        } else {
          const { error: uErr } = await svc.from("test_module_questions").update({ position: body.position }).eq("id", linkId);
          if (uErr) return error(uErr.message, 500);
        }
        await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "practice.question_moved", entity_type: "test", entity_id: id });
        return json({ ok: true });
      }

      const { position: _pos, choices, ...fields } = body;
      void _pos;
      const fieldKeys = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
      if (fieldKeys.length === 0 && choices === undefined) return error("Nothing to update", 422);

      const { data: question, error: qErr } = await svc.from("questions").select("*").eq("id", link.question_id).maybeSingle();
      if (qErr) return error(qErr.message, 500);
      if (!question) return error("Question not found", 404);

      const targetType = (fields.question_type as string | undefined) ?? question.question_type;
      if (choices !== undefined) {
        if (targetType === "multiple_choice" && choices.length < 2) {
          return error("Multiple choice questions need at least 2 choices", 422);
        }
        if (targetType !== "multiple_choice" && choices.length > 0) {
          return error("Student-produced questions cannot have choices", 422);
        }
      }

      // Shared with another test/set/snapshot? Clone first, relink only here.
      const { count: useCount, error: cErr } = await svc
        .from("test_module_questions")
        .select("id", { count: "exact", head: true })
        .eq("question_id", question.id)
        .neq("id", linkId);
      if (cErr) return error(cErr.message, 500);

      let targetId = question.id;
      let cloned = false;
      if ((useCount ?? 0) > 0) {
        const { id: _id, created_at: _ca, updated_at: _ua, ...copyable } = question as Record<string, unknown>;
        void _id;
        void _ca;
        void _ua;
        const { data: clone, error: clErr } = await svc
          .from("questions")
          .insert({ ...copyable, ...fields, created_by: ctx.user.id })
          .select("id")
          .single();
        if (clErr) return error(clErr.message, 500);
        targetId = clone.id;
        cloned = true;
        const { data: origChoices, error: ocErr } = await svc.from("question_choices").select("label, text, is_correct, position").eq("question_id", question.id);
        if (ocErr) return error(ocErr.message, 500);
        const choiceRows = choices ?? (origChoices ?? []);
        if (choiceRows.length > 0) {
          const { error: iErr } = await svc.from("question_choices").insert(
            choiceRows.map((c) => ({ question_id: targetId, label: c.label, text: c.text, is_correct: c.is_correct, position: c.position })),
          );
          if (iErr) return error(iErr.message, 500);
        }
        const { error: rlErr } = await svc.from("test_module_questions").update({ question_id: targetId }).eq("id", linkId);
        if (rlErr) return error(rlErr.message, 500);
      } else {
        const updates: Record<string, unknown> = {};
        for (const k of fieldKeys) updates[k] = (fields as Record<string, unknown>)[k];
        if (Object.keys(updates).length > 0) {
          const { error: uErr } = await svc.from("questions").update(updates).eq("id", targetId);
          if (uErr) return error(uErr.message, 500);
        }
        if (choices !== undefined) {
          const { error: dErr } = await svc.from("question_choices").delete().eq("question_id", targetId);
          if (dErr) return error(dErr.message, 500);
          if (choices.length > 0) {
            const { error: iErr } = await svc.from("question_choices").insert(
              choices.map((c) => ({ question_id: targetId, ...c })),
            );
            if (iErr) return error(iErr.message, 500);
          }
        }
      }

      const { data: full } = await svc
        .from("questions")
        .select("*, choices:question_choices(*), passage:passages(*)")
        .eq("id", targetId)
        .maybeSingle();
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: cloned ? "practice.question_cloned_edited" : "practice.question_edited",
        entity_type: "test",
        entity_id: id,
        details: { fields: fieldKeys, cloned },
      });
      return json({ question: full, cloned });
    }

    // Delete a template. Assignment snapshots, attempts, and analytics are
    // preserved (batches keep a null source).
    if (req.method === "DELETE" && seg.length === 2) {
      const { data: set, error: sErr } = await svc.from("tests").select("id").eq("id", id).eq("kind", "practice").maybeSingle();
      if (sErr) return error(sErr.message, 500);
      if (!set) return error("Practice set not found", 404);
      const { error: dErr } = await svc.from("tests").delete().eq("id", id);
      if (dErr) return error(dErr.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "practice.deleted", entity_type: "test", entity_id: id });
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
