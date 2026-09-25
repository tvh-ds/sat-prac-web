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
  fullTestQuestionEditSchema,
  assignTestSchema,
  assignManySchema,
} from "../_shared/validation.ts";
import { buildAttemptReview } from "../_shared/attempt_review.ts";

type Svc = ReturnType<typeof serviceClient>;

async function signTestQuestionAssets(svc: Svc, test: Record<string, unknown>): Promise<void> {
  const sections = (test.sections ?? []) as Array<Record<string, unknown>>;
  for (const section of sections) {
    for (const module of (section.modules ?? []) as Array<Record<string, unknown>>) {
      for (const link of (module.questions ?? []) as Array<Record<string, unknown>>) {
        const question = link.question as Record<string, unknown> | null;
        const imagePath = question?.stimulus_image_path;
        if (typeof imagePath !== "string" || !imagePath) continue;
        const { data } = await svc.storage.from("question-assets").createSignedUrl(imagePath, 60 * 60);
        if (data?.signedUrl) question.stimulus_image_url = data.signedUrl;
      }
    }
  }
}

async function activateForAssignment(svc: Svc, testId: string): Promise<void> {
  const { data: test, error: getErr } = await svc.from("tests").select("id, status, kind").eq("id", testId).eq("kind", "full").maybeSingle();
  if (getErr) throw new HttpError(500, getErr.message);
  if (!test) throw new HttpError(404, "Full-length test not found");
  if (test.status === "archived") throw new HttpError(409, "Archived tests cannot be assigned");
  const { error: updateErr } = await svc.from("tests").update({ status: "published", is_public: false }).eq("id", testId);
  if (updateErr) throw new HttpError(500, updateErr.message);
}

async function ensureModulesValid(
  svc: Svc,
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

async function scopedModuleIds(svc: Svc, testId: string, contentScope: string, moduleIds: string[] | null | undefined): Promise<string[]> {
  const { data: sections, error: sErr } = await svc.from("test_sections").select("id, section_type").eq("test_id", testId);
  if (sErr) throw new HttpError(500, sErr.message);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: modules, error: mErr } = await svc
    .from("test_modules")
    .select("id, section_id")
    .in("section_id", sectionIds.length > 0 ? sectionIds : [""]);
  if (mErr) throw new HttpError(500, mErr.message);
  const all = modules ?? [];
  if (contentScope === "custom_modules") {
    const allowed = new Set(moduleIds ?? []);
    return all.filter((m) => allowed.has(m.id)).map((m) => m.id);
  }
  if (contentScope === "reading_writing" || contentScope === "math") {
    const allowedSections = new Set((sections ?? []).filter((s) => s.section_type === contentScope).map((s) => s.id));
    return all.filter((m) => allowedSections.has(m.section_id)).map((m) => m.id);
  }
  return all.map((m) => m.id);
}

async function questionCountForScope(svc: Svc, testId: string, contentScope: string, moduleIds: string[] | null | undefined): Promise<number> {
  const ids = await scopedModuleIds(svc, testId, contentScope, moduleIds);
  if (ids.length === 0) return 0;
  const { count, error: err } = await svc
    .from("test_module_questions")
    .select("id", { count: "exact", head: true })
    .in("module_id", ids);
  if (err) throw new HttpError(500, err.message);
  return count ?? 0;
}

