import { requireApprovedStudent, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();

    const [assignmentsResult, attemptsResult, testsResult] = await Promise.all([
      svc.from("test_assignments")
        .select("id, test_id, due_at, status, content_scope, module_ids")
        .eq("student_id", ctx.user.id),
      svc.from("attempts")
        .select("test_id, assignment_id, id, status, started_at")
        .eq("student_id", ctx.user.id),
      svc.from("tests")
        .select("id, title, description, status, is_public, kind")
        .eq("status", "published")
        .order("created_at", { ascending: false }),
    ]);
    if (assignmentsResult.error || attemptsResult.error || testsResult.error) {
      console.error("Failed to load student test list", assignmentsResult.error, attemptsResult.error, testsResult.error);
      return error("Failed to load tests", 500);
    }
    const assignments = assignmentsResult.data;
    const attempts = attemptsResult.data;
    const tests = testsResult.data;

    // Repeat assignments: each assignment is its own row (own due date,
    // scope, attempt, score). Attempts attach by assignment when present,
    // otherwise by test (public tests). Public tests list once, unscoped.
    // Active attempts win over older graded ones for the same key.
    const sortedAttempts = [...(attempts ?? [])].sort((a, b) => {
      const rank = (s: string) => (s === "in_progress" || s === "submitted" ? 0 : 1);
      const d = rank(a.status as string) - rank(b.status as string);
      if (d !== 0) return d;
      return (a.started_at as string) < (b.started_at as string) ? 1 : -1;
    });
    const attemptMap = new Map(sortedAttempts.map((a) => [(a.assignment_id as string | null) ?? a.test_id, a]));
    const byTest = new Map<string, Array<{ id: string; due_at: string | null; status: string; content_scope: string | null; module_ids: string[] }>>();
    for (const a of assignments ?? []) {
      const tid = a.test_id as string;
      if (!byTest.has(tid)) byTest.set(tid, []);
      byTest.get(tid)!.push(a as { id: string; due_at: string | null; status: string; content_scope: string | null; module_ids: string[] });
    }

    const visible = (tests ?? []).filter((t) => t.is_public || byTest.has(t.id));
    const visibleIds = visible.map((t) => t.id);

    // Load sections, modules, and roster counts together instead of issuing
    // three dependent round trips for every test-list request.
    const { data: secs, error: structureErr } = await svc
      .from("test_sections")
      .select("id, test_id, section_type, modules:test_modules(id, section_id, time_limit_minutes, position, question_counts:test_module_questions(count))")
      .in("test_id", visibleIds.length > 0 ? visibleIds : [""]);
    if (structureErr) return error("Failed to load test structure", 500);
    const sectionRows = (secs ?? []) as unknown as Array<{
      id: string;
      test_id: string;
      section_type: string;
      modules?: Array<{ id: string; section_id: string; time_limit_minutes: number; position: number; question_counts?: Array<{ count: number }> }>;
    }>;
    const sectionByTest = new Map<string, Array<{ id: string; section_type: string }>>();
    for (const s of sectionRows) {
      if (!sectionByTest.has(s.test_id)) sectionByTest.set(s.test_id, []);
      sectionByTest.get(s.test_id)!.push(s);
    }

    const modsByTest = new Map<string, Array<{ id: string; section_id: string; time_limit_minutes: number; position: number }>>();
    const qCountByModule = new Map<string, number>();
    for (const section of sectionRows) {
      for (const module of section.modules ?? []) {
        if (!modsByTest.has(section.test_id)) modsByTest.set(section.test_id, []);
        modsByTest.get(section.test_id)!.push(module);
        qCountByModule.set(module.id, Number(module.question_counts?.[0]?.count ?? 0));
      }
    }

    // Resolve which module ids count for a given test + assignment scope.
    function scopedModules(
      testId: string,
      assn: { content_scope?: string | null; module_ids?: string[] | null } | null,
    ): Array<{ id: string; section_id: string; time_limit_minutes: number; position: number }> {
      const all = modsByTest.get(testId) ?? [];
      const scope = assn?.content_scope ?? "full_test";
      if (scope === "full_test" || !assn) return all;
      if (scope === "custom_modules") {
        const allowed = new Set<string>(assn.module_ids ?? []);
        return all.filter((m) => allowed.has(m.id));
      }
      const sections = sectionByTest.get(testId) ?? [];
      const type = scope as "reading_writing" | "math";
      const sectionIds = new Set(sections.filter((s) => s.section_type === type).map((s) => s.id));
      return all.filter((m) => sectionIds.has(m.section_id));
    }

    const list: Array<Record<string, unknown>> = [];
    for (const t of visible) {
      // One row per assignment for assigned tests; a single row for public ones.
      const rows = t.is_public ? [null] : (byTest.get(t.id) ?? []);
      for (const assn of rows) {
        const key = (assn?.id as string | undefined) ?? t.id;
        const assigned = scopedModules(t.id, assn).sort((a, b) => a.position - b.position);
        const sectionIdsPresent = new Set(assigned.map((m) => m.section_id));
        const questions = assigned.reduce((sum, m) => sum + (qCountByModule.get(m.id) ?? 0), 0);
        list.push({
          id: t.id,
          title: t.title,
          description: t.description,
          kind: t.kind,
          assignment_id: assn?.id ?? null,
          assignment_status: assn?.status ?? null,
          due_at: assn?.due_at ?? null,
          sections: sectionIdsPresent.size,
          modules: assigned.length,
          questions,
          time_limit_minutes: assigned[0]?.time_limit_minutes ?? null,
          attempt: attemptMap.get(key) ?? null,
        });
      }
    }

    return json({ tests: list });
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error("Internal error", 500);
  }
});
