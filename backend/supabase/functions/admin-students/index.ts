import { createClient } from "npm:@supabase/supabase-js@2";
import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { buildAttemptReview } from "../_shared/attempt_review.ts";
import { createStudentSchema, updateStudentSchema, resetPasswordSchema } from "../_shared/validation.ts";

function withAccuracy(score: unknown) {
  const row = Array.isArray(score) ? score[0] : score;
  if (!row || typeof row !== "object") return row ?? null;
  const rec = row as Record<string, unknown>;
  if (rec.accuracy != null) return rec;
  const raw = Number(rec.raw_score ?? 0);
  const total = Number(rec.total_questions ?? 0);
  return { ...rec, accuracy: total > 0 ? Math.round((raw / total) * 1000) / 10 : 0 };
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
        .from("student_profiles")
        .select("*, profiles(full_name), attempts(id, status)")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);
      const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 });
      const emails = new Map((users?.users ?? []).map((u) => [u.id, u.email]));
      return json({
        students: (data ?? []).map((s: Record<string, unknown>) => ({
          ...s,
          full_name: (s.profiles as { full_name?: string } | null)?.full_name ?? null,
          email: emails.get(s.id as string) ?? null,
        })),
      });
    }

    if (req.method === "POST" && seg.length === 1) {
      const body = createStudentSchema.parse(await req.json());
      const { data: created, error: authErr } = await svc.auth.admin.createUser({
        email: body.email,
        password: body.temporary_password,
        email_confirm: true,
        user_metadata: { full_name: body.full_name },
      });
      if (authErr) return error(authErr.message, authErr.status === 409 ? 409 : 400);
      const { error: updErr } = await svc
        .from("student_profiles")
        .update({
          grade_level: body.grade_level ?? null,
          school: body.school ?? null,
          notes: body.notes ?? null,
        })
        .eq("id", created.user!.id);
      if (updErr) return error(updErr.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "student.created",
        entity_type: "student",
        entity_id: created.user!.id,
        details: { email: body.email, full_name: body.full_name },
      });
      return json({ student_id: created.user!.id, email: body.email }, 201);
    }

    if (!id) return error("Not found", 404);

    // Student detail with every attempt (full-length + practice) for Manage view.
    if (req.method === "GET" && seg.length === 2) {
      const { data: sp, error: spErr } = await svc
        .from("student_profiles")
        .select("*, profiles(full_name)")
        .eq("id", id)
        .maybeSingle();
      if (spErr) return error(spErr.message, 500);
      if (!sp) return error("Student not found", 404);
      const { data: authUser, error: uErr } = await svc.auth.admin.getUserById(id);
      if (uErr) return error(uErr.message, 500);
      const { data: attempts, error: aErr } = await svc
        .from("attempts")
        .select("id, test_id, assignment_id, status, started_at, submitted_at, test:tests(id, title, kind), score:scores(*)")
        .eq("student_id", id)
        .order("started_at", { ascending: false });
      if (aErr) return error(aErr.message, 500);
      const { data: topics } = await svc
        .from("topic_performance")
        .select("*")
        .eq("student_id", id)
        .order("domain");
      const shaped = (attempts ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        score: withAccuracy(a.score),
      }));
      return json({
        student: {
          ...(sp as Record<string, unknown>),
          full_name: ((sp as Record<string, unknown>).profiles as { full_name?: string } | null)?.full_name ?? null,
          email: authUser?.user?.email ?? null,
        },
        attempts: shaped,
        topics: topics ?? [],
      });
    }

    // Full answer review for any graded attempt belonging to this student.
    if (req.method === "GET" && seg.length === 4 && seg[2] === "attempts") {
      const attemptId = seg[3];
      const { data: attempt, error: aErr } = await svc
        .from("attempts")
        .select("id, test_id, assignment_id, status, started_at, submitted_at, test:tests(title, kind), score:scores(*)")
        .eq("id", attemptId)
        .eq("student_id", id)
        .maybeSingle();
      if (aErr) return error(aErr.message, 500);
      if (!attempt) return error("Attempt not found", 404);
      try {
        const review = await buildAttemptReview(svc, attempt, { includeExplanations: true });
        return json({ attempt: { ...attempt, score: withAccuracy(attempt.score) }, review, explanations_released: true });
      } catch (e) {
        if (e instanceof HttpError) return error(e.message, e.status);
        throw e;
      }
    }

    if (req.method === "PATCH" && seg.length === 2) {
      const body = updateStudentSchema.parse(await req.json());
      if (body.full_name !== undefined) {
        const { error: pErr } = await svc.from("profiles").update({ full_name: body.full_name }).eq("id", id);
        if (pErr) return error(pErr.message, 500);
      }
      const { error: uErr } = await svc
        .from("student_profiles")
        .update({
          grade_level: body.grade_level ?? undefined,
          school: body.school ?? undefined,
          notes: body.notes ?? undefined,
          is_active: body.is_active ?? undefined,
        })
        .eq("id", id);
      if (uErr) return error(uErr.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "student.updated", entity_type: "student", entity_id: id, details: body });
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "reset-password") {
      const body = resetPasswordSchema.parse(await req.json());
      const { error: authErr } = await svc.auth.admin.updateUserById(id, { password: body.new_password });
      if (authErr) return error(authErr.message, 400);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "student.password_reset", entity_type: "student", entity_id: id });
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "toggle-active") {
      const { data: sp } = await svc.from("student_profiles").select("is_active").eq("id", id).single();
      const next = !(sp?.is_active ?? true);
      const { error: uErr } = await svc.from("student_profiles").update({ is_active: next }).eq("id", id);
      if (uErr) return error(uErr.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: next ? "student.activated" : "student.deactivated", entity_type: "student", entity_id: id });
      return json({ ok: true, is_active: next });
    }

    // Permanent deletion: verify the acting admin's own password first, then
    // delete the Auth user. Database cascades remove the student profile,
    // assignments, attempts, responses, scores, topic performance, and
    // vocabulary records.
    if (req.method === "DELETE" && seg.length === 2) {
      if (id === ctx.user.id) return error("You cannot delete your own administrator account", 403);
      let adminPassword = "";
      try {
        const raw = await req.json();
        adminPassword = typeof raw?.admin_password === "string" ? raw.admin_password : "";
      } catch {
        return error("Admin password is required", 400);
      }
      if (!adminPassword) return error("Admin password is required", 400);
      const adminEmail = ctx.user.email;
      if (!adminEmail) return error("Admin email is unavailable; sign in again", 401);
      const url = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!url || !anonKey) return error("Auth verification is not configured", 500);
      const verifier = createClient(url, anonKey, { auth: { persistSession: false } });
      const { error: verifyErr } = await verifier.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
      if (verifyErr) return error("Admin password is incorrect", 403);
      const { data: target } = await svc.auth.admin.getUserById(id);
      if (!target?.user) return error("Student not found", 404);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "student.deleted",
        entity_type: "student",
        entity_id: id,
        details: { email: target.user.email ?? null },
      });
      const { error: delErr } = await svc.auth.admin.deleteUser(id);
      if (delErr) return error(delErr.message, 500);
      return json({ ok: true });
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
