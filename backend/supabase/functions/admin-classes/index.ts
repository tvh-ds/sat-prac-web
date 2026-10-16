import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { studentClassSchema } from "../_shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "admin");
    const svc = serviceClient(), seg = pathSegments(req), id = seg[1];
    if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return error("Invalid class ID", 422);
    if (req.method === "GET" && seg.length === 1) {
      const { data: classes, error: clsError } = await svc.from("student_classes").select("*, members:student_class_members(student_id)").order("name");
      if (clsError) return error("Unable to load classes", 500);
      return json({ classes: (classes ?? []).map(({ members, ...cls }) => ({ ...cls, student_ids: (members ?? []).map((m: { student_id: string }) => m.student_id) })) });
    }
    if (req.method === "GET" && seg.length === 2) {
      const { data: cls, error: clsError } = await svc.from("student_classes").select("id,name").eq("id", id).maybeSingle();
      if (clsError) return error("Unable to load class", 500);
      if (!cls) return error("Class not found", 404);
      const [practice, full] = await Promise.all([
        svc.from("practice_assignment_batches").select("id,title,assigned_at,class_name,timer_minutes,snapshot_test_id").eq("class_id", id).order("assigned_at", { ascending: false }),
        svc.from("full_test_assignment_batches").select("id,title,assigned_at,class_name,content_scope").eq("class_id", id).order("assigned_at", { ascending: false }),
      ]);
      if (practice.error || full.error) return error("Unable to load class assignments", 500);
      return json({ class: cls, assignments: [
        ...(practice.data ?? []).map((a) => ({ ...a, kind: "practice" })),
        ...(full.data ?? []).map((a) => ({ ...a, kind: "full" })),
      ].sort((a, b) => b.assigned_at.localeCompare(a.assigned_at)) });
    }
    if ((req.method === "POST" && seg.length === 1) || (req.method === "PUT" && seg.length === 2)) {
      const body = studentClassSchema.parse(await req.json());
      const { data, error: saveError } = await svc.rpc("save_student_class", { p_id: id ?? null, p_name: body.name, p_student_ids: body.student_ids, p_admin_id: ctx.user.id });
      if (saveError) return error(saveError.code === "23505" ? "A class with this name already exists." : "Unable to save class. Check the name and student selection.", 422);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: id ? "class.updated" : "class.created", entity_type: "student_class", entity_id: data, details: { member_count: new Set(body.student_ids).size } });
      return json({ id: data }, id ? 200 : 201);
    }
    return error("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e && typeof e === "object" && "issues" in e) return error("Invalid class details", 422);
    console.error("admin-classes", e);
    return error("Unable to manage classes", 500);
  }
});
