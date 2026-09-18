import { useAccent, type Accent } from "../lib/accent";

const OPTIONS: Array<{ id: Accent; label: string; title: string }> = [
  { id: "gold", label: "Gold", title: "Amber / Gold" },
  { id: "silver", label: "Silver", title: "Silver / Platinum" },
  { id: "emerald", label: "Emerald", title: "Emerald / Jade" },
  { id: "crimson", label: "Crimson", title: "Crimson / Rose" },
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
          onClick={() => setAccent(o.id)}
        />
      ))}
    </div>
  );
}
