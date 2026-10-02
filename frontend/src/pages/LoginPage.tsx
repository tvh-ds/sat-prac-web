import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui";
import AuthLayout from "../components/AuthLayout";

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
    <AuthLayout>
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
            <p className="login-account-note">Don't have an account? <Link className="auth-link" to="/signup">Sign up</Link></p>
          </form>
        </section>
    </AuthLayout>
  );
}
