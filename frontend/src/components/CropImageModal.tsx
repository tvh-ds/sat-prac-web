import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "./ui";

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode =
  | { kind: "draw"; sx: number; sy: number }
  | { kind: "move"; sx: number; sy: number; orig: CropRect }
  | { kind: "resize"; sx: number; sy: number; orig: CropRect; handle: Handle };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];

const CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

function handlePoints(r: CropRect): Record<Handle, [number, number]> {
  return {
    nw: [r.x, r.y],
    n: [r.x + r.w / 2, r.y],
    ne: [r.x + r.w, r.y],
    e: [r.x + r.w, r.y + r.h / 2],
    se: [r.x + r.w, r.y + r.h],
    s: [r.x + r.w / 2, r.y + r.h],
    sw: [r.x, r.y + r.h],
    w: [r.x, r.y + r.h / 2],
  };
}

function clampRect(r: CropRect, W: number, H: number, MIN = 16): CropRect {
  let { x, y, w, h } = r;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  x = Math.max(0, Math.min(x, W - MIN));
  y = Math.max(0, Math.min(y, H - MIN));
  w = Math.min(Math.max(w, MIN), W - x);
  h = Math.min(Math.max(h, MIN), H - y);
  return { x, y, w, h };
}

export function CropImageModal({
  src,
  title,
  onCancel,
  onSave,
}: {
  src: string;
  title: string;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [view, setView] = useState({ w: 800, h: 460 });
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [cursor, setCursor] = useState("crosshair");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const natural = img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  const scale = natural && natural.w > 0 && natural.h > 0 ? Math.min(view.w / natural.w, view.h / natural.h) : 1;
  const stageW = natural ? natural.w * scale : 0;
  const stageH = natural ? natural.h * scale : 0;

  useEffect(() => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.onerror = () => setError("Failed to load the stimulus image for editing.");
    el.src = src;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [src]);

  useEffect(() => {
    const measure = () => {
      const n = viewRef.current?.getBoundingClientRect();
      if (n && n.width > 10 && n.height > 10) setView({ w: n.width, h: n.height });
    };
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (img && !crop) {
      const w = img.naturalWidth * 0.55;
      const h = img.naturalHeight * 0.4;
      setCrop({ x: (img.naturalWidth - w) / 2, y: (img.naturalHeight - h) / 2, w, h });
    }
  }, [img]);

  useEffect(() => {
    const cv = previewRef.current;
    if (!cv || !img || !crop) return;
    const MAX = 480;
    const s = Math.min(1, MAX / Math.max(crop.w, crop.h));
    cv.width = Math.max(1, Math.round(crop.w * s));
    cv.height = Math.max(1, Math.round(crop.h * s));
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cv.width, cv.height);
  }, [crop, img]);

  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const r = stageRef.current?.getBoundingClientRect();
      if (!r || !natural) return { x: 0, y: 0 };
      return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
    },
    [natural, scale],
  );

  const handleAt = useCallback(
    (ix: number, iy: number): Handle | null => {
      if (!crop) return null;
      const RADIUS = 14;
      const pts = handlePoints(crop);
      for (const h of HANDLES) {
        const [hx, hy] = pts[h];
        if (Math.hypot(ix - hx, iy - hy) <= RADIUS) return h;
      }
      return null;
    },
    [crop],
  );

  function inside(ix: number, iy: number): boolean {
    if (!crop) return false;
    return ix >= crop.x && ix <= crop.x + crop.w && iy >= crop.y && iy <= crop.y + crop.h;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!natural || !img) return;
    e.preventDefault();
    const { x: ix, y: iy } = toImage(e.clientX, e.clientY);
    const h = handleAt(ix, iy);
    if (h && crop) {
      dragRef.current = { kind: "resize", sx: ix, sy: iy, orig: crop, handle: h };
    } else if (inside(ix, iy) && crop) {
      dragRef.current = { kind: "move", sx: ix, sy: iy, orig: crop };
    } else {
      dragRef.current = { kind: "draw", sx: ix, sy: iy };
      setCrop({ x: ix, y: iy, w: 0, h: 0 });
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!natural || !img) return;
    const { x: ix, y: iy } = toImage(e.clientX, e.clientY);
    if (d) {
      if (d.kind === "draw") {
        setCrop(clampRect({ x: d.sx, y: d.sy, w: ix - d.sx, h: iy - d.sy }, natural.w, natural.h));
      } else if (d.kind === "move") {
        setCrop(clampRect({ x: d.orig.x + (ix - d.sx), y: d.orig.y + (iy - d.sy), w: d.orig.w, h: d.orig.h }, natural.w, natural.h));
      } else {
        const o = d.orig;
        let { x, y, w, h } = { x: o.x, y: o.y, w: o.w, h: o.h };
        if (d.handle.includes("w")) {
          w = o.x + o.w - ix;
          x = ix;
        }
        if (d.handle.includes("e")) w = ix - o.x;
        if (d.handle.includes("n")) {
          h = o.y + o.h - iy;
          y = iy;
        }
        if (d.handle.includes("s")) h = iy - o.y;
        setCrop(clampRect({ x, y, w, h }, natural.w, natural.h));
      }
      return;
    }
    const h = handleAt(ix, iy);
    setCursor(h ? CURSORS[h] : inside(ix, iy) ? "move" : "crosshair");
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function handleSave() {
    if (!img || !crop) return;
    setSaving(true);
    setError(null);
    try {
      const cap = 2000;
      const s = Math.min(1, cap / Math.max(crop.w, crop.h));
      const cw = Math.max(1, Math.round(crop.w * s));
      const ch = Math.max(1, Math.round(crop.h * s));
      const cv = document.createElement("canvas");
      cv.width = cw;
      cv.height = ch;
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("Canvas is not supported in this browser");
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
      const blob = await new Promise<Blob | null>((res) => {
        try {
          cv.toBlob(res, "image/png");
        } catch {
          res(null);
        }
      });
      if (!blob) throw new Error("Failed to encode the cropped image. If it is cross-origin, try again after reloading the page.");
      await onSave(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crop failed");
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={saving ? () => {} : onCancel}
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={saving || !crop} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save Crop"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="login-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div
          ref={viewRef}
          style={{
            flex: "1 1 320px",
            height: 460,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: 8,
            background: "var(--panel-alt, #11161c)",
            border: "1px solid var(--border)",
          }}
        >
          {img && natural ? (
            <div
              ref={stageRef}
              style={{
                position: "relative",
                width: stageW,
                height: stageH,
                touchAction: "none",
                cursor,
                userSelect: "none",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <img src={src} crossOrigin="anonymous" width={stageW} height={stageH} alt="Source" draggable={false} style={{ display: "block", userSelect: "none" }} />
              {crop && (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: crop.x * scale,
                      top: crop.y * scale,
                      width: crop.w * scale,
                      height: crop.h * scale,
                      border: "2px solid var(--accent, #4f8cff)",
                      boxSizing: "border-box",
                      pointerEvents: "none",
                      boxShadow: "0 0 0 9999px rgba(8, 12, 16, 0.55)",
                    }}
                  />
                  {HANDLES.map((h) => {
                    const [hx, hy] = handlePoints(crop)[h];
                    return (
                      <div
                        key={h}
                        style={{
                          position: "absolute",
                          left: hx * scale - 5,
                          top: hy * scale - 5,
                          width: 10,
                          height: 10,
                          background: "var(--accent, #4f8cff)",
                          border: "1px solid #fff",
                          borderRadius: 2,
                          pointerEvents: "none",
                        }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          ) : (
            <p className="muted">Loading image…</p>
          )}
        </div>
        <div style={{ width: 220, flexShrink: 0 }}>
          <label className="field-label">
            Preview{" "}
            {crop && (
              <span className="muted" style={{ fontWeight: 400 }}>
                {Math.round(crop.w)} × {Math.round(crop.h)} px
              </span>
            )}
          </label>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 160, border: "1px solid var(--border)", borderRadius: 8, background: "var(--passage-bg)", overflow: "hidden" }}>
            <canvas ref={previewRef} style={{ maxWidth: "100%", maxHeight: 320, display: "block", objectFit: "contain" }} />
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Drag on the image to select the graph or table. Drag inside the box to move it; use the corner/edge handles to resize.
          </p>
        </div>
      </div>
    </Modal>
  );
}