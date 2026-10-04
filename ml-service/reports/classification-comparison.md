# Baseline: TF-IDF + logistic regression

## Methods and reproducibility

Independent skill and difficulty estimators; domain probabilities are aggregated from skill. Inputs contain section, type, passage, prompt, and ordered choices, without answer keys, explanations, or source identifiers. Ordinary and inverse-frequency class-balanced losses use training-fold counts only. Parameters and weighting are selected using five-fold CV inside the frozen training 80%; calibration and suggestion thresholds use training out-of-fold predictions. The outer 20% is final validation, not an independent test.

Dataset version: `0d78eb3734e065ed`. Seed 42 split; final fit seeds 42, 43, 44. 1710 eligible text questions, 1691 verified difficulty labels. 2 audited casing normalizations; 2 image-dependent exclusions and 1 invalid-input exclusions. 1710 indivisible groups; largest group 1. The compiled bank is treated as a container; shared passages and duplicate/content groups remain intact.

| Split | Questions | % | Verified difficulty |
| --- | --- | --- | --- |
| train | 1369 | 80.06 | 1363 |
| validation | 341 | 19.94 | 328 |

| Skill | All | Train | Validation |
| --- | --- | --- | --- |
| Boundaries | 213 | 171 | 42 |
| Central Ideas and Details | 137 | 109 | 28 |
| Command of Evidence | 144 | 115 | 29 |
| Cross-Text Connections | 61 | 49 | 12 |
| Form, Structure, and Sense | 208 | 167 | 41 |
| Inferences | 140 | 112 | 28 |
| Rhetorical Synthesis | 204 | 164 | 40 |
| Text Structure and Purpose | 149 | 117 | 32 |
| Transitions | 194 | 157 | 37 |
| Words in Context | 260 | 208 | 52 |

| Difficulty | All | Train | Validation |
| --- | --- | --- | --- |
| Easy | 555 | 448 | 107 |
| Medium | 582 | 467 | 115 |
| Hard | 554 | 448 | 106 |

Unknown difficulty provenance: 6 training and 13 validation questions. This missing-label subset is not an explicit stratification target; its split is uneven. The observed-label distributions and exact counts above are retained without post-result resplitting.

Deterministic greedy assignment and local improvements minimize normalized deviations: total-size weight 4, skill and verified-difficulty marginal weights 1 per target, and joint-combination weight 0.2. Groups are indivisible; seed 42 hashes break ordering ties. Identical membership is reused by both estimators and methods.

| Inner CV fold | Held-out questions | Verified difficulty | Skill counts |
| --- | --- | --- | --- |
| 0 | 274 | 273 | {"Boundaries": 34, "Central Ideas and Details": 21, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 33, "Inferences": 23, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 23, "Transitions": 32, "Words in Context": 42} |
| 1 | 274 | 272 | {"Boundaries": 34, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 34, "Inferences": 22, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 24, "Transitions": 31, "Words in Context": 41} |
| 2 | 274 | 272 | {"Boundaries": 34, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 34, "Inferences": 22, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 23, "Transitions": 32, "Words in Context": 41} |
| 3 | 274 | 273 | {"Boundaries": 35, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 33, "Inferences": 22, "Rhetorical Synthesis": 32, "Text Structure and Purpose": 24, "Transitions": 31, "Words in Context": 42} |
| 4 | 273 | 273 | {"Boundaries": 34, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 9, "Form, Structure, and Sense": 33, "Inferences": 23, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 23, "Transitions": 31, "Words in Context": 42} |

Word TF-IDF (1–2 grams) and character TF-IDF (2–5 grams), each capped at 30,000 features; logistic regression, C ∈ {0.1, 1, 10}. Vocabulary and IDF are fitted separately within each training fold.

## Cross-validation experiments

Each configuration has five fits. Selection maximizes mean macro-F1, then minimizes log loss, then prefers smaller C/depth and stronger tree regularization. Weighting ties prefer ordinary loss.

| Target | Loss | Parameters | Macro-F1 mean | SD | Log loss | Fit/evaluate seconds |
| --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C": 0.1} | 0.5115 | 0.0245 | 1.6918 | 17.50 |
| skill:reading_writing | ordinary | {"C": 1.0} | 0.9097 | 0.0215 | 0.7774 | 24.79 |
| skill:reading_writing | ordinary | {"C": 10.0} | 0.9354 | 0.0105 | 0.3870 | 29.72 |
| skill:reading_writing | balanced | {"C": 0.1} | 0.8526 | 0.0222 | 1.7580 | 15.95 |
| skill:reading_writing | balanced | {"C": 1.0} | 0.9272 | 0.0187 | 0.7816 | 21.52 |
| skill:reading_writing | balanced | {"C": 10.0} | 0.9387 | 0.0164 | 0.3811 | 27.41 |
| difficulty | ordinary | {"C": 0.1} | 0.4989 | 0.0256 | 1.0324 | 13.64 |
| difficulty | ordinary | {"C": 1.0} | 0.5298 | 0.0182 | 0.9510 | 15.54 |
| difficulty | ordinary | {"C": 10.0} | 0.5335 | 0.0206 | 0.9729 | 17.41 |
| difficulty | balanced | {"C": 0.1} | 0.4962 | 0.0234 | 1.0322 | 13.60 |
| difficulty | balanced | {"C": 1.0} | 0.5321 | 0.0227 | 0.9508 | 16.57 |
| difficulty | balanced | {"C": 10.0} | 0.5326 | 0.0204 | 0.9731 | 18.86 |

CV-selected weighting per target: `{"skill:reading_writing": "balanced", "difficulty": "ordinary"}`. Final-validation outcomes below did not influence this choice.

## Final-validation results

The logistic-regression solver is deterministic here: changing its seed alone yields identical final predictions. These repeated fits are not independent datasets; CV fold variation and bootstrap intervals provide more useful uncertainty estimates.

### Ordinary loss, seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9003 | 0.8876 | 0.8918 | 0.8990 | 0.2229 | 0.1248 | 0.0276 | [0.8468, 0.9211] |
| domain:reading_writing | 341 | 0.9853 | 0.9870 | 0.9862 | 0.9854 | 0.0450 | 0.0223 | 0.0072 | [0.9734, 0.9948] |
| difficulty | 328 | 0.5335 | 0.5372 | 0.5323 | 0.5294 | 0.9472 | 0.5713 | 0.0505 | [0.4834, 0.5821] |

Both skill and difficulty correct: 0.4848 on 328 questions. Difficulty ordinal MAE: 0.5488; Easy↔Hard error rate: 0.0823.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5348, 0.8293] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8261 | 0.6786 | [0.4996, 0.8392] | 0.7451 |  |
| Command of Evidence | 29 | 0.9032 | 0.9655 | [0.8887, 1.0000] | 0.9333 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.7500 | [0.4543, 1.0000] | 0.8571 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7498, 0.9556] | 0.7865 |  |
| Inferences | 28 | 0.7778 | 1.0000 | [1.0000, 1.0000] | 0.8750 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 3 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 28 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 2 | 0 | 9 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9003.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.9137 |
| 0.7 | 0.8827 | 0.9601 |
| 0.8 | 0.8446 | 0.9792 |
| 0.9 | 0.7566 | 0.9884 |
| 0.95 | 0.7097 | 0.9917 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9479 | [0.9012, 0.9802] | 0.9733 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 91 | 0 | 5 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9853.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9883 | 0.9911 |
| 0.8 | 0.9765 | 0.9940 |
| 0.9 | 0.9355 | 0.9969 |
| 0.95 | 0.9003 | 0.9967 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5882 | 0.6542 | [0.5824, 0.7389] | 0.6195 |  |
| 3 | 115 | 0.4455 | 0.3913 | [0.2871, 0.4900] | 0.4167 |  |
| 5 | 106 | 0.5556 | 0.5660 | [0.4700, 0.6618] | 0.5607 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 70 | 24 | 13 |
| 3 | 35 | 45 | 35 |
| 5 | 14 | 32 | 60 |

