import { requireRole, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "student");
    const svc = serviceClient();

    const { data: assignments } = await svc
      .from("test_assignments")
      .select("test_id, due_at, status, content_scope, module_ids")
      .eq("student_id", ctx.user.id);

    const { data: attempts } = await svc
      .from("attempts")
      .select("test_id, id, status, started_at")
      .eq("student_id", ctx.user.id);

    const { data: tests, error: err } = await svc
      .from("tests")
      .select("id, title, description, status, is_public, kind")
      .eq("status", "published")
      .order("created_at", { ascending: false });
    if (err) return error(err.message, 500);

    const assignedMap = new Map((assignments ?? []).map((a) => [a.test_id, a]));
    const attemptMap = new Map((attempts ?? []).map((a) => [a.test_id, a]));

    const visible = (tests ?? []).filter((t) => t.is_public || assignedMap.has(t.id));
    const visibleIds = visible.map((t) => t.id);

    // test -> section_type by section id (needed to resolve section scopes)
    const { data: secs } = await svc.from("test_sections").select("id, test_id, section_type").in("test_id", visibleIds.length > 0 ? visibleIds : [""]);
    const sectionByTest = new Map<string, Array<{ id: string; section_type: string }>>();
    for (const s of secs ?? []) {
      if (!sectionByTest.has(s.test_id)) sectionByTest.set(s.test_id, []);
      sectionByTest.get(s.test_id)!.push(s);
    }

    const secIdList = (secs ?? []).map((s) => s.id);
    const { data: mods } = await svc.from("test_modules").select("id, section_id, time_limit_minutes, position").in("section_id", secIdList.length > 0 ? secIdList : [""]);
    const modsByTest = new Map<string, Array<{ id: string; section_id: string; time_limit_minutes: number; position: number }>>();
    const secToTest = new Map((secs ?? []).map((s) => [s.id, s.test_id]));
    for (const m of mods ?? []) {
      const tid = secToTest.get(m.section_id);
      if (!tid) continue;
      if (!modsByTest.has(tid)) modsByTest.set(tid, []);
      modsByTest.get(tid)!.push(m);
    }

    const modIdList = (mods ?? []).map((m) => m.id);
    const { data: qlinks } = await svc.from("test_module_questions").select("module_id").in("module_id", modIdList.length > 0 ? modIdList : [""]);
    const qCountByModule = new Map<string, number>();
    for (const ql of qlinks ?? []) qCountByModule.set(ql.module_id, (qCountByModule.get(ql.module_id) ?? 0) + 1);

    // Resolve which module ids count for a given test + assignment scope.
    function scopedModules(testId: string): Array<{ id: string; section_id: string; time_limit_minutes: number; position: number }> {
      const all = modsByTest.get(testId) ?? [];
      const assn = assignedMap.get(testId);
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

    const list = visible.map((t) => {
      const assigned = scopedModules(t.id).sort((a, b) => a.position - b.position);
      const sectionIdsPresent = new Set(assigned.map((m) => m.section_id));
      const questions = assigned.reduce((sum, m) => sum + (qCountByModule.get(m.id) ?? 0), 0);
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        kind: t.kind,
        due_at: assignedMap.get(t.id)?.due_at ?? null,
        sections: sectionIdsPresent.size,
        modules: assigned.length,
        questions,
        time_limit_minutes: assigned[0]?.time_limit_minutes ?? null,
        attempt: attemptMap.get(t.id) ?? null,
      };
    });

    return json({ tests: list });
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error("Internal error", 500);
  }
});