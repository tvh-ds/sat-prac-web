# Student dashboard

The student landing route is `/student/dashboard`. Profile approval is still required.

## Scheduling rules

- All greetings, today boundaries, deadlines, and countdowns use GMT+7.
- Morning is 05:00–11:59, afternoon 12:00–17:59, and evening otherwise.
- Assigned, Complete, and Overdue are mutually exclusive. Submission/completion takes priority over a passed deadline.
- Only explicit test/practice assignments appear; repeat assignments remain separate. Latest attempts are selected per assignment.
- Each accessible active vocabulary deck with an existing FSRS state due now appears once as Assigned. Unseen cards are excluded. Decks disappear when no reviews remain due.
- Today's unfinished test/practice assignments include those already overdue earlier today; each due vocabulary deck also counts once in the greeting.
- Test dates are optional account preferences, saved independently of profile approval. Past saved dates remain visible, but new saves must be today or later.
- Refreshes happen on entry, returning to the tab, and GMT+7 midnight. Greeting changes also occur at the morning/afternoon/evening boundaries. There is no background polling loop.

## API

- `GET student-dashboard`: authenticated approved student's lightweight assignment list, with state and an existing page destination.
- `GET student-dashboard/test-date`: own saved date.
- `PATCH student-dashboard/test-date`: `{ "test_date": "YYYY-MM-DD" }` or `{ "test_date": null }`. Extra fields are rejected; account identity is always derived from authentication.
- Responses are private and uncached. Read failures are shown explicitly rather than as zero counts.

## Verification

From `backend`:

```powershell
deno check supabase/functions/student-dashboard/index.ts scripts/e2e-student-dashboard-staging.ts
deno test supabase/functions/_shared/student_dashboard_test.ts
deno run --allow-net --allow-env --allow-read --allow-write scripts/e2e-student-dashboard-staging.ts --project-ref=wgkggknyndgaoyazdhdf
```

The integration script reads staging credentials from the ignored worker and frontend environment files, verifies both project hosts, uses disposable accounts, and removes them afterward. `--keep-for-ui` temporarily retains fixtures in ignored `tmp/`; finish browser checks with the same command plus `--cleanup`.

From `frontend`, run `npm run build`. Check desktop and narrow mobile layouts, filtering, date save/clear, and Open links.

Implementation verification: five unit tests, Edge Function/script type checks, frontend build, and the staging API integration checks passed. Browser checks confirmed the default landing route, state filters, GMT+7 display, date save/clear, and mobile overflow behavior. Changes remain local; only staging received the migration and new Edge Function.
