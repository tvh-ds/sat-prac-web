# SAT Practice Platform Backend

Supabase backend and PDF ingestion worker for the SAT practice platform. The backend owns auth, RLS-protected data, storage buckets, Edge Function APIs, provisioning scripts, E2E suites, and the Node worker that turns PDFs into reviewable question drafts.

The React frontend lives in [`../frontend`](../frontend/README.md).

## Architecture

```text
Frontend
  │ Supabase anon key + user JWT
  ▼
Supabase Edge Functions
  │ service role for trusted writes
  ▼
Postgres + Auth + Storage + RLS
  ▲
  │ private storage, import rows, draft rows
  ▼
Node PDF Worker
  │ render pages + Cohere Parse 5 OCR + parsers
  ▼
Draft questions + answer-key summaries + visual review metadata
```

Nothing imported from a PDF is exposed to students until it is approved or intentionally generated into a practice/full test by an admin.

## Directory Layout

| Path | Purpose |
| --- | --- |
| `supabase/migrations/` | Database schema, RLS policies, buckets, seed data, and feature migrations. |
| `supabase/functions/` | 13 Deno Edge Functions for admin and student APIs. |
| `supabase/functions/_shared/` | Shared auth, CORS, validation, Supabase clients, draft approval, and scoring helpers. |
| `worker/` | Node/TypeScript ingestion worker with OCR, PDF rendering, parsing, and tests. |
| `worker/src/` | Worker server, pipeline, parsers, answer-key extraction, OCR provider, and Supabase integration. |
| `worker/scripts/` | Local corpus/import utilities for parser development and batch ingestion. |
| `worker/tests/` | Vitest coverage for parser, extractor, OCR, text normalization, answer-key logic, and pipeline behavior. |
| `scripts/` | PowerShell E2E suites and TypeScript user provisioning scripts. |

## Migrations

Current migrations include:

- `20260817000000_init.sql`: core schema, profiles, tests, modules, questions, choices, attempts, scores, logs, storage setup, and RLS.
- `20260817000001_seed.sql`: local seed accounts and sample data.
- `20260818000000_vocab.sql`: student vocabulary decks, cards, study state, reviews, and activity.
- `20260819000000_scraper_module_columns.sql`: source module metadata for imported drafts.
- `20260820000000_practice_sets.sql`: practice tests as `tests.kind = 'practice'`.
- `20260822000000_remove_ocr.sql`: legacy OCR cleanup.
- `20260909000000_harden_student_security.sql`: stricter student access policies.
- `20260910000000_question_bank_assets.sql`: question/stimulus asset support.
- `20260912000000_admin_vocab.sql`: admin-owned vocabulary decks and student assignments.
- `20260914000000_ocr_and_full_test.sql`: OCR/import metadata for full-test parsing.
- `20260915000000_full_test_imports.sql`: generated full tests and scoped assignments.
- `20260916000000_answer_key_status.sql`: import/test answer-key completeness fields.

Avoid `supabase db reset` once useful local data exists. Apply new migrations intentionally and keep `supabase_migrations.schema_migrations` accurate.

## Local Development

Prerequisites:

- Docker
- Node 20+
- Deno 2+
- Supabase CLI. Use `npx --yes supabase@2.115.0` for consistency with the scripts.
- Cohere Parse API key for live OCR ingestion.

### Start Supabase

```powershell
cd backend
npx --yes supabase@2.115.0 start
npx --yes supabase@2.115.0 functions serve
```

Keep `functions serve` running. Use a second terminal for scripts and the frontend.

Get local keys:

```powershell
cd backend
npx --yes supabase@2.115.0 status -o env
```

CLI note: newer Supabase CLI versions changed some status output names. The E2E scripts defensively parse both old and new names, but the pinned CLI keeps setup predictable.

### Provision Users

```powershell
cd backend\scripts
npm install
$env:SUPABASE_URL = "http://127.0.0.1:54321"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key from supabase status>"
npm run create-admin -- --email admin@school.edu --password "TempPass123!"
npm run create-student -- --email s1@school.edu --password "TempPass123!" --name "Jane Doe" --grade 11
```

Seeded local accounts may also be present:

- Admin: `principal.admin@test.local` / `Principal123!`
- Student: `jane.student@test.local` / `Student123!`

## Worker Setup

The worker is an Express service. Edge Functions notify it through `POST /process`, and it can also poll pending imports through `POST /jobs/poll`.

