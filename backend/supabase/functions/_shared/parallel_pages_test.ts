import { parallelPages } from "./parallel_pages.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("counted pages preserve every row and range order with bounded concurrency", async () => {
  let active = 0, peak = 0, counts = 0;
  const rows = await parallelPages<number>(async (offset, count) => {
    active++; peak = Math.max(peak, active); if (count) counts++;
    await new Promise(resolve => setTimeout(resolve, offset === 2 ? 15 : 1));
    active--;
    return { data: Array.from({ length: Math.min(2, 13 - offset) }, (_, i) => offset + i), count: count ? 13 : null, error: null };
  }, 2, 3);
  equal(rows, Array.from({ length: 13 }, (_, i) => i));
  equal(peak, 3); equal(counts, 1);
});

Deno.test("empty and exact page boundaries make no extra request", async () => {
  for (const total of [0, 2, 4]) {
    const offsets: number[] = [];
    const rows = await parallelPages<number>((offset, count) => {
      offsets.push(offset);
      return Promise.resolve({ data: Array.from({ length: Math.min(2, total - offset) }, (_, i) => offset + i), count: count ? total : null, error: null });
    }, 2);
    equal(rows.length, total);
    equal(offsets.length, Math.max(1, Math.ceil(total / 2)));
  }
});

Deno.test("a failed page rejects the entire result rather than returning partial counts", async () => {
  const failure = new Error("database unavailable");
  try {
    await parallelPages<number>((offset, count) => Promise.resolve({ data: [offset], count: count ? 3 : null, error: offset === 1 ? failure : null }), 1);
    throw new Error("Expected rejection");
  } catch (error) { if (error !== failure) throw error; }
});
