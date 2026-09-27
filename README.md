# SAT Practice Platform

A SAT practice platform for schools, tutors, and private study. It includes a student testing experience, an admin console, a question bank, vocabulary study, and a multi-layer PDF ingestion pipeline that turns SAT-style PDFs into auditable question drafts.

This is a practice-only app. It does not implement proctoring, College Board integrations, or official score reporting.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, TypeScript, React Router, Supabase JS (`frontend/`) |
| Backend | Supabase Postgres, Auth, Storage, RLS, Deno Edge Functions (`backend/supabase/`) |
| Worker | Node, TypeScript, Express, pdfjs-dist, MuPDF, Cohere Parse 5 OCR, optional Cohere multimodal review (`backend/worker/`) |
| Scripts | PowerShell E2E suites and Node/TS provisioning utilities (`backend/scripts/`) |
| Data corpus | Local SAT PDFs, OCR text, and parser JSON outputs under `Tests Unparsed/` |

## Repository Layout

```text
.
├── frontend/                 React + Vite app for students and admins
│   ├── src/pages/student/    Tests, practice, score reports, vocabulary
│   ├── src/pages/admin/      Students, imports, questions, tests, practice, vocab
│   └── src/styles/theme.css  Design tokens and app-wide styling
├── backend/
│   ├── supabase/
│   │   ├── migrations/       Database schema, RLS, seeds, feature migrations
│   │   └── functions/        15 Deno Edge Functions
│   ├── worker/               PDF ingestion and OCR/parser worker
│   └── scripts/              Provisioning and E2E checks
├── Tests Unparsed/           Local PDF/OCR corpus used by the parser workflow
├── DESIGN.md                 Visual design guidance
└── README.md                 Project overview
```

Generated and installed artifacts such as `frontend/dist/`, `node_modules/`, and `backend/worker/tmp/` are not part of the core source layout.

## Features

### Student App

- Role-gated login and student navigation.
- Student profile submission and approval gate before starting tests or practice.
- Bluebook-style full test sessions with timers, module flow, passage/question split, answer saving, choice elimination, mark-for-review, question grid, review screen, and auto-submit.
- Practice sets built by admins from question-bank items or PDF import drafts.
- Score reports with per-question review, section/domain summaries, filters, explanations, selected answers, typed answers, and visual stimulus images when present.
- Vocabulary decks with student-owned decks, assigned admin decks, bulk card import, SM-2 spaced repetition, sprint mode, heatmap, and streaks.
- Persistent light/dark theme plus accent switching and reduced-motion-friendly transitions.

### Admin Console

- Student management, including account creation, profile approval and updates, password reset, and active/inactive toggling.
- Question bank CRUD with passages, choices, metadata, correct answers, explanations, and stimulus image support.
- Full test builder with sections, modules, ordered question links, publishing, assignment support, and generated tests from imports.
- PDF imports with upload registration, worker processing, page text, draft review, answer-key status, visual warnings, crop/edit stimulus flow, approve/reject/edit actions, and one-click full-test generation.
- Practice set creation from existing questions or selected import drafts.
- Admin vocabulary deck management, card import, archive/delete, and student assignment.
- Progress views for students and attempts.
- The admin home route opens Students; there is no separate dashboard page.

### Multi-layer PDF Ingestion Pipeline

```text
Private PDF upload → page extraction / OCR → SAT parser + answer-key matching
  → import-level deterministic gate → question-level deterministic risks
  → optional AI repair of minor-risk questions → human review where needed
  → Approve Import → generated test
```

