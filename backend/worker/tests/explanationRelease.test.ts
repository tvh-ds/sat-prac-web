import { describe, expect, it } from "vitest";
import { explanationsAvailable } from "../../supabase/functions/_shared/explanationRelease";

describe("explanation release access", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  it("unlocks at exactly seven elapsed days and includes existing older work", () => {
    expect(explanationsAvailable("2026-10-24T12:00:00.001Z", null, now)).toBe(false);
    expect(explanationsAvailable("2026-10-24T12:00:00Z", null, now)).toBe(true);
    expect(explanationsAvailable("2026-10-01T12:00:00Z", null, now)).toBe(true);
    expect(explanationsAvailable("2026-10-24T15:00:00+03:00", null, now)).toBe(true);
  });
  it("keeps recent classmates' work hidden even when an older submission qualifies", () => {
    expect(explanationsAvailable("2026-10-23T12:00:00Z", null, now)).toBe(true);
    expect(explanationsAvailable("2026-10-30T12:00:00Z", null, now)).toBe(false);
  });
  it("preserves immediate manual release", () => {
    expect(explanationsAvailable("2026-10-31T11:59:00Z", "2026-10-31T12:00:00Z", now)).toBe(true);
  });
  it("does not unlock missing, invalid, or future submission times", () => {
    for (const submitted of [null, "", "invalid", "2026-11-01T12:00:00Z"]) {
      expect(explanationsAvailable(submitted, null, now)).toBe(false);
    }
  });
});