Suggestion threshold: 0.8100; coverage: 0.0457; abstention: 0.9543; retained precision: 0.8667.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5915 | 0.5979 |
| 0.7 | 0.1646 | 0.7963 |
| 0.8 | 0.0549 | 0.8333 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 5.697598799946718, "difficulty": 3.3981871999567375}`. Evaluation: 3.10 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/ordinary-seed42/manifest.json>).

### Ordinary loss, seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9003 | 0.8876 | 0.8918 | 0.8990 | 0.2229 | 0.1248 | 0.0276 | [0.8468, 0.9211] |
| domain:reading_writing | 341 | 0.9853 | 0.9870 | 0.9862 | 0.9854 | 0.0450 | 0.0223 | 0.0072 | [0.9734, 0.9948] |
| difficulty | 328 | 0.5335 | 0.5372 | 0.5323 | 0.5294 | 0.9472 | 0.5713 | 0.0505 | [0.4834, 0.5821] |

Both skill and difficulty correct: 0.4848 on 328 questions. Difficulty ordinal MAE: 0.5488; Easy↔Hard error rate: 0.0823.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5348, 0.8293] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8261 | 0.6786 | [0.4996, 0.8392] | 0.7451 |  |
| Command of Evidence | 29 | 0.9032 | 0.9655 | [0.8887, 1.0000] | 0.9333 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.7500 | [0.4543, 1.0000] | 0.8571 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7498, 0.9556] | 0.7865 |  |
| Inferences | 28 | 0.7778 | 1.0000 | [1.0000, 1.0000] | 0.8750 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 3 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 28 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 2 | 0 | 9 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9003.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.9137 |
| 0.7 | 0.8827 | 0.9601 |
| 0.8 | 0.8446 | 0.9792 |
| 0.9 | 0.7566 | 0.9884 |
| 0.95 | 0.7097 | 0.9917 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9479 | [0.9012, 0.9802] | 0.9733 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 91 | 0 | 5 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9853.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9883 | 0.9911 |
| 0.8 | 0.9765 | 0.9940 |
| 0.9 | 0.9355 | 0.9969 |
| 0.95 | 0.9003 | 0.9967 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5882 | 0.6542 | [0.5824, 0.7389] | 0.6195 |  |
| 3 | 115 | 0.4455 | 0.3913 | [0.2871, 0.4900] | 0.4167 |  |
| 5 | 106 | 0.5556 | 0.5660 | [0.4700, 0.6618] | 0.5607 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 70 | 24 | 13 |
| 3 | 35 | 45 | 35 |
| 5 | 14 | 32 | 60 |

Suggestion threshold: 0.8100; coverage: 0.0457; abstention: 0.9543; retained precision: 0.8667.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5915 | 0.5979 |
| 0.7 | 0.1646 | 0.7963 |
| 0.8 | 0.0549 | 0.8333 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 6.1783015000401065, "difficulty": 3.5615236000157893}`. Evaluation: 3.11 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/ordinary-seed43/manifest.json>).

### Ordinary loss, seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9003 | 0.8876 | 0.8918 | 0.8990 | 0.2229 | 0.1248 | 0.0276 | [0.8468, 0.9211] |
| domain:reading_writing | 341 | 0.9853 | 0.9870 | 0.9862 | 0.9854 | 0.0450 | 0.0223 | 0.0072 | [0.9734, 0.9948] |
| difficulty | 328 | 0.5335 | 0.5372 | 0.5323 | 0.5294 | 0.9472 | 0.5713 | 0.0505 | [0.4834, 0.5821] |

Both skill and difficulty correct: 0.4848 on 328 questions. Difficulty ordinal MAE: 0.5488; Easy↔Hard error rate: 0.0823.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5348, 0.8293] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8261 | 0.6786 | [0.4996, 0.8392] | 0.7451 |  |
| Command of Evidence | 29 | 0.9032 | 0.9655 | [0.8887, 1.0000] | 0.9333 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.7500 | [0.4543, 1.0000] | 0.8571 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7498, 0.9556] | 0.7865 |  |
| Inferences | 28 | 0.7778 | 1.0000 | [1.0000, 1.0000] | 0.8750 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 3 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 28 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 2 | 0 | 9 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9003.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.9137 |
| 0.7 | 0.8827 | 0.9601 |
| 0.8 | 0.8446 | 0.9792 |
| 0.9 | 0.7566 | 0.9884 |
| 0.95 | 0.7097 | 0.9917 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9479 | [0.9012, 0.9802] | 0.9733 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 91 | 0 | 5 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9853.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9883 | 0.9911 |
| 0.8 | 0.9765 | 0.9940 |
| 0.9 | 0.9355 | 0.9969 |
| 0.95 | 0.9003 | 0.9967 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5882 | 0.6542 | [0.5824, 0.7389] | 0.6195 |  |
| 3 | 115 | 0.4455 | 0.3913 | [0.2871, 0.4900] | 0.4167 |  |
| 5 | 106 | 0.5556 | 0.5660 | [0.4700, 0.6618] | 0.5607 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 70 | 24 | 13 |
| 3 | 35 | 45 | 35 |
| 5 | 14 | 32 | 60 |

Suggestion threshold: 0.8100; coverage: 0.0457; abstention: 0.9543; retained precision: 0.8667.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5915 | 0.5979 |
| 0.7 | 0.1646 | 0.7963 |
| 0.8 | 0.0549 | 0.8333 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 5.935265299980529, "difficulty": 3.442354000057094}`. Evaluation: 3.05 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/ordinary-seed44/manifest.json>).

### Balanced loss, seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9032 | 0.8959 | 0.8985 | 0.9021 | 0.2138 | 0.1209 | 0.0283 | [0.8680, 0.9298] |
| domain:reading_writing | 341 | 0.9883 | 0.9896 | 0.9889 | 0.9883 | 0.0379 | 0.0187 | 0.0075 | [0.9781, 0.9972] |
| difficulty | 328 | 0.5213 | 0.5253 | 0.5190 | 0.5159 | 0.9484 | 0.5715 | 0.0608 | [0.4689, 0.5752] |

Both skill and difficulty correct: 0.4726 on 328 questions. Difficulty ordinal MAE: 0.5640; Easy↔Hard error rate: 0.0854.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5348, 0.8293] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8636 | 0.6786 | [0.4996, 0.8392] | 0.7600 |  |
| Command of Evidence | 29 | 0.9032 | 0.9655 | [0.8887, 1.0000] | 0.9333 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7498, 0.9556] | 0.7865 |  |
| Inferences | 28 | 0.7778 | 1.0000 | [1.0000, 1.0000] | 0.8750 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 3 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 28 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9032.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.9167 |
| 0.7 | 0.8768 | 0.9666 |
| 0.8 | 0.8416 | 0.9826 |
| 0.9 | 0.7625 | 0.9885 |
| 0.95 | 0.7155 | 0.9918 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9551 | 1.0000 | [1.0000, 1.0000] | 0.9770 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9883.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9883 |
| 0.7 | 0.9853 | 0.9940 |
| 0.8 | 0.9707 | 0.9970 |
| 0.9 | 0.9472 | 0.9969 |
| 0.95 | 0.9032 | 0.9968 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5738 | 0.6542 | [0.5700, 0.7373] | 0.6114 |  |
| 3 | 115 | 0.4286 | 0.3652 | [0.2710, 0.4701] | 0.3944 |  |
| 5 | 106 | 0.5463 | 0.5566 | [0.4600, 0.6577] | 0.5514 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 70 | 24 | 13 |
| 3 | 37 | 42 | 36 |
| 5 | 15 | 32 | 59 |

Suggestion threshold: 0.8100; coverage: 0.0457; abstention: 0.9543; retained precision: 0.8667.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5884 | 0.6114 |
| 0.7 | 0.1829 | 0.8000 |
| 0.8 | 0.0549 | 0.8889 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 6.472913900041021, "difficulty": 4.068297500023618}`. Evaluation: 3.18 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/balanced-seed42/manifest.json>).

