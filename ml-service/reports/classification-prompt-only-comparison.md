# Prompt-only classification comparison

**Cancelled at the user’s request.** No training remains active. Completed and partial artifacts are preserved; remaining experiments will not resume automatically.

The sole model input is raw question prompt text. No passage, answer choices, section/type tokens, field markers, image indicators, or structural numerical features enter the estimators. TF-IDF uses word 1–2 grams and character 2–5 grams; frozen original ModernBERT produces 768-dimensional masked-mean embeddings with bounded complete-prompt chunking. No fine-tuning, paid compute, promotion, deployment, or cloud changes.

Dataset 0d78eb3734e065ed; original immutable seed-42 grouped multi-target 80/20 split and five training-only CV folds. Skill: 1,369 train / 341 validation. Verified categorical difficulty: 1,363 train / 328 validation. The known section selects the valid target/route but is not a model feature. Domain is derived from skill probabilities. The six methods train independent skill and difficulty estimators and compare ordinary versus fitting-partition class-balanced loss. Natural validation distributions remain unchanged. Outer validation has been viewed in prior experiments and is exploratory, not an independent test.

Five classical methods use 20 completed Optuna TPE trials per target/weight, C/alpha 0.001–100, initial 0.1/1/10; XGBoost uses the previous depth {3,4} × lambda {1,5} grid, learning rate 0.05, max 500 trees, patience 25, final median best tree count. This expands the original TF-IDF logistic-regression three-C search, so that comparison changes both features and tuning budget. Other previous classical alternatives already used the same Optuna bounds. Selection uses CV mean macro-F1, then log loss and simpler configuration. OOF temperature/90%-precision thresholds stay inside training. Final seeds 42/43/44.

## Prompt-template overlap and ambiguity

There are 430 distinct training prompts and 123 distinct validation prompts. 18 exact prompt strings occur in both sets, covering 236 validation questions. The frozen original groups are based on full question content; they do not make this ablation prompt-disjoint. These results measure classification of new bank questions under repeated templates, not generalization to unseen prompt templates.

skill:reading_writing: 2 training prompt strings have conflicting labels, covering 373 eligible training rows. Questions with an identical prompt but different difficulty cannot be individually distinguished from this feature alone.

difficulty: 22 training prompt strings have conflicting labels, covering 949 eligible training rows. Questions with an identical prompt but different difficulty cannot be individually distinguished from this feature alone.

## Current completed results

| Method | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 | Joint correct | HTTP p95 ms | Serial questions/s |
| --- | --- | --- | --- | --- | --- | --- |
| TF-IDF + logistic regression | 0.8611 | 0.4163 | 0.9972 | 0.3994 | 22.49 | 120.75 |
| TF-IDF + Linear SVM | 0.8611 | 0.4163 | 0.9972 | 0.3994 | 34.21 | 59.44 |
| TF-IDF + Complement NB | 0.8438 | 0.4054 | 0.9848 | 0.3811 | 32.11 | 65.75 |
| Frozen ModernBERT + XGBoost | 0.8361 | 0.4136 | 0.9831 | 0.3841 | 118.50 | 11.84 |

Not completed: Frozen ModernBERT + logistic regression, Frozen ModernBERT + Linear SVM.

## Paired comparison with previous full-input methods

| Method | Target | Previous macro-F1 | Prompt macro-F1 | Paired difference / 95% CI |
| --- | --- | --- | --- | --- |
| TF-IDF + logistic regression | skill:reading_writing | 0.8985 | 0.8611 | {"prompt_minus_previous": -0.03739519056061391, "ci95": [-0.07338229399774175, 0.004289651407360948]} |
| TF-IDF + logistic regression | difficulty | 0.5323 | 0.4163 | {"prompt_minus_previous": -0.11595025330268571, "ci95": [-0.17445766547224353, -0.05620797177793441]} |
| TF-IDF + Linear SVM | skill:reading_writing | 0.9356 | 0.8611 | {"prompt_minus_previous": -0.07449539135494587, "ci95": [-0.1054031766057302, -0.04126439092656694]} |
| TF-IDF + Linear SVM | difficulty | 0.5206 | 0.4163 | {"prompt_minus_previous": -0.10430405959858968, "ci95": [-0.1576453359887673, -0.045865012870922144]} |
| TF-IDF + Complement NB | skill:reading_writing | 0.8764 | 0.8438 | {"prompt_minus_previous": -0.03265043713876414, "ci95": [-0.06575673826453066, 0.005629632688428993]} |
| TF-IDF + Complement NB | difficulty | 0.4812 | 0.4054 | {"prompt_minus_previous": -0.07574891780474147, "ci95": [-0.12032242512375296, -0.028611545735856798]} |
| Frozen ModernBERT + XGBoost | skill:reading_writing | 0.8753 | 0.8361 | {"prompt_minus_previous": -0.03913007418044212, "ci95": [-0.0790045500648622, -0.002307128695975608]} |
| Frozen ModernBERT + XGBoost | difficulty | 0.5563 | 0.4136 | {"prompt_minus_previous": -0.14267144652989122, "ci95": [-0.1998095872245995, -0.08620898507323495]} |

