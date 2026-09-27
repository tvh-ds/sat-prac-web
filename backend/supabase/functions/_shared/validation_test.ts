import { saveDraftEditorSchema } from "./validation.ts";

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