### Balanced loss, seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9032 | 0.8959 | 0.8985 | 0.9021 | 0.2138 | 0.1209 | 0.0283 | [0.8680, 0.9298] |
| domain:reading_writing | 341 | 0.9883 | 0.9896 | 0.9889 | 0.9883 | 0.0379 | 0.0187 | 0.0075 | [0.9781, 0.9972] |
| difficulty | 328 | 0.5213 | 0.5253 | 0.5190 | 0.5159 | 0.9484 | 0.5715 | 0.0608 | [0.4689, 0.5752] |

Both skill and difficulty correct: 0.4726 on 328 questions. Difficulty ordinal MAE: 0.5640; Easy↔Hard error rate: 0.0854.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5348, 0.8293] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8636 | 0.6786 | [0.4996, 0.8392] | 0.7600 |  |
| Command of Evidence | 29 | 0.9032 | 0.9655 | [0.8887, 1.0000] | 0.9333 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7498, 0.9556] | 0.7865 |  |
| Inferences | 28 | 0.7778 | 1.0000 | [1.0000, 1.0000] | 0.8750 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 3 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 28 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9032.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.9167 |
| 0.7 | 0.8768 | 0.9666 |
| 0.8 | 0.8416 | 0.9826 |
| 0.9 | 0.7625 | 0.9885 |
| 0.95 | 0.7155 | 0.9918 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9551 | 1.0000 | [1.0000, 1.0000] | 0.9770 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9883.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9883 |
| 0.7 | 0.9853 | 0.9940 |
| 0.8 | 0.9707 | 0.9970 |
| 0.9 | 0.9472 | 0.9969 |
| 0.95 | 0.9032 | 0.9968 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5738 | 0.6542 | [0.5700, 0.7373] | 0.6114 |  |
| 3 | 115 | 0.4286 | 0.3652 | [0.2710, 0.4701] | 0.3944 |  |
| 5 | 106 | 0.5463 | 0.5566 | [0.4600, 0.6577] | 0.5514 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 70 | 24 | 13 |
| 3 | 37 | 42 | 36 |
| 5 | 15 | 32 | 59 |

Suggestion threshold: 0.8100; coverage: 0.0457; abstention: 0.9543; retained precision: 0.8667.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5884 | 0.6114 |
| 0.7 | 0.1829 | 0.8000 |
| 0.8 | 0.0549 | 0.8889 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 6.371724500088021, "difficulty": 4.205457199946977}`. Evaluation: 3.08 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/balanced-seed43/manifest.json>).

### Balanced loss, seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9032 | 0.8959 | 0.8985 | 0.9021 | 0.2138 | 0.1209 | 0.0283 | [0.8680, 0.9298] |
| domain:reading_writing | 341 | 0.9883 | 0.9896 | 0.9889 | 0.9883 | 0.0379 | 0.0187 | 0.0075 | [0.9781, 0.9972] |
| difficulty | 328 | 0.5213 | 0.5253 | 0.5190 | 0.5159 | 0.9484 | 0.5715 | 0.0608 | [0.4689, 0.5752] |

Both skill and difficulty correct: 0.4726 on 328 questions. Difficulty ordinal MAE: 0.5640; Easy↔Hard error rate: 0.0854.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5348, 0.8293] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8636 | 0.6786 | [0.4996, 0.8392] | 0.7600 |  |
| Command of Evidence | 29 | 0.9032 | 0.9655 | [0.8887, 1.0000] | 0.9333 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7498, 0.9556] | 0.7865 |  |
| Inferences | 28 | 0.7778 | 1.0000 | [1.0000, 1.0000] | 0.8750 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 3 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 28 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9032.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.9167 |
| 0.7 | 0.8768 | 0.9666 |
| 0.8 | 0.8416 | 0.9826 |
| 0.9 | 0.7625 | 0.9885 |
| 0.95 | 0.7155 | 0.9918 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9551 | 1.0000 | [1.0000, 1.0000] | 0.9770 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9883.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9883 |
| 0.7 | 0.9853 | 0.9940 |
| 0.8 | 0.9707 | 0.9970 |
| 0.9 | 0.9472 | 0.9969 |
| 0.95 | 0.9032 | 0.9968 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5738 | 0.6542 | [0.5700, 0.7373] | 0.6114 |  |
| 3 | 115 | 0.4286 | 0.3652 | [0.2710, 0.4701] | 0.3944 |  |
| 5 | 106 | 0.5463 | 0.5566 | [0.4600, 0.6577] | 0.5514 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 70 | 24 | 13 |
| 3 | 37 | 42 | 36 |
| 5 | 15 | 32 | 59 |

Suggestion threshold: 0.8100; coverage: 0.0457; abstention: 0.9543; retained precision: 0.8667.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5884 | 0.6114 |
| 0.7 | 0.1829 | 0.8000 |
| 0.8 | 0.0549 | 0.8889 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 6.331902700010687, "difficulty": 4.058186599984765}`. Evaluation: 3.03 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/balanced-seed44/manifest.json>).

## Runtime, throughput, and resource usage

Hardware/software: `{"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}`. Eight-thread ceiling, CPU only, one experiment at a time. Dependency versions and code revision are in each artifact manifest; the implementation is an unpushed working-tree change.

TF-IDF vocabulary/IDF fitting and transforms are included in the measured fit/evaluate times; a separate feature-preparation timer was not recorded.

| Measurement | Seconds / value |
| --- | --- |
| Total phase wall time | 379.82 |
| CV accumulated fit/evaluate time | 232.52 |
| Encoder loading + training embedding extraction | 0.00 |
| Validation embedding preparation | 0.00 |
| Feature cache bytes | 0 |
| Artifact bytes | 10712252 |
| Artifact reload | 0.38 |
| API startup | 2.82 |
| Peak experiment process memory MB | 541.35 |
| Direct 100-question time | 0.56 |
| Serial API first 100-question time | 1.46 |

| Path | Requests | p50 ms | p95 ms | p99 ms | Questions/sec |
| --- | --- | --- | --- | --- | --- |
| Direct, complete prediction | 1023 | 5.57 | 8.98 | 10.84 | 170.42 |
| Private HTTP API, serial | 1023 | 10.92 | 31.93 | 35.65 | 65.64 |

Four-client load: 1023 attempts, 449 successful, 574 busy (429), 0 other errors; 4.36 seconds, 102.92 successful questions/sec. The API intentionally serializes inference and returns 429 for overlap; busy responses are not counted as successful classification throughput.

Four-client successful-request p50/p95/p99: 19.21/35.13/42.17 ms. Load-test clients do not retry 429 responses; this burst result is not sustained capacity under backoff.

Ten warm-ups, three full validation passes per serial path. XGBoost complete paths include tokenization, encoding, features, both heads, calibration, and output construction; no feature-cache reads. Process peak memory is measured over the phase and is not total system or simultaneous parent/API memory. Cold loading is separate from warmed latency.

## Limitations and machine-readable evidence

One R&W bank source; no independently human-labeled full-length holdout, Math coverage, or visual evaluation. Rare-class recalls and joint label combinations have small support; group-bootstrap intervals do not address source-domain shift. A training-OOF target of 90% suggestion precision does not guarantee 90% on final validation or future imports. These results do not promote or deploy a model.

