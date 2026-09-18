import { Path2D } from "@napi-rs/canvas";

class PdfDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number } | null) {
    if (Array.isArray(init)) {
      if (init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init.map((n) => Number(n)) as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
      }
    } else if (init && typeof init === "object") {
      this.a = init.a ?? 1;
      this.b = init.b ?? 0;
      this.c = init.c ?? 0;
      this.d = init.d ?? 1;
      this.e = init.e ?? 0;
      this.f = init.f ?? 0;
    }
  }

  invertSelf(): this {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) return this;
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }

  multiplySelf(other: { a: number; b: number; c: number; d: number; e: number; f: number }): this {
    const { a, b, c, d, e, f } = this;
    this.a = a * other.a + c * other.b;
    this.b = b * other.a + d * other.b;
    this.c = a * other.c + c * other.d;
    this.d = b * other.c + d * other.d;
    this.e = a * other.e + c * other.f + e;
    this.f = b * other.e + d * other.f + f;
    return this;
  }
}

let installed = false;

export function installPdfGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  g.Path2D = Path2D;
  g.DOMMatrix = PdfDOMMatrix;
}