Paired intervals use 1,000 original-group bootstrap resamples, seed42. Repeated prompt templates are not resampling groups, so these CIs can understate template-level dependence; they also exclude source shift and repeated model-development uncertainty.

## TF-IDF + logistic regression

CV-selected weighting: {"skill:reading_writing": "ordinary", "difficulty": "balanced"}. Feature version prompt-only-v1.

| Target | Weight | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 94.68369219641917} | 0.8663 | 0.0020 | 0.1811 |
| skill:reading_writing | balanced | {"C/alpha": 44.98741977424376} | 0.8663 | 0.0020 | 0.1828 |
| difficulty | ordinary | {"C/alpha": 0.11345153067354169} | 0.4576 | 0.0205 | 1.0252 |
| difficulty | balanced | {"C/alpha": 0.058599430252151814} | 0.4606 | 0.0248 | 1.0308 |

| Weight | Seed | Skill F1 | Difficulty F1 | Domain F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8611 | 0.4122 | 0.9972 |
| ordinary | 43 | 0.8611 | 0.4122 | 0.9972 |
| ordinary | 44 | 0.8611 | 0.4122 | 0.9972 |
| balanced | 42 | 0.8600 | 0.4163 | 0.9972 |
| balanced | 43 | 0.8600 | 0.4163 | 0.9972 |
| balanced | 44 | 0.8600 | 0.4163 | 0.9972 |

### skill:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.8768 | 0.8917 | 0.8611 | [0.8466979166666666, 0.8727272727272727] | 0.8364 | 0.1919 | 0.1294 | 0.0065 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Boundaries | 0.5060 | 1.0000 | 0.6720 | 42 | [1.0, 1.0] |
| Central Ideas and Details | 0.9655 | 1.0000 | 0.9825 | 28 | [1.0, 1.0] |
| Command of Evidence | 1.0000 | 1.0000 | 1.0000 | 29 | [1.0, 1.0] |
| Cross-Text Connections | 1.0000 | 0.9167 | 0.9565 | 12 | [0.75, 1.0] |
| Form, Structure, and Sense | 0.0000 | 0.0000 | 0.0000 | 41 | [0.0, 0.0] |
| Inferences | 1.0000 | 1.0000 | 1.0000 | 28 | [1.0, 1.0] |
| Rhetorical Synthesis | 1.0000 | 1.0000 | 1.0000 | 40 | [1.0, 1.0] |
| Text Structure and Purpose | 1.0000 | 1.0000 | 1.0000 | 32 | [1.0, 1.0] |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 | [1.0, 1.0] |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 | [1.0, 1.0] |

Confusion labels: ["Boundaries", "Central Ideas and Details", "Command of Evidence", "Cross-Text Connections", "Form, Structure, and Sense", "Inferences", "Rhetorical Synthesis", "Text Structure and Purpose", "Transitions", "Words in Context"]. Rows=true; columns=predicted.

```json
[[42, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 28, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 29, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 11, 0, 0, 0, 0, 0, 0], [41, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 28, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 40, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 32, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 37, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 52]]
```