The artifacts record Git revision and a dirty-working-tree flag. A post-experiment source snapshot preserves the verified implementation; exact dirty-source hashes at the start of each training fit were not recorded. That historical code-lineage limitation is retained rather than rewriting trained artifact manifests.

[Complete metrics and predictions](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/results.json>) · [Frozen configurations](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/configuration-freeze.json>) · [Dataset and fold audit](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/dataset/manifest.json>).

[Verification and source evidence](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/verification.json>).

# Frozen ModernBERT + XGBoost

## Methods and reproducibility

Independent skill and difficulty estimators; domain probabilities are aggregated from skill. Inputs contain section, type, passage, prompt, and ordered choices, without answer keys, explanations, or source identifiers. Ordinary and inverse-frequency class-balanced losses use training-fold counts only. Parameters and weighting are selected using five-fold CV inside the frozen training 80%; calibration and suggestion thresholds use training out-of-fold predictions. The outer 20% is final validation, not an independent test.

Dataset version: `0d78eb3734e065ed`. Seed 42 split; final fit seeds 42, 43, 44. 1710 eligible text questions, 1691 verified difficulty labels. 2 audited casing normalizations; 2 image-dependent exclusions and 1 invalid-input exclusions. 1710 indivisible groups; largest group 1. The compiled bank is treated as a container; shared passages and duplicate/content groups remain intact.

| Split | Questions | % | Verified difficulty |
| --- | --- | --- | --- |
| train | 1369 | 80.06 | 1363 |
| validation | 341 | 19.94 | 328 |

| Skill | All | Train | Validation |
| --- | --- | --- | --- |
| Boundaries | 213 | 171 | 42 |
| Central Ideas and Details | 137 | 109 | 28 |
| Command of Evidence | 144 | 115 | 29 |
| Cross-Text Connections | 61 | 49 | 12 |
| Form, Structure, and Sense | 208 | 167 | 41 |
| Inferences | 140 | 112 | 28 |
| Rhetorical Synthesis | 204 | 164 | 40 |
| Text Structure and Purpose | 149 | 117 | 32 |
| Transitions | 194 | 157 | 37 |
| Words in Context | 260 | 208 | 52 |

| Difficulty | All | Train | Validation |
| --- | --- | --- | --- |
| Easy | 555 | 448 | 107 |
| Medium | 582 | 467 | 115 |
| Hard | 554 | 448 | 106 |

Unknown difficulty provenance: 6 training and 13 validation questions. This missing-label subset is not an explicit stratification target; its split is uneven. The observed-label distributions and exact counts above are retained without post-result resplitting.

Deterministic greedy assignment and local improvements minimize normalized deviations: total-size weight 4, skill and verified-difficulty marginal weights 1 per target, and joint-combination weight 0.2. Groups are indivisible; seed 42 hashes break ordering ties. Identical membership is reused by both estimators and methods.

| Inner CV fold | Held-out questions | Verified difficulty | Skill counts |
| --- | --- | --- | --- |
| 0 | 274 | 273 | {"Boundaries": 34, "Central Ideas and Details": 21, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 33, "Inferences": 23, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 23, "Transitions": 32, "Words in Context": 42} |
| 1 | 274 | 272 | {"Boundaries": 34, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 34, "Inferences": 22, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 24, "Transitions": 31, "Words in Context": 41} |
| 2 | 274 | 272 | {"Boundaries": 34, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 34, "Inferences": 22, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 23, "Transitions": 32, "Words in Context": 41} |
| 3 | 274 | 273 | {"Boundaries": 35, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 10, "Form, Structure, and Sense": 33, "Inferences": 22, "Rhetorical Synthesis": 32, "Text Structure and Purpose": 24, "Transitions": 31, "Words in Context": 42} |
| 4 | 273 | 273 | {"Boundaries": 34, "Central Ideas and Details": 22, "Command of Evidence": 23, "Cross-Text Connections": 9, "Form, Structure, and Sense": 33, "Inferences": 23, "Rhetorical Synthesis": 33, "Text Structure and Purpose": 23, "Transitions": 31, "Words in Context": 42} |

Frozen original `answerdotai/ModernBERT-base`, revision `8949b909ec900327062f0ebf497f51aef5e6f0c8`; masked mean pooling with full passage chunking (1,024 tokens; at most 32 chunks), plus structural features. No encoder fine-tuning, visual features, or dimensionality reduction. XGBoost multiclass probabilities: depth {3,4}, lambda {1,5}, learning rate 0.05, maximum 500 trees, early stopping 25. Final tree counts use median best inner-fold iteration. Embeddings are reused during training; end-to-end benchmarks bypass the cache.

## Cross-validation experiments

Each configuration has five fits. Selection maximizes mean macro-F1, then minimizes log loss, then prefers smaller C/depth and stronger tree regularization. Weighting ties prefer ordinary loss.

| Target | Loss | Parameters | Macro-F1 mean | SD | Log loss | Fit/evaluate seconds |
| --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"max_depth": 3, "reg_lambda": 1} | 0.9018 | 0.0210 | 0.2576 | 186.30 |
| skill:reading_writing | ordinary | {"max_depth": 3, "reg_lambda": 5} | 0.8983 | 0.0204 | 0.2652 | 234.35 |
| skill:reading_writing | ordinary | {"max_depth": 4, "reg_lambda": 1} | 0.9013 | 0.0179 | 0.2607 | 223.52 |
| skill:reading_writing | ordinary | {"max_depth": 4, "reg_lambda": 5} | 0.8987 | 0.0156 | 0.2694 | 295.05 |
| skill:reading_writing | balanced | {"max_depth": 3, "reg_lambda": 1} | 0.8997 | 0.0162 | 0.2619 | 161.54 |
| skill:reading_writing | balanced | {"max_depth": 3, "reg_lambda": 5} | 0.9022 | 0.0173 | 0.2669 | 204.28 |
| skill:reading_writing | balanced | {"max_depth": 4, "reg_lambda": 1} | 0.8966 | 0.0249 | 0.2655 | 189.41 |
| skill:reading_writing | balanced | {"max_depth": 4, "reg_lambda": 5} | 0.8989 | 0.0179 | 0.2745 | 244.09 |
| difficulty | ordinary | {"max_depth": 3, "reg_lambda": 1} | 0.5658 | 0.0309 | 0.9117 | 28.60 |
| difficulty | ordinary | {"max_depth": 3, "reg_lambda": 5} | 0.5703 | 0.0214 | 0.9080 | 35.05 |
| difficulty | ordinary | {"max_depth": 4, "reg_lambda": 1} | 0.5579 | 0.0273 | 0.9091 | 35.94 |
| difficulty | ordinary | {"max_depth": 4, "reg_lambda": 5} | 0.5635 | 0.0183 | 0.9071 | 42.96 |
| difficulty | balanced | {"max_depth": 3, "reg_lambda": 1} | 0.5550 | 0.0214 | 0.9108 | 34.36 |
| difficulty | balanced | {"max_depth": 3, "reg_lambda": 5} | 0.5573 | 0.0276 | 0.9089 | 37.31 |
| difficulty | balanced | {"max_depth": 4, "reg_lambda": 1} | 0.5558 | 0.0154 | 0.9099 | 36.72 |
| difficulty | balanced | {"max_depth": 4, "reg_lambda": 5} | 0.5563 | 0.0315 | 0.9076 | 41.93 |

CV-selected weighting per target: `{"skill:reading_writing": "balanced", "difficulty": "ordinary"}`. Final-validation outcomes below did not influence this choice.

## Final-validation results

