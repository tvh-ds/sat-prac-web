import { normalizeMathAnswer, answersMatch } from "../_shared/scoring.ts";
import { assertEquals } from "jsr:@std/assert@1";

Deno.test("normalizeMathAnswer trims and lowercases", () => {
  assertEquals(normalizeMathAnswer("  5  "), "5");
  assertEquals(normalizeMathAnswer("A"), "a");
});

Deno.test("normalizeMathAnswer strips thousands commas", () => {
  assertEquals(normalizeMathAnswer("1,250"), "1250");
});

Deno.test("normalizeMathAnswer evaluates fractions", () => {
  assertEquals(normalizeMathAnswer("3/4"), "0.75");
  assertEquals(normalizeMathAnswer("7 / 8"), "0.875");
  assertEquals(normalizeMathAnswer("-1/2"), "-0.5");
  assertEquals(normalizeMathAnswer("1/0"), null);
});

Deno.test("normalizeMathAnswer rounds floating point noise", () => {
  assertEquals(normalizeMathAnswer("0.3333333333"), "0.333333");
});

Deno.test("normalizeMathAnswer handles null/empty", () => {
  assertEquals(normalizeMathAnswer(null), null);
  assertEquals(normalizeMathAnswer(""), null);
  assertEquals(normalizeMathAnswer("   "), null);
});

Deno.test("answersMatch accepts equivalent forms", () => {
  assertEquals(answersMatch("3/4", "0.75"), true);
  assertEquals(answersMatch("0.75", "3/4"), true);
  assertEquals(answersMatch("4", "4.0"), true);
  assertEquals(answersMatch("2.5", "5/2"), true);
  assertEquals(answersMatch("A", "A"), true);
  assertEquals(answersMatch("A", "B"), false);
  assertEquals(answersMatch(null, "5"), false);
  assertEquals(answersMatch("x", null), false);
});

Deno.test("answersMatch accepts every official alternative independently", () => {
  assertEquals(answersMatch("0", "0 | 3"), true);
  assertEquals(answersMatch("3", "0 | 3"), true);
  assertEquals(answersMatch("2", "0 | 3"), false);
  assertEquals(answersMatch("14.67", "14.66 | 14.67 | 44/3"), true);
  assertEquals(answersMatch("44/3", "14.66 | 14.67 | 44/3"), true);
  assertEquals(answersMatch("-30", "30 | -30"), true);
  assertEquals(answersMatch("0 | 3", "0 | 3"), false);
  assertEquals(answersMatch("1/0", "1/0 | 3"), false);
});
