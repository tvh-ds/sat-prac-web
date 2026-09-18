import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { createStudentSchema, updateStudentSchema, resetPasswordSchema } from "../_shared/validation.ts";

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
        .select("*, profiles(full_name)")
        .order("created_at", { ascending: false });
      if (err) return error(err.message, 500);
      const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 });
      const emails = new Map((users?.users ?? []).map((u) => [u.id, u.email]));
      return json({ students: data?.map((s) => ({ ...s, email: emails.get(s.id) ?? null })) });
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

    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) return error("Validation failed", 422, (e as unknown as { issues: unknown }).issues);
    console.error(e);
    return error("Internal error", 500);
  }
});