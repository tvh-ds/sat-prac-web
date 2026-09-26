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
      .select("id, test_id, assignment_id, status")
      .eq("id", body.attempt_id)
      .eq("student_id", ctx.user.id)
      .maybeSingle();
    if (aErr) {
      console.error("Failed to load submission attempt", aErr);
      return error("Unable to load attempt", 500);
    }
    if (!attempt) return error("Attempt not found", 404);
    if (attempt.status === "graded") {
      const { data: existingScore, error: scoreErr } = await svc
        .from("scores")
        .select("raw_score, total_questions, section_scores")
        .eq("attempt_id", attempt.id)
        .maybeSingle();
      if (scoreErr || !existingScore) {
        console.error("Unable to read the score for a graded attempt", scoreErr);
        return error("Unable to load submitted score", 500);
      }
      const totalPoints = Object.values(existingScore.section_scores as Record<string, { total?: number }>)
        .reduce((sum, section) => sum + Number(section?.total ?? 0), 0);
      const accuracy = totalPoints > 0
        ? Math.round((Number(existingScore.raw_score) / totalPoints) * 1000) / 10
        : 0;
      return json({
        ok: true,
        raw_score: Number(existingScore.raw_score),
        total_questions: existingScore.total_questions,
        accuracy,
      });
    }
    if (attempt.status !== "in_progress") return error("Attempt is not in progress", 409);

    const { data: attemptModules, error: amErr } = await svc
      .from("attempt_modules")
      .select("module_id")
      .eq("attempt_id", attempt.id);
    if (amErr) {
      console.error("Failed to load attempt modules", amErr);
      return error("Unable to load attempt structure", 500);
    }

    const moduleIds = (attemptModules ?? []).map((m) => m.module_id);
    const { data: links, error: linkErr } = await svc
      .from("test_module_questions")
      .select("module_id, question_id, points, question:questions(id, section, question_type, domain, skill, correct_answer, choices:question_choices(id, question_id, is_correct))")
      .in("module_id", moduleIds.length > 0 ? moduleIds : [""]);
    if (linkErr) {
      console.error("Failed to load attempt question roster", linkErr);
      return error("Unable to load attempt questions", 500);
    }
    const roster = (links ?? []) as unknown as RosterLink[];

    const { data: responses, error: rErr } = await svc
      .from("attempt_responses")
      .select("question_id, module_id, selected_choice_id, typed_answer")
      .eq("attempt_id", attempt.id);
    if (rErr) {
      console.error("Failed to load saved attempt responses", rErr);
      return error("Unable to load saved answers", 500);
    }

    const responseByQuestion = new Map((responses ?? []).map((r) => [r.question_id, r]));

    const scored: ScoredQuestion[] = [];
    const correctionMap: Array<{ question_id: string; is_correct: boolean }> = [];

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
        correctionMap.push({ question_id: q.id, is_correct: correct });
      }
    }

    const rawScore = scored.reduce((sum, s) => sum + (s.isCorrect ? s.points : 0), 0);
    const total = scored.length;
    const totalPoints = scored.reduce((sum, s) => sum + s.points, 0);
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

    const { data: finalized, error: finalizeErr } = await svc.rpc("finalize_student_attempt", {
      p_attempt_id: attempt.id,
      p_student_id: ctx.user.id,
      p_raw_score: rawScore,
      p_total_questions: total,
      p_section_scores: sectionScores,
      p_module_scores: moduleScores,
      p_topic_performance: topicPerformance,
      p_corrections: correctionMap.map((row) => ({ question_id: row.question_id, is_correct: row.is_correct })),
    });
    if (finalizeErr || !finalized) {
      console.error("Unable to atomically finalize student attempt", finalizeErr);
      return error("Failed to finalize attempt", 500);
    }

    const committed = finalized as { raw_score: number; total_questions: number; total_points: number };
    const committedAccuracy = Number(committed.total_points) > 0
      ? Math.round((Number(committed.raw_score) / Number(committed.total_points)) * 1000) / 10
      : 0;
    return json({
      ok: true,
      raw_score: Number(committed.raw_score),
      total_questions: committed.total_questions,
      accuracy: committedAccuracy,
    });
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});