### Ordinary loss, seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8915 | 0.8808 | 0.8832 | 0.8898 | 0.3507 | 0.1782 | 0.0491 | [0.8423, 0.9169] |
| domain:reading_writing | 341 | 0.9677 | 0.9687 | 0.9679 | 0.9674 | 0.1114 | 0.0574 | 0.0126 | [0.9503, 0.9860] |
| difficulty | 328 | 0.5579 | 0.5622 | 0.5563 | 0.5527 | 0.9190 | 0.5612 | 0.0465 | [0.5041, 0.6120] |

Both skill and difficulty correct: 0.4909 on 328 questions. Difficulty ordinal MAE: 0.4970; Easy↔Hard error rate: 0.0549.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8421 | 0.7619 | [0.6301, 0.8889] | 0.8000 |  |
| Central Ideas and Details | 28 | 0.8636 | 0.6786 | [0.5139, 0.8334] | 0.7600 |  |
| Command of Evidence | 29 | 0.7931 | 0.7931 | [0.6249, 0.9394] | 0.7931 |  |
| Cross-Text Connections | 12 | 0.9091 | 0.8333 | [0.5550, 1.0000] | 0.8696 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7609 | 0.8537 | [0.7500, 0.9488] | 0.8046 |  |
| Inferences | 28 | 0.9655 | 1.0000 | [1.0000, 1.0000] | 0.9825 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.8788 | 0.9062 | [0.7667, 1.0000] | 0.8923 |  |
| Transitions | 37 | 0.9487 | 1.0000 | [1.0000, 1.0000] | 0.9737 |  |
| Words in Context | 52 | 0.9808 | 0.9808 | [0.9361, 1.0000] | 0.9808 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 32 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 5 | 0 | 1 | 0 | 1 | 1 | 1 | 0 |
| Command of Evidence | 0 | 2 | 23 | 0 | 0 | 0 | 1 | 2 | 0 | 1 |
| Cross-Text Connections | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 29 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 51 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.8915.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9824 | 0.8955 |
| 0.7 | 0.8886 | 0.9208 |
| 0.8 | 0.8152 | 0.9388 |
| 0.9 | 0.7507 | 0.9609 |
| 0.95 | 0.6833 | 0.9785 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9588 | 0.9688 | [0.9333, 1.0000] | 0.9637 |  |
| Expression of Ideas | 77 | 0.9506 | 1.0000 | [1.0000, 1.0000] | 0.9747 |  |
| Information and Ideas | 85 | 0.9747 | 0.9059 | [0.8395, 0.9682] | 0.9390 |  |
| Standard English Conventions | 83 | 0.9881 | 1.0000 | [1.0000, 1.0000] | 0.9940 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 93 | 1 | 2 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 3 | 77 | 1 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9677.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9705 |
| 0.7 | 0.9560 | 0.9755 |
| 0.8 | 0.9208 | 0.9841 |
| 0.9 | 0.8886 | 0.9901 |
| 0.95 | 0.8534 | 0.9897 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6129 | 0.7103 | [0.6336, 0.7911] | 0.6580 |  |
| 3 | 115 | 0.4412 | 0.3913 | [0.3000, 0.5004] | 0.4147 |  |
| 5 | 106 | 0.6078 | 0.5849 | [0.4956, 0.6752] | 0.5962 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 25 | 6 |
| 3 | 36 | 45 | 34 |
| 5 | 12 | 32 | 62 |

Suggestion threshold: Unavailable; coverage: 0.0000; abstention: 1.0000; retained precision: Unavailable.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6616 | 0.6221 |
| 0.7 | 0.2073 | 0.6324 |
| 0.8 | 0.0579 | 0.8421 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 36.13061809993815, "difficulty": 6.724137499928474}`. Evaluation: 7.45 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/ordinary-seed42/manifest.json>).

### Ordinary loss, seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8798 | 0.8691 | 0.8714 | 0.8777 | 0.3455 | 0.1806 | 0.0417 | [0.8298, 0.9069] |
| domain:reading_writing | 341 | 0.9648 | 0.9664 | 0.9655 | 0.9645 | 0.1034 | 0.0563 | 0.0080 | [0.9488, 0.9825] |
| difficulty | 328 | 0.5579 | 0.5616 | 0.5552 | 0.5522 | 0.9173 | 0.5596 | 0.0461 | [0.4983, 0.6122] |

Both skill and difficulty correct: 0.4909 on 328 questions. Difficulty ordinal MAE: 0.5091; Easy↔Hard error rate: 0.0671.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8333 | 0.7143 | [0.5882, 0.8448] | 0.7692 |  |
| Central Ideas and Details | 28 | 0.7917 | 0.6786 | [0.5139, 0.8334] | 0.7308 |  |
| Command of Evidence | 29 | 0.7778 | 0.7241 | [0.5554, 0.8966] | 0.7500 |  |
| Cross-Text Connections | 12 | 0.9091 | 0.8333 | [0.5550, 1.0000] | 0.8696 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7292 | 0.8537 | [0.7426, 0.9445] | 0.7865 |  |
| Inferences | 28 | 0.9655 | 1.0000 | [1.0000, 1.0000] | 0.9825 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.8788 | 0.9062 | [0.7667, 1.0000] | 0.8923 |  |
| Transitions | 37 | 0.9487 | 1.0000 | [1.0000, 1.0000] | 0.9737 |  |
| Words in Context | 52 | 0.9623 | 0.9808 | [0.9361, 1.0000] | 0.9714 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 30 | 0 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 5 | 0 | 1 | 0 | 1 | 1 | 1 | 0 |
| Command of Evidence | 0 | 4 | 21 | 0 | 0 | 0 | 0 | 2 | 0 | 2 |
| Cross-Text Connections | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 29 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 51 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.8798.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9765 | 0.8889 |
| 0.7 | 0.8827 | 0.9236 |
| 0.8 | 0.8328 | 0.9366 |
| 0.9 | 0.7302 | 0.9759 |
| 0.95 | 0.6774 | 0.9827 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9579 | 0.9479 | [0.9031, 0.9821] | 0.9529 |  |
| Expression of Ideas | 77 | 0.9625 | 1.0000 | [1.0000, 1.0000] | 0.9809 |  |
| Information and Ideas | 85 | 0.9512 | 0.9176 | [0.8619, 0.9734] | 0.9341 |  |
| Standard English Conventions | 83 | 0.9881 | 1.0000 | [1.0000, 1.0000] | 0.9940 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 91 | 1 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 2 | 78 | 1 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9648.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9676 |
| 0.7 | 0.9531 | 0.9785 |
| 0.8 | 0.9384 | 0.9844 |
| 0.9 | 0.8739 | 0.9933 |
| 0.95 | 0.8475 | 0.9965 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6142 | 0.7290 | [0.6505, 0.8092] | 0.6667 |  |
| 3 | 115 | 0.4608 | 0.4087 | [0.3115, 0.5200] | 0.4332 |  |
| 5 | 106 | 0.5859 | 0.5472 | [0.4570, 0.6484] | 0.5659 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 78 | 23 | 6 |
| 3 | 33 | 47 | 35 |
| 5 | 16 | 32 | 58 |

Suggestion threshold: Unavailable; coverage: 0.0000; abstention: 1.0000; retained precision: Unavailable.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6585 | 0.6111 |
| 0.7 | 0.2378 | 0.7179 |
| 0.8 | 0.0671 | 0.8636 |
| 0.9 | 0.0122 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 36.6890935000265, "difficulty": 6.648783200071193}`. Evaluation: 5.75 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/ordinary-seed43/manifest.json>).

### Ordinary loss, seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8886 | 0.8776 | 0.8801 | 0.8870 | 0.3562 | 0.1808 | 0.0503 | [0.8435, 0.9168] |
| domain:reading_writing | 341 | 0.9619 | 0.9634 | 0.9623 | 0.9615 | 0.1118 | 0.0605 | 0.0099 | [0.9441, 0.9822] |
| difficulty | 328 | 0.5335 | 0.5376 | 0.5325 | 0.5290 | 0.9244 | 0.5639 | 0.0596 | [0.4804, 0.5904] |

