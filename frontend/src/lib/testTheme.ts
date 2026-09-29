export type TestTheme = "bluebook" | "dark";

const STORAGE_KEY = "grit-test-theme";

export function getTestTheme(): TestTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "bluebook") return saved;
  } catch {
    // Keep the official style as the first-use default when storage is unavailable.
  }
  return "bluebook";
}

export function saveTestTheme(theme: TestTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The session can still use the selected theme for this page load.
  }
}
