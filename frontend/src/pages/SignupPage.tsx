import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import AuthLayout from "../components/AuthLayout";
import { Button, Spinner } from "../components/ui";
import { fnJson, supabase } from "../lib/supabase";
import { validZaloPhone } from "../lib/studentProfile";

interface ContactDetails {
  full_name: string;
  phone_number: string;
  parent_name: string;
  parent_phone_number: string;
}

function signupError(reason: unknown): string {
  const message = (reason instanceof Error ? reason.message : "").toLowerCase();
  if (/already.*registered|already.*exists|user_already_exists/.test(message)) return "An account with this email already exists. Sign in to continue.";
  if (/fetch|network|connection/.test(message)) return "We couldn’t connect. Check your internet connection and try again.";
  if (/rate|too many|over.*limit/.test(message)) return "Too many attempts. Wait a moment, then try again.";
  if (/password|weak/.test(message)) return "Choose a stronger password with at least eight characters.";
  if (/email.*invalid|invalid.*email/.test(message)) return "Enter a valid email address.";
  return "We couldn’t create your account. Try again, or contact your administrator if it continues.";
}

export default function SignupPage() {
  const { loading, user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [contacts, setContacts] = useState<ContactDetails>({ full_name: "", phone_number: "", parent_name: "", parent_phone_number: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountCreated, setAccountCreated] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const started = useRef(false);
  const inFlight = useRef(false);
  const accountId = useRef<string | null>(null);
  const errorBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(null);
    const details = Object.fromEntries(Object.entries(contacts).map(([key, value]) => [key, value.trim()])) as unknown as ContactDetails;
    if (!submitted && (!details.full_name || !details.parent_name || !validZaloPhone(details.phone_number) || !validZaloPhone(details.parent_phone_number))) {
      setError("Complete both names and enter valid Zalo phone numbers with at least eight digits.");
      return;
    }
    inFlight.current = true;
    started.current = true;
    setBusy(true);
    let stage: "account" | "profile" = accountId.current ? "profile" : "account";
    try {
      if (!accountId.current) {
        const { data, error: signupFailure } = await supabase.auth.signUp({
          email: email.trim(), password, options: { data: { full_name: details.full_name } },
        });
        if (signupFailure) throw signupFailure;
        if (!data.user || data.user.identities?.length === 0) throw new Error("User already registered");
        accountId.current = data.user.id;
        setAccountCreated(true);
        setPassword("");
        stage = "profile";
        if (!data.session) throw new Error("No signup session");
      }
      if (!submitted) {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !data.session || data.session.user.id !== accountId.current) {
          throw new Error("No signup session");
        }
        const result = await fnJson<{ profile_status: "pending" | "approved" }>("student-profile", {
          method: "POST", token: data.session.access_token, body: details,
        });
        if (result.profile_status !== "pending" && result.profile_status !== "approved") throw new Error("Unexpected submission response");
        setSubmitted(true);
      }
      await refreshProfile();
      navigate("/student/profile", { replace: true });
    } catch (reason) {
      if (stage === "account") setError(signupError(reason));
      else if (reason instanceof Error && reason.message === "No signup session") setError("Your account was created, but we couldn’t continue your session. Return to Login, sign in, and submit your details from your profile. If you can’t sign in, contact your administrator.");
      else setError("Your account was created, but we couldn’t submit your details. Check your connection and retry, or sign in and complete your profile.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (loading && !started.current) return <Spinner />;
  if (user && !started.current) return <Navigate to={profile?.role === "admin" ? "/admin/students" : "/student/profile"} replace />;

  const setContact = (field: keyof ContactDetails, value: string) => setContacts((previous) => ({ ...previous, [field]: value }));
  return (
    <AuthLayout signup>
      <section className="login-panel-shell" aria-labelledby="signup-heading">
          <form className="login-card signup-card" onSubmit={(event) => void submit(event)} aria-busy={busy}>
            <h2 id="signup-heading">Create your account</h2>
            <p className="login-description">Submit your details for administrator approval to start practicing.</p>
            {error && <div id="signup-error" className="login-error" role="alert" ref={errorBox} tabIndex={-1}>{error}</div>}
            <fieldset className="signup-group" disabled={busy || accountCreated}>
              <legend>Account details</legend>
              <div className="signup-fields">
                <div>
                  <label className="field-label" htmlFor="signup-email">Email</label>
                  <input id="signup-email" name="email" className="input" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                </div>
                <div>
                  <label className="field-label" htmlFor="signup-password">Password</label>
                  <div className="login-password-field">
                    <input id="signup-password" name="password" className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required={!accountCreated} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={accountCreated ? "Password saved securely" : "At least 8 characters"} aria-describedby="signup-password-help" />
                    <button className="login-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="signup-password" aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </div>
                  <p className="signup-help" id="signup-password-help">Use at least 8 characters.</p>
                </div>
              </div>
            </fieldset>
            <fieldset className="signup-group" disabled={busy || submitted}>
              <legend>Student details</legend>
              <div className="signup-fields">
                <div>
                  <label className="field-label" htmlFor="signup-student-name">Student full name</label>
                  <input id="signup-student-name" name="full_name" className="input" autoComplete="name" maxLength={200} required value={contacts.full_name} onChange={(event) => setContact("full_name", event.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="signup-student-phone">Student phone number (Zalo)</label>
                  <input id="signup-student-phone" name="phone_number" className="input" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} required value={contacts.phone_number} onChange={(event) => setContact("phone_number", event.target.value)} placeholder="+84 …" />
                </div>
              </div>
            </fieldset>
            <fieldset className="signup-group" disabled={busy || submitted}>
              <legend>Parent / guardian details</legend>
              <div className="signup-fields">
                <div>
                  <label className="field-label" htmlFor="signup-parent-name">Parent / guardian full name</label>
                  <input id="signup-parent-name" name="parent_name" className="input" autoComplete="off" maxLength={200} required value={contacts.parent_name} onChange={(event) => setContact("parent_name", event.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="signup-parent-phone">Parent / guardian phone number (Zalo)</label>
                  <input id="signup-parent-phone" name="parent_phone_number" className="input" type="tel" autoComplete="off" inputMode="tel" maxLength={30} required value={contacts.parent_phone_number} onChange={(event) => setContact("parent_phone_number", event.target.value)} placeholder="+84 …" />
                </div>
              </div>
            </fieldset>
            <p className="signup-help signup-privacy">Contact details are visible to tutors and are used for student and parent communication.</p>
            <Button type="submit" size="lg" disabled={busy} className="login-submit signup-submit">{busy ? "Submitting…" : submitted ? "Continue to profile" : accountCreated ? "Retry submission" : "Submit for approval"}</Button>
            <span className="login-sr-only" role="status" aria-live="polite">{busy ? "Submitting. Please wait." : ""}</span>
            <p className="login-account-note">{accountCreated ? "Continue from your profile?" : "Already have an account?"} <Link className="auth-link" to="/login" aria-disabled={busy} onClick={(event) => { if (busy) event.preventDefault(); }}>Back to Login</Link></p>
          </form>
      </section>
    </AuthLayout>
  );
}
