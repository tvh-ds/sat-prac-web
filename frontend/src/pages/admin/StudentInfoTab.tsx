import { useEffect, useState, type FormEvent } from "react";
import { Button, Modal, Pill, fmtDate } from "../../components/ui";
import { fnJson, getToken } from "../../lib/supabase";

export interface AdminStudentInfo {
  id: string;
  email: string | null;
  full_name: string | null;
  phone_number: string | null;
  parent_name: string | null;
  parent_phone_number: string | null;
  profile_status: "incomplete" | "pending" | "approved" | null;
  profile_submitted_at: string | null;
  profile_approved_at: string | null;
  grade_level: string | null;
  school: string | null;
  created_at: string;
}

interface InfoForm {
  full_name: string;
  phone_number: string;
  parent_name: string;
  parent_phone_number: string;
}

function validPhone(value: string): boolean {
  return /^\+?[\d\s().-]+$/.test(value.trim()) && (value.match(/\d/g)?.length ?? 0) >= 8;
}

function hasRequiredInfo(form: InfoForm): boolean {
  return Boolean(
    form.full_name.trim() && form.parent_name.trim() &&
    validPhone(form.phone_number) && validPhone(form.parent_phone_number),
  );
}

function statusLabel(status: AdminStudentInfo["profile_status"]): string {
  if (status === "approved") return "Approved";
  if (status === "pending") return "Awaiting approval";
  return "Setup required";
}

function statusTone(status: AdminStudentInfo["profile_status"]): "green" | "amber" | "gray" {
  if (status === "approved") return "green";
  if (status === "pending") return "amber";
  return "gray";
}

