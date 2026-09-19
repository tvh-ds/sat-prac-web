import { describe, it, expect } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  visualsToNormBoxes,
  normalizedToPixels,
  padRect,
  unionRects,
  rectAreaFrac,
  clusterRects,
  decideCrop,
  cropPng,
  inkRatio,
  detectFigureBoxes,
  CROP_MIN_INK,
  type NormBox,
} from "../src/cropStimulus";

/** White 1000x1400 page with a black "figure" rect drawn on it. */
async function figurePage(fig = { x: 100, y: 300, w: 800, h: 500 }): Promise<Buffer> {
  const canvas = createCanvas(1000, 1400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1000, 1400);
  ctx.fillStyle = "#000000";
  ctx.fillRect(fig.x, fig.y, fig.w, fig.h);
  return Buffer.from(await canvas.encode("png"));
}

describe("visualsToNormBoxes", () => {
  it("prefers normalized boxes and drops invalid ones", () => {
    const boxes = visualsToNormBoxes([
      { kind: "image", description: "chart", category: null, bbox: null, bboxNormalized: { topLeftX: 0.1, topLeftY: 0.2, bottomRightX: 0.9, bottomRightY: 0.6 } },
      { kind: "image", description: "bad", category: null, bbox: null, bboxNormalized: { topLeftX: 0.5, topLeftY: 0.5, bottomRightX: 0.5, bottomRightY: 0.5 } },
      { kind: "table", description: null, category: null, bbox: null, bboxNormalized: null },
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual({ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.6 });
  });

  it("falls back to pixel boxes with fitted dims", () => {
    const boxes = visualsToNormBoxes(
      [{ kind: "image", description: null, category: null, bbox: { topLeftX: 100, topLeftY: 200, bottomRightX: 900, bottomRightY: 600 }, bboxNormalized: null }],
      1000,
      1000,
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x1).toBeCloseTo(0.1);
    expect(boxes[0]!.y2).toBeCloseTo(0.6);
  });
});

describe("normalizedToPixels + padRect", () => {
  it("maps fractions to integer pixels", () => {
    expect(normalizedToPixels({ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.6 }, 1000, 1400)).toEqual({ x: 100, y: 280, w: 800, h: 560 });
  });

  it("pads and clamps to page bounds", () => {
    // Box touching the top-left corner: padding clamps, never negative.
    expect(padRect({ x: 0, y: 0, w: 100, h: 100 }, 0.05, 1000, 1400)).toEqual({ x: 0, y: 0, w: 150, h: 170 });
    // Interior box grows on all sides.
    expect(padRect({ x: 400, y: 600, w: 200, h: 200 }, 0.05, 1000, 1400)).toEqual({ x: 350, y: 530, w: 300, h: 340 });
  });
});

describe("unionRects + rectAreaFrac + clusterRects", () => {
  it("unions to the bounding rect", () => {
    expect(
      unionRects([
        { x: 10, y: 10, w: 100, h: 100 },
        { x: 200, y: 50, w: 60, h: 300 },
      ]),
    ).toEqual({ x: 10, y: 10, w: 250, h: 340 });
    expect(unionRects([])).toBeNull();
  });

  it("computes page-area fraction", () => {
    expect(rectAreaFrac({ x: 0, y: 0, w: 500, h: 700 }, 1000, 1400)).toBeCloseTo(0.25);
  });

  it("merges near boxes, keeps distant clusters apart", () => {
    const near = clusterRects(
      [
        { x: 10, y: 10, w: 100, h: 100 },
        { x: 120, y: 10, w: 100, h: 100 },
      ],
      30,
    );
    expect(near).toHaveLength(1);
    const far = clusterRects(
      [
        { x: 10, y: 10, w: 100, h: 100 },
        { x: 800, y: 1000, w: 100, h: 100 },
      ],
      30,
    );
    expect(far).toHaveLength(2);
  });
});

describe("decideCrop", () => {
  const W = 1000;
  const H = 1400;

  it("crops a sane single box with padding", () => {
    const d = decideCrop([{ x1: 0.1, y1: 0.3, x2: 0.9, y2: 0.7 }], W, H);
    expect(d.kind).toBe("crop");
    if (d.kind === "crop") {
      // 800x560 box + 3.5% padding each side => 870 x 658.
      expect(d.rect).toEqual({ x: 65, y: 371, w: 870, h: 658 });
    }
  });

  it("falls back on no boxes, tiny boxes, full-page boxes, multi-cluster", () => {
    expect(decideCrop([], W, H)).toEqual({ kind: "fallback", reason: "no-boxes" });
    expect(decideCrop([{ x1: 0.5, y1: 0.5, x2: 0.51, y2: 0.51 }], W, H)).toEqual({ kind: "fallback", reason: "too-small" });
    expect(decideCrop([{ x1: 0, y1: 0, x2: 1, y2: 1 }], W, H)).toEqual({ kind: "fallback", reason: "full-page-better" });
    const two: NormBox[] = [
      { x1: 0.05, y1: 0.05, x2: 0.3, y2: 0.3 },
      { x1: 0.7, y1: 0.7, x2: 0.95, y2: 0.95 },
    ];
    expect(decideCrop(two, W, H)).toEqual({ kind: "fallback", reason: "multi-cluster" });
  });

  it("unions adjacent panels into one crop", () => {
    const panels: NormBox[] = [
      { x1: 0.1, y1: 0.2, x2: 0.45, y2: 0.6 },
      { x1: 0.47, y1: 0.2, x2: 0.9, y2: 0.6 },
    ];
    const d = decideCrop(panels, W, H);
    expect(d.kind).toBe("crop");
  });
});

describe("detectFigureBoxes", () => {
  /** Page with one dense figure + thin fake text lines elsewhere. */
  async function textyPage(): Promise<Buffer> {
    const canvas = createCanvas(1000, 1400);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1000, 1400);
    ctx.fillStyle = "#000000";
    for (let y = 60; y < 260; y += 34) ctx.fillRect(80, y, 840, 7); // fake text lines
    ctx.fillRect(100, 500, 800, 500); // dense figure
    for (let y = 1080; y < 1300; y += 34) ctx.fillRect(80, y, 840, 7);
    return Buffer.from(await canvas.encode("png"));
  }

  it("finds the figure and ignores text lines", async () => {
    const boxes = await detectFigureBoxes(await textyPage());
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    const fig = boxes[0]!;
    // Figure spans x 100..900, y 500..1000 on a 1000x1400 page.
    expect(fig.x1).toBeLessThan(0.15);
    expect(fig.x2).toBeGreaterThan(0.85);
    expect(fig.y1).toBeLessThan(0.4);
    expect(fig.y2).toBeGreaterThan(0.68);
  });

  it("returns nothing for a blank page", async () => {
    const canvas = createCanvas(400, 500);
    canvas.getContext("2d").fillStyle = "#ffffff";
    canvas.getContext("2d").fillRect(0, 0, 400, 500);
    const boxes = await detectFigureBoxes(Buffer.from(await canvas.encode("png")));
    expect(boxes).toHaveLength(0);
  });
});
describe("cropPng + inkRatio", () => {
  it("cuts exact pixel dims from a synthetic figure page", async () => {
    const page = await figurePage();
    const out = await cropPng(page, { x: 100, y: 300, w: 800, h: 500 });
    const img = await loadImage(out);
    expect(img.width).toBe(800);
    expect(img.height).toBe(500);
  });

  it("separates figure crops from blank areas by ink", async () => {
    const page = await figurePage();
    const figure = await cropPng(page, { x: 100, y: 300, w: 800, h: 500 });
    const blank = await cropPng(page, { x: 100, y: 1000, w: 800, h: 200 });
    expect(await inkRatio(figure)).toBeGreaterThan(0.5);
    expect(await inkRatio(blank)).toBeLessThan(CROP_MIN_INK);
  });
});
