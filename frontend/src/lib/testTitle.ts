export const EXPECTED_MODULE_COUNTS: Record<string, number> = {
  "Reading and Writing Module 1": 27,
  "Reading and Writing Module 2": 27,
  "Math Module 1": 22,
  "Math Module 2": 22,
};

export function isExpectedModule(name: string): boolean {
  return name in EXPECTED_MODULE_COUNTS;
}

/**
 * Turn a SAT PDF filename into a polished test title, e.g.
 *   202604int1.pdf   -> "2026 April Int 1"
 *   202408asia2.pdf  -> "2024 August Int 2"
 *   202408usv2.pdf   -> "2024 August US 2"
 * Unknown shapes fall back to the filename without the .pdf suffix.
 */
export function polishTestTitle(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").trim();
  if (/^\d{4}\s+[A-Za-z]+\s+(Int|US)\s+\d{1,3}$/.test(base)) return base;
  const m = base.match(/^[^a-z0-9]*(\d{4})[^0-9]{0,2}(\d{2})[^0-9]{0,2}(int|asia|us|usa)[_ .\-,]?v?(\d{0,3})$/i);
  if (!m) return base;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return base;
  const monthName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const variant = /^us$/i.test(m[3]) ? "US" : "Int";
  return `${m[1]} ${monthName} ${variant}${m[4] ? ` ${m[4]}` : ""}`;
}

export function moduleTag(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const m = fullName.match(/^(reading\s*(?:and|&)?\s*writing|math)\s+module\s+(\d+)$/i);
  if (!m) return fullName;
  return `${m[1] === "Math" || m[1].toLowerCase() === "math" ? "Math" : "R&W"} M${m[2]}`;
}