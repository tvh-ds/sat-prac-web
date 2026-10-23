# Admin class and student tracking

The admin workspace starts at `/admin/classes`. The sidebar groups Teaching
(Classes, Students, Assignments) before content preparation. Legacy
`/admin/students?tab=classes&class_id=...` links redirect to dedicated class pages.

Class pages provide Students, Assignments, and Vocabulary tabs. All students and
all retained assignments are shown by default; completion never removes a row.
Search and optional filters live in the URL. Local `return_to` links retain the
class, tab, and filters when opening a student or assignment. Only supported
local admin routes are accepted as return destinations.

Class assignment history uses the original recipients. The student roster tab
uses current class membership and summarizes each student's complete work,
including individual assignments and assignments to other classes. Vocabulary
reports include all explicitly assigned shared decks, including archived ones.
Student-owned private decks are outside this assigned-work report.

## Daily vocabulary statistics

- The reporting day is UTC. New cards, overdue cards, and cards due later today
  contribute to remaining work. Due-now includes new cards; later-today is separate.
- Reviewed/due counts distinct cards, not repeated responses. Daily scheduling
  history uses stored pre-review snapshots; unknown history is never replaced
  with a fabricated denominator. A card can be due again later the same day;
  completion requires zero remaining work even after every unique card was reviewed.
- Status distinguishes not started, in progress, completed, no cards due,
  no decks assigned, and unavailable history. No-due and unknown histories are
  excluded from the corresponding participation/completion denominator.
- Study time sums recorded **study** response durations. Sprint responses are
  excluded. Average time divides that sum by distinct cards with timing; aggregate
  averages weight by those card counts. Missing timing is `Not recorded` and an
  actual recorded zero stays zero.
- Individual seven-day heatmaps remain visible. Selecting a day opens its timing
  row; expanding daily timing shows all seven days. Deck heatmaps open the full
  studied/not-studied/no-due/unknown roster.

## API and completeness

All handlers retain the existing admin role guard; no RLS, grants, auth methods,
or database schema changed. Reads page in stable batches of 500 and chunk ID
filters to 200. Database failures fail the report rather than silently returning
an apparently complete partial history.

- `GET admin-students?progress=1` adds `assignment_progress` per student.
- `GET admin-students/:id` preserves `practice_assignments` and adds
  `full_assignments`. Both include status, score, recorded module time, and attempt
  IDs for answer review. Vocabulary decks include the same seven-day daily data
  used in assignment reports. Existing `attempts`, `topics`, and vocabulary
  summary fields remain available.
- `GET admin-classes/:id` adds recipient count, completion count, and average
  accuracy to each assignment. Global assignment lists use the same latest
  attempt semantics and count each assigned student once.
- Vocabulary daily history adds `timed_card_count` for accurate aggregate timing.

Only retained records can be shown; permanently deleted assignments cannot be
reconstructed. Recorded module time is not an inferred elapsed session duration.

## Verification

Run the frontend build and worker suite, then Deno checks for the five affected
admin functions. Run `deno test` for `_shared/admin_tracking_test.ts`,
`student_progress_test.ts`, and `vocab_assignments_test.ts`.

`backend/worker/scripts/smoke-admin-tracking-staging.ts` verifies the staging
hostname before creating disposable fixtures. It checks practice/full history,
original recipients, archived deck visibility, daily reviewed/due and remaining
counts, study timing, and denied student access. `--keep-for-ui` retains fixtures
for browser inspection; `--verify-existing` rechecks them without reseeding;
`--cleanup` removes only the fixture owner's data after checking account markers.

Staging verification deploys the five functions to `wgkggknyndgaoyazdhdf`.
Production releases require an explicit push request and use GitHub Actions to
deploy Supabase functions to `ygqndcgpbtmewzkruyuq`, with Cloudflare Pages building
the frontend from the same commit. This feature requires no schema migration.
