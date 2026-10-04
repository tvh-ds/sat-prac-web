# Grit question classification

Implements `Production_ML_Workflow.md`: dataset contract → baseline → ModernBERT → frozen embeddings/XGBoost → evaluation → registry → private inference → reviewed metadata.

## Local setup

```powershell
uv sync --locked --extra dev
uv run grit-ml dataset datasets/raw/bank.jsonl datasets/bank-v1
uv run grit-ml train datasets/bank-v1 artifacts/baseline-v1
uv run pytest
```

Run commands from `ml-service/`. Dataset and artifact directories are ignored and immutable. Baseline execution is local and does not call a paid provider. MLflow stores runs in a local SQLite database and registers the complete serving artifact. Set a private tracking URI in a config for shared runs. No public tracking service is required.

## Data and provenance

Use `node backend/scripts/export-classification-dataset.mjs` from the repository root for a read-only staging export. The exporter refuses production credentials. It exports no student data or answer keys. Source documents, passages, exact content duplicates, and known duplicate IDs form connected components; components remain in one split. Missing source lineage is one conservative group, not invented independent sources. The dataset builder quarantines invalid taxonomy rows and refuses insufficient independent groups.

The current audited snapshot is `datasets/raw/staging-bank-only-source-audited-v2.jsonl`: 1,713 R&W bank questions, 1,693 source-verified difficulty labels, and two image-dependent rows. Its sidecar records snapshot, label-proof, and original-PDF checksums; these carry into built dataset manifests. The approved CPU experiment treats the compiled PDF as a container and freezes passage/duplicate/content groups instead; both methods have completed real-corpus training and validation. The general dataset builder still conservatively groups source documents. This is not yet a verified Math or multimodal training corpus.

The user-authorized content copy uses `backend/scripts/copy-classification-content-to-staging.mjs`; production requests are strictly GET-only and staging identity is verified before writes. Existing staging IDs are preserved. `backend/scripts/recover-staging-import-pdfs.mjs` restores missing storage objects only from matching local originals, validating stored sizes and page counts and recording hashes. It leaves oversized PDFs local rather than changing cloud limits. Content-copy and recovery audit manifests are under ignored `tmp/`.

Difficulty provenance must be `source` or `human` to train difficulty; `unknown` and `default` are excluded. A stored Medium value is not evidence of a verified label. Export recovery requires a question-bank import with matching original parser-snapshot difficulty, or original PDF label proof matching the source question ID, prompt, ordered choices, domain, skill, and difficulty. Run `backend/scripts/recover-classification-source-labels.ts` to produce the latter proof from the local original R&W bank. Historical full-length imports and unlabeled staging seed questions are excluded from the bank export. Unrecoverable provenance needs source review; do not relax this rule to make training run.

Exported visual rows initially lack image bytes. For a multimodal training dataset, populate `content.image_base64` from operator-owned confirmed crops, record image hashes in the source snapshot, and independently verify image labels. No arbitrary image URL is fetched by the ML service.

Inputs are section, type, passage, prompt, ordered choices, optional confirmed image, and essential-image flag. Metadata IDs are grouping/lineage only. Answer keys, explanations, correctness flags, and labels are never model features. English SAT taxonomy only; invalid/unsupported inputs require human classification.

## Candidate training

### Approved local CPU comparison

Run from the repository root, completing baseline before the XGBoost command:

```powershell
$env:OMP_NUM_THREADS = '8'
$env:MKL_NUM_THREADS = '8'
$env:OPENBLAS_NUM_THREADS = '8'
$env:HF_HOME = 'D:/SAT website/ml-service/artifacts/cpu-comparison-v1/huggingface-cache'
ml-service/.venv/Scripts/python.exe -m grit_ml.experiment baseline
ml-service/.venv/Scripts/python.exe -m grit_ml.experiment_verify ml-service/artifacts/cpu-comparison-v1 baseline
ml-service/.venv/Scripts/python.exe -m grit_ml.experiment xgboost
ml-service/.venv/Scripts/python.exe -m grit_ml.experiment_verify ml-service/artifacts/cpu-comparison-v1 xgboost
```

