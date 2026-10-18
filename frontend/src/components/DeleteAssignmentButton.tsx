import { useState } from "react";
import { Button } from "./ui";
import { fnJson, getToken } from "../lib/supabase";

export default function DeleteAssignmentButton({ kind, batch, disabled, onDeleted }: {
  kind: "practice" | "full";
  batch: { id: string; title: string; student_count: number };
  disabled?: boolean;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (deleting || !window.confirm(`Delete assignment “${batch.title}” for all ${batch.student_count} students? This permanently removes this assignment, its attempts, and scores. The original ${kind === "practice" ? "practice set" : "test"} is kept. This cannot be undone.`)) return;
    setDeleting(true); setError(null);
    try {
      const token = await getToken();
      const path = kind === "practice" ? `admin-practice-assignments/${batch.id}` : `admin-tests/assignment-batches/${batch.id}`;
      await fnJson(path, { method: "DELETE", token });
      onDeleted();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete assignment. Please try again."); }
    finally { setDeleting(false); }
  }
  return <div>
    <Button variant="danger" size="sm" disabled={disabled || deleting} onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete assignment"}</Button>
    {error && <div className="login-error" role="alert">{error}</div>}
  </div>;
}
