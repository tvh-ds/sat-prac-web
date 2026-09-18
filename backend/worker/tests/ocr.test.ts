import { describe, it, expect, vi, afterEach } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  blocksToPageText,
  tableHtmlToText,
  fitImageForParse,
  createParseProvider,
  CohereParseProvider,
  parsePageTiled,
  trimStripOverlap,
  PARSE_MAX_WIDTH,
  PARSE_TILE_MAX_H,
  type ParseProvider,
  type ParsePageResult,
} from "../src/ocr";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tableHtmlToText", () => {
  it("flattens table cells to text lines without tags", () => {
    const out = tableHtmlToText("<table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table>");
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toMatch(/1/);
    expect(out).toMatch(/2/);
  });
});

describe("blocksToPageText", () => {
  it("orders text/table/image blocks and records visuals", () => {
    const { text, visuals } = blocksToPageText([
      { type: "text", text: { content: "1. What is x?" } },
      {
        type: "table",
        table: { html: "<table><tr><td>1</td><td>2</td></tr></table>", bounding_box: { top_left_x: 1, top_left_y: 2, bottom_right_x: 3, bottom_right_y: 4 } },
      },
      { type: "image", image: { description: "coordinate graph", category: "other" } },
    ]);
    expect(text).toMatch(/What is x/);
    expect(text).toMatch(/\[figure: coordinate graph\]/);
    expect(visuals).toHaveLength(2);
    expect(visuals[0]!.kind).toBe("table");
    expect(visuals[0]!.bbox).toEqual({ topLeftX: 1, topLeftY: 2, bottomRightX: 3, bottomRightY: 4 });
    expect(visuals[1]!.kind).toBe("image");
  });

  it("skips empty text blocks", () => {
    const { text, visuals } = blocksToPageText([{ type: "text", text: { content: "   " } }]);
    expect(text).toBe("");
    expect(visuals).toHaveLength(0);
  });
});

describe("fitImageForParse", () => {
  it("keeps small pages as PNG", async () => {
    const canvas = createCanvas(800, 1000);
    const png = Buffer.from(await canvas.encode("png"));
    const out = await fitImageForParse(png);
    expect(out.mime).toBe("image/png");
    expect(out.width).toBe(800);
    expect(out.pixels).toBe(800_000);
  });

  it("downscales oversized pages within caps", async () => {
    const canvas = createCanvas(3000, 3000);
    const png = Buffer.from(await canvas.encode("png"));
    const out = await fitImageForParse(png);
    expect(out.width).toBeLessThanOrEqual(PARSE_MAX_WIDTH);
    expect(out.pixels).toBeLessThanOrEqual(30_000_000);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "ERR", json: async () => body };
}

describe("CohereParseProvider", () => {
  it("sends parse-v5.0 blocks requests and parses the response", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        seen.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({
          pages: [
            {
              type: "blocks",
              blocks: [
                { type: "text", text: { content: "1. Hello?" } },
                { type: "image", image: { description: "graph", category: "other" } },
              ],
            },
          ],
          meta: { billed_units: { pages: 1 } },
        });
      }),
    );
    const ocr = new CohereParseProvider("k", undefined, 10_000);
    const out = await ocr.parseImage(Buffer.from("img"), "image/png");
    expect(seen[0]!.url).toMatch(/\/v2\/parse/);
    expect((seen[0]!.body as { model: string }).model).toBe("parse-v5.0");
    expect((seen[0]!.body as { output_format: string }).output_format).toBe("blocks");
    expect(out.text).toMatch(/Hello/);
    expect(out.imageCount).toBe(1);
    expect(out.billedPages).toBe(1);
  });

  it("throws auth errors immediately without retry", async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: "invalid key" }, 401));
    vi.stubGlobal("fetch", fetch);
    const ocr = new CohereParseProvider("bad", undefined, 10_000);
    await expect(ocr.parseImage(Buffer.from("img"), "image/png")).rejects.toThrow(/auth failure/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries once on transient failures", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    vi.stubGlobal("fetch", fetch);
    const ocr = new CohereParseProvider("k", undefined, 10_000);
    await expect(ocr.parseImage(Buffer.from("img"), "image/png")).rejects.toThrow(/socket hang up/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rotates to the next key on quota failures and retries the page", async () => {
    const seenAuth: string[] = [];
    const fetch = vi.fn(async (_url: string, init: { headers?: Record<string, string> }) => {
      seenAuth.push(init.headers?.Authorization ?? "");
      if (seenAuth.length <= 2) return jsonResponse({ message: "quota exceeded for key" }, 429);
      return jsonResponse({
        pages: [{ type: "blocks", blocks: [{ type: "text", text: { content: "ok" } }] }],
        meta: { billed_units: { pages: 1 } },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const ocr = new CohereParseProvider(["k1", "k2"], undefined, 10_000, 1000, 0);
    const out = await ocr.parseImage(Buffer.from("img"), "image/png");
    expect(out.text).toBe("ok");
    expect(seenAuth[0]).toContain("k1");
    expect(seenAuth[seenAuth.length - 1]).toContain("k2");
    expect(ocr.exhaustedCount()).toBe(1);
  });

  it("retires a key after its billed-page cap and keeps serving from the next key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          pages: [{ type: "blocks", blocks: [{ type: "text", text: { content: "ok" } }] }],
          meta: { billed_units: { pages: 1 } },
        }),
      ),
    );
    const ocr = new CohereParseProvider(["k1", "k2"], undefined, 10_000, 2);
    await ocr.parseImage(Buffer.from("a"), "image/png");
    await ocr.parseImage(Buffer.from("b"), "image/png");
    expect(ocr.exhaustedCount()).toBe(1);
    const out = await ocr.parseImage(Buffer.from("c"), "image/png");
    expect(out.text).toBe("ok");
    expect(ocr.billedPagesByKey()).toEqual([2, 1]);
  });

  it("throws when every key is exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "quota exceeded" }, 429)));
    const ocr = new CohereParseProvider(["k1", "k2"], undefined, 10_000, 1000, 0);
    await expect(ocr.parseImage(Buffer.from("img"), "image/png")).rejects.toThrow(/429|exhausted/);
    expect(ocr.exhaustedCount()).toBe(2);
  });
});

