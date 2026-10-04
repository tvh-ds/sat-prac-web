# ML-first question classification

Status: local implementation and staging integration are implemented. The user-approved real-corpus CPU comparison uses a frozen 80/20 split and five inner CV folds. Both baseline and frozen ModernBERT + XGBoost training, validation, reload checks, and benchmarks are complete. The measured comparison recommends retaining the baseline pending independent full-length evaluation. No model is promoted. This supersedes the earlier model-selection discussion.

## Agreed model order

1. Versioned, validated question-bank dataset and leakage-safe evaluation.
2. TF-IDF word/character features plus section-specific logistic regression skills and separate difficulty model.
3. Fine-tuned `answerdotai/ModernBERT-base`, comparing multiclass and ordinal difficulty heads.
4. Frozen original ModernBERT embeddings plus XGBoost, with optional frozen SigLIP2 visual features.
5. Explicitly compare quality, calibrated suggestion precision/coverage, latency, resource usage, and cost before promotion.

Follow `Production_ML_Workflow.md`. Language-model API classification is deferred. Paid training remains disabled while `[BUDGET_USD — TBD]` is unresolved.

## Implemented

- `ml-service/`: strict input/taxonomy contracts, grouped dataset manifests, immutable artifacts, baseline training, candidate training implementations, validation calibration, per-class and sliced evaluation, MLflow registration, private authenticated FastAPI service, and locked Docker dependency installation.
- Worker: asynchronous claims, bounded retries, model-version and output validation, image handling, progress, and error categories.
- Staging database: separate jobs, suggestions, and decision audits; administrator-only reads; transactional snapshot-bound acceptance; explicit label replacement; publication and ingestion review states unchanged.
- Administrator import UI: import-wide and individual classification, status, editable suggestions, acceptance, dismissal, retry, and duplicate-start prevention.
- Offline tests and CI, staging transactional checks, and full queue-to-acceptance integration smoke test.

Implementation and operator commands are documented in `ml-service/README.md`. Fixture models are software tests and must never be promoted as trained classifiers.

## Staging corpus audit

The user authorized read-only production content copying into staging `wgkggknyndgaoyazdhdf`. The copy preserves existing staging records and excludes accounts, profiles, assignments, student answers, and production audit histories. Production has received no writes.

Source records copied include 2,359 questions, 66 PDF imports, 5,183 draft questions, and six full-length tests, plus passages, choices, answer keys, module mappings, source mappings, and referenced assets. Answer keys belong to the import application data; the ML exporter excludes them from features.

The bank-only snapshot contains 1,713 Reading and Writing questions. Original PDF parsing recovered 1,693 difficulty labels that match the current source ID, prompt, ordered choices, domain, skill, and difficulty. Unknown/default difficulty labels remain excluded from difficulty training. Historical full-length imports and staging seed fixtures are excluded from the training-bank snapshot.

## Completed experiment and remaining promotion requirements

- The user approved treating the compiled R&W bank as a container. The current experiment uses a frozen multi-target stratified grouped 80/20 split: 1,369 training and 341 validation questions after two visual and one malformed-input exclusions. Five CV folds inside training select ordinary/balanced losses, parameters, calibration, and thresholds; final validation is untouched until configuration freeze. Counts, distributions, uncertainty, runtime, and throughput are documented in `ml-service/reports/classification-comparison.md`.
- Independently human-label a held-out full-length sample. Imported default labels are not an independent gold standard.
- Gather a verified Math bank and sufficient confirmed visual training examples. Initially unsupported sections/images abstain.
- The user explicitly authorized local CPU runs with no paid services for this comparison. The frozen encoder revision is pinned and final fits use three seeds. Paid/fine-tuned candidate runs remain blocked by the unset budget.
- Internal-bank quality, uncertainty, confidence versus coverage, training-serving parity, warmed latency, throughput, and resource usage are measured in the comparison report. Neither target establishes a reliable positive XGBoost gain; difficulty precision remains insufficient for unattended acceptance.
- Explicitly approve retraining or promotion. Production deployment remains a separate user request.

## Verified locally and on staging

Python tests cover baseline training, registry/reload, calibration, provenance, transitive duplicate/shared-passage grouping, private API contracts/auth, and offline candidate training fixtures. Worker tests cover configuration and malformed predictions. Database checks cover authorization, duplicate jobs, stale decisions, replacement confirmation, and unchanged publication. Integration smoke tests cover staging queue → local worker → private ML service → suggestion → deployed administrator acceptance. Browser checks cover desktop/mobile overflow, keyboard navigation, empty/queued/ready/error states, retries, and acceptance. The frontend build passes.
