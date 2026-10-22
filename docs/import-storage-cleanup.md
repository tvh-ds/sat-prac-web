# Published question image retention

Source images and PDFs remain available while an imported test is a draft.
`generate-test` now records `awaiting_publication` instead of deleting evidence.

Publishing (including assignment activation, status PATCH, practice templates,
and assignment snapshots) queues cleanup transactionally. Edge publishing routes
attempt cleanup immediately. Worker `/jobs/poll` retries pending records, and
repeating Publish or `generate-test` retries an already published import.

Published questions cannot point at importer full-page images or review-source
pages. Database guards cover publication, links into published tests, and later
question image edits. A question using a full-page source must be cropped before
publication. Manually uploaded final stimuli remain valid.

For a fully published generated import, cleanup aligns each draft with its
linked question's final image and releases original/review sources. Unused draft
images are released too. For a legacy question-bank import or an import with a
generated test still in draft, only drafts whose questions are published release
source evidence; other unfinished drafts retain their images. A removed visual
uses the question's null image rather than retaining the old draft image.

Only final images still used by questions and images needed by unfinished drafts
are protected. Deletion scans every current question and draft image reference,
paginates beyond 1,000 rows, and fails closed if any reference lookup fails.
Refinement directories are included only when a draft points into them and their
old import record no longer exists. Saved prefixes survive failed deletions.
The original PDF is deleted only for a fully published generated import and only
when no other import shares the PDF. Files are deleted through the Storage API,
never by deleting `storage.objects` rows.

The service-only `release_import_source_images` RPC verifies publication and
active review jobs once per transaction. Its transaction-local scope preserves
human/AI approval history without re-running publication graph queries for each
draft row. Anonymous and authenticated clients cannot invoke that release RPC.

## Verification

- `npm --prefix backend/worker test`: 189 tests, including pagination, shared
  references, deletion/retry, and sources retained before publication.
- All affected Edge Functions pass `deno check`; the frontend build passes.
- The worker-wide strict type check still reports four pre-existing possibly
  undefined accesses in `frontend/src/lib/reviewAnnotations.ts:8`, outside this
  change. The cleanup regression suite and integration script pass.
- `backend/worker/scripts/smoke-published-image-retention-staging.ts` requires
  `--project-ref=wgkggknyndgaoyazdhdf` and verifies actual publication/deletion,
  bulk imports with 100+ drafts, full-page guards, final crop retention, removed
  visuals, approval preservation, legacy imports, unfinished draft protection,
  retries, and service-only permissions. Disposable fixtures are removed.
- Storage listings/metadata verify deletion; previously requested downloads can
  remain in a CDN cache briefly after an object is removed.
- Database advisor results were unchanged by the publication retention schema.

Production release applies the tracked migrations before deploying the four
admin Edge Functions that publish or generate tests. Source cleanup receipts and
the one-time production orphan sweep manifest are recorded in ignored `tmp/`.