Policy {"temperature": 0.7549567288540389, "threshold": 0.51, "fitted_on": "training_out_of_fold_only"}; coverage 0.7566; abstention 0.2434; retained 258; precision 0.9961; exact retained-precision CI [np.float64(0.97859484623318), np.float64(0.999901873775994)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 1.0000 | 0.8768 |
| 0.7000 | 0.7507 | 0.9961 |
| 0.8000 | 0.7449 | 0.9961 |
| 0.9000 | 0.7419 | 0.9960 |
| 0.9500 | 0.7390 | 0.9960 |

Rare classes: ['Cross-Text Connections']; long-prompt slice: {"count": 0}.

### difficulty

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.4360 | 0.4360 | 0.4163 | [0.3732460393064108, 0.4724577262963019] | 0.4169 | 1.0865 | 0.6555 | 0.0546 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Easy | 0.4337 | 0.6729 | 0.5275 | 107 | [0.5999484536082474, 0.7620160213618158] |
| Medium | 0.4393 | 0.4087 | 0.4234 | 115 | [0.3244019138755981, 0.5087430102516309] |
| Hard | 0.4364 | 0.2264 | 0.2981 | 106 | [0.14833233173076923, 0.3143114543114543] |

Confusion labels: ["1", "3", "5"]. Rows=true; columns=predicted.

```json
[[72, 25, 10], [47, 47, 21], [47, 35, 24]]
```

Policy {"temperature": 0.6973315288799952, "threshold": null, "fitted_on": "training_out_of_fold_only"}; coverage 0.0000; abstention 1.0000; retained 0; precision —; exact retained-precision CI unavailable. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.2683 | 0.4886 |
| 0.7000 | 0.0274 | 0.6667 |
| 0.8000 | 0.0000 | — |
| 0.9000 | 0.0000 | — |
| 0.9500 | 0.0000 | — |

Rare classes: []; long-prompt slice: {"count": 0}.

Ordinal step error 0.7378; Easy↔Hard error 0.1738.

### domain:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.9971 | 0.9974 | 0.9972 | [0.991396250690902, 1.0] | 0.9971 | 0.0197 | 0.0067 | 0.0032 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Craft and Structure | 1.0000 | 0.9896 | 0.9948 | 96 | [0.969984693877551, 1.0] |
| Expression of Ideas | 1.0000 | 1.0000 | 1.0000 | 77 | [1.0, 1.0] |
| Information and Ideas | 0.9884 | 1.0000 | 0.9942 | 85 | [1.0, 1.0] |
| Standard English Conventions | 1.0000 | 1.0000 | 1.0000 | 83 | [1.0, 1.0] |

Confusion labels: ["Craft and Structure", "Expression of Ideas", "Information and Ideas", "Standard English Conventions"]. Rows=true; columns=predicted.

```json
[[95, 0, 1, 0], [0, 77, 0, 0], [0, 0, 85, 0], [0, 0, 0, 83]]
```

Policy {"threshold": 0.0}; coverage 1.0000; abstention 0.0000; retained 341; precision 0.9971; exact retained-precision CI [np.float64(0.9837699760496924), np.float64(0.999925756984934)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 1.0000 | 0.9971 |
| 0.7000 | 1.0000 | 0.9971 |
| 0.8000 | 0.9941 | 0.9971 |
| 0.9000 | 0.9941 | 0.9971 |
| 0.9500 | 0.9883 | 0.9970 |

Rare classes: []; long-prompt slice: null.

### Operational measurements

Hardware: {"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}. CPU ≤8 threads, one experiment at a time. Main-process peak memory 376.95 MiB; HTTP subprocess peak memory is not instrumented. Feature preparation/cache-read time 0.00s; total recorded method wall time 322.04s; artifact size 3.92 MiB; load 0.154s.

| Path | p50 ms | p95 ms | p99 ms | questions/s |
| --- | --- | --- | --- | --- |
| direct | 2.3309 | 3.5446 | 4.9445 | 402.0279 |
| api_serial | 4.9246 | 22.4916 | 27.9587 | 120.7519 |

100 direct questions 0.264s; 100 HTTP questions 0.632s. Ten warm-ups, three validation passes, fresh prompt encoding with cache reads disabled during both direct/API benchmarks. Classifier-only cached-feature measurements: null.

Four-client burst load (429 is intentional busy rejection, not an unexpected error): {"clients": 4, "attempts": 1023, "successful": 539, "busy_429": 484, "other_errors": 0, "elapsed_seconds": 3.3065470999572426, "successful_questions_per_second": 163.00992658080384, "successful_latency": {"requests": 539, "p50_ms": 12.733299983665347, "p95_ms": 27.79108000686392, "p99_ms": 32.90723801124841, "elapsed_seconds": 7.569550501881167, "questions_per_second": 71.20634175913735}}.

Machine metrics [tfidf_lr/results.json](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_lr/results.json>); [experiment manifest](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_lr/experiment-manifest.json>); [verification](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_lr/verification.json>); [configuration freeze](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_lr/configuration-freeze.json>). Each immutable artifact manifest includes configurations, dependencies, code hashes, and encoder revision.

## TF-IDF + Linear SVM

CV-selected weighting: {"skill:reading_writing": "balanced", "difficulty": "ordinary"}. Feature version prompt-only-v1.

| Target | Weight | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 94.68369219641917} | 0.8663 | 0.0020 | 0.1884 |
| skill:reading_writing | balanced | {"C/alpha": 94.68369219641917} | 0.8663 | 0.0020 | 0.1884 |
| difficulty | ordinary | {"C/alpha": 0.007645565781251344} | 0.4638 | 0.0224 | 1.0256 |
| difficulty | balanced | {"C/alpha": 0.007974278445638952} | 0.4621 | 0.0208 | 1.0254 |

| Weight | Seed | Skill F1 | Difficulty F1 | Domain F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8611 | 0.4163 | 0.9972 |
| ordinary | 43 | 0.8611 | 0.4163 | 0.9972 |
| ordinary | 44 | 0.8611 | 0.4163 | 0.9972 |
| balanced | 42 | 0.8611 | 0.4163 | 0.9972 |
| balanced | 43 | 0.8611 | 0.4163 | 0.9972 |
| balanced | 44 | 0.8611 | 0.4163 | 0.9972 |

### skill:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.8768 | 0.8917 | 0.8611 | [0.8466979166666666, 0.8727272727272727] | 0.8364 | 0.1989 | 0.1293 | 0.0036 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Boundaries | 0.5060 | 1.0000 | 0.6720 | 42 | [1.0, 1.0] |
| Central Ideas and Details | 0.9655 | 1.0000 | 0.9825 | 28 | [1.0, 1.0] |
| Command of Evidence | 1.0000 | 1.0000 | 1.0000 | 29 | [1.0, 1.0] |
| Cross-Text Connections | 1.0000 | 0.9167 | 0.9565 | 12 | [0.75, 1.0] |
| Form, Structure, and Sense | 0.0000 | 0.0000 | 0.0000 | 41 | [0.0, 0.0] |
| Inferences | 1.0000 | 1.0000 | 1.0000 | 28 | [1.0, 1.0] |
| Rhetorical Synthesis | 1.0000 | 1.0000 | 1.0000 | 40 | [1.0, 1.0] |
| Text Structure and Purpose | 1.0000 | 1.0000 | 1.0000 | 32 | [1.0, 1.0] |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 | [1.0, 1.0] |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 | [1.0, 1.0] |

Confusion labels: ["Boundaries", "Central Ideas and Details", "Command of Evidence", "Cross-Text Connections", "Form, Structure, and Sense", "Inferences", "Rhetorical Synthesis", "Text Structure and Purpose", "Transitions", "Words in Context"]. Rows=true; columns=predicted.

```json
[[42, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 28, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 29, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 11, 0, 0, 0, 0, 0, 0], [41, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 28, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 40, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 32, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 37, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 52]]
```

Policy {"temperature": 0.6973315288799952, "threshold": 0.51, "fitted_on": "training_out_of_fold_only"}; coverage 0.7566; abstention 0.2434; retained 258; precision 0.9961; exact retained-precision CI [np.float64(0.97859484623318), np.float64(0.999901873775994)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 1.0000 | 0.8768 |
| 0.7000 | 0.7537 | 0.9961 |
| 0.8000 | 0.7507 | 0.9961 |
| 0.9000 | 0.7507 | 0.9961 |
| 0.9500 | 0.7449 | 0.9961 |

Rare classes: ['Cross-Text Connections']; long-prompt slice: {"count": 0}.

### difficulty

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.4360 | 0.4360 | 0.4163 | [0.3732460393064108, 0.4724577262963019] | 0.4169 | 1.0819 | 0.6532 | 0.0407 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Easy | 0.4337 | 0.6729 | 0.5275 | 107 | [0.5999484536082474, 0.7620160213618158] |
| Medium | 0.4393 | 0.4087 | 0.4234 | 115 | [0.3244019138755981, 0.5087430102516309] |
| Hard | 0.4364 | 0.2264 | 0.2981 | 106 | [0.14833233173076923, 0.3143114543114543] |

Confusion labels: ["1", "3", "5"]. Rows=true; columns=predicted.

```json
[[72, 25, 10], [47, 47, 21], [47, 35, 24]]
```

Policy {"temperature": 1.037177518961867, "threshold": null, "fitted_on": "training_out_of_fold_only"}; coverage 0.0000; abstention 1.0000; retained 0; precision —; exact retained-precision CI unavailable. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.2652 | 0.4828 |
| 0.7000 | 0.0000 | — |
| 0.8000 | 0.0000 | — |
| 0.9000 | 0.0000 | — |
| 0.9500 | 0.0000 | — |

Rare classes: []; long-prompt slice: {"count": 0}.

Ordinal step error 0.7378; Easy↔Hard error 0.1738.

### domain:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.9971 | 0.9974 | 0.9972 | [0.991396250690902, 1.0] | 0.9971 | 0.0269 | 0.0071 | 0.0034 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Craft and Structure | 1.0000 | 0.9896 | 0.9948 | 96 | [0.969984693877551, 1.0] |
| Expression of Ideas | 1.0000 | 1.0000 | 1.0000 | 77 | [1.0, 1.0] |
| Information and Ideas | 0.9884 | 1.0000 | 0.9942 | 85 | [1.0, 1.0] |
| Standard English Conventions | 1.0000 | 1.0000 | 1.0000 | 83 | [1.0, 1.0] |

Confusion labels: ["Craft and Structure", "Expression of Ideas", "Information and Ideas", "Standard English Conventions"]. Rows=true; columns=predicted.

```json
[[95, 0, 1, 0], [0, 77, 0, 0], [0, 0, 85, 0], [0, 0, 0, 83]]
```

Policy {"threshold": 0.0}; coverage 1.0000; abstention 0.0000; retained 341; precision 0.9971; exact retained-precision CI [np.float64(0.9837699760496924), np.float64(0.999925756984934)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 1.0000 | 0.9971 |
| 0.7000 | 0.9971 | 0.9971 |
| 0.8000 | 0.9971 | 0.9971 |
| 0.9000 | 0.9971 | 0.9971 |
| 0.9500 | 0.9941 | 0.9971 |

Rare classes: []; long-prompt slice: null.

### Operational measurements

Hardware: {"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}. CPU ≤8 threads, one experiment at a time. Main-process peak memory 284.03 MiB; HTTP subprocess peak memory is not instrumented. Feature preparation/cache-read time 0.00s; total recorded method wall time 2344.19s; artifact size 4.03 MiB; load 0.156s.

| Path | p50 ms | p95 ms | p99 ms | questions/s |
| --- | --- | --- | --- | --- |
| direct | 3.7555 | 8.1908 | 9.8715 | 218.6455 |
| api_serial | 14.9493 | 34.2134 | 36.7914 | 59.4430 |

100 direct questions 0.405s; 100 HTTP questions 1.444s. Ten warm-ups, three validation passes, fresh prompt encoding with cache reads disabled during both direct/API benchmarks. Classifier-only cached-feature measurements: null.

Four-client burst load (429 is intentional busy rejection, not an unexpected error): {"clients": 4, "attempts": 1023, "successful": 487, "busy_429": 536, "other_errors": 0, "elapsed_seconds": 3.972973700030707, "successful_questions_per_second": 122.57820886059125, "successful_latency": {"requests": 487, "p50_ms": 16.662599984556437, "p95_ms": 28.673719975631684, "p99_ms": 38.1664300477132, "elapsed_seconds": 8.782768300035968, "questions_per_second": 55.44948737837085}}.

Machine metrics [tfidf_svm/results.json](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_svm/results.json>); [experiment manifest](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_svm/experiment-manifest.json>); [verification](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_svm/verification.json>); [configuration freeze](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_svm/configuration-freeze.json>). Each immutable artifact manifest includes configurations, dependencies, code hashes, and encoder revision.

## TF-IDF + Complement NB

CV-selected weighting: {"skill:reading_writing": "ordinary", "difficulty": "ordinary"}. Feature version prompt-only-v1.

| Target | Weight | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 0.007645565781251344} | 0.8418 | 0.0066 | 0.2831 |
| skill:reading_writing | balanced | {"C/alpha": 0.01895224164060671} | 0.8407 | 0.0061 | 0.2855 |
| difficulty | ordinary | {"C/alpha": 25.459624782651638} | 0.4689 | 0.0217 | 1.0663 |
| difficulty | balanced | {"C/alpha": 10.143644365141961} | 0.4667 | 0.0217 | 1.1809 |

| Weight | Seed | Skill F1 | Difficulty F1 | Domain F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8438 | 0.4054 | 0.9848 |
| ordinary | 43 | 0.8438 | 0.4054 | 0.9848 |
| ordinary | 44 | 0.8438 | 0.4054 | 0.9848 |
| balanced | 42 | 0.8437 | 0.4066 | 0.9879 |
| balanced | 43 | 0.8437 | 0.4066 | 0.9879 |
| balanced | 44 | 0.8437 | 0.4066 | 0.9879 |

### skill:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.8592 | 0.8750 | 0.8438 | [0.8269854145120312, 0.8599726829218738] | 0.8179 | 0.2422 | 0.1544 | 0.0182 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Boundaries | 0.5060 | 1.0000 | 0.6720 | 42 | [1.0, 1.0] |
| Central Ideas and Details | 1.0000 | 0.7500 | 0.8571 | 28 | [0.6086568322981367, 0.9032258064516129] |
| Command of Evidence | 0.9667 | 1.0000 | 0.9831 | 29 | [1.0, 1.0] |
| Cross-Text Connections | 1.0000 | 1.0000 | 1.0000 | 12 | [1.0, 1.0] |
| Form, Structure, and Sense | 0.0000 | 0.0000 | 0.0000 | 41 | [0.0, 0.0] |
| Inferences | 1.0000 | 1.0000 | 1.0000 | 28 | [1.0, 1.0] |
| Rhetorical Synthesis | 0.8889 | 1.0000 | 0.9412 | 40 | [1.0, 1.0] |
| Text Structure and Purpose | 0.9697 | 1.0000 | 0.9846 | 32 | [1.0, 1.0] |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 | [1.0, 1.0] |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 | [1.0, 1.0] |

Confusion labels: ["Boundaries", "Central Ideas and Details", "Command of Evidence", "Cross-Text Connections", "Form, Structure, and Sense", "Inferences", "Rhetorical Synthesis", "Text Structure and Purpose", "Transitions", "Words in Context"]. Rows=true; columns=predicted.

```json
[[42, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 21, 1, 0, 0, 0, 5, 1, 0, 0], [0, 0, 29, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 12, 0, 0, 0, 0, 0, 0], [41, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 28, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 40, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 32, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 37, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 52]]
```

Policy {"temperature": 1.9575603673909976, "threshold": 0.52, "fitted_on": "training_out_of_fold_only"}; coverage 0.9912; abstention 0.0088; retained 338; precision 0.8639; exact retained-precision CI [np.float64(0.8226710445798344), np.float64(0.8986093862285658)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.9912 | 0.8639 |
| 0.7000 | 0.7449 | 0.9803 |
| 0.8000 | 0.7419 | 0.9842 |
| 0.9000 | 0.7390 | 0.9841 |
| 0.9500 | 0.7331 | 0.9880 |

Rare classes: ['Cross-Text Connections']; long-prompt slice: {"count": 0}.

### difficulty

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.4268 | 0.4273 | 0.4054 | [0.35601985683532655, 0.45674062353998246] | 0.4057 | 1.0995 | 0.6618 | 0.0720 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Easy | 0.4269 | 0.6822 | 0.5252 | 107 | [0.6088120899718839, 0.7757009345794392] |
| Medium | 0.4231 | 0.3826 | 0.4018 | 115 | [0.2965719644345651, 0.48295817369093236] |
| Hard | 0.4340 | 0.2170 | 0.2893 | 106 | [0.1358896564600448, 0.30195867026055706] |

Confusion labels: ["1", "3", "5"]. Rows=true; columns=predicted.

```json
[[73, 24, 10], [51, 44, 20], [47, 36, 23]]
```

Policy {"temperature": 1.6701275746241606, "threshold": null, "fitted_on": "training_out_of_fold_only"}; coverage 0.0000; abstention 1.0000; retained 0; precision —; exact retained-precision CI unavailable. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.2378 | 0.5641 |
| 0.7000 | 0.0000 | — |
| 0.8000 | 0.0000 | — |
| 0.9000 | 0.0000 | — |
| 0.9500 | 0.0000 | — |

Rare classes: []; long-prompt slice: {"count": 0}.

Ordinal step error 0.7470; Easy↔Hard error 0.1738.

### domain:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.9853 | 0.9853 | 0.9848 | [0.9709544807943218, 0.9968379021218754] | 0.9853 | 0.0543 | 0.0252 | 0.0060 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Craft and Structure | 0.9897 | 1.0000 | 0.9948 | 96 | [1.0, 1.0] |
| Expression of Ideas | 0.9506 | 1.0000 | 0.9747 | 77 | [1.0, 1.0] |
| Information and Ideas | 1.0000 | 0.9412 | 0.9697 | 85 | [0.8876325367937964, 0.9870171495171495] |
| Standard English Conventions | 1.0000 | 1.0000 | 1.0000 | 83 | [1.0, 1.0] |

Confusion labels: ["Craft and Structure", "Expression of Ideas", "Information and Ideas", "Standard English Conventions"]. Rows=true; columns=predicted.

```json
[[96, 0, 0, 0], [0, 77, 0, 0], [1, 4, 80, 0], [0, 0, 0, 83]]
```

Policy {"threshold": 0.0}; coverage 1.0000; abstention 0.0000; retained 341; precision 0.9853; exact retained-precision CI [np.float64(0.9661155156768367), np.float64(0.9952223510986715)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.9912 | 0.9882 |
| 0.7000 | 0.9883 | 0.9881 |
| 0.8000 | 0.9853 | 0.9911 |
| 0.9000 | 0.9853 | 0.9911 |
| 0.9500 | 0.9795 | 0.9940 |

Rare classes: []; long-prompt slice: null.

### Operational measurements

Hardware: {"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}. CPU ≤8 threads, one experiment at a time. Main-process peak memory 327.75 MiB; HTTP subprocess peak memory is not instrumented. Feature preparation/cache-read time 0.00s; total recorded method wall time 188.00s; artifact size 6.59 MiB; load 0.171s.

| Path | p50 ms | p95 ms | p99 ms | questions/s |
| --- | --- | --- | --- | --- |
| direct | 3.6921 | 6.2972 | 7.2498 | 250.3910 |
| api_serial | 13.7547 | 32.1079 | 34.9153 | 65.7451 |

100 direct questions 0.389s; 100 HTTP questions 1.442s. Ten warm-ups, three validation passes, fresh prompt encoding with cache reads disabled during both direct/API benchmarks. Classifier-only cached-feature measurements: null.

Four-client burst load (429 is intentional busy rejection, not an unexpected error): {"clients": 4, "attempts": 1023, "successful": 433, "busy_429": 590, "other_errors": 0, "elapsed_seconds": 3.244991400046274, "successful_questions_per_second": 133.43640910537556, "successful_latency": {"requests": 433, "p50_ms": 13.128899969160557, "p95_ms": 26.32022004108876, "p99_ms": 34.72430001944305, "elapsed_seconds": 6.3427836002083495, "questions_per_second": 68.26655728657946}}.

Machine metrics [tfidf_nb/results.json](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_nb/results.json>); [experiment manifest](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_nb/experiment-manifest.json>); [verification](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_nb/verification.json>); [configuration freeze](<D:/SAT website/ml-service/artifacts/prompt-only-v1/tfidf_nb/configuration-freeze.json>). Each immutable artifact manifest includes configurations, dependencies, code hashes, and encoder revision.

## Frozen ModernBERT + XGBoost

CV-selected weighting: {"skill:reading_writing": "ordinary", "difficulty": "ordinary"}. Feature version prompt-only-v1.

| Target | Weight | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"max_depth": 4, "reg_lambda": 5} | 0.8389 | 0.0082 | 0.2468 |
| skill:reading_writing | balanced | {"max_depth": 4, "reg_lambda": 1} | 0.8372 | 0.0082 | 0.2451 |
| difficulty | ordinary | {"max_depth": 4, "reg_lambda": 1} | 0.4451 | 0.0211 | 1.0358 |
| difficulty | balanced | {"max_depth": 3, "reg_lambda": 1} | 0.4445 | 0.0204 | 1.0330 |

| Weight | Seed | Skill F1 | Difficulty F1 | Domain F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8361 | 0.4136 | 0.9831 |
| ordinary | 43 | 0.8464 | 0.4198 | 0.9888 |
| ordinary | 44 | 0.8499 | 0.4027 | 0.9887 |
| balanced | 42 | 0.8438 | 0.4139 | 0.9888 |
| balanced | 43 | 0.8409 | 0.4227 | 0.9861 |
| balanced | 44 | 0.8473 | 0.4112 | 0.9888 |

### skill:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.8592 | 0.8612 | 0.8361 | [0.8001858833489929, 0.8551243239776836] | 0.8197 | 0.2588 | 0.1494 | 0.0098 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Boundaries | 0.5060 | 1.0000 | 0.6720 | 42 | [1.0, 1.0] |
| Central Ideas and Details | 0.9615 | 0.8929 | 0.9259 | 28 | [0.7811631944444445, 1.0] |
| Command of Evidence | 0.9062 | 1.0000 | 0.9508 | 29 | [1.0, 1.0] |
| Cross-Text Connections | 1.0000 | 0.7500 | 0.8571 | 12 | [0.4444444444444444, 1.0] |
| Form, Structure, and Sense | 0.0000 | 0.0000 | 0.0000 | 41 | [0.0, 0.0] |
| Inferences | 1.0000 | 1.0000 | 1.0000 | 28 | [1.0, 1.0] |
| Rhetorical Synthesis | 1.0000 | 1.0000 | 1.0000 | 40 | [1.0, 1.0] |
| Text Structure and Purpose | 0.9688 | 0.9688 | 0.9688 | 32 | [0.8927579365079366, 1.0] |
| Transitions | 0.9737 | 1.0000 | 0.9867 | 37 | [1.0, 1.0] |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 | [1.0, 1.0] |

Confusion labels: ["Boundaries", "Central Ideas and Details", "Command of Evidence", "Cross-Text Connections", "Form, Structure, and Sense", "Inferences", "Rhetorical Synthesis", "Text Structure and Purpose", "Transitions", "Words in Context"]. Rows=true; columns=predicted.

```json
[[42, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 25, 2, 0, 0, 0, 0, 1, 0, 0], [0, 0, 29, 0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 9, 0, 0, 0, 0, 1, 0], [41, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 28, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 40, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 31, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 37, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 52]]
```

Policy {"temperature": 0.8173438871427768, "threshold": 0.51, "fitted_on": "training_out_of_fold_only"}; coverage 0.7419; abstention 0.2581; retained 253; precision 0.9842; exact retained-precision CI [np.float64(0.9600164152842781), np.float64(0.9956758632342011)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.9853 | 0.8661 |
| 0.7000 | 0.7331 | 0.9960 |
| 0.8000 | 0.7273 | 0.9960 |
| 0.9000 | 0.7067 | 1.0000 |
| 0.9500 | 0.7009 | 1.0000 |

Rare classes: ['Cross-Text Connections']; long-prompt slice: {"count": 0}.

### difficulty

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.4299 | 0.4324 | 0.4136 | [0.3643149245921035, 0.46285554571463894] | 0.4126 | 1.0656 | 0.6443 | 0.0555 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Easy | 0.4181 | 0.6916 | 0.5211 | 107 | [0.6151785714285715, 0.7757258869431086] |
| Medium | 0.4390 | 0.3130 | 0.3655 | 115 | [0.22876332343176656, 0.4103603603603604] |
| Hard | 0.4493 | 0.2925 | 0.3543 | 106 | [0.19822550757331617, 0.395628078817734] |

Confusion labels: ["1", "3", "5"]. Rows=true; columns=predicted.

```json
[[74, 21, 12], [53, 36, 26], [50, 25, 31]]
```

Policy {"temperature": 1.037177518961867, "threshold": null, "fitted_on": "training_out_of_fold_only"}; coverage 0.0000; abstention 1.0000; retained 0; precision —; exact retained-precision CI unavailable. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.2774 | 0.5165 |
| 0.7000 | 0.0366 | 0.6667 |
| 0.8000 | 0.0030 | 1.0000 |
| 0.9000 | 0.0000 | — |
| 0.9500 | 0.0000 | — |

Rare classes: []; long-prompt slice: {"count": 0}.

Ordinal step error 0.7591; Easy↔Hard error 0.1890.

### domain:reading_writing

| Accuracy | Balanced accuracy | Macro F1 | 95% CI | Weighted F1 | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.9824 | 0.9840 | 0.9831 | [0.9654707304982008, 0.9944163117298142] | 0.9823 | 0.0517 | 0.0225 | 0.0076 |

| Class | Precision | Recall | F1 | Support | Recall 95% CI |
| --- | --- | --- | --- | --- | --- |
| Craft and Structure | 0.9891 | 0.9479 | 0.9681 | 96 | [0.8921301688992429, 0.989247311827957] |
| Expression of Ideas | 0.9872 | 1.0000 | 0.9935 | 77 | [1.0, 1.0] |
| Information and Ideas | 0.9655 | 0.9882 | 0.9767 | 85 | [0.956485100146556, 1.0] |
| Standard English Conventions | 0.9881 | 1.0000 | 0.9940 | 83 | [1.0, 1.0] |

Confusion labels: ["Craft and Structure", "Expression of Ideas", "Information and Ideas", "Standard English Conventions"]. Rows=true; columns=predicted.

```json
[[91, 1, 3, 1], [0, 77, 0, 0], [1, 0, 84, 0], [0, 0, 0, 83]]
```

Policy {"threshold": 0.0}; coverage 1.0000; abstention 0.0000; retained 341; precision 0.9824; exact retained-precision CI [np.float64(0.9620976965351336), np.float64(0.9935161451867638)]. Small retained samples cannot establish the precision target.

| Threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5000 | 0.9971 | 0.9853 |
| 0.7000 | 0.9824 | 0.9940 |
| 0.8000 | 0.9765 | 0.9970 |
| 0.9000 | 0.9648 | 0.9970 |
| 0.9500 | 0.9560 | 1.0000 |

Rare classes: []; long-prompt slice: null.

### Operational measurements

Hardware: {"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}. CPU ≤8 threads, one experiment at a time. Main-process peak memory 2734.71 MiB; HTTP subprocess peak memory is not instrumented. Feature preparation/cache-read time 27.70s; total recorded method wall time 1526.72s; artifact size 574.16 MiB; load 1.758s.

| Path | p50 ms | p95 ms | p99 ms | questions/s |
| --- | --- | --- | --- | --- |
| direct | 62.3586 | 92.3475 | 111.8031 | 15.1790 |
| api_serial | 77.2376 | 118.5002 | 168.9130 | 11.8421 |

100 direct questions 6.838s; 100 HTTP questions 11.807s. Ten warm-ups, three validation passes, fresh prompt encoding with cache reads disabled during both direct/API benchmarks. Classifier-only cached-feature measurements: {"requests": 1023, "p50_ms": 2.5800999719649553, "p95_ms": 3.4604599233716726, "p99_ms": 4.748743954114616, "elapsed_seconds": 2.607273501693271, "questions_per_second": 392.3639001952122, "feature_preparation_seconds": 15.477822099928744, "excludes_encoder_and_api": true}.

Four-client burst load (429 is intentional busy rejection, not an unexpected error): {"clients": 4, "attempts": 1023, "successful": 13, "busy_429": 1010, "other_errors": 0, "elapsed_seconds": 3.463535499991849, "successful_questions_per_second": 3.75339014138316, "successful_latency": {"requests": 13, "p50_ms": 271.44979999866337, "p95_ms": 372.3594800336286, "p99_ms": 391.18589605670417, "elapsed_seconds": 3.5814741001231596, "questions_per_second": 3.6297903144275026}}.

Machine metrics [embedding_xgb/results.json](<D:/SAT website/ml-service/artifacts/prompt-only-v1/embedding_xgb/results.json>); [experiment manifest](<D:/SAT website/ml-service/artifacts/prompt-only-v1/embedding_xgb/experiment-manifest.json>); [verification](<D:/SAT website/ml-service/artifacts/prompt-only-v1/embedding_xgb/verification.json>); [configuration freeze](<D:/SAT website/ml-service/artifacts/prompt-only-v1/embedding_xgb/configuration-freeze.json>). Each immutable artifact manifest includes configurations, dependencies, code hashes, and encoder revision.

## Interpretation and limitations

Prompt-only removes the actual passage and answer-option evidence, so difficulty predictions may collapse toward prompt-template class proportions. Shared templates with conflicting difficulty labels are irreducible ambiguity for this input. Per-class support/recall, confidence/coverage, and paired differences matter more than raw accuracy. Cross-Text Connections has only 12 validation rows; zero-error bootstrap intervals do not establish population perfection. No independent full-length holdout, image evidence, or unseen-template test has been evaluated. No automatic promotion.
