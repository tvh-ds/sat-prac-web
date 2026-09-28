import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui";

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const profile = await signIn(email.trim(), password);
      navigate(profile?.role === "admin" ? "/admin/students" : "/student", { replace: true });
    } catch (err) {
      const raw = (err instanceof Error ? err.message : "").toLowerCase();
      if (/fetch|network|connection/.test(raw)) {
        setError("We couldn’t connect. Check your internet connection and try again.");
      } else if (/invalid.*credentials|invalid.*password/.test(raw)) {
        setError("The email or password is incorrect. Check your details and try again.");
      } else if (/rate|too many/.test(raw)) {
        setError("Too many sign-in attempts. Wait a moment, then try again.");
      } else if (raw.includes("email not confirmed")) {
        setError("Your account isn’t ready yet. Contact your administrator for help.");
      } else {
        setError("We couldn’t sign you in. Try again, or contact your administrator if it continues.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grit-login">
      <div className="grit-login-layout">
        <section className="login-editorial" aria-label="The Grit overview">
          <div className="login-brand-row">
            <span className="login-wordmark">the Grit</span>
          </div>

          <div className="login-hero-copy">
            <h1>
              <span className="login-sr-only">Outwork the test.</span>
              <span className="login-headline-visual" aria-hidden="true">
                <span className="login-headline-line">Outwork</span>
                <span className="login-headline-line login-headline-ending">
                  <span>the</span>{" "}
                  <span className="login-word-slot">
                    <span className="login-word login-word-test">test.</span>
                    <span className="login-word login-word-rest">rest.</span>
                  </span>
                </span>
              </span>
            </h1>
            <p>Your all-in-one SAT platform</p>
          </div>

          <ul className="login-feature-strip" aria-label="Practice features">
            <li>Full-length tests</li>
            <li>Focused practice</li>
            <li>Vocabulary review</li>
          </ul>
        </section>

        <section className="login-panel-shell" aria-labelledby="login-heading">
          <form className="login-card" onSubmit={onSubmit} aria-busy={busy}>
            <p className="login-member-access">Member Access</p>
            <h2 id="login-heading">Welcome back</h2>
            <p className="login-description">Sign in to continue your practice.</p>
            {error && <div id="login-error" className="login-error" role="alert">{error}</div>}
            <div className="login-fields">
              <div>
                <label className="field-label" htmlFor="login-email">Email</label>
                <input id="login-email" name="email" className="input" type="email"
                  autoComplete="username" autoCapitalize="none" spellCheck={false}
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required placeholder="you@example.com" readOnly={busy}
                  aria-describedby={error ? "login-error" : undefined} />
              </div>
              <div>
                <label className="field-label" htmlFor="login-password">Password</label>
                <div className="login-password-field">
                  <input id="login-password" name="password" className="input"
                    type={showPassword ? "text" : "password"} autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    required placeholder="Enter your password" readOnly={busy}
                    aria-describedby={error ? "login-error" : undefined} />
                  <button className="login-password-toggle" type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-controls="login-password" aria-pressed={showPassword}
                    onClick={() => setShowPassword((shown) => !shown)}>
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <Button type="submit" size="lg" disabled={busy} className="login-submit">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </div>
            <span className="login-sr-only" role="status" aria-live="polite">{busy ? "Signing in. Please wait." : ""}</span>
            <p className="login-account-note">Secure access for students and tutors.</p>
          </form>
        </section>
      </div>
    </main>
  );
}
