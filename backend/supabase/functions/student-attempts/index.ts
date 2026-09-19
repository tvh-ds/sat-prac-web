import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { startAttemptSchema, advanceModuleSchema } from "../_shared/validation.ts";

const TEST_STRUCTURE_QUERY =
  "id, title, description, status, is_public, kind, sections:test_sections(id, test_id, name, section_type, position, modules:test_modules(id, section_id, name, time_limit_minutes, position, is_adaptive, questions:test_module_questions(id, module_id, question_id, position, points, question:questions(id, section, question_type, passage_id, prompt, domain, skill, difficulty, stimulus_image_path, choices:question_choices(id, label, text, position), passage:passages(id, title, content)))))";

async function loadTestStructure(svc: ReturnType<typeof serviceClient>, testId: string) {
  const { data, error: err } = await svc
    .from("tests")
    .select(TEST_STRUCTURE_QUERY)
    .eq("id", testId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  return data;
}

async function attachStimulusUrls(svc: ReturnType<typeof serviceClient>, test: Record<string, unknown> | null): Promise<void> {
  if (!test) return;
  const sections = (test.sections ?? []) as Array<{ modules?: Array<{ questions?: Array<{ question?: Record<string, unknown> }> }> }>;
  for (const section of sections) {
    for (const module of section.modules ?? []) {
      for (const link of module.questions ?? []) {
        const question = link.question;
        const path = question?.stimulus_image_path;
        if (typeof path !== "string" || !path) continue;
        const { data } = await svc.storage.from("question-assets").createSignedUrl(path, 60 * 60);
        if (data?.signedUrl) question.stimulus_image_url = data.signedUrl;
      }
    }
  }
}

interface SectionLike {
  id: string;
  section_type?: string;
  modules?: Array<{ id: string }>;
}

/**
 * Resolve which module ids a student can take for a test given their
 * assignment scope. Public tests (and missing assignments) mean the full
 * test. `custom_modules` uses the stored module_ids; section scopes map to
 * modules under that section type.
 */
function allowedModuleIds(
  test: Record<string, unknown> | null,
  assignment: { content_scope?: string | null; module_ids?: string[] | null } | null,
): Set<string> {
  const sections = (test?.sections ?? []) as Array<SectionLike>;
  const all = new Set<string>();
  for (const s of sections) for (const m of s.modules ?? []) all.add(m.id);

  const scope = assignment?.content_scope ?? "full_test";
  if (scope === "full_test" || !assignment) return all;
  if (scope === "custom_modules") {
    const explicit = new Set<string>(assignment.module_ids ?? []);
    return new Set([...explicit].filter((id) => all.has(id)));
  }
  const wanted = scope as "reading_writing" | "math";
  const allowed = new Set<string>();
  for (const s of sections) {
    if (s.section_type !== wanted) continue;
    for (const m of s.modules ?? []) allowed.add(m.id);
  }
  return allowed;
}

function filterTestToModules(test: Record<string, unknown> | null, allowed: Set<string>): void {
  if (!test) return;
  const sections = (test.sections ?? []) as Array<SectionLike>;
  for (const s of sections) {
    s.modules = (s.modules ?? []).filter((m) => allowed.has(m.id));
  }
  test.sections = sections.filter((s) => (s.modules ?? []).length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "student");
    const svc = serviceClient();
    const seg = pathSegments(req);

    if (req.method === "POST" && seg.length === 1) {
      const body = startAttemptSchema.parse(await req.json());

      // Repeat assignments: the client starts a specific assignment. The
      // test is resolved from it, and the active-attempt check is scoped to
      // that assignment — other assignments of the same test are unaffected.
      let testId = body.test_id;
      let assignmentId: string | null = null;
      let assignmentScope: { content_scope?: string | null; module_ids?: string[] | null } | null = null;
      if (body.assignment_id) {
        const { data: asg, error: asgErr } = await svc
          .from("test_assignments")
          .select("id, test_id, content_scope, module_ids")
          .eq("id", body.assignment_id)
          .eq("student_id", ctx.user.id)
          .maybeSingle();
        if (asgErr) return error(asgErr.message, 500);
        if (!asg) return error("Assignment not found", 404);
        testId = asg.test_id;
        assignmentId = asg.id;
        assignmentScope = asg;
      }

      const test = await loadTestStructure(svc, testId);
      if (!test) return error("Test not found", 404);
      if (test.status !== "published") return error("Test is not available", 403);

      if (test.is_public !== true && !assignmentId) {
        // Legacy path for clients that do not send assignment_id: use the
        // student's (first) assignment for this test.
        const { data: assignment, error: assignmentErr } = await svc
          .from("test_assignments")
          .select("id, content_scope, module_ids")
          .eq("test_id", testId)
          .eq("student_id", ctx.user.id)
          .maybeSingle();
        if (assignmentErr) return error(assignmentErr.message, 500);
        if (!assignment) return error("You do not have access to this test", 403);
        assignmentId = assignment.id;
        assignmentScope = assignment;
      }

      const allowed = allowedModuleIds(test as Record<string, unknown>, assignmentScope);
      filterTestToModules(test as Record<string, unknown>, allowed);
      await attachStimulusUrls(svc, test as Record<string, unknown>);
      if (allowed.size === 0) return error("This assignment has no modules", 409);

      // One active attempt per assignment (public attempts: per test).
      let existingQuery = svc
        .from("attempts")
        .select("id")
        .eq("student_id", ctx.user.id)
        .in("status", ["in_progress", "submitted"]);
      existingQuery = assignmentId
        ? existingQuery.eq("assignment_id", assignmentId)
        : existingQuery.eq("test_id", testId).is("assignment_id", null);
      const { data: existing } = await existingQuery.maybeSingle();
      if (existing) return error("An attempt for this test already exists", 409);

      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .insert({ student_id: ctx.user.id, test_id: testId, assignment_id: assignmentId, status: "in_progress" })
        .select("*")
        .single();
      if (aErr) return error(aErr.message, 500);

      if (assignmentId) {
        await svc.from("test_assignments").update({ status: "in_progress" }).eq("id", assignmentId);
      }

      const modules = ((test.sections ?? []) as Array<{ modules?: Array<{ id: string; position: number }> }>)
        .flatMap((s) => s.modules ?? []);
      const firstModule = modules.sort((a, b) => a.position - b.position)[0];

      if (modules.length > 0) {
        const { error: mErr } = await svc.from("attempt_modules").insert(
          modules.map((m: { id: string }) => ({
            attempt_id: attempt.id,
            module_id: m.id,
            status: m.id === firstModule?.id ? "in_progress" : "not_started",
            started_at: m.id === firstModule?.id ? new Date().toISOString() : null,
          })),
        );
        if (mErr) return error(mErr.message, 500);
      }

      const { error: uErr } = await svc
        .from("attempts")
        .update({ current_module_id: firstModule?.id ?? null, current_question_position: 1 })
        .eq("id", attempt.id);
      if (uErr) return error(uErr.message, 500);

      await svc.from("attempt_events").insert({ attempt_id: attempt.id, event_type: "attempt.started", payload: { test_id: body.test_id } });

      return json({ attempt_id: attempt.id, test }, 201);
    }

    if (req.method === "GET" && seg.length === 2 && seg[1] === "current") {
      const url = new URL(req.url);
      const attemptId = url.searchParams.get("attempt_id");
      const testId = url.searchParams.get("test_id");
      let attempt = null;
      if (attemptId) {
        const { data, error: aErr } = await svc
          .from("attempts")
          .select("*")
          .eq("id", attemptId)
          .eq("student_id", ctx.user.id)
          .in("status", ["in_progress", "submitted"])
          .maybeSingle();
        if (aErr) return error(aErr.message, 500);
        attempt = data;
      } else if (testId) {
        const { data, error: aErr } = await svc
          .from("attempts")
          .select("*")
          .eq("student_id", ctx.user.id)
          .eq("test_id", testId)
          .in("status", ["in_progress", "submitted"])
          .maybeSingle();
        if (aErr) return error(aErr.message, 500);
        attempt = data;
      } else {
        const { data, error: aErr } = await svc
          .from("attempts")
          .select("*")
          .eq("student_id", ctx.user.id)
          .eq("status", "in_progress")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (aErr) return error(aErr.message, 500);
        attempt = data;
      }
      if (!attempt) return error("No active attempt found", 404);
      const resolvedTestId = testId ?? attempt.test_id;
      if (testId && attempt.test_id !== testId) return error("No active attempt found for this test", 404);

      const test = await loadTestStructure(svc, resolvedTestId);
      const { data: attemptModules } = await svc
        .from("attempt_modules")
        .select("*, module:test_modules(*)")
        .eq("attempt_id", attempt.id);
      const attemptModuleIds = new Set<string>((attemptModules ?? []).map((am) => am.module_id));
      filterTestToModules(test as Record<string, unknown>, attemptModuleIds);
      await attachStimulusUrls(svc, test as Record<string, unknown>);
      const { data: responses } = await svc
        .from("attempt_responses")
        .select("attempt_id, question_id, module_id, selected_choice_id, typed_answer, marked_for_review, eliminated_choice_ids")
        .eq("attempt_id", attempt.id);

      const now = Date.now();
      const modules = (attemptModules ?? []).map((am) => {
        const remaining = am.module.time_limit_minutes * 60 * 1000;
        let secondsLeft: number | null = null;
        if (am.started_at && am.status === "in_progress") {
          const elapsed = Math.max(0, now - new Date(am.started_at).getTime());
          secondsLeft = Math.max(0, Math.ceil((remaining - elapsed) / 1000));
        } else if (am.status === "not_started") {
          secondsLeft = Math.ceil(remaining / 1000);
        }
        return { ...am, seconds_left: secondsLeft };
      });

      return json({ attempt, test, responses: responses ?? [], modules });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "advance") {
      const body = advanceModuleSchema.parse(await req.json());
      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("*")
        .eq("id", body.attempt_id)
        .eq("student_id", ctx.user.id)
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      if (attempt.status !== "in_progress") return error("Attempt is not in progress", 409);

      const { data: targetModule, error: mErr } = await svc
        .from("test_modules")
        .select("*, section:test_sections(*)")
        .eq("id", body.module_id)
        .maybeSingle();
      if (mErr) return error(mErr.message, 500);
      if (!targetModule) return error("Module not found", 404);

      if (attempt.current_module_id) {
        const { error: cErr } = await svc
          .from("attempt_modules")
          .update({ status: "completed", completed_at: new Date().toISOString(), time_spent_seconds: body.time_spent_seconds })
          .eq("attempt_id", attempt.id)
          .eq("module_id", attempt.current_module_id);
        if (cErr) return error(cErr.message, 500);
      }

      const { error: nErr } = await svc
        .from("attempt_modules")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("attempt_id", attempt.id)
        .eq("module_id", body.module_id);
      if (nErr) return error(nErr.message, 500);

      let difficulty: string | null = null;
      if (targetModule.is_adaptive && targetModule.section.position === 1) {
        const { data: module1 } = await svc
          .from("attempt_modules")
          .select("id, module_id")
          .eq("attempt_id", attempt.id)
          .eq("status", "completed")
          .order("started_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (module1) {
          const { data: m1questions } = await svc
            .from("test_module_questions")
            .select("question_id")
            .eq("module_id", module1.module_id);
          const ids = (m1questions ?? []).map((q) => q.question_id);
          const { data: m1responses } = await svc
            .from("attempt_responses")
            .select("is_correct")
            .eq("attempt_id", attempt.id)
            .in("question_id", ids.length > 0 ? ids : [""]);
          const correct = (m1responses ?? []).filter((r) => r.is_correct).length;
          const total = (m1responses ?? []).length;
          difficulty = total > 0 && correct / total >= 0.6 ? "harder" : "easier";
        }
      }

      const { error: uErr } = await svc
        .from("attempts")
        .update({
          current_module_id: body.module_id,
          current_question_position: 1,
          module2_difficulty: difficulty ?? attempt.module2_difficulty,
        })
        .eq("id", attempt.id);
      if (uErr) return error(uErr.message, 500);

      await svc.from("attempt_events").insert({ attempt_id: attempt.id, event_type: "module.advanced", payload: { module_id: body.module_id, difficulty } });
      return json({ ok: true, module2_difficulty: difficulty });
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
