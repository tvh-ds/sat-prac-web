# Dependency audit — 2026-09-27

## Production dependencies

- Worker: `npm audit --omit=dev --audit-level=high` reports **0 vulnerabilities** after pinning Express 4.22.3 and overriding `body-parser`/`qs` to patched releases.
- Frontend: two moderate React Router advisories remain. npm's available fix requires migrating from React Router 6 to 7.18. The app is a client-rendered SPA and does not use React Router SSR hydration; navigation targets in the reviewed admin ingestion flow are application-owned routes rather than untrusted URLs. The major-version migration is deferred to a dedicated compatibility change.

## Development dependencies

- The full frontend audit reports 3 moderate and 1 high finding; the production-only audit has 2 moderate React Router findings and no high or critical findings. Vite's high finding is a Windows `server.fs.deny` bypass in the development server. Production serves generated static assets, and local Vite must remain bound to loopback.
- The full worker audit reports 3 moderate, 1 high, and 1 critical finding; the production-only audit reports **0 vulnerabilities**. The high finding is in Vite's development server. The critical Vitest UI file-read/execution finding applies when the Vitest UI server is listening; the repository runs `vitest run` and does not enable or expose that UI. The worker's development dependencies are absent from its production install.

Review the deferred React Router, Vite, and Vitest major upgrades by **2026-10-27**, or sooner if a development server or test UI will be exposed to an untrusted network.


## Frontend release recheck — 2026-10-22

The vocabulary history release changes no dependencies. The full frontend audit
reports 3 moderate and 2 high findings; the production-only audit remains at 2
moderate React Router findings and no high or critical findings.

The additional high finding is `source-map-js` (GHSA-68fv-2mgg-jv7q), reachable
through build-time source-map processing. This release builds repository-owned
sources and dependencies; student-uploaded content is not processed as a build
source map. The package is absent from the production dependency tree. Defer
its patch update to the dependency maintenance change by **2026-10-27**.
Vite/launch-editor findings affect development server/editor endpoints, which
are not served by the production static frontend; keep local servers bound to
loopback. Existing upgrade deferrals and the **2026-10-27** review date remain.
