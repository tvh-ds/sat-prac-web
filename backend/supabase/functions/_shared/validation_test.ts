import { saveDraftEditorSchema, vocabReviewSchema } from "./validation.ts";

Deno.test("draft editor accepts Supabase timestamps with UTC offsets", () => {
  const payload = {
    assigned_module_name: "Reading and Writing Module 1",
    display_order: 2,
    expected_updated_at: "2026-09-28T01:23:45.123456+00:00",
    prompt: "What does the passage suggest?",
    passage_text: "The revised passage.",
  };
  const result = saveDraftEditorSchema.safeParse(payload);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
});

Deno.test("vocabulary Study reviews require an idempotency key and state version", () => {
  const valid = vocabReviewSchema.safeParse({
    card_id: "a2cd337a-6d2e-4caf-bec8-f33e5d21dd45",
    rating: 3,
    mode: "study",
    submission_id: "a2cd337a-6d2e-4caf-bec8-f33e5d21dd45",
    expected_version: 0,
  });
  if (!valid.success) throw new Error(JSON.stringify(valid.error.issues));

  const invalid = vocabReviewSchema.safeParse({
    card_id: "a2cd337a-6d2e-4caf-bec8-f33e5d21dd45",
    rating: 3,
    mode: "study",
    submission_id: "a2cd337a-6d2e-4caf-bec8-f33e5d21dd45",
  });
  if (invalid.success) throw new Error("Study review accepted a missing expected_version");
});

Deno.test("Sprint review rejects scheduling state", () => {
  const result = vocabReviewSchema.safeParse({
    card_id: "a2cd337a-6d2e-4caf-bec8-f33e5d21dd45",
    rating: 4,
    mode: "sprint",
    submission_id: "a2cd337a-6d2e-4caf-bec8-f33e5d21dd45",
    expected_version: 0,
  });
  if (result.success) throw new Error("Sprint review accepted an FSRS state version");
});