describe("createParseProvider", () => {
  it("requires an API key", () => {
    expect(() => createParseProvider("cohere_parse", undefined)).toThrow(/COHERE_API_KEY/);
  });

  it("maps legacy cohere provider to Parse 5", () => {
    expect(createParseProvider("cohere", "k").model).toBe("parse-v5.0");
  });

  it("rejects unknown providers", () => {
    expect(() => createParseProvider("vision", "k")).toThrow(/Unknown OCR provider/);
  });
});

describe("trimStripOverlap", () => {
  it("cuts the overlapped head from the next strip", () => {
    const prev = "alpha beta gamma delta epsilon zeta eta theta one two three four five six seven eight";
    const cur = "one two three four five six seven eight nine ten eleven twelve";
    expect(trimStripOverlap(prev, cur)).toBe("nine ten eleven twelve");
  });

  it("resumes mid-question overlap at the continuation point", () => {
    const prev =
      "7. Which choice best states the function? Curious about dreams Stephen LaBerge and team recruited lucid dreamers who are awake visually";
    const cur =
      "7. Which choice best states the function? Curious about dreams Stephen LaBerge and team recruited lucid dreamers who are awake visually track objects around them suggesting pure imagination";
    expect(trimStripOverlap(prev, cur)).toBe("track objects around them suggesting pure imagination");
  });

  it("keeps text when there is no overlap", () => {
    expect(trimStripOverlap("alpha beta gamma", "delta epsilon zeta eta theta iota kappa")).toBe(
      "delta epsilon zeta eta theta iota kappa",
    );
  });
});

describe("parsePageTiled", () => {
  function mockProvider(texts: string[]): ParseProvider & { calls: number } {
    const p = {
      name: "mock",
      model: "mock",
      calls: 0,
      parseImage: async (): Promise<ParsePageResult> => {
        const text = texts[Math.min(p.calls, texts.length - 1)] ?? "";
        p.calls++;
        return { text, visuals: [], tableCount: 0, imageCount: 0, textBlockCount: 1, billedPages: 1 };
      },
    };
    return p;
  }

  async function pngOf(w: number, h: number): Promise<Buffer> {
    const canvas = createCanvas(w, h);
    return Buffer.from(await canvas.encode("png"));
  }

  it("passes short pages through as a single call", async () => {
    const provider = mockProvider(["hello world"]);
    const out = await parsePageTiled(provider, { image: await pngOf(800, 1000), mime: "image/png", width: 800, height: 1000, pixels: 800_000 });
    expect(provider.calls).toBe(1);
    expect(out.text).toBe("hello world");
    expect(out.billedPages).toBe(1);
  });

  it("tiles tall pages and stitches without duplicating overlap", async () => {
    const h = PARSE_TILE_MAX_H * 2;
    const provider = mockProvider([
      "strip one alpha beta gamma delta epsilon zeta eta theta one shared overlap sequence words here",
      "one shared overlap sequence words here strip two phi chi psi omega end",
    ]);
    const out = await parsePageTiled(provider, { image: await pngOf(1000, h), mime: "image/png", width: 1000, height: h, pixels: 1000 * h });
    expect(provider.calls).toBeGreaterThan(1);
    expect(out.text).toContain("strip one");
    expect(out.text).toContain("strip two");
    expect(out.text.match(/one shared overlap sequence words here/g)?.length).toBe(1);
    expect(out.billedPages).toBe(provider.calls);
  });
});
