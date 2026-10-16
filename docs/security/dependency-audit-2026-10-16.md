# Release dependency audit — 2026-10-16

Production-only audits were rerun for the import storage cleanup release.

- Worker: npm reports one critical `proxy-addr` advisory,
  [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).
  Exploitation requires trusting a malformed IPv6 proxy subnet and relying on
  spoofable forwarded IP addresses. The worker does not configure `trust proxy`
  or use request IPs for authorization, rate limiting, or logging. Worker
  authorization compares a bearer token. The affected trust configuration is
  not reachable in this release. Defer the dependency-only patch to 2.0.8 to
  separate dependency maintenance, due by 2026-10-27 and before adding proxy
  trust or IP-based security controls.
- Frontend: the same two moderate React Router findings documented on
  2026-09-27 remain. The reviewed app is a client-rendered SPA, uses no SSR
  hydration, and its navigation targets are application-owned. A major router
  upgrade remains deferred to the existing 2026-10-27 compatibility review.

No dependency versions or lockfiles were changed by this release.
