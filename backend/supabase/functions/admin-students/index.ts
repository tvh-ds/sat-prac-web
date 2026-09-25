import { createClient } from "npm:@supabase/supabase-js@2";
import { requireRole, HttpError, pathSegments } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, json, error } from "../_shared/cors.ts";
import { buildAttemptReview } from "../_shared/attempt_review.ts";
import { createStudentSchema, updateStudentSchema, resetPasswordSchema } from "../_shared/validation.ts";
import { hasRequiredStudentProfile } from "../_shared/student_profile.ts";
import {
  assignedVocabDeckProgress,
  latestAttempt,
  practiceAssignmentStatus,
  sumModuleTimeSeconds,
  vocabularyStreak,
} from "../_shared/student_progress.ts";

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
        .select("id, grade_level, school, profile_status, profile_submitted_at, profile_approved_at, created_at, profiles:profiles!student_profiles_id_fkey(full_name), attempts(id, status)")
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
        .select("*, profiles:profiles!student_profiles_id_fkey(full_name)")
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
      const shaped: Array<Record<string, unknown>> = (attempts ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        score: withAccuracy(a.score),
      }));

      // Assignment and vocabulary progress for this student. The admin-only
      // handler uses the service client, so every student-owned query is
      // explicitly scoped to the requested student id.
      const { data: assignments, error: assignmentErr } = await svc
        .from("test_assignments")
        .select("id, test_id, assigned_at, due_at, status")
        .eq("student_id", id)
        .order("assigned_at", { ascending: false });
      if (assignmentErr) return error(assignmentErr.message, 500);

      const assignmentRows = (assignments ?? []) as Array<{
        id: string;
        test_id: string;
        assigned_at: string;
        due_at: string | null;
        status: string;
      }>;
      const assignedTestIds = [...new Set(assignmentRows.map((assignment) => assignment.test_id))];
      const { data: practiceTests, error: testErr } = assignedTestIds.length > 0
        ? await svc.from("tests").select("id, title").in("id", assignedTestIds).eq("kind", "practice")
        : { data: [], error: null };
      if (testErr) return error(testErr.message, 500);
      const practiceTestRows = (practiceTests ?? []) as Array<{ id: string; title: string }>;
      const practiceTestIds = new Set(practiceTestRows.map((test) => test.id));
      const practiceAssignments = assignmentRows.filter((assignment) => practiceTestIds.has(assignment.test_id));
      const practiceAssignmentIds = new Set(practiceAssignments.map((assignment) => assignment.id));

      const { data: practiceBatches, error: batchErr } = practiceTestIds.size > 0
        ? await svc
          .from("practice_assignment_batches")
          .select("snapshot_test_id, title, timer_minutes")
          .in("snapshot_test_id", [...practiceTestIds])
        : { data: [], error: null };
      if (batchErr) return error(batchErr.message, 500);
      const batchRows = (practiceBatches ?? []) as Array<{
        snapshot_test_id: string;
        title: string;
        timer_minutes: number;
      }>;
      const batchByTestId = new Map(batchRows.map((batch) => [batch.snapshot_test_id, batch]));
      const testById = new Map(practiceTestRows.map((test) => [test.id, test]));

      type AttemptProgress = {
        id: string;
        assignment_id: string | null;
        started_at: string;
        submitted_at: string | null;
        status: string;
        score: unknown;
      };
      const practiceAttemptRows: AttemptProgress[] = [];
      for (const row of shaped) {
        if (
          typeof row.id !== "string" || typeof row.started_at !== "string" ||
          typeof row.status !== "string"
        ) continue;
        const assignmentId = typeof row.assignment_id === "string" ? row.assignment_id : null;
        if (!assignmentId || !practiceAssignmentIds.has(assignmentId)) continue;
        practiceAttemptRows.push({
          id: row.id,
          assignment_id: assignmentId,
          started_at: row.started_at,
          submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : null,
          status: row.status,
          score: row.score,
        });
      }
      const attemptsByAssignment = new Map<string, AttemptProgress[]>();
      for (const attempt of practiceAttemptRows) {
        const assignmentId = attempt.assignment_id!;
        const rows = attemptsByAssignment.get(assignmentId) ?? [];
        rows.push(attempt);
        attemptsByAssignment.set(assignmentId, rows);
      }

      const practiceAttemptIds = practiceAttemptRows.map((attempt) => attempt.id);
      const { data: moduleTimes, error: moduleTimeErr } = practiceAttemptIds.length > 0
        ? await svc
          .from("attempt_modules")
          .select("attempt_id, time_spent_seconds")
          .in("attempt_id", practiceAttemptIds)
        : { data: [], error: null };
      if (moduleTimeErr) return error(moduleTimeErr.message, 500);
      const moduleTimesByAttempt = new Map<string, Array<{ time_spent_seconds: number | null }>>();
      for (const row of (moduleTimes ?? []) as Array<{ attempt_id: string; time_spent_seconds: number | null }>) {
        const rows = moduleTimesByAttempt.get(row.attempt_id) ?? [];
        rows.push({ time_spent_seconds: row.time_spent_seconds });
        moduleTimesByAttempt.set(row.attempt_id, rows);
      }

      const now = new Date();
      const practiceProgress = practiceAssignments.map((assignment) => {
        const attempt = latestAttempt(attemptsByAssignment.get(assignment.id) ?? []);
        const scoreRow = attempt
          ? (Array.isArray(attempt.score) ? attempt.score[0] : attempt.score) as Record<string, unknown> | null
          : null;
        const rawScore = scoreRow?.raw_score == null ? null : Number(scoreRow.raw_score);
        const totalQuestions = scoreRow?.total_questions == null ? null : Number(scoreRow.total_questions);
        return {
          assignment_id: assignment.id,
          test_id: assignment.test_id,
          title: batchByTestId.get(assignment.test_id)?.title ?? testById.get(assignment.test_id)?.title ?? "Practice set",
          assigned_at: assignment.assigned_at,
          due_at: assignment.due_at,
          status: practiceAssignmentStatus(assignment.status, assignment.due_at, attempt?.status ?? null, now),
          attempt_status: attempt?.status ?? null,
          started_at: attempt?.started_at ?? null,
          submitted_at: attempt?.submitted_at ?? null,
          raw_score: rawScore,
          total_questions: totalQuestions,
          accuracy: scoreRow?.accuracy == null ? null : Number(scoreRow.accuracy),
          active_time_seconds: attempt ? sumModuleTimeSeconds(moduleTimesByAttempt.get(attempt.id) ?? []) : null,
          timer_minutes: batchByTestId.get(assignment.test_id)?.timer_minutes ?? null,
        };
      });

      const { data: vocabAssignments, error: vocabAssignmentErr } = await svc
        .from("vocab_deck_assignments")
        .select("deck_id")
        .eq("student_id", id);
      if (vocabAssignmentErr) return error(vocabAssignmentErr.message, 500);
      const assignedDeckIds = [...new Set((vocabAssignments ?? []).map((row: { deck_id: string }) => row.deck_id))];
      const { data: vocabDecks, error: deckErr } = assignedDeckIds.length > 0
        ? await svc
          .from("vocab_decks")
          .select("id, name")
          .in("id", assignedDeckIds)
          .eq("status", "active")
          .order("created_at", { ascending: true })
        : { data: [], error: null };
      if (deckErr) return error(deckErr.message, 500);
      const deckRows = (vocabDecks ?? []) as Array<{ id: string; name: string }>;
      const activeDeckIds = deckRows.map((deck) => deck.id);
      const { data: vocabCards, error: cardErr } = activeDeckIds.length > 0
        ? await svc.from("vocab_cards").select("id, deck_id").in("deck_id", activeDeckIds)
        : { data: [], error: null };
      if (cardErr) return error(cardErr.message, 500);
      const cardRows = (vocabCards ?? []) as Array<{ id: string; deck_id: string }>;
      const vocabCardIds = cardRows.map((card) => card.id);
      const today = now.toISOString().slice(0, 10);

      const { data: cardStates, error: cardStateErr } = vocabCardIds.length > 0
        ? await svc
          .from("vocab_card_state")
          .select("card_id, due_at")
          .eq("student_id", id)
          .in("card_id", vocabCardIds)
        : { data: [], error: null };
      if (cardStateErr) return error(cardStateErr.message, 500);
      const { data: vocabReviews, error: reviewErr } = vocabCardIds.length > 0
        ? await svc
          .from("vocab_reviews")
          .select("card_id, reviewed_on, response_ms")
          .eq("student_id", id)
          .eq("reviewed_on", today)
          .in("card_id", vocabCardIds)
        : { data: [], error: null };
      if (reviewErr) return error(reviewErr.message, 500);

      const vocabDeckProgress = assignedVocabDeckProgress(
        deckRows,
        cardRows,
        (cardStates ?? []) as Array<{ card_id: string; due_at: string }>,
        (vocabReviews ?? []) as Array<{ card_id: string; reviewed_on: string; response_ms: number | null }>,
        now,
      );
      const trackedReviewRows = vocabDeckProgress.reduce((count, deck) => count + deck.tracked_review_count, 0);
      const reviewCount = vocabDeckProgress.reduce((count, deck) => count + deck.reviewed_today, 0);
      const responseTime = vocabDeckProgress.reduce((total, deck) => total + (deck.tracked_review_ms ?? 0), 0);
      const vocabularyToday = {
        assigned_deck_count: vocabDeckProgress.length,
        decks_done_today: vocabDeckProgress.filter((deck) => deck.today_status === "done_today").length,
        decks_with_due: vocabDeckProgress.filter((deck) => deck.today_status === "due_remaining").length,
        cards_due_now: vocabDeckProgress.reduce((total, deck) => total + deck.due_remaining, 0),
        reviews_today: reviewCount,
        tracked_review_ms: trackedReviewRows > 0 ? responseTime : null,
        tracked_review_count: trackedReviewRows,
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
        practice_assignments: practiceProgress,
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
