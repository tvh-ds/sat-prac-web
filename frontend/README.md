# SAT Practice Platform Frontend

React + Vite + TypeScript client for the SAT practice platform. The app has two role-gated experiences:

- Student app: tests, practice sets, score reports, and vocabulary study.
- Admin console: students, imports, question bank, tests, practice sets, vocabulary decks, and progress tools.

The backend is Supabase plus Edge Functions and a Node PDF worker. See [`../backend/README.md`](../backend/README.md).

## Requirements

- Node 20+
- Local or hosted Supabase backend
- `frontend/.env` with Supabase client settings

Create `frontend/.env` from `.env.example`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase status>
```

## Getting Started

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Other scripts:

```powershell
npm run build      # TypeScript check + production build into dist/
npm run preview    # Serve the production build locally
```

## Local Accounts

Seeded local accounts may be available after Supabase migrations and seeds:

- Admin: `principal.admin@test.local` / `Principal123!`
- Student: `jane.student@test.local` / `Student123!`

You can also create users with `backend/scripts/create-admin.ts` and `backend/scripts/create-student.ts`.

## Source Layout

```text
src/
├── App.tsx                         Route tree and role guards
├── main.tsx                        React root
├── auth/
│   └── AuthContext.tsx             Supabase session/profile provider
├── components/
│   ├── AccentSwitcher.tsx          Accent color selector
│   ├── CropImageModal.tsx          Client-side crop tool for stimulus images
│   ├── ThemeToggle.tsx             Light/dark theme control
│   └── ui.tsx                      Shared Button, Modal, Spinner, EmptyState, helpers
├── lib/
│   ├── accent.ts                   Accent persistence/helpers
│   ├── reveal.ts                   Scroll/reveal helpers
│   ├── satTaxonomy.ts              SAT sections/domains/skills metadata
│   ├── supabase.ts                 Supabase client, token helpers, Edge Function fetcher
│   ├── testTitle.ts                PDF/test title formatting helpers
│   ├── theme.ts                    Theme persistence and OS fallback
│   └── types.ts                    Shared frontend API/data types
├── pages/
│   ├── LoginPage.tsx               Role-aware login
│   ├── admin/
│   │   ├── AdminLayout.tsx         Admin shell/navigation
│   │   ├── AdminDashboard.tsx      Overview landing page
│   │   ├── StudentsPage.tsx        Student account management
│   │   ├── ImportsPage.tsx         PDF import list/upload/status
│   │   ├── ImportDetailPage.tsx    Pages, drafts, answer-key status, crop/review/generate-test
│   │   ├── QuestionsPage.tsx       Question bank CRUD
│   │   ├── TestsPage.tsx           Tests list/create/publish/archive/assign
│   │   ├── TestBuilderPage.tsx     Sections, modules, question links, reorder
│   │   ├── PracticePage.tsx        Practice set list/archive
│   │   ├── PracticeComposePage.tsx Create from bank or import drafts
│   │   ├── PracticeManagePage.tsx  Edit practice questions/details
│   │   ├── AdminVocabPage.tsx      Admin vocabulary decks
│   │   └── AdminVocabDeckPage.tsx  Cards, import, assignments
│   └── student/
│       ├── StudentLayout.tsx       Student shell/navigation/theme controls
│       ├── StudentTestsPage.tsx    Available tests and attempts
│       ├── PracticePage.tsx        Available practice sets
│       ├── PracticeStartPage.tsx   Practice start screen
│       ├── TestStartPage.tsx       Full test start screen
│       ├── TestSessionPage.tsx     Timed Bluebook-style session
│       ├── ResultsPage.tsx         Score history
│       ├── ScoreReportPage.tsx     Detailed review and performance breakdowns
│       └── vocab/
│           ├── VocabularyPage.tsx  Decks, due queue, heatmap, streaks
│           ├── DeckCards.tsx       Card CRUD and bulk import
│           ├── StudySession.tsx    SM-2 review flow
│           └── SprintSession.tsx   Shuffled sprint flow
└── styles/
    └── theme.css                   Tokens, layouts, components, motion, responsive CSS
