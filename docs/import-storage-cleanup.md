# Import source retention

The PDF remains available through parsing, deterministic/AI review, crop review,
and approval. Successful `generate-test` commits the complete test first, then
cleans source storage. Partial or failed test assembly never triggers cleanup.

Cleanup removes the original PDF unless another import shares it. It releases
the generated import's full-page/review-image references and removes unused
images from its directory. Former refinement directories are included only
when a current draft points into them and their original import record is gone.
Every candidate is checked against all current question and draft image paths,
including other imports' source/review paths, before deletion. Active question
images, including full pages used as final stimuli, remain available.

The service-only `release_import_source_images` RPC preserves completion and
approval history while replacing temporary source references with the active
question image. This metadata cleanup does not alter the question content.

Storage errors leave `text_quality.storage_cleanup.status` as `pending`; the
generated test remains intact. Former directory provenance is recorded before
references are released. Worker `/jobs/poll` retries pending cleanup; repeating
`generate-test` also retries without assembling a duplicate test. After test
generation, source review and Full Reprocess are blocked. Upload a new import
to process the PDF again.

## Verification

- Worker regression suite: 187 tests pass, including storage pagination,
  shared references, failed deletion/retry, and pre-generation protection.
- Backend Edge Function type check and frontend type check/build pass.
- `scripts/smoke-import-storage-cleanup-staging.ts` verifies actual generation,
  source deletion, retained active/shared images, preserved approvals,
  idempotent generation, and blocked reprocessing in project
  `wgkggknyndgaoyazdhdf`. It removes its disposable fixtures afterward.
- The migration and `admin-pdf-imports` function were verified in staging before
  release. Production deployment follows the repository's `master` workflow:
  database migrations precede Edge Functions, and Cloudflare builds the frontend.
