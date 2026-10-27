# College Board R&W deck publication

Only import `5a255e65-742d-41e1-ba7c-ca0379257ebc` (Full RW Question Bank With Key.pdf) has a **Publish to Practice Bank** action. The exact import ID is shared by the frontend and Edge Function. File names and document-family detection do not activate this exception for other imports.

Publishing calls an admin-only endpoint and one database transaction. It publishes the 132 remaining visual drafts as active practice-bank questions, preserving passages, choices, official keys, explanations, source IDs and confirmed image paths. Previously published questions are preserved. The operation is serialized, audited and safe to retry. Missing content, invalid choices, unavailable images and source-identity conflicts stop the transaction without partial publication.

The deck cannot use the generic approval or full-test generation endpoints. Other PDF imports retain their existing approval and full-test workflow. No storage cleanup runs on this publishing path.

Validation: frontend production build and Edge Function type check; 17 import regression tests; staging publication with all 132 real drafts; exact content and choice checks; no new full test; unchanged questions from other imports; atomic rollback on a provenance conflict; retries without duplicate content; endpoint authentication and scope guards. The browser Publish action was also exercised in staging and produced 1,845 bank questions with 134 images and no generated test.

To repeat the rollback-only database checks, explicitly target staging:

```powershell
supabase db query --linked --project-ref wgkggknyndgaoyazdhdf --file backend/scripts/verify-collegeboard-bank-staging.sql
```

If the staging deck is already published, the script checks idempotence and content preservation instead. The production drafts are published only when an administrator presses the deck's Publish button.
