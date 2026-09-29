import { useState } from "react";
import { getTestTheme, saveTestTheme, type TestTheme } from "../lib/testTheme";
import "../styles/test-session.css";

export default function TestThemeToggle() {
  const [theme, setTheme] = useState<TestTheme>(getTestTheme);

  function choose(next: TestTheme) {
    setTheme(next);
    saveTestTheme(next);
  }

  return (
    <button
      type="button"
      className="test-theme-toggle"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label={`Theme: ${theme === "bluebook" ? "Official Bluebook" : "Dark Mode"}. Activate to switch themes.`}
      onClick={() => choose(theme === "bluebook" ? "dark" : "bluebook")}
    >
      <span className="test-theme-label">Theme</span>
      <strong>{theme === "bluebook" ? "Official Bluebook" : "Dark Mode"}</strong>
      <span className="test-theme-switch-indicator" aria-hidden="true"><i /></span>
    </button>
  );
}
