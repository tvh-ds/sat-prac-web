import { useTheme, type Theme } from "../lib/theme";

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      className={`theme-toggle${dark ? " dark" : ""}`}
      onClick={toggle}
      role="switch"
      aria-checked={dark}
      aria-label="Toggle dark mode"
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span className="theme-toggle-knob">
        {dark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}

export type { Theme };
