import {
  hasRequiredStudentProfile,
  nextStudentProfileStatus,
} from "./student_profile.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("student profile completion requires all four contact fields", () => {
  assertEquals(hasRequiredStudentProfile({
    full_name: "A Student",
    phone_number: "0123456789",
    parent_name: "Parent",
    parent_phone_number: "0987654321",
  }), true);
  assertEquals(hasRequiredStudentProfile({
    full_name: "A Student",
    phone_number: "0123456789",
    parent_name: " ",
    parent_phone_number: "0987654321",
  }), false);
  assertEquals(hasRequiredStudentProfile({
    full_name: null,
    phone_number: "0123456789",
    parent_name: "Parent",
    parent_phone_number: "0987654321",
  }), false);
});

Deno.test("an approved profile remains approved unless a submitted field changes", () => {
  const current = {
    full_name: "A Student",
    phone_number: "0123456789",
    parent_name: "Parent",
    parent_phone_number: "0987654321",
  };
  assertEquals(nextStudentProfileStatus("approved", current, { ...current }), "approved");
  assertEquals(nextStudentProfileStatus("approved", current, { ...current, phone_number: "0111222333" }), "pending");
  assertEquals(nextStudentProfileStatus("incomplete", current, { ...current }), "pending");
});
