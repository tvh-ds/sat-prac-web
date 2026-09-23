import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./auth.ts";

interface KeyQuestion {
  id: string;
  question_type: string;
  correct_answer: string | null;
}

/** Ensure every question id has a usable answer key. Throws 422 otherwise. */
export async function assertAnswerKeys(svc: SupabaseClient, questionIds: string[]) {
  const unique = [...new Set(questionIds)];
  if (unique.length === 0) return;
  const { data: questions, error: qErr } = await svc
    .from("questions")
    .select("id, question_type, correct_answer")
    .in("id", unique);
  if (qErr) throw new HttpError(500, qErr.message);
  const rows = (questions ?? []) as KeyQuestion[];
  if (rows.length !== unique.length) {
    throw new HttpError(422, "One or more questions were not found");
  }
  const { data: choices, error: cErr } = await svc
    .from("question_choices")
    .select("question_id, is_correct")
    .in("question_id", unique);
  if (cErr) throw new HttpError(500, cErr.message);
  const correctByQ = new Set(
    ((choices ?? []) as Array<{ question_id: string; is_correct: boolean }>)
      .filter((c) => c.is_correct)
      .map((c) => c.question_id),
  );
  const invalid = rows
    .filter((q) =>
      q.question_type === "multiple_choice"
        ? !correctByQ.has(q.id)
        : !String(q.correct_answer ?? "").trim()
    )
    .map((q) => q.id);
  if (invalid.length > 0) {
    throw new HttpError(
      422,
      `These questions are missing answer keys and cannot be used in practice sets: ${invalid.join(", ")}`,
    );
  }
}
