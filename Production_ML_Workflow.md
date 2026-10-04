# Production ML Workflow

**A practical end-to-end guide for implementing machine-learning features inside production-grade AI/engineering products.**

> Core idea: a production ML feature is not just a trained model. It is a versioned, testable, observable, deployable software subsystem with a machine-learning decision inside it.

---

## 1. End-to-End Lifecycle

```text
PRODUCT REQUIREMENT
       ↓
DATA + LABEL CONTRACT
       ↓
DATA PIPELINE / VALIDATION
       ↓
FEATURE / PREPROCESSING PIPELINE
       ↓
TRAINING + EXPERIMENT TRACKING
       ↓
OFFLINE EVALUATION
       ↓
MODEL REGISTRY + ARTIFACT PACKAGING
       ↓
STAGING + INTEGRATION / LOAD TESTS
       ↓
SHADOW / CANARY / A-B ROLLOUT
       ↓
PRODUCTION INFERENCE
       ↓
APPLICATION / BUSINESS LOGIC
       ↓
LOGGING + OBSERVABILITY + MODEL MONITORING
       ↓
GROUND TRUTH / FEEDBACK
       ↓
RETRAIN / PROMOTE / ROLLBACK
```

The engineering objective is not simply to maximize an ML metric. It is to maximize useful model quality subject to reliability, latency, cost, maintainability, safety, and product constraints.

---

## 2. Step 1 — Define the Product and ML Contract

Before selecting a model, specify:

- **Task:** binary, multiclass, multilabel, ranking, regression, etc.
- **Input contract:** required fields, types, ranges, nullability, max lengths.
- **Output contract:** class, score, probabilities, confidence, model version, reason/fallback if needed.
- **Consumer:** API, user-facing UI, batch process, downstream decision engine, agent, human reviewer.
- **Failure semantics:** what happens if the model is wrong, unavailable, slow, uncertain, or out-of-distribution?
- **Operating mode:** synchronous real-time, asynchronous, streaming, or batch.
- **SLOs:** p95/p99 latency, throughput, availability, max error rate, resource/cost budget.
- **Quality gates:** required F1/recall/precision/AUC/etc. overall and on critical slices.
- **Abstention/fallback:** rules for low-confidence cases.

Example:

```yaml
task: multiclass_classification
input:
  question_text: string
  answer_choices: list[string]
output:
  class: string
  probabilities: map[string, float]
  confidence: float
  model_version: string
requirements:
  macro_f1: ">= 0.90"
  critical_class_recall: ">= 0.95"
  p95_latency_ms: "< 150"
  availability: ">= 99.9%"
```

---

## 3. Step 2 — Data and Label Contract

Define a schema for every feature and target, including:

- type, units, valid range, allowed categories
- nullable vs required
- source system and ownership
- transformation rules
- timestamp semantics
- label taxonomy and version

Validate both **data quality** and **label quality**.

### Data checks

- schema/types
- null rate
- range violations
- unexpected categories
- duplicates
- malformed text/encoding
- distribution shifts
- upstream freshness

### Label checks

- class definitions are mutually understandable
- ambiguous samples are documented
- label leakage is absent
- inter-annotator agreement if humans label data
- class imbalance is measured
- label-version changes are tracked

Useful tools: Pydantic, Pandera, Great Expectations, dbt tests, Deequ.

---

## 4. Step 3 — Build a Reproducible Data Pipeline

Replace ad hoc files such as `final_v7_REAL_FINAL.csv` with a reproducible dataset build.

```text
raw sources
   ↓
schema validation
   ↓
cleaning
   ↓
deduplication
   ↓
label transformation
   ↓
feature/preprocessing construction
   ↓
versioned train/validation/test dataset
```

Track:

- dataset version/snapshot
- source tables/files and query
- transformation code commit
- filter rules
- label version
- build timestamp
- feature definition version

### Prevent leakage

Train/validation/test splitting must match how production will operate. For time-dependent problems, a chronological split is often more realistic than a random split. Ensure no future-only feature, post-outcome feature, duplicate entity, or target-derived feature can leak into training.

---

