import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";

interface ReviewChoice { id: string; label: string; text: string; is_correct: boolean; position: number }
interface ReviewQuestion {
  id: string;
  section: string;
  question_type: string;
  prompt: string;
  domain: string | null;
  skill: string | null;
  difficulty: number | null;
  explanation: string | null;
  correct_answer: string | null;
  stimulus_image_path: string | null;
  stimulus_image_url?: string | null;
  choices: ReviewChoice[];
}
interface LinkRow {
  module_id: string;
  question_id: string;
  position: number;
  question: ReviewQuestion;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "student");
    const svc = serviceClient();
    const seg = pathSegments(req);

    if (req.method === "GET" && seg.length === 1) {
      const { data, error: err } = await svc
        .from("attempts")
        .select("id, test_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("student_id", ctx.user.id)
        .eq("status", "graded")
        .order("submitted_at", { ascending: false });
      if (err) return error(err.message, 500);
      return json({ history: data ?? [] });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("id, test_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("id", seg[1])
        .eq("student_id", ctx.user.id)
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      if (attempt.status !== "graded") return error("Attempt has not been graded yet", 409);

      // Full test structure so the report covers every question (incl. unanswered)
      const { data: sections, error: sErr } = await svc
        .from("test_sections")
        .select("id, name, section_type, position")
        .eq("test_id", attempt.test_id)
        .order("position", { ascending: true });
      if (sErr) return error(sErr.message, 500);

      const secIds = (sections ?? []).map((s) => s.id);
      const { data: modules, error: mErr } = await svc
        .from("test_modules")
        .select("id, section_id, name, position")
        .in("section_id", secIds.length > 0 ? secIds : [""])
        .order("position", { ascending: true });
      if (mErr) return error(mErr.message, 500);

      // Only score/show the modules this student was actually assigned
      const { data: attemptModules, error: tmErr } = await svc
        .from("attempt_modules")
        .select("module_id")
        .eq("attempt_id", attempt.id);
      if (tmErr) return error(tmErr.message, 500);
      const attemptedModuleIds = new Set((attemptModules ?? []).map((am) => am.module_id));

      const modRows = (modules ?? []).filter((m) => attemptedModuleIds.has(m.id));
      const modIds = modRows.map((m) => m.id);
      const { data: links, error: lErr } = await svc
        .from("test_module_questions")
        .select("module_id, question_id, position, question:questions(*, choices:question_choices(*))")
        .in("module_id", modIds.length > 0 ? modIds : [""])
        .order("position", { ascending: true });
      if (lErr) return error(lErr.message, 500);
      const linkRows = (links ?? []) as unknown as LinkRow[];

      const { data: responses, error: rErr } = await svc
        .from("attempt_responses")
        .select("question_id, selected_choice_id, typed_answer, is_correct, marked_for_review")
        .eq("attempt_id", attempt.id);
      if (rErr) return error(rErr.message, 500);

      const responseByQ = new Map((responses ?? []).map((r) => [r.question_id, r]));

      let num = 0;
      const review = [];
      for (const sec of sections ?? []) {
        for (const mod of modRows.filter((m) => m.section_id === sec.id)) {
          for (const link of linkRows.filter((l) => l.module_id === mod.id)) {
            const q = link.question;
            if (!q) continue;
            if (q.stimulus_image_path) {
              const { data } = await svc.storage.from("question-assets").createSignedUrl(q.stimulus_image_path, 60 * 60);
              q.stimulus_image_url = data?.signedUrl ?? null;
            }
            num++;
            const r = responseByQ.get(q.id);
            const selected = r?.selected_choice_id
              ? (q.choices ?? []).find((c) => c.id === r.selected_choice_id)
              : undefined;
            const correctChoices = (q.choices ?? []).filter((c) => c.is_correct);
            review.push({
              question_id: q.id,
              question_number: num,
              section: q.section,
              section_name: sec.name,
              section_type: sec.section_type,
              module_name: mod.name,
              prompt: q.prompt,
              question_type: q.question_type,
              domain: q.domain,
              skill: q.skill,
              difficulty: q.difficulty,
              explanation: q.explanation,
              correct_answer: q.correct_answer,
              stimulus_image_path: q.stimulus_image_path,
              stimulus_image_url: q.stimulus_image_url ?? null,
              choices: (q.choices ?? [])
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((c) => ({ id: c.id, label: c.label, text: c.text, is_correct: c.is_correct })),
              selected_choice_id: r?.selected_choice_id ?? null,
              typed_answer: r?.typed_answer ?? null,
              your_answer: selected ? `${selected.label}. ${selected.text}` : r?.typed_answer ?? null,
              correct_answers: correctChoices.map((c) => ({ label: c.label, text: c.text })),
              is_correct: r?.is_correct ?? null,
              unanswered: !r,
              marked_for_review: r?.marked_for_review ?? false,
            });
          }
        }
      }

      return json({ attempt, review });
    }

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error("Internal error", 500);
  }
});
