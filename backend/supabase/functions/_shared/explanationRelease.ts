const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Evaluate on the server when a report is read: no scheduled job or student
// activity is needed, and existing completed attempts qualify immediately.
export function explanationsAvailable(
  submittedAt: string | null,
  manuallyReleasedAt: string | null,
  now = Date.now(),
): boolean {
  if (manuallyReleasedAt != null) return true;
  if (!submittedAt) return false;
  const submitted = Date.parse(submittedAt);
  return Number.isFinite(submitted) && now - submitted >= SEVEN_DAYS_MS;
}