## 5. Step 4 — Establish Baselines

Always create a simple baseline before introducing complexity:

- majority class
- business rule
- logistic regression
- small tree
- existing production heuristic

A more complex model should justify itself through measurable gains in product-relevant quality, not novelty.

Compare models across:

- predictive quality
- latency
- throughput
- memory/CPU/GPU
- inference cost
- explainability requirements
- maintainability
- retraining burden

---

## 6. Step 5 — Reproducible Training and Experiment Tracking

Training should become a deterministic, scriptable pipeline:

```text
load dataset
→ validate
→ split
→ fit preprocessing
→ train
→ evaluate
→ persist artifacts
→ register candidate
```

Track every run:

- code commit
- dataset version
- preprocessing/feature version
- random seed
- hyperparameters
- environment/package versions
- metrics and slice metrics
- model artifact
- evaluation reports
- training timestamp

Common tools: MLflow, Weights & Biases, Neptune, Comet; Optuna or Ray Tune for hyperparameter search.

---

## 7. Step 6 — Offline Evaluation Framework

A production classifier should not be approved using one aggregate metric.

### Core metrics

Choose based on the business objective:

- accuracy
- precision / recall
- F1 / macro-F1 / weighted-F1
- ROC-AUC
- PR-AUC
- log loss

For imbalanced problems, accuracy can be misleading.

### Required analyses

1. **Confusion matrix** — identify systematic class confusions.
2. **Per-class metrics** — ensure rare/critical classes are not hidden by averages.
3. **Slice evaluation** — source, language, customer, region, length, difficulty, device, time period, etc.
4. **Calibration** — Brier score, reliability curve, expected calibration error when probabilities drive decisions.
5. **Threshold selection** — optimize based on false-positive vs false-negative costs; 0.5 is not automatically correct.
6. **Robustness** — nulls, empty input, unknown category, very long input, malformed data, duplicates, OOD samples, adversarial edge cases.
7. **Regression/golden-set tests** — critical examples that every new model must preserve.
8. **Statistical uncertainty** — confidence intervals or repeated validation where decision margins are small.

Use an untouched final test set only after model/tuning decisions are largely complete.

---

## 8. Step 7 — Package Preprocessing and Model Together

Avoid training-serving skew. The transformation used in production must match the transformation fit during training.

```text
raw request
   ↓
input validation
   ↓
preprocessing / feature transforms
   ↓
model
   ↓
postprocessing / thresholds / abstention
   ↓
response
```

Version the complete inference artifact, not only weights.

For simple scikit-learn systems, `Pipeline` / `ColumnTransformer` often provide a clean way to couple transformations with the estimator.

---

## 9. Step 8 — Define the Inference API Contract

Example:

```http
POST /v1/classify
```

```json
{
  "question_id": "q_18291",
  "question_text": "Solve 3x + 5 = 20"
}
```

```json
{
  "prediction": "linear_equations",
  "confidence": 0.972,
  "probabilities": {
    "linear_equations": 0.972,
    "geometry": 0.014,
    "statistics": 0.014
  },
  "model_version": "skill_classifier_v17"
}
```

The service contract should specify validation errors, timeouts, fallback behavior, idempotency/retry behavior if relevant, and version compatibility.

---

## 10. Step 9 — Select a Serving Pattern

### Batch

```text
database / object storage
→ scheduled job
→ model inference
→ predictions table
```

Use for nightly scores, segmentation, recommendations, analytics, backfills.

### Synchronous real-time

```text
frontend/backend
→ prediction API
→ model
→ response
```

Use when the product requires an immediate prediction.

### Asynchronous

```text
application
→ queue/event bus
→ worker
→ model
→ result store / callback
```

Use for slow/heavy inference or high-burst workloads where callers do not need an immediate answer.

Common technologies: FastAPI, Docker, Cloud Run/ECS/Kubernetes; Kafka/SQS/RabbitMQ/Celery for async workloads; Spark/Airflow/Dagster/Prefect for batch/orchestration.

---

## 11. Step 10 — Model Registry and Artifact Management

Never manage production models as `model_final_v2.pkl`.

A registry should associate each candidate with:

