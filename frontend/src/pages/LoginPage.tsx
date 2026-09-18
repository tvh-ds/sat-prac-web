import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui";
import { BookOpenCheck, ShieldCheck, TimerReset } from "lucide-react";

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
    <div className="premium-login">
      <section className="login-editorial" aria-label="SAT Practice overview">
        <div className="login-brand-row">
          <span className="login-brand-mark">S</span>
          <span>SAT Practice</span>
        </div>

        <div className="login-hero-copy">
          <div className="hero-badge"><span className="hero-badge-dot" /> Practice environment online</div>
          <h1>Timed practice with a quieter room around it.</h1>
          <p>
            A premium workspace for full-length tests, focused practice, vocabulary review, and admin oversight.
            Students get the exam flow. Teachers get the control room.
          </p>
        </div>

        <div className="login-proof-row" aria-label="Platform strengths">
          <div className="login-proof">
            <TimerReset size={18} strokeWidth={1.8} />
            <strong>Timed</strong>
            <span>Module pacing that stays out of the way.</span>
          </div>
          <div className="login-proof">
            <BookOpenCheck size={18} strokeWidth={1.8} />
            <strong>Reviewed</strong>
            <span>Question-level results and domain feedback.</span>
          </div>
          <div className="login-proof">
            <ShieldCheck size={18} strokeWidth={1.8} />
            <strong>Private</strong>
            <span>Role-based access for students and admins.</span>
          </div>
        </div>
      </section>

      <section className="login-panel-shell" aria-label="Sign in">
        <form className="login-card" onSubmit={onSubmit}>
          <div className="section-label" style={{ textAlign: "center", marginBottom: 8 }}>Member access</div>
          <div className="brand">Welcome back</div>
          <div className="sub">Sign in to continue your assigned tests, practice sets, and review work.</div>
          {error && <div className="login-error">{error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="field-label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@school.edu" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Password" />
            </div>
            <Button type="submit" size="lg" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <p className="arch-meta" style={{ textAlign: "center", marginTop: 8 }}>Secure access for assigned students and administrators.</p>
          </div>
        </form>
      </section>
    </div>
  );
}
