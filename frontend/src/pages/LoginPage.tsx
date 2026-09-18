import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui";

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const profile = await signIn(email, password);
      navigate(profile?.role === "admin" ? "/admin" : "/student", { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Sign in failed";
      if (raw.toLowerCase().includes("failed to fetch") || raw.toLowerCase().includes("networkerror") || raw.toLowerCase().includes("fetch")) {
        setError(`Cannot reach Supabase at ${import.meta.env.VITE_SUPABASE_URL}. Check the network and project status.`);
      } else {
        setError(raw);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-orb" />
      <form className="login-card" onSubmit={onSubmit}>
        <div className="section-label" style={{ textAlign: "center", marginBottom: 8 }}>[ SAT PRACTICE ]</div>
        <div className="brand">SAT Practice</div>
        <div className="sub">Bluebook-inspired · practice only</div>
        {error && <div className="login-error">{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="field-label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required placeholder="you@school.edu" />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <Button type="submit" size="lg" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Signing in…" : "Sign in →"}
          </Button>
          <p className="arch-meta" style={{ textAlign: "center", marginTop: 8 }}>SYS // AUTH v2.4 // SECURE SESSION // 256-BIT</p>
        </div>
      </form>
    </div>
  );
}