```

## Routes

Public and shared routes:

| Path | Component | Notes |
| --- | --- | --- |
| `/login` | `LoginPage` | Supabase email/password login. |
| `/` | redirect | Redirects to `/student`; role guard redirects admins to `/admin`. |

Student routes:

| Path | Component | Notes |
| --- | --- | --- |
| `/student/tests` | `StudentTestsPage` | Published public tests and assigned tests. |
| `/student/practice` | `PracticePage` | Published practice sets. |
| `/student/results` | `ResultsPage` | Graded attempt history. |
| `/student/scores/:attemptId` | `ScoreReportPage` | Full review for one graded attempt. |
| `/student/vocabulary` | `VocabularyPage` | Deck dashboard, assigned decks, heatmap, queue. |
| `/student/vocabulary/decks/:deckId` | `DeckCards` | Cards for one deck. |
| `/student/vocabulary/study` | `StudySession` | Scheduled review. |
| `/student/vocabulary/sprint` | `SprintSession` | Unscheduled sprint practice. |
| `/student/tests/:testId/start` | `TestStartPage` | Full test confirmation. |
| `/student/practice/:testId/start` | `PracticeStartPage` | Practice set confirmation. |
| `/student/attempts/:attemptId/session` | `TestSessionPage` | Active testing UI. |

Admin routes:

| Path | Component | Notes |
| --- | --- | --- |
| `/admin` | `AdminDashboard` | Admin overview. |
| `/admin/students` | `StudentsPage` | Create, update, reset password, toggle active. |
| `/admin/imports` | `ImportsPage` | Register/upload PDF imports and view status. |
| `/admin/imports/:importId` | `ImportDetailPage` | Draft review, answer-key status, stimulus cropping, generated tests. |
| `/admin/questions` | `QuestionsPage` | Question bank filters and CRUD. |
| `/admin/tests` | `TestsPage` | Test list/create/publish/archive/assign. |
| `/admin/tests/:testId/build` | `TestBuilderPage` | Test structure and question ordering. |
| `/admin/practice` | `PracticePage` | Practice set management. |
| `/admin/practice/new` | `PracticeComposePage` | Compose from question bank or import drafts. |
| `/admin/practice/:setId` | `PracticeManagePage` | Edit one practice set. |
| `/admin/vocabulary` | `AdminVocabPage` | Admin-owned decks. |
| `/admin/vocabulary/decks/:deckId` | `AdminVocabDeckPage` | Cards, CSV/TSV import, assignments. |

## API Access Pattern

`src/lib/supabase.ts` centralizes frontend API calls:

- Creates the Supabase browser client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Reads the current session token.
- Calls Edge Functions with `Authorization: Bearer <JWT>`.
- Serializes JSON request bodies and error responses.

All role-sensitive operations are still enforced server-side in Edge Functions. Frontend guards improve routing UX but are not the security boundary.

## Feature Notes

### Student Testing

- Full tests and practice sets share the same session UI.
- Timers are module-based for full tests and single-module for practice sets.
- Responses save selected choices, typed answers, marked-for-review state, eliminated choices, notes, highlights, and timing fields.
- Active sessions load signed stimulus image URLs when questions have visual assets.
- Submit sends the attempt to `student-submit`, then score reports read from `student-scores`.

### Score Reports

- Shows every attempted/assigned question, including unanswered questions.
- Displays selected answer, typed answer, correct choices, explanation, section, module, domain, skill, and difficulty.
- Filters help students focus on incorrect or unanswered questions.
- Stimulus images are signed through the backend and displayed in review cards.

### Vocabulary

- Students can create personal decks and cards.
- Admin decks can be assigned to students; assigned active decks are readable by students.
- Bulk import accepts simple word/definition CSV or TSV data.
- Study mode uses SM-2 ratings: Again, Hard, Good, Easy.
- Sprint mode shuffles cards without changing review schedules.
- Dashboard shows due/new/review counts, current and best streaks, and a 26-week activity heatmap.

### Admin Imports

- PDF imports list status, draft counts, OCR/parser reports, and answer-key completeness.
- Import detail pages page through large draft sets instead of loading every draft at once.
- Drafts can be edited before approval, including prompt, choices, metadata, answers, and stimulus image path.
- Visual questions can be reviewed with signed image URLs and cropped through `CropImageModal`.
- Admins can generate a full test from an import. Generated tests preserve module structure and answer-key status.

### Admin Vocabulary

- Admins can create active or archived decks.
- Decks support cards with word, definition, optional example sentence, part of speech, and tags.
- Cards can be imported in bulk.
- Assignments grant students access without making the deck student-owned.

## Theme, Accent, and Motion

- Theme preference is stored in `localStorage["sat-theme"]` and falls back to `prefers-color-scheme`.
- An inline script in `index.html` applies `data-theme` before CSS loads to avoid theme flash.
- Accent preference is handled separately through `accent.ts` and `AccentSwitcher`.
- `theme.css` contains light/dark tokens, layout rules, cards, forms, tables, session UI, vocabulary UI, import review UI, and responsive behavior.
- Motion includes route/page fade-up, modal transitions, score bars, card interactions, and flash-card flips.
- Animations respect `prefers-reduced-motion`.

## Verification

From `frontend/`:

```powershell
npm run build
```

With the local backend running, frontend-related E2E checks live under `backend/scripts/`:

```powershell
cd ..\backend
powershell -ExecutionPolicy Bypass -File scripts\e2e-frontend.ps1
powershell -ExecutionPolicy Bypass -File scripts\e2e-student-ui.ps1
```

The broader backend E2E suites are documented in [`../backend/README.md`](../backend/README.md).

## Implementation Notes

- Keep server state authoritative. Do not add client-only role or ownership checks as a substitute for Edge Function checks.
- Use shared UI components from `components/ui.tsx` before adding one-off controls.
- Keep route changes in `App.tsx` synchronized with this README.
- When adding new API response shapes, update `lib/types.ts` with the frontend contract.
- Avoid hardcoding Supabase URLs or keys outside `.env`.
