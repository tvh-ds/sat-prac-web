import { isCollegeBoardRwBank } from "./collegeboardBank.ts";
import { assertEquals } from "jsr:@std/assert@1";

Deno.test("the practice-bank publishing exception belongs to exactly one deck", () => {
  assertEquals(isCollegeBoardRwBank("5a255e65-742d-41e1-ba7c-ca0379257ebc"), true);
  // Full-test imports, another bank upload, and unknown IDs retain the normal flow.
  assertEquals(isCollegeBoardRwBank("5b0dea55-44ef-47ae-9bc6-8f30d3f22539"), false);
  assertEquals(isCollegeBoardRwBank("30e58fb4-be59-4f1b-aea2-5d480467debe"), false);
  assertEquals(isCollegeBoardRwBank("5a255e65-742d-41e1-ba7c-ca0379257ebd"), false);
  assertEquals(isCollegeBoardRwBank(undefined), false);
});
