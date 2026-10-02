# Student signup

Login links to `/signup`. Signup collects email, password, student name/Zalo number,
and parent or guardian name/Zalo number. Supabase creates the student account;
the authenticated `student-profile` endpoint validates and submits contact details
for administrator approval. Submission keeps the student signed in and navigates
to `/student/profile`, which shows the awaiting-approval badge. Only Profile and
Sign out are available until administrator approval; direct study URLs redirect
to Profile and study APIs independently reject unapproved accounts.

If profile submission fails after account creation, retry submits only the profile.
The contact fields remain editable, the credentials are disabled, and the password
is cleared from the form. Returning to Login also lets students recover through
their existing profile page. Pending students can edit/resubmit details but cannot
access study areas. Approval uses the existing admin student controls.

## Staging requirements

- Project reference: `wgkggknyndgaoyazdhdf` (`sat-website-staging`).
- Signup and the email provider enabled, Confirm email disabled, minimum password
  length eight characters. The local Supabase config records these defaults;
  cloud authentication settings must be configured separately.
- Deploy the existing `student-profile` and current `admin-students` functions
  to this verified staging project. No database migration is needed for signup.
- Keep code local. Production configuration and deployments require a separate
  explicit request.

## Verification

Start the frontend with `npm run dev` in `frontend`, using `.env.local` connected
to staging. The browser tests use Playwright from a supplied runtime or installed
package; set `PLAYWRIGHT_MODULE_PATH` to its absolute `index.mjs` path if necessary.

```powershell
node frontend/tests/signup.browser.mjs
node backend/scripts/e2e-signup-staging.mjs --project-ref=wgkggknyndgaoyazdhdf
```

The first command mocks staging responses and covers validation, keyboard
navigation, responsive layout, duplicate submission, signed-in profile/locked routes, logout, account
creation errors, retry, and missing-session recovery. Screenshots are written
to ignored `tmp/signup-review/`.

The second command checks live signup without email verification, the server
password minimum, pending profile access/editing, study API denial, administrator
listing/approval, dashboard access after approval, and duplicate-email recovery.
It requires the staging anon and service keys already used by the local frontend
and worker. It refuses non-staging targets and cleans up only its owned temporary
accounts. Never log or commit those keys, fixture credentials, or auth sessions.

Frontend compilation: `npm run build` in `frontend`.

## Production release checks (2026-10-02)

The runtime dependency audit has no high or critical findings. Two moderate
React Router findings remain: this client uses BrowserRouter without SSR error
hydration, and signup navigation uses fixed internal routes. A breaking router
upgrade is deferred; review the advisories again by 2026-11-02.
