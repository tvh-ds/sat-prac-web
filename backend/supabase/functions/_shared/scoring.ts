export function normalizeMathAnswer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // strip commas from thousands separators
  s = s.replace(/,/g, "");
  // handle fraction forms "a/b" by evaluating if both parts are numeric
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const num = parseFloat(frac[1]);
    const den = parseFloat(frac[2]);
    if (den === 0 || !Number.isFinite(num) || !Number.isFinite(den)) return null;
    return String(Math.round((num / den) * 1e6) / 1e6);
  }
  const num = parseFloat(s);
  if (Number.isFinite(num)) return String(Math.round(num * 1e6) / 1e6);
  return s;
}

export function answersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const na = normalizeMathAnswer(a);
  const nb = normalizeMathAnswer(b);
  return na !== null && na === nb;
}