- model version
- experiment/run
- metrics
- dataset and code lineage
- artifact checksum/location
- stage/status/alias
- approval metadata

Typical lifecycle:

```text
candidate → staging → production
                  ↘ rejected
production v33 → rollback → v32
```

---

## 12. Step 11 — CI/CD for ML

ML CI/CD has several layers.

### Code CI

- formatting/lint
- type checking
- unit tests
- security/dependency checks

### Data/ML tests

- schema tests
- feature validation
- training smoke test
- minimum quality gates
- critical-slice gates
- calibration or threshold checks if required
- prediction sanity checks

### Integration tests

Run the actual serving path:

```text
HTTP/request schema
→ preprocessing
→ model
→ postprocessing
→ database/event system
```

### Performance tests

Measure:

- p50/p95/p99 latency
- throughput/RPS
- memory/CPU/GPU
- cold starts
- queue depth
- error/time-out rate

Common tools: pytest, ruff, mypy, GitHub Actions/GitLab CI, k6, Locust.

---

## 13. Step 12 — Staging and Safe Rollout

Do not send 100% of production traffic to a new model immediately.

Preferred progression:

```text
local/test
→ staging
→ shadow
→ canary 1–5%
→ 10–25%
→ 50%
→ 100%
```

### Shadow deployment

The new model receives real requests, but its prediction does not affect users. Compare output distributions, latency, failures, and eventual quality.

### Canary deployment

A small percentage of users/requests receive the new model. Expand only after technical and product metrics remain healthy.

Always maintain an immediate rollback path.

---

## 14. Step 13 — Observability

### Software/infra telemetry

Record:

- request count/RPS
- p50/p95/p99 latency
- HTTP errors/timeouts
- CPU/GPU/memory
- container restarts
- queue depth
- downstream failures
- trace/request IDs

Tools: OpenTelemetry, Prometheus, Grafana, Datadog, Sentry.

### Prediction telemetry

Log enough to diagnose and evaluate predictions while respecting privacy/security requirements:

```text
prediction_id
request/trace_id
model_version
feature/preprocessing version
prediction
confidence/probabilities as appropriate
timestamp
latency
fallback/abstention status
```

Avoid unrestricted logging of sensitive/raw user inputs unless required and properly governed.

---

## 15. Step 14 — Model Monitoring

Monitor the behavior of the model itself:

- prediction distribution
- confidence distribution
- class frequency
- input/feature drift
- missingness/schema changes
- OOD rate
- abstention/fallback rate
- calibration drift
- performance against delayed ground truth

Distinguish:

- **data drift:** input distribution changed
- **label drift:** class proportions changed
- **concept drift:** relationship between inputs and target changed
- **pipeline failure:** data is malformed or transformed incorrectly

Drift is a signal for investigation, not automatically a reason to retrain.

---

## 16. Step 15 — Ground Truth and Feedback Loop

If labels arrive after inference, maintain joinable identifiers:

```text
prediction_id + model_version + timestamp
```

so the original prediction can later be joined with:

```text
actual_outcome / reviewer_label / user feedback
```

Then recalculate real-world precision, recall, F1, calibration, slice performance, and product metrics.

---

## 17. Step 16 — Retraining, Promotion, and Rollback

A mature loop is:

```text
new labeled data
→ dataset build
→ train candidate
→ offline quality gates
→ registry
→ staging/integration tests
→ shadow/canary
→ promote or reject
```

Retraining should not imply automatic deployment unless the entire evaluation and safety policy is intentionally automated.

Triggers may be:

- schedule
- enough new labels accumulated
- performance degradation
- drift + confirmed quality impact
- taxonomy/product change

Every release needs a rollback target and procedure.

---

## 18. Repository Structure

```text
ml-service/
├── src/
│   ├── data/
│   │   ├── loaders.py
│   │   ├── validation.py
│   │   └── preprocessing.py
│   ├── features/
│   ├── training/
│   │   ├── train.py
│   │   └── tune.py
│   ├── evaluation/
│   │   ├── metrics.py
│   │   ├── slices.py
│   │   └── calibration.py
│   ├── inference/
│   │   ├── predictor.py
│   │   └── schemas.py
│   └── api/
│       └── main.py
├── pipelines/
├── tests/
│   ├── unit/
│   ├── data/
│   ├── model/
│   ├── integration/
│   ├── regression/
│   └── load/
├── configs/
├── Dockerfile
├── pyproject.toml
└── README.md
```

