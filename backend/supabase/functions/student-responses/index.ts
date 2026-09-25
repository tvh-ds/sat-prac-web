import { requireApprovedStudent, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { responseSaveSchema } from "../_shared/validation.ts";

async function ensureOwnAttempt(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  attemptId: string,
): Promise<{ id: string; test_id: string; status: string; current_module_id: string | null }> {
  const { data, error: err } = await svc
    .from("attempts")
    .select("id, test_id, status, current_module_id")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (err) throw new HttpError(500, err.message);
  if (!data) throw new HttpError(404, "Attempt not found");
  if (data.status !== "in_progress") throw new HttpError(409, "Attempt is not in progress");
  return data;
}

async function validateResponseTarget(
  svc: ReturnType<typeof serviceClient>,
  attempt: { test_id: string; current_module_id: string | null },
  body: Record<string, unknown>,
): Promise<void> {
  const moduleId = body.module_id as string;
  const questionId = body.question_id as string;
  const selectedChoiceId = body.selected_choice_id as string | null | undefined;

  if (!attempt.current_module_id || moduleId !== attempt.current_module_id) {
    throw new HttpError(409, "Responses can only be saved for the active module");
  }

  const { data: module, error: mErr } = await svc
    .from("test_modules")
    .select("id, section:test_sections(test_id)")
    .eq("id", moduleId)
    .maybeSingle();
  if (mErr) throw new HttpError(500, mErr.message);
  const rawSection = module?.section as { test_id?: string } | Array<{ test_id?: string }> | null | undefined;
  const section = Array.isArray(rawSection) ? rawSection[0] : rawSection;
  if (!module || section?.test_id !== attempt.test_id) {
    throw new HttpError(422, "Module does not belong to this attempt");
  }

  const { data: link, error: lErr } = await svc
    .from("test_module_questions")
    .select("id")
    .eq("module_id", moduleId)
    .eq("question_id", questionId)
    .maybeSingle();
  if (lErr) throw new HttpError(500, lErr.message);
  if (!link) throw new HttpError(422, "Question does not belong to this module");

  if (selectedChoiceId) {
    const { data: choice, error: cErr } = await svc
      .from("question_choices")
      .select("id, question_id")
      .eq("id", selectedChoiceId)
      .maybeSingle();
    if (cErr) throw new HttpError(500, cErr.message);
    if (!choice || choice.question_id !== questionId) {
      throw new HttpError(422, "Choice does not belong to this question");
    }
  }
}

async function saveResponse(
  svc: ReturnType<typeof serviceClient>,
  studentId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const attempt = await ensureOwnAttempt(svc, studentId, body.attempt_id as string);
  await validateResponseTarget(svc, attempt, body);
  const patch: Record<string, unknown> = {
    selected_choice_id: body.selected_choice_id ?? null,
    typed_answer: body.typed_answer ?? null,
    marked_for_review: body.marked_for_review ?? false,
    eliminated_choice_ids: body.eliminated_choice_ids ?? [],
    notes: body.notes ?? null,
    highlights: body.highlights ?? [],
    time_spent_seconds: body.time_spent_seconds ?? 0,
  };
  const { data, error: err } = await svc
    .from("attempt_responses")
    .upsert(
      {
        attempt_id: body.attempt_id as string,
        question_id: body.question_id as string,
        module_id: body.module_id as string,
        ...patch,
      },
      { onConflict: "attempt_id,question_id" },
    )
    .select("attempt_id, question_id, module_id, selected_choice_id, typed_answer, marked_for_review, eliminated_choice_ids, highlights, is_correct")
    .single();
  if (err) throw new HttpError(500, err.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireApprovedStudent(req);
    const svc = serviceClient();
    const seg = pathSegments(req);

    if (req.method === "POST" && seg.length === 1) {
      const body = responseSaveSchema.parse(await req.json());
      const data = await saveResponse(svc, ctx.user.id, body);
      await svc.from("attempt_events").insert({
        attempt_id: body.attempt_id,
        event_type: "response.saved",
        payload: { question_id: body.question_id, marked_for_review: body.marked_for_review ?? false },
      });
      return json({ response: data });
    }

    if (req.method === "POST" && seg.length === 2 && seg[1] === "bulk") {
      const raw = await req.json();
      if (!Array.isArray(raw.responses) || raw.responses.length === 0) {
        return error("responses array required", 422);
      }
      const results = [];
      for (const r of raw.responses) {
        const body = responseSaveSchema.parse(r);
        results.push(await saveResponse(svc, ctx.user.id, body));
      }
      return json({ saved: results.length });
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