Both skill and difficulty correct: 0.4695 on 328 questions. Difficulty ordinal MAE: 0.5274; Easy↔Hard error rate: 0.0610.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8421 | 0.7619 | [0.6363, 0.8864] | 0.8000 |  |
| Central Ideas and Details | 28 | 0.8636 | 0.6786 | [0.5139, 0.8334] | 0.7600 |  |
| Command of Evidence | 29 | 0.7667 | 0.7931 | [0.6249, 0.9394] | 0.7797 |  |
| Cross-Text Connections | 12 | 0.9091 | 0.8333 | [0.5550, 1.0000] | 0.8696 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7609 | 0.8537 | [0.7497, 0.9512] | 0.8046 |  |
| Inferences | 28 | 0.9655 | 1.0000 | [1.0000, 1.0000] | 0.9825 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.8750 | 0.8750 | [0.7333, 0.9668] | 0.8750 |  |
| Transitions | 37 | 0.9487 | 1.0000 | [1.0000, 1.0000] | 0.9737 |  |
| Words in Context | 52 | 0.9808 | 0.9808 | [0.9361, 1.0000] | 0.9808 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 32 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 5 | 0 | 1 | 0 | 1 | 1 | 1 | 0 |
| Command of Evidence | 0 | 2 | 23 | 0 | 0 | 0 | 1 | 2 | 0 | 1 |
| Cross-Text Connections | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 1 | 2 | 1 | 0 | 0 | 0 | 28 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 51 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.8886.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9853 | 0.8958 |
| 0.7 | 0.8739 | 0.9195 |
| 0.8 | 0.8182 | 0.9319 |
| 0.9 | 0.7361 | 0.9641 |
| 0.95 | 0.6921 | 0.9746 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9579 | 0.9479 | [0.9031, 0.9891] | 0.9529 |  |
| Expression of Ideas | 77 | 0.9506 | 1.0000 | [1.0000, 1.0000] | 0.9747 |  |
| Information and Ideas | 85 | 0.9506 | 0.9059 | [0.8395, 0.9682] | 0.9277 |  |
| Standard English Conventions | 83 | 0.9881 | 1.0000 | [1.0000, 1.0000] | 0.9940 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 91 | 1 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 3 | 77 | 1 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9619.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9619 |
| 0.7 | 0.9531 | 0.9754 |
| 0.8 | 0.9179 | 0.9840 |
| 0.9 | 0.8710 | 0.9899 |
| 0.95 | 0.8475 | 0.9965 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5840 | 0.6822 | [0.6060, 0.7661] | 0.6293 |  |
| 3 | 115 | 0.4135 | 0.3739 | [0.2869, 0.4779] | 0.3927 |  |
| 5 | 106 | 0.5960 | 0.5566 | [0.4652, 0.6487] | 0.5756 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 73 | 27 | 7 |
| 3 | 39 | 43 | 33 |
| 5 | 13 | 34 | 59 |

Suggestion threshold: Unavailable; coverage: 0.0000; abstention: 1.0000; retained precision: Unavailable.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6768 | 0.6081 |
| 0.7 | 0.2226 | 0.6986 |
| 0.8 | 0.0579 | 0.7895 |
| 0.9 | 0.0030 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 37.64291939989198, "difficulty": 6.987954100011848}`. Evaluation: 4.78 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/ordinary-seed44/manifest.json>).

### Balanced loss, seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8827 | 0.8733 | 0.8753 | 0.8807 | 0.3338 | 0.1772 | 0.0431 | [0.8335, 0.9080] |
| domain:reading_writing | 341 | 0.9677 | 0.9687 | 0.9682 | 0.9674 | 0.1013 | 0.0542 | 0.0128 | [0.9522, 0.9842] |
| difficulty | 328 | 0.5549 | 0.5590 | 0.5531 | 0.5496 | 0.9184 | 0.5613 | 0.0467 | [0.4978, 0.6069] |

Both skill and difficulty correct: 0.4878 on 328 questions. Difficulty ordinal MAE: 0.5030; Easy↔Hard error rate: 0.0579.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8286 | 0.6905 | [0.5686, 0.8446] | 0.7532 |  |
| Central Ideas and Details | 28 | 0.8636 | 0.6786 | [0.5139, 0.8334] | 0.7600 |  |
| Command of Evidence | 29 | 0.7857 | 0.7586 | [0.6068, 0.9202] | 0.7719 |  |
| Cross-Text Connections | 12 | 0.9091 | 0.8333 | [0.5550, 1.0000] | 0.8696 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7143 | 0.8537 | [0.7497, 0.9512] | 0.7778 |  |
| Inferences | 28 | 0.9655 | 1.0000 | [1.0000, 1.0000] | 0.9825 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.8571 | 0.9375 | [0.8386, 1.0000] | 0.8955 |  |
| Transitions | 37 | 0.9487 | 1.0000 | [1.0000, 1.0000] | 0.9737 |  |
| Words in Context | 52 | 0.9808 | 0.9808 | [0.9361, 1.0000] | 0.9808 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 29 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 5 | 0 | 1 | 0 | 1 | 1 | 1 | 0 |
| Command of Evidence | 0 | 3 | 22 | 0 | 0 | 0 | 0 | 3 | 0 | 1 |
| Cross-Text Connections | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 51 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.8827.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9795 | 0.8892 |
| 0.7 | 0.8739 | 0.9262 |
| 0.8 | 0.8328 | 0.9401 |
| 0.9 | 0.7478 | 0.9686 |
| 0.95 | 0.6921 | 0.9788 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9490 | 0.9688 | [0.9333, 1.0000] | 0.9588 |  |
| Expression of Ideas | 77 | 0.9625 | 1.0000 | [1.0000, 1.0000] | 0.9809 |  |
| Information and Ideas | 85 | 0.9747 | 0.9059 | [0.8553, 0.9652] | 0.9390 |  |
| Standard English Conventions | 83 | 0.9881 | 1.0000 | [1.0000, 1.0000] | 0.9940 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 93 | 1 | 2 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 5 | 2 | 77 | 1 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9677.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9676 |
| 0.7 | 0.9443 | 0.9845 |
| 0.8 | 0.9267 | 0.9842 |
| 0.9 | 0.8856 | 0.9934 |
| 0.95 | 0.8592 | 0.9932 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6080 | 0.7103 | [0.6212, 0.8020] | 0.6552 |  |
| 3 | 115 | 0.4412 | 0.3913 | [0.3000, 0.5004] | 0.4147 |  |
| 5 | 106 | 0.6040 | 0.5755 | [0.4659, 0.6667] | 0.5894 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 26 | 5 |
| 3 | 35 | 45 | 35 |
| 5 | 14 | 31 | 61 |

Suggestion threshold: Unavailable; coverage: 0.0000; abstention: 1.0000; retained precision: Unavailable.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6951 | 0.6096 |
| 0.7 | 0.2500 | 0.6951 |
| 0.8 | 0.0701 | 0.9130 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 45.42118760000449, "difficulty": 7.1825603999895975}`. Evaluation: 4.26 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/balanced-seed42/manifest.json>).

### Balanced loss, seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8856 | 0.8765 | 0.8782 | 0.8841 | 0.3188 | 0.1736 | 0.0438 | [0.8386, 0.9108] |
| domain:reading_writing | 341 | 0.9619 | 0.9638 | 0.9625 | 0.9616 | 0.0923 | 0.0505 | 0.0106 | [0.9441, 0.9808] |
| difficulty | 328 | 0.5579 | 0.5624 | 0.5536 | 0.5503 | 0.9182 | 0.5591 | 0.0718 | [0.4996, 0.6068] |

