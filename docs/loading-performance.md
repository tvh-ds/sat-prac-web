# Admin and student loading improvements

Measured on 27 October 2026 using a local Vite production build and Supabase
Cloud staging `sat-website-staging` (`wgkggknyndgaoyazdhdf`, Singapore).
These measurements were taken before release, with frontend changes in the local
working tree and backend changes applied only to staging.

## Measured results

| Path/resource | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Cinematic background | 1,592,833 bytes | 55,080 bytes | 96.5% less image transfer on login/dashboard |
| Practice/test background | 2,155,869 bytes | 108,558 bytes | 95.0% less image transfer |
| Question Bank initial JS | 203,340 bytes | about 123,550 bytes | About 39% less encoded JS; editing/math load when opened |
| Student Results initial JS | 207,343 bytes | about 125,890 bytes | About 39% less encoded JS; Error Log/math load when opened |
| Classes overview API requests | 3 | 1 | School-wide reports wait until a class is opened |
| Font stylesheet requests | 2 | 1 | Discovered in HTML, without the CSS import chain |
| Imports API | 14,481 ms | 3,055 ms | About 79% faster in the sampled staging requests |
| Student progress roster API | 3,994 ms | 2,276 ms | About 43% faster in the sampled staging requests |
| Answer-key join for 1,000 drafts | 405.096 ms | 9.001 ms | Database EXPLAIN ANALYZE, about 45 times faster |

Browser transfer numbers come from fresh browser contexts against the preview
server. API times are individual client-to-staging samples, not percentiles or
production guarantees. They include a Europe-to-Singapore round trip and can vary
with network conditions and function cold starts. Question API latency did not
show a reliable reduction in these samples (1,837 ms before, 2,156 ms after);
its count/data queries now overlap and image signing uses bounded batches.
Most pages gained about 1 KB of shared JS for request coordination and navigation
preloading. These measurements do not establish field LCP, INP or CLS scores.

## Implementation

- Keep only simultaneous identical JSON reads in memory, scoped by endpoint,
  query and complete access token. Evict successes and failures immediately;
  there is no completed-response cache. Writes invalidate reads both before the
  request and after it settles, preventing a post-save refresh from joining a
  read that began before the save committed.
- Preload sidebar route code on hover, keyboard focus or touch. Respect Save-Data
  and slow connections. Preloading never fetches account data. Local Suspense
  boundaries keep navigation visible while routes or optional tools download.
- Defer answer-review modals, vocabulary import modals, image cropping, question
  preview/editing, class vocabulary UI and the student's Error Log until opened.
- Fetch class progress when opening a class. Load only the basic roster when
  creating a class. The Students Accounts tab also skips assignment/vocabulary
  reports; switching to Progress loads the complete report again. Discard stale
  roster responses when tabs change.
- Serve WebP background assets at their existing dimensions. Retain the PNG
  sources. Consolidate font stylesheets and load signup CSS with its route.
- Run independent roster reads concurrently. Run question count/data queries
  concurrently, and sign distinct image paths in batches of at most 100.
- Read only parser flags needed for import readiness, fetching counted draft
  pages with at most four concurrent requests. Preserve order and all rows;
  any page error rejects the result instead of showing partial totals.
- Add indexes for answer keys by draft, attempts by assignment, card state by
  card/student and vocabulary history by card/student/date. The measured draft
  join now uses an index instead of scanning answer keys for each draft.

## Verification

- Frontend TypeScript check and production build passed.
- Four request-coordination tests cover overlap, account/query isolation,
  retries, and mutation races.
- Twenty-five Deno tests passed: import readiness, student progress, dashboard,
  and bounded pagination. All three changed Edge Functions passed `deno check`.
- All 15 top-level admin/student/login pages passed browser checks without
  JavaScript exceptions, failing Supabase responses or unexpected redirects.
- Additional interactions cover class roster loading, class detail/vocabulary,
  Accounts/Progress switching, question preview/editing, both vocabulary import
  modals, Error Log loading and a deliberately delayed route download that keeps
  admin navigation visible. Test tools open and close without saving changes.
- Desktop and mobile Classes/dashboard screenshots were inspected. Mobile
  document widths passed the overflow check.
- Before/after JSON responses match for all three changed APIs, excluding
  expiring signed image URLs. Anonymous requests still receive 401. Disposable
  student accounts and their owned deck are removed in `finally` blocks.
- Post-migration advisors confirm the four targeted foreign-key index findings
  are resolved. Other existing performance/security advisor findings remain;
  this change does not alter RLS, roles or function execution grants. See the
  [Supabase index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Staging state and rerunning checks

Staging functions: `admin-questions` v2, `admin-students` v9,
`admin-pdf-imports` v9; JWT verification remains enabled. Migration
`20261027074613_loading_query_indexes.sql` matches the recorded staging migration
version. Production still requires explicit authorization.

Start a preview with `npm run preview -- --host 127.0.0.1 --port 4174` from
`frontend`. From `backend/scripts`, run:

```powershell
$env:PERFORMANCE_BASE_URL = 'http://127.0.0.1:4174'
# Set PLAYWRIGHT_MODULE_PATH if Playwright is supplied outside node_modules.
node loading-performance.mjs --project-ref=wgkggknyndgaoyazdhdf
node loading-performance.mjs --tools --project-ref=wgkggknyndgaoyazdhdf
```

The browser script uses installed Edge, the existing staging admin credentials
in `backend/scripts/.env`, and verified staging frontend/worker env files. It
creates only disposable, owned student fixtures. Set `PERFORMANCE_REPORT` to an
ignored local JSON path to retain measurements. `loading-api-check.mjs` captures
baseline API snapshots in ignored `tmp/`; its `--after` mode checks response
parity and timings. Baseline/after checks should run without concurrent fixture
creation or other catalog changes.

From the repository root:

```powershell
backend/scripts/node_modules/.bin/tsx --test frontend/tests/inflightRequests.test.ts
deno test backend/supabase/functions/_shared/parallel_pages_test.ts backend/supabase/functions/_shared/importReadiness_test.ts backend/supabase/functions/_shared/student_progress_test.ts backend/supabase/functions/_shared/student_dashboard_test.ts
```

Active test start/resume/submission, timed exam behavior and vocabulary scheduling
were not redesigned. The loading smoke checks are not a replacement for a
populated exam/submission load test or a representative low-end-device field
measurement.

## Release regression checks

The pre-push review passed the frontend build, all 16 production Edge Function
entrypoint type checks, 76 shared backend tests and four frontend request tests.
The vocabulary example-file test needs an explicit Deno read permission; its
initial permission-denied run was rerun with that permission and passed.
The extracted question preview/editor functions are unchanged from the original
implementation, apart from their exports and module location.

`loading-write-regression.mjs` uses owned staging fixtures to exercise the
deferred question editor's save/refresh path, student practice start, answer
autosave, reload/resume, submission, persisted scoring and the deferred admin
answer review. It removes its user, test and question in its cleanup block.

The frontend lockfile is unchanged. A release audit reports five existing
dependency findings (three moderate, two high), including Vite/build tooling and
React Router. Resolving all findings requires major framework/tool upgrades;
this loading patch does not attempt those migrations. Audit findings should not
be interpreted as new regressions introduced by these changes.
