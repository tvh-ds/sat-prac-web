import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { studentProfileSubmissionSchema } from "../_shared/validation.ts";
import { nextStudentProfileStatus } from "../_shared/student_profile.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await requireRole(req, "student");
    const svc = serviceClient();
    const seg = pathSegments(req);
    if (seg.length !== 1 || seg[0] !== "student-profile") return error("Not found", 404);

    const [profileResult, studentResult] = await Promise.all([
      svc.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
      svc.from("student_profiles")
        .select("phone_number, parent_name, parent_phone_number, profile_status, profile_submitted_at, profile_approved_at")
        .eq("id", ctx.user.id)
        .maybeSingle(),
    ]);
    if (profileResult.error) return error(profileResult.error.message, 500);
    if (studentResult.error) return error(studentResult.error.message, 500);
    if (!profileResult.data || !studentResult.data) return error("Student profile not found", 404);

    if (req.method === "GET") {
      return json({
        profile: {
          full_name: profileResult.data.full_name,
          phone_number: studentResult.data.phone_number,
          parent_name: studentResult.data.parent_name,
          parent_phone_number: studentResult.data.parent_phone_number,
          profile_status: studentResult.data.profile_status,
          profile_submitted_at: studentResult.data.profile_submitted_at,
          profile_approved_at: studentResult.data.profile_approved_at,
        },
      });
    }

    if (req.method === "POST") {
      const body = studentProfileSubmissionSchema.parse(await req.json());
      const current = {
        full_name: profileResult.data.full_name,
        phone_number: studentResult.data.phone_number,
        parent_name: studentResult.data.parent_name,
        parent_phone_number: studentResult.data.parent_phone_number,
      };
      const status = nextStudentProfileStatus(
        studentResult.data.profile_status,
        current,
        body,
      );

      if (status !== "approved") {
        const { error: nameErr } = await svc.from("profiles")
          .update({ full_name: body.full_name })
          .eq("id", ctx.user.id);
        if (nameErr) return error(nameErr.message, 500);

        const { error: detailErr } = await svc.from("student_profiles")
          .update({
            phone_number: body.phone_number,
            parent_name: body.parent_name,
            parent_phone_number: body.parent_phone_number,
            profile_status: "pending",
            profile_submitted_at: new Date().toISOString(),
            profile_approved_at: null,
            profile_approved_by: null,
          })
          .eq("id", ctx.user.id);
        if (detailErr) return error(detailErr.message, 500);

        await svc.from("audit_logs").insert({
          actor_id: ctx.user.id,
          action: "student.profile_submitted",
          entity_type: "student",
          entity_id: ctx.user.id,
        });
      }

      return json({ ok: true, profile_status: status });
    }

    return error("Method not allowed", 405);
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
    if (e instanceof Error && "issues" in (e as object)) {
      return error("Please check all required profile fields", 422, (e as unknown as { issues: unknown }).issues);
    }
    console.error(e);
    return error("Internal error", 500);
  }
});
