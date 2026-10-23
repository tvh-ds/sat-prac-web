// Return only to supported local admin views, never a supplied external URL.
export function adminReturnPath(value: string | null, fallback: string): string {
  return value && /^\/admin\/(classes|students|assignments)([/?]|$)/.test(value) && !value.includes("\\") ? value : fallback;
}
