import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Button, Pill, Spinner } from "../../components/ui";
import { fnJson, getToken } from "../../lib/supabase";
import { validZaloPhone } from "../../lib/studentProfile";
import "../../styles/student-profile.css";

interface ProfileForm {
  full_name: string;
  phone_number: string;
  parent_name: string;
  parent_phone_number: string;
}

export default function StudentProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [form, setForm] = useState<ProfileForm>({
    full_name: "",
    phone_number: "",
    parent_name: "",
    parent_phone_number: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      full_name: profile?.full_name ?? "",
      phone_number: profile?.phone_number ?? "",
      parent_name: profile?.parent_name ?? "",
      parent_phone_number: profile?.parent_phone_number ?? "",
    });
  }, [profile]);

  if (!profile) return <Spinner />;

  const status = profile.profile_status ?? "incomplete";
  const setField = (field: keyof ProfileForm, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setNotice(null);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!form.full_name.trim() || !form.parent_name.trim() || !form.phone_number.trim() || !form.parent_phone_number.trim()) {
      setError("Complete all four required fields before submitting.");
      return;
    }
    if (!validZaloPhone(form.phone_number) || !validZaloPhone(form.parent_phone_number)) {
      setError("Enter valid Zalo phone numbers with at least eight digits.");
      return;
    }

    setBusy(true);
    try {
      const token = await getToken();
      const result = await fnJson<{ profile_status: "pending" | "approved" }>("student-profile", {
        method: "POST",
        token,
        body: {
          full_name: form.full_name.trim(),
          phone_number: form.phone_number.trim(),
          parent_name: form.parent_name.trim(),
          parent_phone_number: form.parent_phone_number.trim(),
        },
      });
      await refreshProfile();
      setNotice(result.profile_status === "approved"
        ? "Your approved profile is up to date."
        : "Profile submitted. Study sections unlock after an administrator approves it.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit your profile.");
    } finally {
      setBusy(false);
    }
  }

  const statusText = status === "approved" ? "Approved" : status === "pending" ? "Awaiting approval" : "Setup required";
  const statusTone = status === "approved" ? "green" : status === "pending" ? "amber" : "gray";

  return (
    <main className="student-profile-page">
      <header className="student-profile-heading">
        <div>
          <h1 className="page-title">Your profile</h1>
          <p className="page-sub">Add and edit your contact details</p>
        </div>
        <Pill tone={statusTone}>{statusText}</Pill>
      </header>

      {status === "incomplete" && (
        <div className="student-profile-notice" role="status">
          Complete every required field and submit the profile for administrator approval. Your study areas will unlock after approval.
        </div>
      )}

      <form className="student-profile-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="student-profile-fields">
          <div className="student-profile-field">
            <label className="field-label" htmlFor="student-full-name">Student full name <span aria-hidden="true">*</span></label>
            <input id="student-full-name" className="input" autoComplete="name" maxLength={200} required value={form.full_name} onChange={(event) => setField("full_name", event.target.value)} />
          </div>
          <div className="student-profile-field">
            <label className="field-label" htmlFor="student-zalo-phone">Student phone number (Zalo) <span aria-hidden="true">*</span></label>
            <input id="student-zalo-phone" className="input" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} required value={form.phone_number} onChange={(event) => setField("phone_number", event.target.value)} placeholder="+84 …" />
          </div>
          <div className="student-profile-field">
            <label className="field-label" htmlFor="parent-full-name">Parent / guardian full name <span aria-hidden="true">*</span></label>
            <input id="parent-full-name" className="input" autoComplete="off" maxLength={200} required value={form.parent_name} onChange={(event) => setField("parent_name", event.target.value)} />
          </div>
          <div className="student-profile-field">
            <label className="field-label" htmlFor="parent-zalo-phone">Parent / guardian phone number (Zalo) <span aria-hidden="true">*</span></label>
            <input id="parent-zalo-phone" className="input" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} required value={form.parent_phone_number} onChange={(event) => setField("parent_phone_number", event.target.value)} placeholder="+84 …" />
          </div>
        </div>
        <p className="student-profile-privacy">Contact details are visible to tutors and are used for student and parent communication.</p>
        {error && <div className="login-error" role="alert">{error}</div>}
        {notice && <div className="student-profile-success" role="status">{notice}</div>}
        <div className="student-profile-submit">
          <Button type="submit" disabled={busy}>
            {busy ? "Submitting…" : status === "approved" ? "Submit profile changes" : status === "pending" ? "Update and resubmit" : "Submit for approval"}
          </Button>
        </div>
      </form>
    </main>
  );
}