1. **Extraction and parsing:** The worker extracts selectable text, uses Cohere Parse 5 OCR for pages that need it, and records page text, visual evidence, parser diagnostics, module identity, and answer-key matches. It creates drafts with an automatic initial position within each assigned module. The source module and printed question number remain separate provenance fields.
2. **Import-level deterministic gate:** A full test must have 98 readable questions distributed 27/27/22/22 across the four SAT modules, with unambiguous module assignments and no duplicate identities within a module. A structural failure marks the import and its drafts **Failed**, stops AI review, and requires **Full Reprocess**. Question-bank and section-test imports are not subject to the 98-question rule. Lesser OCR, parser, and answer-key warnings remain visible above the questions.
3. **Question-level deterministic review:** Each draft is checked for source evidence, required answer, prompt and choice quality, parser flags, answer alignment, and visual/crop state. No-risk drafts become **Complete** automatically. Major or unrecognized risks go directly to human **Review**. Minor risks are eligible for AI repair only when no major risk is present.
4. **Conditional AI repair:** With `COHERE_REVIEW_API_KEY` configured, the worker reviews eligible drafts using OCR text, source-page images, draft content, and answer-key evidence. It applies a proposed repair only at confidence `≥ 0.80` after field and evidence validation; other findings remain suggestions. Every AI-reviewed draft still goes to human **Review**; provider failure also leaves it there. Without the key, deterministic review still runs and those minor-risk drafts wait for human review. AI never approves or publishes questions.
5. **Human review and approval:** The import page shows **Complete**, **Review**, and **Failed** queues. Admins inspect source images, compare AI changes with parser originals, edit content and crops, and approve Review drafts individually. The editor lets them change the assigned module and insertion position; neighboring positions shift while PDF source numbering remains intact. A module change requires human approval again. Placement cannot change after test generation.
6. **Import approval and generation:** When every draft is Complete, has a usable answer, and has a confirmed visual crop where required, **Approve Import** approves the drafts and assembles a test. Full-test module counts are checked again against the final assigned modules. Automated Complete drafts do not need individual sign-off, but import approval is an admin action. Only approved drafts can enter the generated test.

The worker requires Cohere Parse credentials for normal PDF ingestion. Saved `post_ocr` text under `Tests Unparsed/` can also be imported without new Parse calls through worker helper scripts. The optional AI-review key is separate from the Parse key; see [`backend/README.md`](backend/README.md) for worker configuration and API details.

## Quick Start

Prerequisites:

- Docker
- Node 20+
- Deno 2+
- Supabase CLI. The docs and scripts are written for `npx --yes supabase@2.115.0`.
- A Cohere API key for Parse OCR if you want live PDF ingestion.

### 1. Start Supabase

```powershell
cd backend
npx --yes supabase@2.115.0 start
npx --yes supabase@2.115.0 functions serve
```

Keep `functions serve` running while developing. In another terminal, capture the local keys:

```powershell
cd backend
npx --yes supabase@2.115.0 status -o env
```

### 2. Configure the Worker

Create `backend/worker/.env` using `backend/.env.example` as the template:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<from supabase status>
WORKER_AUTH_TOKEN=<local shared secret>
COHERE_API_KEY=<cohere parse key>
# Optional: enables AI repair for minor-risk drafts; deterministic review works without it.
# COHERE_REVIEW_API_KEY=<cohere review key>
# Optional: COHERE_API_KEYS=key1,key2,key3
# Optional: COHERE_KEY_PAGE_CAP=1000
OCR_PROVIDER=cohere
OCR_MODE=auto
PORT=8000
```

Start the worker:

```powershell
cd backend\worker
npm install
npm run dev
```

For direct worker notifications, set the same token and URL before serving or deploying Edge Functions. If `functions serve` is already running, restart it after changing these variables:

```powershell
$env:WORKER_URL = "http://127.0.0.1:8000"
$env:WORKER_AUTH_TOKEN = "<local shared secret>"
```

If `WORKER_URL` is not set, imports can still be processed by calling the worker poll endpoint or by manually triggering import processing from the admin UI/API.

### 3. Start the Frontend

Create `frontend/.env` from `frontend/.env.example`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<from supabase status>
```

Run the app:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 4. Create Users

```powershell
cd backend\scripts
npm install
$env:SUPABASE_URL = "http://127.0.0.1:54321"
$env:SUPABASE_SERVICE_ROLE_KEY = "<from supabase status>"
npm run create-admin -- --email admin@school.edu --password "TempPass123!"
npm run create-student -- --email s1@school.edu --password "TempPass123!" --name "Jane Doe" --grade 11
```

