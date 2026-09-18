import { useAccent } from "../lib/accent";

// Hidden from all shells (gold-only lock). Kept so the file stays valid;
// the silver try-both preview uses ?theme=silver instead.
const OPTIONS: Array<{ id: string; label: string; title: string }> = [
  { id: "gold", label: "Gold", title: "Champagne Gold" },
];

export default function AccentSwitcher({ size = 22 }: { size?: number }) {
  const { accent, setAccent } = useAccent();
  return (
    <div className="accent-switcher" role="radiogroup" aria-label="Accent color">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={accent === o.id}
          aria-label={o.title}
          title={o.title}
          className={`accent-dot ${o.id}${accent === o.id ? " active" : ""}`}
          style={{ width: size, height: size }}
          onClick={() => setAccent("gold")}
        />
      ))}
    </div>
  );
}
