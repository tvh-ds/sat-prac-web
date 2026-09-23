import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireRole(req, "admin");
    const svc = serviceClient();
    const seg = pathSegments(req);
    const id = seg[2];

    if (req.method === "GET" && seg.length === 2 && seg[1] === "students") {
      const { data: students, error: err } = await svc
        .from("student_profiles")
        .select("*, profiles(full_name), attempts(id, status), topic_performance(student_id, attempted, correct)")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);
      const rows = (students ?? []).map((s: Record<string, unknown>) => {
        const attempts = (s.attempts ?? []) as Array<{ status: string }>;
        const topics = (s.topic_performance ?? []) as Array<{ attempted: number; correct: number }>;
        const attempted = topics.reduce((a, t) => a + t.attempted, 0);
        const correct = topics.reduce((a, t) => a + t.correct, 0);
        return {
          id: s.id,
          full_name: (s.profiles as { full_name?: string } | null)?.full_name ?? "",
          grade_level: s.grade_level,
          school: s.school,
          is_active: s.is_active,
          total_attempts: attempts.length,
          completed_attempts: attempts.filter((a) => a.status === "graded").length,
          total_questions_attempted: attempted,
          total_questions_correct: correct,
          accuracy: attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : null,
          created_at: s.created_at,
        };
      });
      return json({ students: rows });
    }

    if (req.method === "GET" && seg.length === 3 && seg[1] === "students") {
      const { data: profile } = await svc.from("profiles").select("full_name").eq("id", id).maybeSingle();
      const { data: attempts, error: aErr } = await svc
        .from("attempts")
        .select("*, test:tests(title), score:scores(*)")
        .eq("student_id", id)
        .order("started_at", { ascending: false });
      if (aErr) return error(aErr.message, 500);
      const { data: topics } = await svc.from("topic_performance").select("*").eq("student_id", id).order("domain");
      return json({ student: { id, full_name: profile?.full_name ?? "" }, attempts: attempts ?? [], topics: topics ?? [] });
    }

    if (req.method === "GET" && seg.length === 3 && seg[1] === "attempts") {
      const { data: attempt, error: err } = await svc
        .from("attempts")
        .select("*, test:tests(title), student:student_profiles(profiles(full_name)), score:scores(*)")
        .eq("id", id)
        .maybeSingle();
      if (err) return error(err.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      const { data: responses } = await svc
        .from("attempt_responses")
        .select("*, question:questions(prompt, section, question_type, domain, skill, correct_answer, explanation, passage:passages(id, title, content)), selected_choice:question_choices(label, text)")
        .eq("attempt_id", id);
      return json({ attempt, responses: responses ?? [] });
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error("Internal error", 500);
  }
});