Seeded local accounts may also be available after migrations/seeds run:

- Admin: `principal.admin@test.local` / `Principal123!`
- Student: `jane.student@test.local` / `Student123!`

## Main Backend APIs

Edge Functions live at `backend/supabase/functions/` and are served locally under:

```text
http://127.0.0.1:54321/functions/v1/<function-name>
```

Admin functions:

- `admin-students`: create, list, update, reset passwords, and toggle active state.
- `admin-questions`: question bank CRUD.
- `admin-tests`: test CRUD, publish/archive, assignment, and builder support.
- `admin-pdf-imports`: PDF import registration, processing, review queues, draft editing/placement, approval, and full-test generation.
- `admin-practice`: practice set creation and management.
- `admin-practice-assignments`: practice assignments and result access.
- `admin-progress`: student and attempt analytics.
- `admin-vocab`: admin vocabulary decks, cards, imports, and assignments.

Student functions:

- `student-tests`: public test and practice listing.
- `student-attempts`: start attempts, load current attempt state, and advance modules.
- `student-responses`: save answers, review marks, eliminated choices, notes, and highlights.
- `student-submit`: score an attempt.
- `student-scores`: score list and detailed review.
- `student-profile`: student profile reads and updates.
- `student-vocab`: student deck, card, import, study, sprint, review, and dashboard workflows.

## Verification

Run the checks from a configured local stack unless noted otherwise.

```powershell
# Frontend typecheck and production build
cd frontend
npm run build

# Backend Edge Function checks
cd ..\backend
deno check supabase/functions/**/*.ts
deno test supabase/functions/_shared/scoring_test.ts
deno test supabase/functions/_shared/validation_test.ts

# Live API and UI E2E suites
powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-vocab.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-practice.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-builder.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-worker.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-frontend.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-student-ui.ps1

# Worker tests and typecheck
cd worker
npm test
npm run typecheck

# Optional local PDF corpus scan
npm run verify:corpus
```

## Environments and Deployment

- **Staging** means local, unpushed code connected to Supabase Cloud project `sat-website-staging` (`wgkggknyndgaoyazdhdf`). Local frontend and worker processes use that project for integration tests. Staging does not trigger GitHub or Cloudflare deployment.
- **Production** means a push to GitHub `master`, Cloudflare Pages deployment of the frontend, and migrations plus Edge Functions deployed to Supabase Cloud project `sat-practice` (`ygqndcgpbtmewzkruyuq`). The [Supabase workflow](.github/workflows/deploy-supabase.yml) runs on `master` pushes that change `backend/supabase/**`; Cloudflare deploys through its GitHub integration.

- Supabase migrations create the schema, RLS policies, seed data, storage buckets, vocabulary tables, import metadata, full-test generation metadata, and answer-key status fields.
- Edge Functions require Supabase project secrets for any deployed environment. Set `WORKER_URL` and `WORKER_AUTH_TOKEN` if imports should notify a hosted worker directly.
- The worker needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_AUTH_TOKEN`, and one or more Cohere Parse keys.
- The service role key must only be used by Edge Functions, worker processes, and trusted provisioning scripts.

## Security Model

- Students cannot self-register. Admins create student accounts.
- Role checks are enforced in Edge Functions and backed by `profiles.role`.
- Tables use RLS; privileged writes use the Supabase service role inside trusted backend code only.
- PDF-derived answers remain draft suggestions until individual human approval or admin import approval. AI repair alone never approves a draft.
- Import-generated tests contain approved drafts with Complete review state and confirmed visual crops; answer-key status remains visible for audit.

## Documentation

- [`frontend/README.md`](frontend/README.md): frontend setup, routing, UI systems, and verification.
- [`backend/README.md`](backend/README.md): Supabase schema/functions, worker setup, API table, ingestion pipeline, and deployment.
- [`docs/evals/ai-content-ingestion-evaluation.md`](docs/evals/ai-content-ingestion-evaluation.md): ingestion metric definitions and an unmeasured results template.
- [`DESIGN.md`](DESIGN.md): visual design guidance for the app.
