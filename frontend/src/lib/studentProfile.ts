export function validZaloPhone(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 30 && /^\+?[\d\s().-]+$/.test(trimmed) && (trimmed.match(/\d/g)?.length ?? 0) >= 8;
}
