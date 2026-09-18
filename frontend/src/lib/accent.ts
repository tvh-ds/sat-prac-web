export type Accent = "gold";

const STORAGE_KEY = "sat-accent";

// Gold-only lock: the accent switcher is hidden and the theme is fixed to
// champagne gold. The silver try-both preview uses data-theme-variant instead.
export function getAccent(): Accent {
  return "gold";
}

export function applyAccent(_a: Accent) {
  document.documentElement.dataset.accent = "gold";
  try { localStorage.setItem(STORAGE_KEY, "gold"); } catch { /* ignore */ }
}

import { useCallback, useEffect, useState } from "react";

export function useAccent() {
  const [accent] = useState<Accent>("gold");
  useEffect(() => { applyAccent("gold"); }, []);
  const set = useCallback((_a: Accent) => undefined, []);
  return { accent, setAccent: set };
}
