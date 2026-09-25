import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { requireApprovedStudent } from "../_shared/auth.ts";
import { submitAttemptSchema } from "../_shared/validation.ts";
import { answersMatch } from "../_shared/scoring.ts";

interface ScoredQuestion {
  questionId: string;
  moduleId: string;
  section: "reading_writing" | "math";
  domain: string | null;
  skill: string | null;
  points: number;
  isCorrect: boolean;
}

interface RosterLink {
  module_id: string;
  question_id: string;
  points: number | null;
  question: {
    id: string;
    section: "reading_writing" | "math";
    question_type: "multiple_choice" | "student_produced";
    domain: string | null;
    skill: string | null;
    correct_answer: string | null;
    choices?: Array<{ id: string; question_id: string; is_correct: boolean }>;
  } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const seg = pathSegments(req);

    if (req.method !== "POST" || seg.length !== 1) return error("Not found", 404);

    const body = submitAttemptSchema.parse(await req.json());

    const { data: attempt, error: aErr } = await svc
      .from("attempts")
      .select("*")
      .eq("id", body.attempt_id)
      .eq("student_id", ctx.user.id)
      .maybeSingle();
    if (aErr) return error(aErr.message, 500);
    if (!attempt) return error("Attempt not found", 404);
    if (attempt.status !== "in_progress") return error("Attempt is not in progress", 409);

    const { data: attemptModules, error: amErr } = await svc
      .from("attempt_modules")
      .select("module_id")
      .eq("attempt_id", attempt.id);
    if (amErr) return error(amErr.message, 500);

    const moduleIds = (attemptModules ?? []).map((m) => m.module_id);
    const { data: links, error: linkErr } = await svc
      .from("test_module_questions")
      .select("module_id, question_id, points, question:questions(id, section, question_type, domain, skill, correct_answer, choices:question_choices(id, question_id, is_correct))")
      .in("module_id", moduleIds.length > 0 ? moduleIds : [""]);
    if (linkErr) return error(linkErr.message, 500);
    const roster = (links ?? []) as unknown as RosterLink[];

    const { data: responses, error: rErr } = await svc
      .from("attempt_responses")
      .select("question_id, module_id, selected_choice_id, typed_answer")
      .eq("attempt_id", attempt.id);
    if (rErr) return error(rErr.message, 500);

    const responseByQuestion = new Map((responses ?? []).map((r) => [r.question_id, r]));

    const scored: ScoredQuestion[] = [];
    const correctionMap: Array<{ attempt_id: string; question_id: string; is_correct: boolean }> = [];

    for (const link of roster) {
      const q = link.question;
      if (!q) continue;
      const r = responseByQuestion.get(q.id);
      let correct = false;
      if (r && q.question_type === "multiple_choice") {
        const choice = r.selected_choice_id ? (q.choices ?? []).find((c) => c.id === r.selected_choice_id && c.question_id === q.id) : undefined;
        correct = choice?.is_correct === true;
      } else if (r) {
        correct = answersMatch(r.typed_answer, q.correct_answer);
      }
      const points = Number(link.points ?? 1);
      scored.push({
        questionId: q.id,
        moduleId: link.module_id,
        section: q.section,
        domain: q.domain,
        skill: q.skill,
        points,
        isCorrect: correct,
      });
      if (r) {
        correctionMap.push({ attempt_id: attempt.id, question_id: q.id, is_correct: correct });
      }
    }

    for (const c of correctionMap) {
      const { error: updateErr } = await svc
        .from("attempt_responses")
        .update({ is_correct: c.is_correct })
        .eq("attempt_id", c.attempt_id)
        .eq("question_id", c.question_id);
      if (updateErr) return error(updateErr.message, 500);
    }

    const rawScore = scored.reduce((sum, s) => sum + (s.isCorrect ? s.points : 0), 0);
    const total = scored.length;
    const totalPoints = scored.reduce((sum, s) => sum + s.points, 0);
    const pct = totalPoints > 0 ? (rawScore / totalPoints) * 100 : 0;

    const sectionScores: Record<string, { correct: number; total: number; accuracy: number }> = {};
    const moduleScores: Record<string, { correct: number; total: number; accuracy: number }> = {};
    const topicMap = new Map<string, { correct: number; total: number }>();

    for (const s of scored) {
      const sec = sectionScores[s.section] ?? { correct: 0, total: 0, accuracy: 0 };
      sec.correct += s.isCorrect ? s.points : 0;
      sec.total += s.points;
      sectionScores[s.section] = sec;

      const mod = moduleScores[s.moduleId] ?? { correct: 0, total: 0, accuracy: 0 };
      mod.correct += s.isCorrect ? s.points : 0;
      mod.total += s.points;
      moduleScores[s.moduleId] = mod;

      if (s.domain) {
        const key = `${s.domain}::${s.skill ?? ""}`;
        const t = topicMap.get(key) ?? { correct: 0, total: 0 };
        t.correct += s.isCorrect ? 1 : 0;
        t.total += 1;
        topicMap.set(key, t);
      }
    }

    for (const [key, v] of Object.entries(sectionScores)) v.accuracy = v.total > 0 ? Math.round((v.correct / v.total) * 1000) / 10 : 0;
    for (const [key, v] of Object.entries(moduleScores)) v.accuracy = v.total > 0 ? Math.round((v.correct / v.total) * 1000) / 10 : 0;

    const topicPerformance = [...topicMap.entries()].map(([key, v]) => {
      const [domain, skill] = key.split("::");
      return { domain, skill: skill || null, ...v };
    });

    const now = new Date().toISOString();
    const { error: sErr } = await svc.from("scores").insert({
      attempt_id: attempt.id,
      raw_score: rawScore,
      total_questions: total,
      section_scores: sectionScores,
      module_scores: moduleScores,
      topic_performance: topicPerformance,
    });
    if (sErr) return error(sErr.message, 500);

    const { error: upErr } = await svc
      .from("attempts")
      .update({ status: "graded", submitted_at: now })
      .eq("id", attempt.id);
    if (upErr) return error(upErr.message, 500);

    if (attempt.assignment_id) {
      const { error: asgErr } = await svc.from("test_assignments").update({ status: "completed" }).eq("id", attempt.assignment_id);
      if (asgErr) return error(asgErr.message, 500);
    }

    for (const t of topicPerformance) {
      let topicQuery = svc
        .from("topic_performance")
        .select("id, attempted, correct")
        .eq("student_id", ctx.user.id)
        .eq("domain", t.domain);
      topicQuery = t.skill === null ? topicQuery.is("skill", null) : topicQuery.eq("skill", t.skill);
      const existing = await topicQuery;
      if (existing.error) continue;
      if (existing.data.length > 0) {
        const prev = existing.data[0];
        await svc
          .from("topic_performance")
          .update({ attempted: prev.attempted + t.total, correct: prev.correct + t.correct })
          .eq("id", prev.id);
      } else {
        await svc
          .from("topic_performance")
          .insert({ student_id: ctx.user.id, domain: t.domain, skill: t.skill, attempted: t.total, correct: t.correct });
      }
    }

    await svc.from("attempt_events").insert({
      attempt_id: attempt.id,
      event_type: "attempt.submitted",
      payload: { raw_score: rawScore, total, accuracy: Math.round(pct * 10) / 10 },
    });

    return json({ ok: true, raw_score: rawScore, total_questions: total, accuracy: Math.round(pct * 10) / 10 });
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});