This explicit CPU experiment uses the audited bank snapshot, freezes a grouped multi-target stratified 80/20 split and five inner CV folds, compares ordinary/class-balanced training, and writes `reports/classification-comparison.md`. It invokes no paid compute, keeps the original ModernBERT encoder frozen, and leaves deployment unchanged. The general candidate-training budget gate below still applies to paid/fine-tuning workflows. ModernBERT checkpoint downloads go to the workspace cache; no question content is sent to Hugging Face.

CV fold results, embeddings, artifact versions, and benchmarks are recoverable checkpoints under `artifacts/cpu-comparison-v1`. A changed source or split checksum refuses resume. The outer validation is read for prediction only after configuration freeze; tuning and calibration use training OOF predictions. Neither validation nor CV folds are oversampled. The compiled bank container exception and input exclusions are explicit in the dataset audit. Final validation remains an internal bank holdout, not independent full-length evidence.

The current real experiment excludes two image-dependent rows and one multiple-choice row with no choices: 1,710 eligible skill examples and 1,691 verified difficulty labels. Frozen membership is 1,369 train / 341 validation, with 1,363 / 328 verified difficulty labels. The missing-provenance subset is uneven; this limitation is reported rather than changing the split after results. A training-input-only CPU thread probe checks 1/2/4/8 threads and numerical parity, then stores the fastest setting in the serving artifact. Initial extraction wall time is retained separately from warmed inference costs and resumed-run timing.

```powershell
uv sync --locked --extra candidates --extra dev
uv run grit-ml train datasets/bank-v1 artifacts/modernbert-seed42 --kind modernbert --seed 42 --config configs/candidates.json
uv run grit-ml train datasets/bank-v1 artifacts/xgboost-seed42 --kind xgboost --seed 42 --config configs/candidates.json
```

The candidate config intentionally has an unset budget, authorization disabled, and placeholder checkpoint revisions. Fill these only after approving a concrete training budget. Pin checkpoint commits; never use a moving model revision in an artifact. GPU instances must be ephemeral and shut down after each run. `max_training_seconds` limits each ModernBERT task, not cloud billing; provider-side spending limits are also required.

Bounded initial comparison: seeds 42/43/44; ModernBERT learning rates 2e-5/5e-5 and multiclass/ordinal difficulty; XGBoost depths 3/4 and text-only/image-enabled ablations. Freeze the experiment list before final testing. Start with one seed/config per candidate, then run finalists within the approved cap. Do not silently spend past the cap.

ModernBERT uses full passage chunking with preserved prompt/choices and rejects >32 chunks. XGBoost uses a separate frozen original ModernBERT, never the supervised candidate's weights. Frozen SigLIP2 image vectors and an explicit image mask are optional. Cached vectors are keyed by content and pinned encoder/feature definitions. Each XGBoost task requires held-out validation for early stopping. The visual candidate requires at least 30 labeled visual training examples; that is a smoke gate, not evidence of quality. Inference includes encoder costs.

## Expanded classical and fine-tuning experiment

The authorized expanded run is sequential: TF-IDF/Linear SVM, TF-IDF/Complement Naive Bayes,
frozen original ModernBERT/logistic regression, frozen original ModernBERT/Linear SVM, then
the ModernBERT CPU pilot and selected CPU/free-Colab fine-tuning path. Outputs go to
`artifacts/cpu-expanded-v1`; the original baseline/XGBoost experiment is preserved.

```powershell
$env:OMP_NUM_THREADS = '8'
$env:MKL_NUM_THREADS = '8'
$env:OPENBLAS_NUM_THREADS = '8'
$env:HF_HOME = 'D:/SAT website/ml-service/artifacts/cpu-comparison-v1/huggingface-cache'
$env:HF_HUB_OFFLINE = '1'
$env:MLFLOW_DISABLE_AGENT_HINT = '1'
ml-service/.venv/Scripts/python.exe -m grit_ml.expanded_queue
```

