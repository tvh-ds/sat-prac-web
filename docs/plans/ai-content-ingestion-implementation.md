# AI content ingestion implementation

## Scope and state model

The implemented pipeline is:

```text
OCR -> parser -> import deterministic review
  -> Failed: stop, mark every draft Failed, no AI
  -> Passed: question deterministic review
       -> no risk: Complete, awaiting import-level approval
       -> major risk: Review, no AI call
       -> minor risk only: AI repair, then Review
human approval -> Complete and approved
```

`review_state` is `complete`, `review`, or `failed`. The older `review_route` fields remain as temporary compatibility fields while API and UI consumers migrate. Complete questions do not need individual sign-off. The Approve Import action is enabled only when every question is Complete; the server also requires a usable answer for every draft and a confirmed crop for every visual question.

## Deterministic policy

The policy is versioned as `ingestion-review-v2`.

### Import gate

Exact 98-question and 27/27/22/22 module validation applies only when the parser classifies the document as `full_test`.

Major import risks stop downstream work:

- processing failed or was cancelled;
- no readable questions were produced;
- a full test has a question count other than 98;
- a full test does not have module counts 27/27/22/22;
- module assignment is missing or ambiguous;
- explicit section/module identity conflicts with derived structure;
- duplicate question identities occur within one module.

Minor import warnings stay at the import header and never trigger question AI calls:

- OCR page fallback or failed/rejected retry;
- inferred but structurally consistent question numbers or boundaries;
- missing, partial, low-confidence, unparsed, or undetected answer key;
- positional key matching;
- duplicate, excess, unmatched, or shortfall key diagnostics;
- parser recovery diagnostics that do not invalidate final structure.

Question-bank and section-test imports bypass the full-test count gate.

### Question gate

Major risks go directly to human Review:

- missing source page;
- missing required answer;
- missing source image for a visual question;
- `duplicate_source_number_conflict`;
- `source_question_id_unresolved`;
- `screenshot_section_unresolved`;
- `source_global_id_ocr_unresolved`;
- `number_inference_after_duplicate`;
- any unknown future parser flag.

Minor risks create AI work only when no major risk is present:

- empty or unusually short prompt;
- missing, empty, truncated, or malformed choices;
- ordinary inferred question number;
- low-confidence, recovered, module-position, or document-position answer matching;
- `question_id_recovered_from_neighbors`;
- `source_choice_table_truncated_review_required`;
- `recovered_from_page_replay`;
- `recovered_from_global_marker_block`;
- `source_global_id_positional_slot`;
- `positional_answer_review_required`;
- `repeated_source_question_coalesced`;
- `legacy_parser_unverified`;
- visual question with an unconfirmed crop and available full source image.

Every known parser flag is explicitly mapped. Unknown flags fail toward human Review and never reach the model.

## AI repair and evidence

The review worker receives the parsed draft, deterministic minor risks, current and adjacent OCR page text, answer-key evidence, and a rendered source-page image. Review source images are stored separately from active stimulus crops.

The Cohere request uses a pinned configurable model, temperature zero, a versioned prompt, and JSON-schema constrained output. AI repair is enabled automatically only when `COHERE_REVIEW_API_KEY` exists; without it, deterministic review still runs and minor-risk questions go directly to human Review. A finding records issue type, major/minor severity, cited source page and excerpt, explanation, proposed field/value, and confidence. Cited pages must belong to the supplied evidence.

Repairs are applied to the working draft only at confidence `>= 0.80` and after field validation:

- prompt must remain nonempty and plausibly sized;
- passage may be replaced or cleared;
- multiple-choice answers must be A-D;
- choice repairs must contain exactly four nonempty ordered choices;
- crop coordinates must fit the source image, meet minimum dimensions, and contain nonblank pixels.

The system stores the parser-original snapshot, AI-fixed snapshot, field list/diff, findings, model, prompt version, job token totals, estimated cost, and latency. Provider errors, malformed responses, invalid repairs, timeouts, budget limits, and stale snapshots preserve the original content and route the draft to Review. Every AI attempt ends in Review.

## Persistence and idempotency

Imports store deterministic status, policy version, major risks, warnings, and evaluation time. Drafts store `review_state`, explicit deterministic risks, source evidence path, parser-original snapshot, AI-fixed snapshot, snapshot hash, error category, and human review audit fields.

AI jobs are keyed by import snapshot, model, prompt, and risk-policy version. Only one queued/running job may exist for an import. A job processes minor-only drafts, respects concurrency, draft-count, timeout, retry, and cost limits, and refuses stale snapshots. Findings and revisions keep immutable audit evidence; dismissed findings include an administrator reason.

## API and admin UI

The admin import API exposes import gate results, all-import state counts, import-approval eligibility, per-draft risks, findings, original/AI snapshots, and signed source-image URLs. It provides admin-only actions for automatic AI review, finding decisions, one import-level approval, individual human approval, crop confirmation, and Full Reprocess.

The import list marks structural failures prominently. Deterministic review and optional AI repair run automatically after parsing; the import detail page is the human-review workspace and does not expose a manual AI-run control. It shows:

- Full Reprocess for structurally failed imports;
- import-level warnings above questions;
- Complete, Review, and Failed filters and counts;
- an Approve Import action that is enabled only when all questions are Complete;
- concise deterministic risks and AI-change summaries;
- parser-original versus AI-fixed snapshots;
- source image popup, editor, and crop controls.

Failed imports cannot create AI jobs, approve drafts, approve the import, or generate tests. Individual Complete questions are not sign-off targets; the import approval RPC validates the entire import and approves all its drafts atomically. Full Reprocess resets the gate, downloads the stored source PDF, removes superseded derived pages/drafts/jobs, and reruns OCR through downstream review. GitHub and production deployment remain outside this implementation until explicitly requested.

## Verification

Automated checks cover every known parser-flag mapping, unknown-flag fallback, full-test versus non-full-test gating, missing answers, visual crops, malformed outputs, evidence validation, repair confidence, snapshot stability, and evaluation metric calculations.

Required gates are:

1. worker typecheck and unit tests;
2. Edge Function typecheck;
3. frontend production build;
4. staging migration and Edge Function deployment to `sat-website-staging`;
5. staging end-to-end cases for a clean question, AI-repaired question, direct-human question, and structurally failed import;
6. confirmation that no unapproved draft or unconfirmed visual crop reaches test generation.

Measured quality results belong in [the evaluation report](../evals/ai-content-ingestion-evaluation.md). Unknown results remain **Not measured**.