Create `backend/worker/.env` from `backend/.env.example`:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service role key>
WORKER_AUTH_TOKEN=<shared secret used by edge functions>
COHERE_API_KEY=<cohere parse key>
# Optional: COHERE_API_KEYS=key1,key2,key3
# Optional: COHERE_API_KEY_2=...
# Optional: COHERE_KEY_PAGE_CAP=1000
# Optional: COHERE_OCR_MODEL=parse-v5.0
OCR_PROVIDER=cohere
OCR_MODE=auto
PORT=8000
POLL_INTERVAL_MS=15000
```

Run it:

```powershell
cd backend\worker
npm install
npm run dev
```

Worker endpoints:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Health check and configured poll interval. |
| `POST` | `/process` | `Authorization: Bearer <WORKER_AUTH_TOKEN>` | Process a specific `{ import_id }`. |
| `POST` | `/jobs/poll` | `Authorization: Bearer <WORKER_AUTH_TOKEN>` | Claim and process the next pending import. |

If Edge Functions should call the worker directly, serve/deploy functions with these variables set. Restart `functions serve` after changing them:

```powershell
$env:WORKER_URL = "http://127.0.0.1:8000"
$env:WORKER_AUTH_TOKEN = "<same shared secret>"
```

Without `WORKER_URL`, the admin import API still registers imports; the worker must be triggered manually or by polling.

## PDF Ingestion Pipeline

Live PDF processing uses Cohere Parse 5 as the OCR/parser input path.

1. Admin uploads a PDF to the private `pdf-imports` storage bucket.
2. `admin-pdf-imports` inserts a `pdf_imports` row with `ocr_mode = 'auto'`, `content_scope = 'full_test'`, and `status = 'uploaded'`.
3. The worker downloads the PDF, extracts selectable text for fallback, renders pages, fits images to Parse limits, and sends pages to Cohere Parse.
4. Parse output is reconstructed into ordered page text. Tables and figures are recorded as visual metadata.
5. Parsers run in this order: question-bank parser, full-test parser, scraper parser, legacy parser.
6. The worker matches answer keys using module-scoped keys first, then global/inferred keys where safe.
7. Drafts are stored with statuses such as `needs_review`, `has_suggested_key`, and `missing_key`.
8. Import-level reports record module completeness, OCR failures, billed Parse pages, visual pages, warnings, timings, and answer-key status.
9. Page images and cropped stimulus assets are stored in `question-assets` when visual review is needed.
10. Admins review, edit, crop, approve, reject, generate practice sets, or generate a full test from the import.

The worker supports multiple Cohere keys. It collects `COHERE_API_KEYS`, `COHERE_API_KEY`, and `COHERE_API_KEY_2` through `COHERE_API_KEY_32`, dedupes them, and rotates on quota/rate-limit/timeout or after `COHERE_KEY_PAGE_CAP` billed pages.

Saved OCR files under `Tests Unparsed/post_ocr/` can be imported without new Parse calls using worker scripts. This is useful for mirrored corpora and repeatable parser development.

Useful worker scripts:

- `npm run verify:corpus`: scans `Tests Unparsed/` with text extraction and parsers, writing `worker/tmp/full-test-parser-report.json`.
- `npx tsx scripts/import-ocr-folder.ts ...`: imports saved `post_ocr` output into Supabase drafts without calling Parse.
- `npx tsx scripts/ingest-folder.ts ...`: local batch ingestion helper.
- `npx tsx scripts/import-local-bank.ts ...`: question-bank import helper.

## Edge Function API

Local base URL:

```text
http://127.0.0.1:54321/functions/v1
```

All application routes expect `Authorization: Bearer <user JWT>`. Admin routes require `profiles.role = 'admin'`; student routes require `profiles.role = 'student'`.

| Function | Main routes | Notes |
| --- | --- | --- |
| `admin-students` | `GET /`, `POST /`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`, `GET /{id}/attempts/{attemptId}`, `POST /{id}/reset-password`, `POST /{id}/toggle-active` | Student roster, per-student attempts/review, password-confirmed permanent deletion, and Auth admin management. |
| `admin-questions` | `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}` | Question bank CRUD with choices, passages, metadata, answers, explanations, and stimulus asset paths. |
| `admin-tests` | `GET /`, `GET/PATCH /{id}`, `POST /`, `POST /{id}/sections`, `PATCH/DELETE /{id}/sections/{sectionId}`, `POST /{id}/modules`, `PATCH/DELETE /{id}/modules/{moduleId}`, `POST/PATCH/DELETE /{id}/questions/{linkId?}`, `POST /{id}/publish`, `POST /{id}/assign`, `POST /{id}/assignees` | Full test builder and assignments. Assignment scopes include full test, Reading/Writing, Math, and custom modules. |
| `admin-pdf-imports` | `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `POST /{id}/process`, `POST /{id}/generate-test`, `GET/PATCH /{id}/drafts/{draftId}`, `POST /{id}/drafts/{draftId}/approve`, `POST /{id}/drafts/{draftId}/reject` | Import registration, worker triggering, draft review, stimulus URL signing, and generated full tests. |
| `admin-practice` | `GET /`, `GET /{id}`, `POST /`, `POST /from-import`, `PATCH /{id}`, `POST /{id}/questions`, `DELETE /{id}/questions/{linkId}` | Practice sets are published `tests` with `kind = 'practice'` and one module timer. |
| `admin-progress` | `GET /students`, `GET /students/{id}`, `GET /attempts/{id}` | Student progress and attempt detail views. |
| `admin-vocab` | `GET/POST /decks`, `GET/PATCH/DELETE /decks/{deckId}`, `GET/POST /decks/{deckId}/cards`, `POST /decks/{deckId}/cards/import`, `PATCH/DELETE /decks/{deckId}/cards/{cardId}`, `GET/POST /decks/{deckId}/assignments` | Admin-owned vocabulary decks, card import, and student assignment. |
| `student-tests` | `GET /` | Lists published public tests plus tests assigned to the student, honoring assignment scopes. |
| `student-attempts` | `POST /`, `GET /current`, `POST /advance` | Starts attempts, loads current attempt state, and advances modules. |
| `student-responses` | `POST /`, `POST /bulk` | Saves active-module answers, marked-for-review state, eliminated choices, notes, and highlights. |
| `student-submit` | `POST /{attemptId}` | Scores multiple-choice and typed answers, writes score rows, and marks assignment completion. |
| `student-scores` | `GET /`, `GET /{attemptId}` | Score history and detailed per-question review with signed stimulus image URLs. |
| `student-vocab` | `GET /`, `POST/PATCH/DELETE /decks/{id?}`, `GET /decks/{deckId}/cards`, `POST/PATCH/DELETE /cards/{id?}`, `POST /cards/import`, `GET /study`, `GET /sprint`, `POST /review` | Student-owned and assigned decks, bulk import, SM-2 review, sprint mode, dashboard. |

## Verification

Run the relevant checks after starting the local Supabase stack. Some E2E suites create and clean up their own users and data.

```powershell
# Edge Functions: syntax/type checks and scoring tests
cd backend
deno check supabase/functions/**/*.ts
deno test supabase/functions/_shared/scoring_test.ts