Keep notebooks for exploration, not as the authoritative production training/serving workflow.

---

## 19. Practical Toolchain

| Layer | Common choices |
|---|---|
| Storage / warehouse | Postgres, object storage, Snowflake, BigQuery |
| Processing | pandas, Polars, Spark |
| Validation | Pydantic, Pandera, Great Expectations, dbt tests |
| Training | scikit-learn, XGBoost, LightGBM, PyTorch |
| Tuning | Optuna, Ray Tune |
| Experiment tracking | MLflow, W&B |
| Registry | MLflow or cloud model registry |
| Workflow orchestration | Airflow, Dagster, Prefect, Kubeflow |
| API/serving | FastAPI, BentoML, KServe |
| Packaging | Docker |
| Infrastructure | Cloud Run, ECS, Kubernetes |
| IaC | Terraform |
| CI/CD | GitHub Actions, GitLab CI |
| Telemetry | OpenTelemetry |
| Infra monitoring | Prometheus, Grafana, Datadog |
| ML monitoring | Evidently, Arize, WhyLabs or custom metrics |
| Testing | pytest |
| Load testing | k6, Locust |

**Do not adopt infrastructure purely because it is associated with MLOps.** Production grade is defined by guarantees and repeatability, not by the number of tools. A small FastAPI + Docker + MLflow + managed compute system can be fully production-grade when its requirements are satisfied.

---

## 20. Small-Team Reference Architecture

```text
Postgres / object storage
        ↓
Python dataset + training pipeline
        ↓
Pydantic / Pandera validation
        ↓
scikit-learn / LightGBM / XGBoost
        ↓
MLflow experiment tracking + registry
        ↓
FastAPI inference service
        ↓
Docker
        ↓
Cloud Run / ECS
        ↓
OpenTelemetry
        ↓
Grafana / Datadog
```

CI/CD:

```text
Pull Request
→ lint + unit/data/model tests
→ training smoke test
→ build image
→ deploy staging
→ integration/load checks
→ shadow/canary
→ production
```

---

## 21. Production Definition of Done

A classification feature is end-to-end complete when all of the following are true:

- [ ] Product target, inputs, outputs, consumers, failure behavior and SLOs are documented.
- [ ] Data and label schemas are validated and versioned.
- [ ] Train/validation/test split reflects production and leakage checks have passed.
- [ ] A baseline exists and complexity is justified.
- [ ] Training is reproducible from code/config/data versions.
- [ ] Experiments and artifacts are traceable.
- [ ] Evaluation covers aggregate, per-class, slices, confusion, calibration/thresholds when relevant, robustness, and golden cases.
- [ ] Preprocessing, model, thresholds and postprocessing are versioned together.
- [ ] A stable typed inference contract exists.
- [ ] Unit, data, model, integration, regression and performance tests pass.
- [ ] Model/image artifacts are registered and immutable.
- [ ] Staging and safe rollout procedures exist.
- [ ] Rollback can be performed quickly.
- [ ] Infra telemetry and prediction telemetry exist.
- [ ] Drift, confidence, distribution and ground-truth quality are monitored.
- [ ] Feedback/labels can be joined back to the prediction that generated them.
- [ ] Retraining and model-promotion policies are documented.
- [ ] Privacy, security, access control and data-retention requirements are satisfied.
- [ ] Cost/capacity expectations are tested under realistic traffic.

---

## 22. The Mental Model to Keep

```text
ML FEATURE
=
data contract
+ feature/preprocessing logic
+ model artifact
+ evaluation evidence
+ inference code
+ API/event contract
+ deployment mechanism
+ monitoring
+ versioning/lineage
+ feedback loop
+ rollback mechanism
```

A production ML engineer optimizes the complete system, not just the estimator.
