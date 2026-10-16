import { assignManySchema, practiceAssignSchema, studentClassSchema } from "./validation.ts";
const id = "11111111-1111-4111-8111-111111111111";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }

Deno.test("class assignments require exactly one recipient source", () => {
  for (const schema of [assignManySchema, practiceAssignSchema]) {
    const base = { timer_minutes: 20 };
    assert(schema.safeParse({ ...base, class_id: id }).success, "Class target rejected");
    assert(schema.safeParse({ ...base, student_ids: [id] }).success, "Individual target rejected");
    assert(!schema.safeParse(base).success, "Missing recipient target accepted");
    assert(!schema.safeParse({ ...base, class_id: id, student_ids: [id] }).success, "Mixed targets accepted");
    assert(!schema.safeParse({ ...base, class_id: "invalid" }).success, "Invalid class ID accepted");
  }
});
Deno.test("practice timers reject blank, zero, fractions and out-of-range values", () => {
  for (const timer of ["", "20", 0, -1, 1.5, 601, null]) assert(!practiceAssignSchema.safeParse({ student_ids: [id], timer_minutes: timer }).success, `Invalid timer accepted: ${timer}`);
  for (const timer of [1, 20, 600]) assert(practiceAssignSchema.safeParse({ class_id: id, timer_minutes: timer }).success, `Valid timer rejected: ${timer}`);
});
Deno.test("class names and roster bounds are validated", () => {
  const parsed = studentClassSchema.parse({ name: "  Saturday SAT  ", student_ids: [] });
  assert(parsed.name === "Saturday SAT", "Name was not trimmed");
  assert(!studentClassSchema.safeParse({ name: "  ", student_ids: [] }).success, "Blank class accepted");
  assert(!studentClassSchema.safeParse({ name: "x".repeat(101), student_ids: [] }).success, "Overlong name accepted");
  assert(!studentClassSchema.safeParse({ name: "SAT", student_ids: ["invalid"] }).success, "Invalid member accepted");
  assert(!studentClassSchema.safeParse({ name: "SAT", student_ids: Array(1001).fill(id) }).success, "Oversized class accepted");
});
