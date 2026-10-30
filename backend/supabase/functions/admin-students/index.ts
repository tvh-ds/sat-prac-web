import { createClient } from "npm:@supabase/supabase-js@2";
import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { buildAttemptReview } from "../_shared/attempt_review.ts";
import { createStudentSchema, updateStudentSchema, resetPasswordSchema } from "../_shared/validation.ts";
import { hasRequiredStudentProfile } from "../_shared/student_profile.ts";
import { vocabularyStreak } from "../_shared/student_progress.ts";
import { allProgressRows, loadAssignmentProgress, progressUserEmails } from "../_shared/assignment_progress.ts";
import { loadVocabularyAssignments } from "../_shared/vocab_assignment_data.ts";
import { loadErrorLogPage } from "../_shared/error_log.ts";

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
      const [data, emails, progress] = await Promise.all([
        allProgressRows<Record<string, unknown>>(start => svc
        .from("student_profiles")
        .select("id,grade_level,school,profile_status,profile_submitted_at,profile_approved_at,created_at,profiles:profiles!student_profiles_id_fkey!inner(full_name),attempts!attempts_student_id_fkey(id,status)")
        .eq("profiles.role", "student").order("id").range(start, start + 499)),
        progressUserEmails(svc),
        new URL(req.url).searchParams.get("progress") === "1"
          ? loadAssignmentProgress(svc, new Date()) : Promise.resolve(null),
      ]);
      const byStudent = progress ? Map.groupBy(progress, a => a.student_id) : null;
      return json({
        students: (data ?? []).map((s: Record<string, unknown>) => ({
          ...s,
          ...(byStudent ? { assignment_progress: byStudent.get(s.id as string) ?? [] } : {}),
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
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return error("Invalid student ID", 422);

    if (req.method === "GET" && seg.length === 3 && seg[2] === "error-log") {
      const { data: student, error: studentError } = await svc.from("student_profiles")
        .select("id").eq("id", id).maybeSingle();
      if (studentError) throw new HttpError(500, "Unable to load student");
      if (!student) return error("Student not found", 404);
      return json(await loadErrorLogPage(svc, id, new URL(req.url)));
    }

    // Student detail with every attempt (full-length + practice) for Manage view.
    if (req.method === "GET" && seg.length === 2) {
      const { data: sp, error: spErr } = await svc
        .from("student_profiles")
        .select("*, profiles:profiles!student_profiles_id_fkey(full_name)")
        .eq("id", id)
        .maybeSingle();
      if (spErr) return error(spErr.message, 500);
      if (!sp) return error("Student not found", 404);
      const { data: authUser, error: uErr } = await svc.auth.admin.getUserById(id);
      if (uErr) return error(uErr.message, 500);
      const attempts = await allProgressRows<Record<string, unknown>>(start => svc.from("attempts")
        .select("id,test_id,assignment_id,status,started_at,submitted_at,test:tests(id,title,kind),score:scores(*)")
        .eq("student_id", id).order("id").range(start, start + 499));
      const { data: topics } = await svc
        .from("topic_performance")
        .select("*")
        .eq("student_id", id)
        .order("domain");
      const shaped: Array<Record<string, unknown>> = (attempts ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        score: withAccuracy(a.score),
      }));

      const now = new Date(), today = now.toISOString().slice(0, 10);
      const [assignmentProgress, vocabReport] = await Promise.all([
        loadAssignmentProgress(svc, now, id, true),
        loadVocabularyAssignments(svc, now, undefined, undefined, id),
      ]);
      const vocabDeckProgress = vocabReport.decks.flatMap(deck => deck.students.map(student => ({
        ...student, deck_id: deck.id, name: deck.name, card_count: deck.card_count,
      })));
      const tracked = vocabDeckProgress.reduce((n, d) => n + d.tracked_review_count, 0);
      const vocabularyToday = {
        assigned_deck_count: vocabDeckProgress.length,
        decks_done_today: vocabDeckProgress.filter(d => d.today_status === "done_today").length,
        decks_with_due: vocabDeckProgress.filter(d => d.remaining_today > 0).length,
        cards_due_now: vocabDeckProgress.reduce((n, d) => n + d.due_remaining + d.new_remaining, 0),
        cards_remaining_today: vocabDeckProgress.reduce((n, d) => n + d.remaining_today, 0),
        reviews_today: vocabDeckProgress.reduce((n, d) => n + d.reviewed_today, 0),
        tracked_review_ms: tracked ? vocabDeckProgress.reduce((n, d) => n + (d.tracked_review_ms ?? 0), 0) : null,
        tracked_review_count: tracked,
      };

      const cutoff = new Date(now.getTime() - 182 * 86_400_000).toISOString().slice(0, 10);
      const { data: activity, error: activityErr } = await svc
        .from("vocab_daily_activity")
        .select("activity_date")
        .eq("student_id", id)
        .gte("activity_date", cutoff)
        .order("activity_date", { ascending: true });
      if (activityErr) return error(activityErr.message, 500);
      const streak = vocabularyStreak(
        ((activity ?? []) as Array<{ activity_date: string }>).map((row) => row.activity_date),
        today,
      );

      return json({
        student: {
          ...(sp as Record<string, unknown>),
          full_name: ((sp as Record<string, unknown>).profiles as { full_name?: string } | null)?.full_name ?? null,
          email: authUser?.user?.email ?? null,
        },
        attempts: shaped,
        topics: topics ?? [],
        practice_assignments: assignmentProgress.filter(a => a.kind === "practice"),
        full_assignments: assignmentProgress.filter(a => a.kind === "full"),
        vocabulary: {
          decks: vocabDeckProgress,
          today: vocabularyToday,
          streak,
        },
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
          phone_number: body.phone_number ?? undefined,
          parent_name: body.parent_name ?? undefined,
          parent_phone_number: body.parent_phone_number ?? undefined,
        })
        .eq("id", id);
      if (uErr) return error(uErr.message, 500);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "student.updated", entity_type: "student", entity_id: id, details: { updated_fields: Object.keys(body) } });
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 4 && seg[2] === "profile" && seg[3] === "approve") {
      const [{ data: student, error: studentErr }, { data: profile, error: profileErr }] = await Promise.all([
        svc.from("student_profiles")
          .select("phone_number, parent_name, parent_phone_number, profile_status")
          .eq("id", id)
          .maybeSingle(),
        svc.from("profiles").select("full_name").eq("id", id).maybeSingle(),
      ]);
      if (studentErr) return error(studentErr.message, 500);
      if (profileErr) return error(profileErr.message, 500);
      if (!student || !profile) return error("Student not found", 404);
      if (student.profile_status !== "pending") return error("Only submitted profiles can be approved", 409);
      if (!hasRequiredStudentProfile({ ...student, full_name: profile.full_name })) {
        return error("All required student and parent contact fields must be complete before approval", 422);
      }
      const { error: approveErr } = await svc.from("student_profiles")
        .update({ profile_status: "approved", profile_approved_at: new Date().toISOString(), profile_approved_by: ctx.user.id })
        .eq("id", id)
        .eq("profile_status", "pending");
      if (approveErr) return error(approveErr.message, 500);
      await svc.from("audit_logs").insert({
        actor_id: ctx.user.id,
        action: "student.profile_approved",
        entity_type: "student",
        entity_id: id,
      });
      return json({ ok: true, profile_status: "approved" });
    }

    if (req.method === "POST" && seg.length === 3 && seg[2] === "reset-password") {
      const body = resetPasswordSchema.parse(await req.json());
      const { error: authErr } = await svc.auth.admin.updateUserById(id, { password: body.new_password });
      if (authErr) return error(authErr.message, 400);
      await svc.from("audit_logs").insert({ actor_id: ctx.user.id, action: "student.password_reset", entity_type: "student", entity_id: id });
      return json({ ok: true });
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
