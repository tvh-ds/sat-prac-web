import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import {
  questionCreateSchema,
  questionUpdateSchema,
  passageSchema,
} from "../_shared/validation.ts";

async function signStimulus(svc: ReturnType<typeof serviceClient>, question: {
  stimulus_image_path?: string | null;
  stimulus_image_url?: string | null;
}) {
  question.stimulus_image_url = null;
  if (question.stimulus_image_path) {
    const { data } = await svc.storage
      .from("question-assets")
      .createSignedUrl(question.stimulus_image_path, 60 * 60);
    question.stimulus_image_url = data?.signedUrl ?? null;
  }
  return question;
}

async function withStimulus(svc: ReturnType<typeof serviceClient>, questions: Array<Record<string, unknown>>) {
  return await Promise.all(questions.map((q) => signStimulus(svc, q as { stimulus_image_path?: string | null })));
}

async function fetchQuestion(svc: ReturnType<typeof serviceClient>, id: string) {
  const { data, error } = await svc
    .from("questions")
    .select("*, choices:question_choices(*), passage:passages(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { data, error };
  if (data) await signStimulus(svc, data);
  return { data, error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient();
    const seg = pathSegments(req);
    const id = seg[1];

    if (req.method === "GET" && seg.length === 1) {
      const url = new URL(req.url);
      const section = url.searchParams.get("section");
      const domain = url.searchParams.get("domain");
      const skill = url.searchParams.get("skill");
      const difficulty = url.searchParams.get("difficulty");
      const status = url.searchParams.get("status") ?? "active";
      const search = url.searchParams.get("search");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 500);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

      const applyFilters = (q: { eq: (c: string, v: unknown) => unknown; is: (c: string, v: unknown) => unknown; ilike: (c: string, v: string) => unknown }) => {
        if (section) q.eq("section", section);
        if (domain) q.eq("domain", domain);
        if (skill) q.eq("skill", skill);
        if (difficulty) q.eq("difficulty", Number(difficulty));
        q.eq("status", status);
        q.is("source_pdf_id", null);
        if (search) q.ilike("prompt", `%${search}%`);
      };

      const countQ = svc.from("questions").select("id", { count: "exact", head: true });
      applyFilters(countQ);
      const { count, error: countErr } = await countQ;
      if (countErr) return error(countErr.message, 500);

      const dataQ = svc
        .from("questions")
        .select("*, choices:question_choices(*), passage:passages(*)");
      applyFilters(dataQ);
      dataQ.order("created_at", { ascending: false });
      dataQ.range(offset, offset + limit - 1);

      const { data, error: err } = await dataQ;
      if (err) return error(err.message, 500);

      const questions = await withStimulus(svc, data ?? []);
      return json({
        questions,
        question_total: count ?? 0,
        question_limit: limit,
        question_offset: offset,
        question_has_more: offset + (data?.length ?? 0) < (count ?? 0),
      });
    }

    if (req.method === "GET" && seg.length === 2) {
      const { data, error: err } = await fetchQuestion(svc, id);
      if (err) return error(err.message, 500);
      if (!data) return error("Question not found", 404);
      return json({ question: data });
    }

    if (req.method === "POST" && seg.length === 1) {
      const body = questionCreateSchema.parse(await req.json());
      if (body.question_type === "multiple_choice" && body.choices.length < 2) {
        return error("Multiple choice questions need at least 2 choices", 422);
      }
      if (body.question_type === "student_produced" && body.choices.length > 0) {
        return error("Student-produced questions cannot have choices", 422);
      }
      const { data, error: err } = await svc
        .from("questions")
        .insert({
          section: body.section,
          question_type: body.question_type,
          passage_id: body.passage_id ?? null,
          prompt: body.prompt,
          domain: body.domain ?? null,
          skill: body.skill ?? null,
          difficulty: body.difficulty ?? null,
          correct_answer: body.correct_answer ?? null,
          explanation: body.explanation ?? null,
          source_question_id: body.source_question_id ?? null,
          stimulus_image_path: body.stimulus_image_path ?? null,
          status: body.status ?? "active",
          created_by: ctx.user.id,
        })
        .select("id")
        .single();
      if (err) return error(err.message, 500);
      if (body.choices.length > 0) {
        const { error: cErr } = await svc.from("question_choices").insert(
          body.choices.map((c) => ({ question_id: data.id, ...c })),
        );
        if (cErr) return error(cErr.message, 500);
      }
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "question.created",
        entity_type: "question",
        entity_id: data.id,
        details: { section: body.section, question_type: body.question_type },
      });
      const { data: full } = await fetchQuestion(svc, data.id);
      return json({ question: full }, 201);
    }

    if (req.method === "PATCH" && seg.length === 2) {
      const body = questionUpdateSchema.parse(await req.json());
      const { prompt, choices, ...rest } = body;
      const { data, error: err } = await svc
        .from("questions")
        .update({ ...rest, updated_at: undefined })
        .eq("id", id)
        .select("id")
        .single();
      if (err) return error(err.message, 500);
      if (choices) {
        if (choices.length >= 2) {
          const { error: dErr } = await svc.from("question_choices").delete().eq("question_id", id);
          if (dErr) return error(dErr.message, 500);
          const { error: iErr } = await svc.from("question_choices").insert(
            choices.map((c) => ({ question_id: id, ...c })),
          );
          if (iErr) return error(iErr.message, 500);
        } else {
          return error("Multiple choice questions need at least 2 choices", 422);
        }
      }
      if (prompt !== undefined) {
        const { error: pErr } = await svc.from("questions").update({ prompt }).eq("id", id);
        if (pErr) return error(pErr.message, 500);
      }
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "question.updated",
        entity_type: "question",
        entity_id: id,
        details: { fields: Object.keys(body) },
      });
      const { data: full } = await fetchQuestion(svc, id);
      return json({ question: full });
    }

    if (req.method === "DELETE" && seg.length === 2) {
      const { data: linked } = await svc
        .from("test_module_questions")
        .select("id")
        .eq("question_id", id)
        .limit(1);
      if ((linked ?? []).length > 0) {
        const { error: aErr } = await svc.from("questions").update({ status: "archived" }).eq("id", id);
        if (aErr) return error(aErr.message, 500);
      } else {
        const { error: dErr } = await svc.from("questions").delete().eq("id", id);
        if (dErr) return error(dErr.message, 500);
      }
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "question.deleted",
        entity_type: "question",
        entity_id: id,
      });
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "passage") {
      const body = passageSchema.parse(await req.json());
      const { data, error: err } = await svc
        .from("passages")
        .insert({ ...body, created_by: ctx.user.id })
        .select("id, title, content")
        .single();
      if (err) return error(err.message, 500);
      return json({ passage: data }, 201);
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