async function fullBatchStudents(svc: Svc, batch: { id: string }) {
  const { data: assignments, error: aErr } = await svc
    .from("test_assignments")
    .select("id, student_id, status, assigned_at, due_at")
    .eq("assignment_batch_id", batch.id)
    .order("assigned_at");
  if (aErr) throw new HttpError(500, aErr.message);

  const studentIds = (assignments ?? []).map((a) => a.student_id);
  const [{ data: profiles }, authList] = await Promise.all([
    studentIds.length > 0
      ? svc.from("student_profiles").select("id, profiles(full_name)").in("id", studentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; profiles: { full_name?: string } | null }> }),
    svc.auth.admin.listUsers({ perPage: 1000 }).catch(() => null),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => {
    const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    return [p.id, profile?.full_name ?? ""];
  }));
  const emails = new Map(((authList as { users?: Array<{ id: string; email?: string }> } | null)?.users ?? []).map((u) => [u.id, u.email]));

  const assignmentIds = (assignments ?? []).map((a) => a.id);
  const { data: attempts } = assignmentIds.length > 0
    ? await svc.from("attempts").select("id, assignment_id, status, started_at, submitted_at").in("assignment_id", assignmentIds)
    : { data: [] as Array<{ id: string; assignment_id: string; status: string; started_at: string; submitted_at: string | null }> };
  const latestByAssignment = new Map<string, { id: string; assignment_id: string; status: string; started_at: string; submitted_at: string | null }>();
  for (const a of (attempts ?? []).sort((x, y) => (x.started_at < y.started_at ? -1 : 1))) latestByAssignment.set(a.assignment_id, a);
  const latestGradedByAssignment = new Map<string, { id: string; assignment_id: string; status: string; started_at: string; submitted_at: string | null }>();
  for (const a of (attempts ?? []).filter((x) => x.status === "graded").sort((x, y) => (x.started_at < y.started_at ? -1 : 1))) latestGradedByAssignment.set(a.assignment_id, a);

  const latestIds = [...latestByAssignment.values()].map((a) => a.id);
  const { data: scores } = latestIds.length > 0
    ? await svc.from("scores").select("attempt_id, raw_score, total_questions").in("attempt_id", latestIds)
    : { data: [] as Array<{ attempt_id: string; raw_score: number; total_questions: number }> };
  const scoreByAttempt = new Map((scores ?? []).map((s) => [s.attempt_id, s]));

  return (assignments ?? []).map((a) => {
    const att = latestByAssignment.get(a.id);
    const sc = att ? scoreByAttempt.get(att.id) : undefined;
    const total = sc ? Number(sc.total_questions) : 0;
    const raw = sc ? Number(sc.raw_score) : 0;
    return {
      assignment_id: a.id,
      student_id: a.student_id,
      full_name: nameById.get(a.student_id) ?? "",
      email: emails.get(a.student_id) ?? null,
      status: att ? att.status : (a.status === "completed" ? "completed" : "not_started"),
      started_at: att?.started_at ?? null,
      submitted_at: att?.submitted_at ?? null,
      raw_score: sc ? raw : null,
      total_questions: sc ? total : null,
      accuracy: sc && total > 0 ? Math.round((raw / total) * 1000) / 10 : null,
      review_attempt_id: latestGradedByAssignment.get(a.id)?.id ?? null,
    };
  });
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
        .eq("kind", "full")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);
      return json({ tests: data });
    }

    if (req.method === "GET" && seg.length === 2 && seg[1] === "assignment-batches") {
      const { data: batches, error: bErr } = await svc
        .from("full_test_assignment_batches")
        .select("*")
        .order("assigned_at", { ascending: false });
      if (bErr) return error(bErr.message, 500);

      const rows = [];
      for (const b of batches ?? []) {
        const students = await fullBatchStudents(svc, b);
        const graded = students.filter((s) => s.review_attempt_id);
        const acc = students.filter((s) => s.accuracy != null).map((s) => Number(s.accuracy));
        rows.push({
          ...b,
          question_count: await questionCountForScope(svc, b.source_test_id, b.content_scope, b.module_ids),
          student_count: students.length,
          completed_count: graded.length,
          avg_accuracy: acc.length > 0 ? Math.round((acc.reduce((x, y) => x + y, 0) / acc.length) * 10) / 10 : null,
        });
      }
      return json({ batches: rows });
    }

    if (req.method === "GET" && seg.length === 3 && seg[1] === "assignment-batches") {
      const { data: batch, error: bErr } = await svc
        .from("full_test_assignment_batches")
        .select("*")
        .eq("id", seg[2])
        .maybeSingle();
      if (bErr) return error(bErr.message, 500);
      if (!batch) return error("Assignment batch not found", 404);
      const students = await fullBatchStudents(svc, batch);
      return json({ batch: { ...batch, question_count: await questionCountForScope(svc, batch.source_test_id, batch.content_scope, batch.module_ids), student_count: students.length }, students });
    }

    if (req.method === "GET" && seg.length === 5 && seg[1] === "assignment-batches" && seg[3] === "attempts") {
      const { data: batch, error: bErr } = await svc
        .from("full_test_assignment_batches")
        .select("id")
        .eq("id", seg[2])
        .maybeSingle();
      if (bErr) return error(bErr.message, 500);
      if (!batch) return error("Assignment batch not found", 404);

      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("id, test_id, assignment_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("id", seg[4])
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt || !attempt.assignment_id) return error("Attempt not found", 404);

      const { data: assignment, error: asErr } = await svc
        .from("test_assignments")
        .select("id")
        .eq("id", attempt.assignment_id)
        .eq("assignment_batch_id", batch.id)
        .maybeSingle();
      if (asErr) return error(asErr.message, 500);
      if (!assignment) return error("Attempt is not tied to this assignment batch", 404);

      const review = await buildAttemptReview(svc, attempt, { includeExplanations: true });
      return json({ attempt, review, explanations_released: true });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data, error: err } = await svc
        .from("tests")
        .select("*, sections:test_sections(*, modules:test_modules(*, questions:test_module_questions(*, question:questions(*, choices:question_choices(*), passage:passages(id, title, content)))))")
        .eq("id", id)
        .maybeSingle();
      if (err) return error(err.message, 500);
      if (!data) return error("Test not found", 404);
      await signTestQuestionAssets(svc, data as unknown as Record<string, unknown>);
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
      const { data: existing, error: existingErr } = await svc.from("tests").select("kind").eq("id", id).maybeSingle();
      if (existingErr) return error(existingErr.message, 500);
      if (!existing) return error("Test not found", 404);
      if (existing.kind === "full" && body.is_public === true) return error("Full-length tests are assigned to students and cannot be public", 422);
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

    if (req.method === "POST" && seg.length === 5 && seg[2] === "questions" && seg[4] === "content") {
      const body = fullTestQuestionEditSchema.parse(await req.json());
      const { data: link, error: linkErr } = await svc.from("test_module_questions")
        .select("id, module_id, question_id").eq("id", seg[3]).maybeSingle();
      if (linkErr) return error(linkErr.message, 500);
      if (!link) return error("Question link not found", 404);
      const { data: module, error: moduleErr } = await svc.from("test_modules").select("section_id").eq("id", link.module_id).maybeSingle();
      if (moduleErr) return error(moduleErr.message, 500);
      if (!module) return error("Test module not found", 404);
      const { data: section, error: sectionErr } = await svc.from("test_sections").select("test_id").eq("id", module.section_id).maybeSingle();
      if (sectionErr) return error(sectionErr.message, 500);
      if (!section || section.test_id !== id) return error("Question does not belong to this test", 404);
      const { data: original, error: questionErr } = await svc.from("questions").select("question_type").eq("id", link.question_id).maybeSingle();
      if (questionErr) return error(questionErr.message, 500);
      if (!original) return error("Question not found", 404);
      if (original.question_type === "multiple_choice" && body.choices.length < 2) {
        return error("Multiple-choice questions need at least two choices", 422);
      }
      if (original.question_type === "student_produced" && body.choices.length > 0) {
        return error("Student-produced questions cannot have choices", 422);
      }
      const { data: questionId, error: cloneErr } = await svc.rpc("clone_full_test_question_for_edit", {
        p_test_id: id,
        p_link_id: link.id,
        p_payload: body,
        p_admin_id: ctx.user.id,
      });
      if (cloneErr) return error(cloneErr.message, /not found/i.test(cloneErr.message) ? 404 : 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "full_test.question_edited",
        entity_type: "question",
        entity_id: questionId,
        details: { test_id: id, replaced_question_id: link.question_id, link_id: link.id },
      });
      return json({ question_id: questionId });
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
      const { data: test, error: testErr } = await svc.from("tests").select("id, title").eq("id", body.test_id).eq("kind", "full").maybeSingle();
      if (testErr) return error(testErr.message, 500);
      if (!test) return error("Test not found", 404);
      await activateForAssignment(svc, body.test_id);
      const { data: batch, error: batchErr } = await svc
        .from("full_test_assignment_batches")
        .insert({
          source_test_id: body.test_id,
          title: test.title,
          content_scope: body.content_scope,
          module_ids: body.content_scope === "custom_modules" ? (body.module_ids ?? []) : [],
          due_at: body.due_at ?? null,
          assigned_by: ctx.user.id,
        })
        .select("id")
        .single();
      if (batchErr) return error(batchErr.message, 500);
      // Repeat assignments: every POST creates its own row (own due date,
      // status, attempts, scores) — never merged with an earlier assignment.
      const { data, error: err } = await svc
        .from("test_assignments")
        .insert(
          {
            test_id: body.test_id,
            student_id: body.student_id,
            due_at: body.due_at ?? null,
            assigned_by: ctx.user.id,
            content_scope: body.content_scope,
            module_ids: body.content_scope === "custom_modules" ? (body.module_ids ?? []) : [],
            assignment_batch_id: batch.id,
          },
        )
        .select("id, test_id, student_id, due_at, content_scope, module_ids")
        .single();
      if (err) return error(err.message, 500);
      return json({ assignment: data }, 201);
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "assignees") {
      const body = assignManySchema.parse(await req.json());
      await ensureModulesValid(svc, id, body.content_scope, body.module_ids);
      const { data: test, error: testErr } = await svc.from("tests").select("id, title").eq("id", id).eq("kind", "full").maybeSingle();
      if (testErr) return error(testErr.message, 500);
      if (!test) return error("Test not found", 404);
      await activateForAssignment(svc, id);
      const { data: batch, error: batchErr } = await svc
        .from("full_test_assignment_batches")
        .insert({
          source_test_id: id,
          title: test.title,
          content_scope: body.content_scope,
          module_ids: body.content_scope === "custom_modules" ? (body.module_ids ?? []) : [],
          due_at: body.due_at ?? null,
          assigned_by: ctx.user.id,
        })
        .select("id")
        .single();
      if (batchErr) return error(batchErr.message, 500);

      const rows = body.student_ids.map((student_id) => ({
        test_id: id,
        student_id,
        due_at: body.due_at ?? null,
        assigned_by: ctx.user.id,
        content_scope: body.content_scope,
        module_ids: body.content_scope === "custom_modules" ? (body.module_ids ?? []) : [],
        assignment_batch_id: batch.id,
      }));

      const { data, error: err } = await svc
        .from("test_assignments")
        .insert(rows)
        .select("id, test_id, student_id, content_scope");
      if (err) return error(err.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "test.assigned",
        entity_type: "test",
        entity_id: id,
        details: { count: body.student_ids.length, content_scope: body.content_scope, module_ids: body.module_ids ?? [] },
      });
      return json({ assigned: (data ?? []).length, batch }, 201);
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