export default function StudentInfoTab({
  student,
  onRefresh,
  onDeleted,
}: {
  student: AdminStudentInfo;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<InfoForm>({
    full_name: student.full_name ?? "",
    phone_number: student.phone_number ?? "",
    parent_name: student.parent_name ?? "",
    parent_phone_number: student.parent_phone_number ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    setForm({
      full_name: student.full_name ?? "",
      phone_number: student.phone_number ?? "",
      parent_name: student.parent_name ?? "",
      parent_phone_number: student.parent_phone_number ?? "",
    });
    setError(null);
    setNotice(null);
  }, [student]);

  function update(field: keyof InfoForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      await fnJson(`admin-students/${student.id}`, {
        method: "PATCH",
        token,
        body: {
          full_name: form.full_name.trim(),
          phone_number: form.phone_number.trim(),
          parent_name: form.parent_name.trim(),
          parent_phone_number: form.parent_phone_number.trim(),
        },
      });
      await onRefresh();
      setNotice("Student contact information saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save student information.");
    } finally {
      setBusy(false);
    }
  }

  async function approveProfile() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      await fnJson(`admin-students/${student.id}/profile/approve`, { method: "POST", token, body: {} });
      await onRefresh();
      setNotice("Profile approved. The student can now access study areas.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resetStudentPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-students/${student.id}/reset-password`, {
        method: "POST",
        token,
        body: { new_password: newPassword },
      });
      setResetOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Student password reset successfully.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Password reset failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteConfirmation.trim().toUpperCase() !== "DELETE" || !adminPassword) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await fnJson(`admin-students/${student.id}`, {
        method: "DELETE",
        token,
        body: { admin_password: adminPassword },
      });
      onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account deletion failed.");
      setBusy(false);
    }
  }

  const profileStatus = student.profile_status ?? "incomplete";
  const profileComplete = hasRequiredInfo(form);

  return (
    <div className="student-info-tab">
      <section className="panel student-info-summary">
        <div>
          <span className="student-info-overline">Profile review</span>
          <h2>{statusLabel(profileStatus)}</h2>
          <p className="muted">
            {profileStatus === "pending" && student.profile_submitted_at
              ? `Submitted ${fmtDate(student.profile_submitted_at)}`
              : profileStatus === "approved" && student.profile_approved_at
                ? `Approved ${fmtDate(student.profile_approved_at)}`
                : "The student must submit all required contact details for approval."}
          </p>
        </div>
        <Pill tone={statusTone(profileStatus)}>{statusLabel(profileStatus)}</Pill>
      </section>

      <form className="panel student-info-form" onSubmit={(event) => void save(event)}>
        <div className="student-info-form-heading">
          <div>
            <h2>Student and family contact</h2>
            <p className="muted">Student name and Zalo numbers are required before profile approval.</p>
          </div>
          <span className="student-info-email">{student.email ?? "No email on account"}</span>
        </div>
        <div className="student-info-fields">
          <div>
            <label className="field-label" htmlFor="admin-student-name">Student full name</label>
            <input id="admin-student-name" className="input" autoComplete="name" required value={form.full_name} onChange={(event) => update("full_name", event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="admin-student-phone">Student phone number (Zalo)</label>
            <input id="admin-student-phone" className="input" type="tel" inputMode="tel" required value={form.phone_number ?? ""} onChange={(event) => update("phone_number", event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="admin-parent-name">Parent / guardian full name</label>
            <input id="admin-parent-name" className="input" required value={form.parent_name ?? ""} onChange={(event) => update("parent_name", event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="admin-parent-phone">Parent / guardian phone number (Zalo)</label>
            <input id="admin-parent-phone" className="input" type="tel" inputMode="tel" required value={form.parent_phone_number ?? ""} onChange={(event) => update("parent_phone_number", event.target.value)} />
          </div>
        </div>
        {error && <div className="login-error" role="alert">{error}</div>}
        {notice && <div className="student-profile-success" role="status">{notice}</div>}
        <div className="student-info-save-row">
          {profileStatus === "pending" && (
            <Button type="button" disabled={busy || !profileComplete} onClick={() => void approveProfile()}>
              {busy ? "Working…" : "Approve profile"}
            </Button>
          )}
          <Button type="submit" variant="outline" disabled={busy || !profileComplete}>
            {busy ? "Saving…" : "Save contact information"}
          </Button>
        </div>
        {!profileComplete && <p className="student-info-validation">All four contact fields must be completed before saving or approving.</p>}
      </form>

      <section className="panel student-info-account">
        <div>
          <h2>Account access</h2>
          <p className="muted">Reset the login password or permanently remove this account and its learning data.</p>
        </div>
        <div className="student-info-account-actions">
          <Button variant="outline" onClick={() => { setError(null); setResetOpen(true); }}>Reset password</Button>
          <Button variant="danger" onClick={() => { setError(null); setDeleteOpen(true); }}>Delete account</Button>
        </div>
      </section>

      {resetOpen && (
        <Modal title="Reset student password" onClose={busy ? () => undefined : () => setResetOpen(false)}>
          <form className="student-info-modal-form" onSubmit={(event) => void resetStudentPassword(event)}>
            <p className="muted">Set a temporary password for {student.email ?? "this student"}. Share it with the student privately.</p>
            <div>
              <label className="field-label" htmlFor="student-new-password">New password</label>
              <input id="student-new-password" className="input" type="password" minLength={8} autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="student-confirm-password">Confirm new password</label>
              <input id="student-confirm-password" className="input" type="password" minLength={8} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            {error && <div className="login-error" role="alert">{error}</div>}
            {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="student-info-validation">Passwords do not match.</p>}
            <div className="student-info-modal-actions">
              <Button type="button" variant="outline" onClick={() => setResetOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || newPassword.length < 8 || newPassword !== confirmPassword}>{busy ? "Resetting…" : "Reset password"}</Button>
            </div>
          </form>
        </Modal>
      )}

      {deleteOpen && (
        <Modal title={`Delete ${student.full_name || "student"}?`} onClose={busy ? () => undefined : () => setDeleteOpen(false)}>
          <form className="student-info-modal-form" onSubmit={(event) => void deleteStudent(event)}>
            <div className="login-error" role="alert">
              This permanently deletes the student's login and related assignments, attempts, scores, and vocabulary data. This cannot be undone.
            </div>
            <div>
              <label className="field-label" htmlFor="delete-student-confirm">Type DELETE to confirm</label>
              <input id="delete-student-confirm" className="input" autoComplete="off" required value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="delete-admin-password">Your admin password</label>
              <input id="delete-admin-password" className="input" type="password" autoComplete="current-password" required value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
            </div>
            {error && <div className="login-error" role="alert">{error}</div>}
            <div className="student-info-modal-actions">
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={busy || deleteConfirmation.trim().toUpperCase() !== "DELETE" || !adminPassword}>{busy ? "Deleting…" : "Delete account permanently"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