# Core API E2E
powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1

# Feature E2E suites
powershell -ExecutionPolicy Bypass -File scripts\e2e-vocab.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-practice.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-builder.ps1

# PDF worker E2E
powershell -ExecutionPolicy Bypass -File scripts\e2e-worker.ps1

# Frontend/page checks that depend on the backend
powershell -ExecutionPolicy Bypass -File scripts\e2e-frontend.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-student-ui.ps1

# Worker unit tests and typecheck
cd worker
npm test
npm run typecheck

# Optional corpus parser scan
npm run verify:corpus
```

PowerShell 5.1 note: `npx supabase status -o env` may emit non-fatal stderr about stopped services. The E2E scripts wrap that command through `cmd /c` where needed.

## Deployment

### Supabase Cloud

```powershell
cd backend
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase secrets set WORKER_URL=https://your-worker.example.com
npx supabase secrets set WORKER_AUTH_TOKEN=<shared secret>
npx supabase functions deploy
```

Storage buckets are created by migrations where possible. If a hosted project does not contain the expected private buckets (`pdf-imports`, `question-assets`), create them manually or add explicit storage setup to deployment automation.

### Worker Hosting

The worker can run on any Node-capable host such as Render, Railway, Fly.io, a VPS, or an internal server.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_AUTH_TOKEN`
- `COHERE_API_KEY` or `COHERE_API_KEYS`
- `PORT`, if the host does not inject one automatically

Build/start:

```powershell
npm ci
npm run build
npm start
```

Set Supabase `WORKER_URL` to the public worker URL so imports can notify it. Keep polling enabled as a fallback if the host or edge call fails.

## Security Notes

- RLS is enabled on application tables; client-side access uses the anon key and user JWT.
- Edge Functions and worker code use the service role only for trusted backend operations.
- Students cannot self-register.
- Admin APIs enforce role checks before privileged operations.
- Worker endpoints that mutate imports require `WORKER_AUTH_TOKEN`.
- PDF-derived answer keys are suggestions until admin review. Generated tests preserve complete/partial/missing answer-key status.
