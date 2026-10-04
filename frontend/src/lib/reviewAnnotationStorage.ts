import { supabase } from "./supabase";
import { validAnnotation } from "./reviewAnnotations";
import type { ReviewAnnotation } from "./reviewAnnotations";

export async function loadAnnotations(scope: string) {
  const { data, error } = await supabase.from("admin_review_annotations")
    .select("question_id,document,content_hash").eq("scope", scope);
  if (error) throw new Error("Could not load saved annotations. Try again.");
  return (data ?? []).filter(row => validAnnotation(row.document)) as
    { question_id: string; document: ReviewAnnotation; content_hash: string }[];
}

export async function saveAnnotation(scope: string, questionId: string, contentHash: string, document: ReviewAnnotation) {
  if (!validAnnotation(document) || new TextEncoder().encode(JSON.stringify(document)).length > 900000) throw new Error("Annotation exceeds the supported size.");
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in again before saving.");
  const { error } = await supabase.from("admin_review_annotations").upsert({
    owner_id: user.id, scope, question_id: questionId, content_hash: contentHash, document,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id,scope,question_id" });
  if (error) throw new Error("Could not save annotation.");
}
