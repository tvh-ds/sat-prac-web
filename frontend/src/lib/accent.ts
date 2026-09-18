export type Accent = "gold" | "silver" | "emerald" | "crimson";

const STORAGE_KEY = "sat-accent";
const VALID: Accent[] = ["gold", "silver", "emerald", "crimson"];

export function getAccent(): Accent {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (VALID as string[]).includes(v)) return v as Accent;
  } catch { /* ignore */ }
  return "gold";
}

export function applyAccent(a: Accent) {
  document.documentElement.dataset.accent = a;
  try { localStorage.setItem(STORAGE_KEY, a); } catch { /* ignore */ }
}

import { useCallback, useEffect, useState } from "react";

export function useAccent() {
  const [accent, setAccent] = useState<Accent>(getAccent);
  useEffect(() => { applyAccent(accent); }, [accent]);
  const set = useCallback((a: Accent) => setAccent(a), []);
  return { accent, setAccent: set };
}