Both skill and difficulty correct: 0.4878 on 328 questions. Difficulty ordinal MAE: 0.5183; Easy↔Hard error rate: 0.0762.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8378 | 0.7381 | [0.6206, 0.8611] | 0.7848 |  |
| Central Ideas and Details | 28 | 0.8261 | 0.6786 | [0.5139, 0.8334] | 0.7451 |  |
| Command of Evidence | 29 | 0.7931 | 0.7931 | [0.6249, 0.9394] | 0.7931 |  |
| Cross-Text Connections | 12 | 0.9091 | 0.8333 | [0.5550, 1.0000] | 0.8696 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7447 | 0.8537 | [0.7497, 0.9512] | 0.7955 |  |
| Inferences | 28 | 0.9655 | 1.0000 | [1.0000, 1.0000] | 0.9825 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.8788 | 0.9062 | [0.7667, 1.0000] | 0.8923 |  |
| Transitions | 37 | 0.9250 | 1.0000 | [1.0000, 1.0000] | 0.9610 |  |
| Words in Context | 52 | 0.9804 | 0.9615 | [0.9128, 1.0000] | 0.9709 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 31 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 5 | 0 | 1 | 0 | 1 | 1 | 1 | 0 |
| Command of Evidence | 0 | 3 | 23 | 0 | 0 | 0 | 0 | 2 | 0 | 1 |
| Cross-Text Connections | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 6 | 0 | 0 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 29 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 50 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.8856.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9795 | 0.8892 |
| 0.7 | 0.8827 | 0.9236 |
| 0.8 | 0.8240 | 0.9466 |
| 0.9 | 0.7449 | 0.9724 |
| 0.95 | 0.6891 | 0.9830 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9574 | 0.9375 | [0.8875, 0.9785] | 0.9474 |  |
| Expression of Ideas | 77 | 0.9506 | 1.0000 | [1.0000, 1.0000] | 0.9747 |  |
| Information and Ideas | 85 | 0.9512 | 0.9176 | [0.8619, 0.9734] | 0.9341 |  |
| Standard English Conventions | 83 | 0.9881 | 1.0000 | [1.0000, 1.0000] | 0.9940 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 90 | 2 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 2 | 78 | 1 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9619.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9971 | 0.9647 |
| 0.7 | 0.9560 | 0.9816 |
| 0.8 | 0.9384 | 0.9875 |
| 0.9 | 0.8974 | 0.9935 |
| 0.95 | 0.8592 | 0.9966 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5833 | 0.7196 | [0.6364, 0.7981] | 0.6444 |  |
| 3 | 115 | 0.4731 | 0.3826 | [0.2969, 0.4910] | 0.4231 |  |
| 5 | 106 | 0.6019 | 0.5849 | [0.4811, 0.6825] | 0.5933 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 77 | 24 | 6 |
| 3 | 36 | 44 | 35 |
| 5 | 19 | 25 | 62 |