Run the queue once, from the repository root. `--wait-pid` can wait for an already-running
Windows experiment process without duplicating it. `queue-status.json` and per-phase logs
show progress/failure. A completed `results.json` skips that method on resume. Optuna stores
20 completed trials per target/weight study in artifact-folder-isolated SQLite, with sampler snapshots and full-five-fold
checkpoints. Interrupted trials are marked failed and retried using completed fold results.
Features, fitting-only weights, calibration partitions, and the frozen outer split are unchanged.
Each method snapshots source/dependency hashes before fitting and refuses incompatible resume.
The dense embedding SVM uses the dual LinearSVC solver with a 10,000-iteration cap; sparse TF-IDF
uses automatic solver selection. The report preserves interrupted attempts and convergence warnings.

Skill and verified categorical difficulty are independent targets; domain is derived from skill.
No numerical difficulty score is introduced. The previously inspected outer validation is now
exploratory evidence. OOF temperature and 90%-precision suggestion thresholds stay within training.
Report: `reports/classification-expanded-comparison.md`; each method includes trials, ordinary/
balanced variants and seeds42/43/44, per-class metrics, bootstrap intervals, slices, and complete
CPU direct/private-HTTP performance. Embedding classifiers reuse the original content/revision
cache for training; end-to-end inference disables cache reads.

The CPU pilot is bounded to about 30 minutes, stopping at a completed optimizer update so its
checkpoint remains resumable. It uses only training examples and projects the full bounded
schedule with a 25% margin. Full fine-tuning uses CPU only if the estimate is at most 12 hours;
otherwise the queue creates the authorized free-Colab handoff. It never purchases compute.
The handoff bundle excludes credentials and outer-validation contents. Upload/run it only after
`finetune-authorization.json` records completed prerequisites and the pilot device decision.
The generated notebook runs the same Python training code, with two independent fully trained
encoders/heads, train-only inverse-frequency loss, early stopping, and resumable optimizer/RNG state.
CPU training stays in FP32. Free-GPU training uses FP16 autocast with FP32 parameters and dynamic
gradient scaling; evaluation and local CPU serving stay in FP32. SDPA is explicit and implicit
reference compilation is disabled. Exact runtime dependencies and encoder revision are recorded.
Checkpoint cleanup requires a resolved experiment-owned child path and completed training evidence.

Colab training outputs persist in the user's `modernBERT_finetuned/finetune` folder. Drive permission,
free-GPU allocation, disconnection, and quota limits may require user action or interruption recovery.
Download trusted artifacts into the matching local experiment folder, then run
`python -m grit_ml.finetune_experiment` for local CPU validation, registry packaging, and private API
benchmarks. Keep code, source snapshots, authorization file, and split checksums identical across
the handoff. No deployment or staging classifier replacement is automatic.

## Evaluation and promotion

Training only touches train/validation. An explicit final-test switch unlocks the held-out evaluation:

```powershell
uv run grit-ml evaluate artifacts/baseline-v1 datasets/bank-v1/test.jsonl --final-test
```

Use an independently reviewed full-length holdout through the same command. Reports include unknown labels, per-class precision/recall/F1, confusion matrices, source-group bootstrap intervals, ECE, Brier score, difficulty ordinal error, confidence/coverage curves, and text/visual/long-passage/section slices. Validation temperature scaling requires at least 20 examples and represented labels; threshold selection requires at least 20 retained predictions at 90% observed precision. Without evidence, outputs abstain rather than invent confidence. These are provisional gates; inspect intervals and rare-class evidence before promotion.

All newly trained models are candidates. Never promote fixture artifacts or interpret fixture scores as corpus performance. Compare candidates on the same eligible inputs. Retain the baseline if complexity does not earn a useful quality/coverage gain. Record review approval, measured inference hardware, cold/warm p50/p95/p99, memory, throughput, abstention, and failures before staging promotion. The local CPU comparison measures internal R&W bank quality and runtime in `reports/classification-comparison.md`; independent full-length generalization, Math, visual quality, and deployment approval remain outstanding.

## Private serving and application integration

```powershell
$env:ML_SERVICE_TOKEN = '<private random token, at least 32 characters>'
$env:ML_ARTIFACT_PATH = '<operator-owned artifact directory>'
uv run uvicorn grit_ml.api:create_app --factory --host 127.0.0.1 --port 8080
```

