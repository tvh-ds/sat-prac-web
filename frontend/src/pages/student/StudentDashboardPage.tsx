import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button, EmptyState, Pill, Spinner } from "../../components/ui";
import { fnJson, getToken } from "../../lib/supabase";
import type { StudentDashboardData, StudentDashboardState } from "../../lib/types";
import { dashboardGreeting, dashboardToday, nextDashboardBoundary, summarizeDashboard, testDaysRemaining } from "../../lib/studentDashboard";
import "../../styles/student-dashboard.css";

const labels: Record<StudentDashboardState, string> = { assigned: "Assigned", complete: "Complete", overdue: "Overdue" };
const kinds = { test: "Full-length test", practice: "Practice set", vocabulary: "Vocabulary" };
const deadlineFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const testDateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

export default function StudentDashboardPage() {
  const { profile } = useAuth();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState<StudentDashboardState | "all">("all");
  const [testDate, setTestDate] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState("");
  const [dateReady, setDateReady] = useState(false);
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [dateNotice, setDateNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const loading = useRef(false);
  const dateRequest = useRef(0);
  const dateDirty = useRef(false);
  const dateSaving = useRef(false);

  const loadAssignments = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const token = await getToken();
      const result = await fnJson<StudentDashboardData>("student-dashboard", { token });
      if (mounted.current) { setData(result); setLoadError(null); setNow(new Date()); }
    } catch (e) {
      if (mounted.current) setLoadError(e instanceof Error ? e.message : "Unable to load assignments.");
    } finally { loading.current = false; }
  }, []);

  const loadDate = useCallback(async () => {
    if (dateSaving.current) return;
    const request = ++dateRequest.current;
    try {
      const token = await getToken();
      const result = await fnJson<{ test_date: string | null }>("student-dashboard/test-date", { token });
      if (mounted.current && request === dateRequest.current) {
        setTestDate(result.test_date);
        if (!dateDirty.current) setDateInput(result.test_date ?? "");
        setDateReady(true); setDateError(null);
      }
    } catch (e) {
      if (mounted.current && request === dateRequest.current) setDateError(e instanceof Error ? e.message : "Unable to load your test date.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadAssignments(); void loadDate();
    let lastRefresh = Date.now();
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      setNow(new Date());
      // Visibility and focus commonly fire together; issue a single refresh.
      if (Date.now() - lastRefresh > 1000) { lastRefresh = Date.now(); void loadAssignments(); void loadDate(); }
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => { mounted.current = false; dateRequest.current++; window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [loadAssignments, loadDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new Date(); setNow(next);
      if (dashboardToday(next) !== dashboardToday(now)) void loadAssignments();
    }, Math.max(1, nextDashboardBoundary(now) - Date.now() + 100));
    return () => window.clearTimeout(timer);
  }, [now, loadAssignments]);

  async function saveDate(value: string | null) {
    if (dateSaving.current) return;
    dateSaving.current = true;
    setSaving(true); setDateError(null); setDateNotice(""); dateRequest.current++;
    try {
      const token = await getToken();
      const result = await fnJson<{ test_date: string | null }>("student-dashboard/test-date", { method: "PATCH", body: { test_date: value }, token });
      if (mounted.current) { dateDirty.current = false; setTestDate(result.test_date); setDateInput(result.test_date ?? ""); setDateReady(true); setDateEditorOpen(false); setDateNotice(value ? "Test date saved." : "Test date cleared."); }
    } catch (e) { if (mounted.current) setDateError(e instanceof Error ? e.message : "Unable to save your test date."); }
    finally { dateSaving.current = false; if (mounted.current) setSaving(false); }
  }

  const summary = data && !loadError ? summarizeDashboard(data.items, now) : null;
  const rows = summary?.items.filter((item) => filter === "all" || item.state === filter).sort((a, b) => {
    const order = { overdue: 0, assigned: 1, complete: 2 };
    return order[a.state] - order[b.state] || (a.kind === "vocabulary" ? now.getTime() : a.due_at ? Date.parse(a.due_at) : Infinity) - (b.kind === "vocabulary" ? now.getTime() : b.due_at ? Date.parse(b.due_at) : Infinity) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  }) ?? [];
  const remaining = testDate ? testDaysRemaining(testDate, now) : null;

  return <div className="student-dashboard">
    <div className="dashboard-top">
      <section className="dashboard-welcome" aria-labelledby="dashboard-greeting">
        <h1 id="dashboard-greeting">{dashboardGreeting(now)}, <span>{profile?.full_name || "there"}.</span></h1>
        <p className="dashboard-due-message">{summary ? <>You have <strong>{summary.dueToday}</strong> {summary.dueToday === 1 ? "assignment" : "assignments"} due today.</> : "Your assignments, all in one place."}</p>
        <div className="dashboard-counts" aria-label="Filter assignments by state">
          {(["assigned", "complete", "overdue"] as const).map((state) => <button key={state} className={`dashboard-count dashboard-count-${state}${filter === state ? " is-selected" : ""}`} aria-pressed={filter === state} disabled={!summary || !!loadError} onClick={() => setFilter(state)}>
            <span>{labels[state]}</span><strong>{summary && !loadError ? summary.counts[state] : "—"}</strong>
          </button>)}
        </div>
      </section>
      <section className="dashboard-test-date" aria-labelledby="dashboard-test-date-title">
        <div className="dashboard-date-title"><CalendarDays size={19} aria-hidden="true" /><h2 id="dashboard-test-date-title">Your test day</h2></div>
        <div className="dashboard-countdown" aria-live="polite">{!dateReady ? <p>{dateError ? "Test date unavailable" : "Loading your test date…"}</p> : remaining === null ? <p>Set your SAT date to count down.</p> : remaining > 0 ? <p><strong>{remaining}</strong> {remaining === 1 ? "day" : "days"} to go</p> : <p>{remaining === 0 ? "Test day is today" : "Your test date has passed"}</p>}</div>
        {testDate ? <div className="dashboard-test-date-current">
          <span className="dashboard-date-field-label">SAT test date</span>
          <button className="dashboard-current-date" type="button" aria-label={`Change SAT test date, currently ${testDateFormat.format(new Date(`${testDate}T00:00:00Z`))}`} aria-expanded={dateEditorOpen} aria-controls="dashboard-date-editor" onClick={() => setDateEditorOpen((open) => !open)}>
            <time dateTime={testDate}>{testDateFormat.format(new Date(`${testDate}T00:00:00Z`))}</time><CalendarDays size={15} aria-hidden="true" />
          </button>
          {dateEditorOpen && <form id="dashboard-date-editor" className="dashboard-date-inline dashboard-date-popover" role="group" aria-label="Change SAT test date" onSubmit={(event) => { event.preventDefault(); void saveDate(dateInput); }}>
            <label htmlFor="dashboard-date">Change SAT test date</label>
            <input id="dashboard-date" type="date" min={dashboardToday(now)} value={dateInput} disabled={!dateReady || saving} onChange={(event) => { dateDirty.current = true; setDateInput(event.target.value); setDateNotice(""); }} aria-describedby="dashboard-date-feedback" />
            <div className="dashboard-date-actions"><Button size="sm" disabled={!dateReady || saving || !dateInput || dateInput === testDate}>{saving ? "Saving…" : "Save"}</Button><Button type="button" variant="ghost" size="sm" disabled={!dateReady || saving || !testDate} onClick={() => void saveDate(null)}>Clear</Button><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { dateDirty.current = false; setDateInput(testDate); setDateNotice(""); setDateEditorOpen(false); }}>Cancel</Button></div>
          </form>}
        </div> : <form className="dashboard-date-inline" onSubmit={(event) => { event.preventDefault(); void saveDate(dateInput); }}>
          <label htmlFor="dashboard-date">SAT test date</label>
          <input id="dashboard-date" type="date" min={dashboardToday(now)} value={dateInput} disabled={!dateReady || saving} onChange={(event) => { dateDirty.current = true; setDateInput(event.target.value); setDateNotice(""); }} aria-describedby="dashboard-date-feedback" />
          <div className="dashboard-date-actions"><Button size="sm" disabled={!dateReady || saving || !dateInput || dateInput === testDate}>{saving ? "Saving…" : "Save"}</Button></div>
        </form>}
        <div id="dashboard-date-feedback" className="dashboard-date-feedback" aria-live="polite">{dateError ? <><span role="alert">{dateError}</span>{!dateReady && <Button variant="ghost" size="sm" onClick={() => void loadDate()}>Retry</Button>}</> : dateNotice}</div>
      </section>
    </div>
    <section className="card card-pad dashboard-assignment-card" aria-labelledby="dashboard-assignments-title" aria-busy={!data && !loadError}>
      <div className="dashboard-list-heading"><h2 id="dashboard-assignments-title">{filter === "all" ? "Your assignments" : `${labels[filter]} assignments`}</h2><button className={`btn btn-ghost btn-sm${filter === "all" ? " dashboard-all-active" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button></div>
      {loadError ? <div className="dashboard-list-error" role="alert"><p>{loadError}</p><Button variant="outline" size="sm" onClick={() => void loadAssignments()}>Retry</Button></div> : !summary ? <Spinner /> : rows.length === 0 ? <EmptyState title={filter === "all" ? "Nothing assigned right now" : `No ${labels[filter].toLowerCase()} assignments`} body={filter === "all" ? "Assigned tests, practice sets, and vocabulary reviews will appear here." : "Choose All to see your other assignments."} /> : <table className="table dashboard-assignment-table">
        <thead><tr><th>Assignment</th><th>Deadline <span className="dashboard-timezone">GMT+7</span></th><th>State</th><th><span className="sr-only">Open assignment</span></th></tr></thead>
        <tbody>{rows.map((item) => <tr key={item.id}>
          <td><span className="dashboard-item-title">{item.title}</span><span className="dashboard-item-kind">{kinds[item.kind]}</span></td>
          <td data-label="Deadline">{item.kind === "vocabulary" ? "Due today" : item.due_at ? <time dateTime={item.due_at}>{deadlineFormat.format(new Date(item.due_at))}</time> : "No deadline"}</td>
          <td data-label="State"><Pill tone={item.state === "complete" ? "green" : item.state === "overdue" ? "red" : "amber"}>{labels[item.state]}</Pill></td>
          <td className="dashboard-item-action"><Link className="btn btn-outline btn-sm" to={item.kind === "vocabulary" ? "/student/vocabulary" : item.href} aria-label={`Open ${item.title}`}>Open <ArrowUpRight size={15} aria-hidden="true" /></Link></td>
        </tr>)}</tbody>
      </table>}
    </section>
  </div>;
}