Suggestion threshold: Unavailable; coverage: 0.0000; abstention: 1.0000; retained precision: Unavailable.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6951 | 0.6228 |
| 0.7 | 0.2287 | 0.7200 |
| 0.8 | 0.0671 | 0.8636 |
| 0.9 | 0.0122 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 45.01947189995553, "difficulty": 6.916729699936695}`. Evaluation: 5.33 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/balanced-seed43/manifest.json>).

### Balanced loss, seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8856 | 0.8760 | 0.8784 | 0.8845 | 0.3266 | 0.1724 | 0.0465 | [0.8377, 0.9112] |
| domain:reading_writing | 341 | 0.9677 | 0.9690 | 0.9686 | 0.9675 | 0.1020 | 0.0527 | 0.0078 | [0.9535, 0.9850] |
| difficulty | 328 | 0.5579 | 0.5622 | 0.5554 | 0.5521 | 0.9192 | 0.5593 | 0.0557 | [0.5049, 0.6019] |

Both skill and difficulty correct: 0.4817 on 328 questions. Difficulty ordinal MAE: 0.5061; Easy↔Hard error rate: 0.0640.

**skill:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8000 | 0.7619 | [0.6363, 0.8864] | 0.7805 |  |
| Central Ideas and Details | 28 | 0.8333 | 0.7143 | [0.5650, 0.8696] | 0.7692 |  |
| Command of Evidence | 29 | 0.7857 | 0.7586 | [0.6068, 0.9202] | 0.7719 |  |
| Cross-Text Connections | 12 | 0.9091 | 0.8333 | [0.5550, 1.0000] | 0.8696 | Yes (<20) |
| Form, Structure, and Sense | 41 | 0.7500 | 0.8049 | [0.6755, 0.9025] | 0.7765 |  |
| Inferences | 28 | 0.9655 | 1.0000 | [1.0000, 1.0000] | 0.9825 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.8529 | 0.9062 | [0.7667, 1.0000] | 0.8788 |  |
| Transitions | 37 | 0.9737 | 1.0000 | [1.0000, 1.0000] | 0.9867 |  |
| Words in Context | 52 | 0.9808 | 0.9808 | [0.9361, 1.0000] | 0.9808 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 32 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 20 | 5 | 0 | 1 | 0 | 1 | 1 | 0 | 0 |
| Command of Evidence | 0 | 3 | 22 | 0 | 0 | 0 | 0 | 3 | 0 | 1 |
| Cross-Text Connections | 0 | 0 | 0 | 10 | 0 | 1 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 8 | 0 | 0 | 0 | 33 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 29 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 51 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.8856.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.8902 |
| 0.7 | 0.9003 | 0.9218 |
| 0.8 | 0.8270 | 0.9397 |
| 0.9 | 0.7449 | 0.9764 |
| 0.95 | 0.6979 | 0.9790 |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

**domain:reading_writing — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9485 | 0.9583 | [0.9149, 0.9911] | 0.9534 |  |
| Expression of Ideas | 77 | 0.9747 | 1.0000 | [1.0000, 1.0000] | 0.9872 |  |
| Information and Ideas | 85 | 0.9630 | 0.9176 | [0.8666, 0.9759] | 0.9398 |  |
| Standard English Conventions | 83 | 0.9881 | 1.0000 | [1.0000, 1.0000] | 0.9940 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 1 | 3 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 5 | 1 | 78 | 1 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Suggestion threshold: 0.0000; coverage: 1.0000; abstention: 0.0000; retained precision: 0.9677.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9677 |
| 0.7 | 0.9589 | 0.9786 |
| 0.8 | 0.9384 | 0.9844 |
| 0.9 | 0.8915 | 0.9934 |
| 0.95 | 0.8534 | 0.9931 |

**difficulty — per-class results**

| Class | Support | Precision | Recall | Recall 95% CI | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6179 | 0.7103 | [0.6310, 0.7963] | 0.6609 |  |
| 3 | 115 | 0.4545 | 0.3913 | [0.3032, 0.4901] | 0.4206 |  |
| 5 | 106 | 0.5849 | 0.5849 | [0.4999, 0.6795] | 0.5849 |  |

Confusion matrix: rows are true labels; columns are predicted labels.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 23 | 8 |
| 3 | 34 | 45 | 36 |
| 5 | 13 | 31 | 62 |

Suggestion threshold: Unavailable; coverage: 0.0000; abstention: 1.0000; retained precision: Unavailable.

| Confidence threshold | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6738 | 0.6063 |
| 0.7 | 0.2439 | 0.6875 |
| 0.8 | 0.0671 | 0.8636 |
| 0.9 | 0.0061 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0 questions; macro-F1 Unavailable.

Training seconds by target: `{"skill:reading_writing": 42.91483119991608, "difficulty": 6.565709999995306}`. Evaluation: 4.34 seconds. [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/balanced-seed44/manifest.json>).

## Runtime, throughput, and resource usage

Hardware/software: `{"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}`. Eight-thread ceiling, CPU only, one experiment at a time. Dependency versions and code revision are in each artifact manifest; the implementation is an unpushed working-tree change.

Encoder inference uses 8 threads, selected solely by timing training inputs. The initial embedding extraction used eight threads; those original costs remain included. All profiled representations passed numerical parity against cached embeddings (rtol/atol 1e-5).

| Encoder threads | Median seconds/question | Maximum absolute feature difference |
| --- | --- | --- |
| 1 | 0.4521 | 6.198883056640625e-06 |
| 2 | 0.3013 | 7.62939453125e-06 |
| 4 | 0.2360 | 1.71661376953125e-05 |
| 8 | 0.2013 | 4.291534423828125e-06 |

Resumed after encoder profiling; total adds initial encoder work to resumed wall time. Initial CV overhead is listed in accumulated fold times.

Interrupted attempt: operator interruption for CPU thread profiling after costly embedding extraction. 9 completed CV folds and all embeddings were preserved. One in-progress fold was discarded and rerun; its interrupted runtime was not captured. Timing totals are measured completed work, not a billing estimate or an uninterrupted execution guarantee.

Initial encoder load: 98.11 seconds; training embedding extraction: 12247.31 seconds. These are the measured initial costs, distinct from the later warmed serial benchmark.

| Measurement | Seconds / value |
| --- | --- |
| Total phase wall time | 15890.38 |
| CV accumulated fit/evaluate time | 2031.41 |
| Encoder loading + training embedding extraction | 12345.41 |
| Validation embedding preparation | 106.39 |
| Feature cache bytes | 5519880 |
| Artifact bytes | 603327152 |
| Artifact reload | 1.99 |
| API startup | 13.41 |
| Peak experiment process memory MB | 2743.89 |
| Direct 100-question time | 33.07 |
| Serial API first 100-question time | 32.15 |

Uncached feature preparation for the tree-only benchmark: 108.92 seconds. Tree-only latency excludes this preparation, calibration, and HTTP overhead.

| Path | Requests | p50 ms | p95 ms | p99 ms | Questions/sec |
| --- | --- | --- | --- | --- | --- |
| Direct, complete prediction | 1023 | 294.68 | 567.59 | 695.38 | 2.95 |
| Private HTTP API, serial | 1023 | 300.78 | 526.64 | 702.00 | 3.02 |
| Trees only, prepared features | 1023 | 3.50 | 5.33 | 6.39 | 278.14 |

Four-client load: 1023 attempts, 8 successful, 1015 busy (429), 0 other errors; 5.64 seconds, 1.42 successful questions/sec. The API intentionally serializes inference and returns 429 for overlap; busy responses are not counted as successful classification throughput.

Four-client successful-request p50/p95/p99: 745.21/814.52/816.64 ms. Load-test clients do not retry 429 responses; this burst result is not sustained capacity under backoff.

Ten warm-ups, three full validation passes per serial path. XGBoost complete paths include tokenization, encoding, features, both heads, calibration, and output construction; no feature-cache reads. Process peak memory is measured over the phase and is not total system or simultaneous parent/API memory. Cold loading is separate from warmed latency.

## Limitations and machine-readable evidence

One R&W bank source; no independently human-labeled full-length holdout, Math coverage, or visual evaluation. Rare-class recalls and joint label combinations have small support; group-bootstrap intervals do not address source-domain shift. A training-OOF target of 90% suggestion precision does not guarantee 90% on final validation or future imports. These results do not promote or deploy a model.

The artifacts record Git revision and a dirty-working-tree flag. A post-experiment source snapshot preserves the verified implementation; exact dirty-source hashes at the start of each training fit were not recorded. That historical code-lineage limitation is retained rather than rewriting trained artifact manifests.

[Complete metrics and predictions](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/results.json>) · [Frozen configurations](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/configuration-freeze.json>) · [Dataset and fold audit](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/dataset/manifest.json>).

[Verification and source evidence](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/verification.json>).

# Comparison

Both methods use identical frozen train/validation membership and CV folds. Primary comparisons use CV-selected weighting for each target, seed 42; all weighting/seed results are reported above.

| Target | Baseline F1 | XGBoost F1 | Difference | Baseline accuracy | XGBoost accuracy |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 0.8985 | 0.8753 | -0.0232 | 0.9032 | 0.8827 |
| difficulty | 0.5323 | 0.5563 | 0.0240 | 0.5335 | 0.5579 |
| domain:reading_writing | 0.9889 | 0.9682 | -0.0208 | 0.9883 | 0.9677 |

Joint correctness: baseline 0.4878, candidate 0.4909.

| Skill | Validation support | Baseline recall | XGBoost recall | Recall difference |
| --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.6905 | 0.6905 | 0.0000 |
| Central Ideas and Details | 28 | 0.6786 | 0.6786 | 0.0000 |
| Command of Evidence | 29 | 0.9655 | 0.7586 | -0.2069 |
| Cross-Text Connections | 12 | 0.8333 | 0.8333 | 0.0000 |
| Form, Structure, and Sense | 41 | 0.8537 | 0.8537 | 0.0000 |
| Inferences | 28 | 1.0000 | 1.0000 | 0.0000 |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | 0.0000 |
| Text Structure and Purpose | 32 | 0.9375 | 0.9375 | 0.0000 |
| Transitions | 37 | 1.0000 | 1.0000 | 0.0000 |
| Words in Context | 52 | 1.0000 | 0.9808 | -0.0192 |

Ordinary versus balanced loss on the unchanged final validation:

| Method | Loss | Target | F1 mean across seeds | F1 SD across seeds |
| --- | --- | --- | --- | --- |
| baseline | ordinary | skill:reading_writing | 0.8918 | 0.0000 |
| baseline | ordinary | difficulty | 0.5323 | 0.0000 |
| baseline | balanced | skill:reading_writing | 0.8985 | 0.0000 |
| baseline | balanced | difficulty | 0.5190 | 0.0000 |
| xgboost | ordinary | skill:reading_writing | 0.8782 | 0.0061 |
| xgboost | ordinary | difficulty | 0.5480 | 0.0134 |
| xgboost | balanced | skill:reading_writing | 0.8773 | 0.0018 |
| xgboost | balanced | difficulty | 0.5540 | 0.0012 |

Paired group-bootstrap 95% intervals for candidate − baseline macro-F1 (1,000 resamples):

| Target | 95% difference interval |
| --- | --- |
| skill:reading_writing | [-0.0682, 0.0250] |
| difficulty | [-0.0232, 0.0742] |

[Machine-readable paired intervals](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/paired-comparison.json>).

| Operational measurement | Baseline | XGBoost complete path |
| --- | --- | --- |
| Direct p95 ms | 8.98 | 567.59 |
| API p95 ms | 31.93 | 526.64 |
| Serial API questions/sec | 65.64 | 3.02 |
| 100-question serial API seconds | 1.46 | 32.15 |
| Total phase seconds | 379.82 | 15890.38 |

## Recommendation

For skill:reading_writing, the experiment does not establish a reliable positive XGBoost gain. Retain the simpler baseline pending independent full-length evaluation.

For difficulty, the experiment does not establish a reliable positive XGBoost gain. Retain the simpler baseline pending independent full-length evaluation.

Measured winners are experimental recommendations, not deployment decisions. Keep final validation frozen; a future independently reviewed full-length test is required to assess import generalization.

Technical gates measured on this CPU: warmed serial API p95 ≤2,000 ms and 100 questions ≤600 seconds.

| Method | API p95 gate | 100-question gate |
| --- | --- | --- |
| baseline | Pass | Pass |
| xgboost | Pass | Pass |