Mount a trusted immutable artifact into Docker. For candidate artifacts build with `--build-arg CANDIDATE_DEPS=true`; dependency installation uses `uv.lock`. The default image only serves the baseline. The service loads operator-owned joblib artifacts (executable serialization), never uploaded artifacts. Deployment should enforce an 18 MB ingress limit, TLS, private networking, a non-root user, and a read-only artifact mount.

Worker configuration: `ML_SERVICE_URL`, `ML_SERVICE_TOKEN`. Only loopback/container-local HTTP or HTTPS is accepted. The existing authenticated `/jobs/poll` processes classification jobs and the `/classify` route immediately kicks a newly queued job. Keep the existing external poller running to recover queued jobs after a worker restart. No public inference endpoint is added.

Administrator endpoints:

- `POST admin-pdf-imports/{id}/classification`: body `{}` or `{draft_ids: [...]}`.
- `GET admin-pdf-imports/{id}/classification`: latest job and suggestions.
- `POST admin-pdf-imports/{id}/classification/suggestions/{id}/decision`: `{decision: 'accept'|'dismiss', labels: {domain?, skill?, difficulty?}, replace_existing: false}`.

Only complete, unpublished, non-rejected full-length drafts are eligible; visual crops must be confirmed. Job claims are atomic. Existing live jobs are reused. Suggestions are snapshot-bound; acceptance checks live content, label values, publication state, and taxonomy in a transaction. Source or accepted labels are preserved unless replacement is explicitly confirmed. Classification never publishes or modifies review states. Partial failures are visible and do not block import approval.

## Monitoring, feedback, rollback

The prediction record stores model/preprocessing/taxonomy versions, hash, probabilities, confidence, abstention, and inference latency. Jobs expose queue time, processed/failed counts, and errors. API telemetry uses request IDs and omits raw content. Decisions join to the exact suggestion and model version for delayed quality measurement.

Review monthly, or after 100 new reviewed decisions: label frequencies, confidence/abstention histograms, input lengths/image missingness, per-class quality and calibration against verified corrections. Investigate drift before retraining; acceptance-only feedback is biased and needs sampled independent audits. Rebuild versioned datasets explicitly; no automatic retraining or deployment.

Promotion: candidate → staging → separately authorized production shadow → 5% canary → 25% → 50% → 100%, with reviewed quality and technical gates at each step. Roll back by restoring `ML_ARTIFACT_PATH` to the previous immutable approved artifact and restarting the private service; queued jobs pin their original model version and fail safely on mismatch. Keep previous artifacts and decision lineage. No production push/deployment is part of this implementation.

## Verification

Python tests exercise grouped leakage prevention, label provenance, baseline training/registry/reload/API, auth, malformed input, calibration support, visual abstention, ModernBERT multiclass/ordinal gradients using tiny offline fixtures, XGBoost probability training, and chunk preservation. Worker tests validate model versions, probabilities, and taxonomy. `backend/scripts/classification-database-check.sql` runs rollback-only staging assertions. Fixture tests establish software correctness, not model accuracy.

## Prompt-only experiment

The user discontinued ModernBERT fine-tuning. Do not restart that run. The new ablation trains six classical estimators using only raw question prompts; the ModernBERT encoder remains frozen at its original pinned revision. No passage, choices, field markers, section/type tokens, image indicators, or structural features enter these models.

From the repository root, using the existing CPU environment:

```powershell
ml-service/.venv/Scripts/python.exe -u -m grit_ml.prompt_experiment all
```

The sequential queue stores immutable artifacts, per-folder Optuna studies, fold checkpoints, logs, and local MLflow candidate registration under `ml-service/artifacts/prompt-only-v1`. Completed methods are skipped on restart; interrupted methods require identical dataset/code lineage. The existing frozen split and CV folds are reused, including the original source-verified difficulty eligibility rules. No promotion or deployment occurs.

`ml-service/reports/classification-prompt-only-comparison.md` refreshes after each completed method and compares measured results with the prior full-input runs. The prompt audit reports repeated templates across the fixed split and conflicting target labels for identical prompts; this is not a prompt-disjoint generalization test. Verification covers exclusion of all other fields, prompt-keyed cache behavior, frozen weights, complete bounded chunking, reload parity, private API authorization, and uncached encoding.
