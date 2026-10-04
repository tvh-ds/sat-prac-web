# Current classification results

Fine-tuning is discontinued at the user's request. No further fitting, tuning, promotion, or deployment is authorized by this report. All six completed methods below were evaluated on identical frozen outer-validation questions. Their selected seed-42 configurations were chosen using training-only five-fold CV; outer results did not select configurations.

The source contains 1,713 R&W questions. After the documented image/malformed-input exclusions, skill has 1,369 training / 341 validation questions; verified difficulty has 1,363 training / 328 validation questions. Skill has ten observed classes; difficulty remains Easy/Medium/Hard (stored class IDs 1/3/5). The deterministic seed-42 80/20 split uses group-aware, multi-target stratification; five frozen inner folds stay within training. Natural evaluation distributions are retained. These outer results are exploratory final validation, not an independently sourced test or evidence of full-length generalization.

## Completed model comparison

| Method | Skill accuracy | Skill macro-F1 | Skill 95% CI | Difficulty accuracy | Difficulty macro-F1 | Difficulty 95% CI | Joint correct |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TF-IDF + logistic regression | 0.9032 | 0.8985 | 0.8680–0.9298 | 0.5335 | 0.5323 | 0.4834–0.5821 | 0.4878 |
| TF-IDF + Linear SVM | 0.9384 | 0.9356 | 0.9091–0.9599 | 0.5244 | 0.5206 | 0.4656–0.5755 | 0.4939 |
| TF-IDF + Complement NB | 0.8856 | 0.8764 | 0.8356–0.9057 | 0.4909 | 0.4812 | 0.4242–0.5301 | 0.4207 |
| ModernBERT embeddings + XGBoost | 0.8827 | 0.8753 | 0.8335–0.9080 | 0.5579 | 0.5563 | 0.5041–0.6120 | 0.4909 |
| ModernBERT embeddings + logistic regression | 0.8974 | 0.8738 | 0.8256–0.9073 | 0.5610 | 0.5588 | 0.5135–0.6076 | 0.5061 |
| ModernBERT embeddings + Linear SVM | 0.9179 | 0.9082 | 0.8825–0.9368 | 0.5610 | 0.5546 | 0.5071–0.6104 | 0.5030 |

TF-IDF + SVM has the highest observed skill macro-F1. Frozen embeddings + logistic regression has the highest observed difficulty macro-F1, narrowly ahead of XGBoost and embedding SVM. Overlapping uncertainty means the small difficulty differences do not establish a reliable winner. Difficulty is substantially harder than skill for every completed model; no model has earned automatic difficulty acceptance.

## CPU inference and execution measurements

| Method | HTTP p50 ms | HTTP p95 ms | HTTP p99 ms | Serial questions/s | 100 HTTP questions s | Artifact MiB | Recorded phase min |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TF-IDF + logistic regression | 10.92 | 31.93 | 35.65 | 65.64 | 1.46 | 10.22 | 6.33 |
| TF-IDF + Linear SVM | 11.66 | 31.34 | 34.83 | 66.25 | 1.67 | 10.67 | 88.09 |
| TF-IDF + Complement NB | 14.54 | 33.74 | 36.97 | 57.18 | 1.71 | 17.09 | 17.64 |
| ModernBERT embeddings + XGBoost | 300.78 | 526.64 | 702.00 | 3.02 | 32.15 | 575.38 | 264.84 |
| ModernBERT embeddings + logistic regression | 253.27 | 462.59 | 564.55 | 3.46 | 30.54 | 570.18 | 15.65 |
| ModernBERT embeddings + Linear SVM | 256.55 | 463.73 | 573.08 | 3.43 | 29.50 | 570.33 | 45.72 |

Benchmarks use ten warm-up requests and three validation passes. ModernBERT costs include fresh encoding, with feature-cache reads disabled. CPU math threads are capped at eight. Phase times have different inherited-cache/resume boundaries and are not clean standalone training-cost comparisons; the detailed reports disclose extraction, tuning, interrupted attempts, loading, and benchmarking separately. Original embedding extraction took 12,247.31 seconds and was reused by subsequent embedding methods. Four-client burst tests return many intentional 429 busy responses; their successful throughput is not sustained capacity.

| Method | 4-client successes | 429 busy | Other errors | Direct p95 ms | Load s |
| --- | --- | --- | --- | --- | --- |
| TF-IDF + logistic regression | 449 | 574 | 0 | 8.98 | 0.385 |
| TF-IDF + Linear SVM | 401 | 622 | 0 | 9.73 | 0.394 |
| TF-IDF + Complement NB | 313 | 710 | 0 | 11.09 | 0.386 |
| ModernBERT embeddings + XGBoost | 8 | 1015 | 0 | 567.59 | 1.993 |
| ModernBERT embeddings + logistic regression | 6 | 1017 | 0 | 490.23 | 1.410 |
| ModernBERT embeddings + Linear SVM | 7 | 1016 | 0 | 460.36 | 1.064 |

## Calibration and difficulty abstention

| Method | Skill coverage | Skill precision | Difficulty threshold | Difficulty coverage | Difficulty precision | Difficulty ECE | Ordinal error | Easy↔Hard error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TF-IDF + logistic regression | 1.0000 | 0.9032 | 0.8100 | 0.0457 | 0.8667 | 0.0505 | 0.5488 | 0.0823 |
| TF-IDF + Linear SVM | 1.0000 | 0.9384 | — | 0.0000 | — | 0.0561 | 0.5671 | 0.0915 |
| TF-IDF + Complement NB | 0.9971 | 0.8882 | — | 0.0000 | — | 0.0779 | 0.6463 | 0.1372 |
| ModernBERT embeddings + XGBoost | 1.0000 | 0.8827 | — | 0.0000 | — | 0.0465 | 0.4970 | 0.0549 |
| ModernBERT embeddings + logistic regression | 1.0000 | 0.8974 | 0.8600 | 0.0488 | 1.0000 | 0.0462 | 0.4878 | 0.0488 |
| ModernBERT embeddings + Linear SVM | 1.0000 | 0.9179 | 0.7500 | 0.0701 | 0.7826 | 0.0253 | 0.4939 | 0.0549 |

Thresholds and temperatures use training OOF predictions only. Zero coverage means complete abstention, not zero classification accuracy. Embedding logistic regression retained only 16 difficulty suggestions, all correct: the exact 95% precision interval is approximately 79.4%–100%, so this does not establish 90% population precision. Embedding SVM retained 23, of which 18 were correct (78.3%); it missed the target.

## Per-skill recall

| Skill | Validation support | TF-IDF + logistic regression | TF-IDF + Linear SVM | TF-IDF + Complement NB | ModernBERT embeddings + XGBoost | ModernBERT embeddings + logistic regression | ModernBERT embeddings + Linear SVM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.6905 | 0.9048 | 0.6190 | 0.6905 | 0.9048 | 0.8810 |
| Central Ideas and Details | 28 | 0.6786 | 0.8929 | 0.4286 | 0.6786 | 0.6429 | 0.6786 |
| Command of Evidence | 29 | 0.9655 | 1.0000 | 1.0000 | 0.7586 | 0.8621 | 0.8621 |
| Cross-Text Connections | 12 | 0.8333 | 0.8333 | 0.9167 | 0.8333 | 0.7500 | 0.9167 |
| Form, Structure, and Sense | 41 | 0.8537 | 0.7561 | 0.8780 | 0.8537 | 0.8780 | 0.8537 |
| Inferences | 28 | 1.0000 | 1.0000 | 0.9643 | 1.0000 | 0.8571 | 0.8929 |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| Text Structure and Purpose | 32 | 0.9375 | 0.9375 | 1.0000 | 0.9375 | 0.8438 | 1.0000 |
| Transitions | 37 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| Words in Context | 52 | 1.0000 | 1.0000 | 1.0000 | 0.9808 | 1.0000 | 1.0000 |

Cross-Text Connections has only 12 validation questions; its estimates are especially uncertain. Perfect observed recall on a small set is not proof of perfect generalization.

## CV, weighting, seeds, and full per-class results

### TF-IDF + logistic regression

CV-selected weighting: skill:reading_writing: balanced; difficulty: ordinary. [results.json](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/baseline/results.json>)

| Target | Weighting | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C": 0.1} | 0.5115 | 0.0245 | 1.6918 |
| skill:reading_writing | ordinary | {"C": 1.0} | 0.9097 | 0.0215 | 0.7774 |
| skill:reading_writing | ordinary | {"C": 10.0} | 0.9354 | 0.0105 | 0.3870 |
| skill:reading_writing | balanced | {"C": 0.1} | 0.8526 | 0.0222 | 1.7580 |
| skill:reading_writing | balanced | {"C": 1.0} | 0.9272 | 0.0187 | 0.7816 |
| skill:reading_writing | balanced | {"C": 10.0} | 0.9387 | 0.0164 | 0.3811 |
| difficulty | ordinary | {"C": 0.1} | 0.4989 | 0.0256 | 1.0324 |
| difficulty | ordinary | {"C": 1.0} | 0.5298 | 0.0182 | 0.9510 |
| difficulty | ordinary | {"C": 10.0} | 0.5335 | 0.0206 | 0.9729 |
| difficulty | balanced | {"C": 0.1} | 0.4962 | 0.0234 | 1.0322 |
| difficulty | balanced | {"C": 1.0} | 0.5321 | 0.0227 | 0.9508 |
| difficulty | balanced | {"C": 10.0} | 0.5326 | 0.0204 | 0.9731 |

| Weighting | Seed | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8918 | 0.5323 | 0.9862 |
| ordinary | 43 | 0.8918 | 0.5323 | 0.9862 |
| ordinary | 44 | 0.8918 | 0.5323 | 0.9862 |
| balanced | 42 | 0.8985 | 0.5190 | 0.9889 |
| balanced | 43 | 0.8985 | 0.5190 | 0.9889 |
| balanced | 44 | 0.8985 | 0.5190 | 0.9889 |

**skill:reading_writing**: balanced accuracy 0.8959; weighted F1 0.9021; log loss 0.2138; Brier 0.1209; ECE 0.0283.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Boundaries | 0.8286 | 0.6905 | 0.7532 | 42 |
| Central Ideas and Details | 0.8636 | 0.6786 | 0.7600 | 28 |
| Command of Evidence | 0.9032 | 0.9655 | 0.9333 | 29 |
| Cross-Text Connections | 1.0000 | 0.8333 | 0.9091 | 12 |
| Form, Structure, and Sense | 0.7292 | 0.8537 | 0.7865 | 41 |
| Inferences | 0.7778 | 1.0000 | 0.8750 | 28 |
| Rhetorical Synthesis | 1.0000 | 1.0000 | 1.0000 | 40 |
| Text Structure and Purpose | 1.0000 | 0.9375 | 0.9677 | 32 |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 |

**difficulty**: balanced accuracy 0.5372; weighted F1 0.5294; log loss 0.9472; Brier 0.5713; ECE 0.0505.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Easy | 0.5882 | 0.6542 | 0.6195 | 107 |
| Medium | 0.4455 | 0.3913 | 0.4167 | 115 |
| Hard | 0.5556 | 0.5660 | 0.5607 | 106 |

**domain:reading_writing**: balanced accuracy 0.9896; weighted F1 0.9883; log loss 0.0379; Brier 0.0187; ECE 0.0075.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Craft and Structure | 1.0000 | 0.9583 | 0.9787 | 96 |
| Expression of Ideas | 1.0000 | 1.0000 | 1.0000 | 77 |
| Information and Ideas | 0.9551 | 1.0000 | 0.9770 | 85 |
| Standard English Conventions | 1.0000 | 1.0000 | 1.0000 | 83 |

### TF-IDF + Linear SVM

CV-selected weighting: skill:reading_writing: balanced; difficulty: balanced. [results.json](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_svm/results.json>)

| Target | Weighting | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 1.7367748819881088} | 0.9537 | 0.0200 | 0.1712 |
| skill:reading_writing | balanced | {"C/alpha": 2.3014895834912275} | 0.9537 | 0.0200 | 0.1703 |
| difficulty | ordinary | {"C/alpha": 0.28365900391318116} | 0.5291 | 0.0103 | 0.9335 |
| difficulty | balanced | {"C/alpha": 0.28365900391318116} | 0.5291 | 0.0103 | 0.9334 |

| Weighting | Seed | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.9356 | 0.5266 | 0.9860 |
| ordinary | 43 | 0.9356 | 0.5266 | 0.9860 |
| ordinary | 44 | 0.9356 | 0.5266 | 0.9860 |
| balanced | 42 | 0.9356 | 0.5206 | 0.9860 |
| balanced | 43 | 0.9356 | 0.5206 | 0.9860 |
| balanced | 44 | 0.9356 | 0.5206 | 0.9860 |

**skill:reading_writing**: balanced accuracy 0.9325; weighted F1 0.9379; log loss 0.2065; Brier 0.1018; ECE 0.0268.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Boundaries | 0.8085 | 0.9048 | 0.8539 | 42 |
| Central Ideas and Details | 0.8621 | 0.8929 | 0.8772 | 28 |
| Command of Evidence | 0.9355 | 1.0000 | 0.9667 | 29 |
| Cross-Text Connections | 1.0000 | 0.8333 | 0.9091 | 12 |
| Form, Structure, and Sense | 0.8857 | 0.7561 | 0.8158 | 41 |
| Inferences | 0.9333 | 1.0000 | 0.9655 | 28 |
| Rhetorical Synthesis | 1.0000 | 1.0000 | 1.0000 | 40 |
| Text Structure and Purpose | 1.0000 | 0.9375 | 0.9677 | 32 |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 |

**difficulty**: balanced accuracy 0.5287; weighted F1 0.5175; log loss 0.9303; Brier 0.5632; ECE 0.0561.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Easy | 0.5726 | 0.6636 | 0.6147 | 107 |
| Medium | 0.4409 | 0.3565 | 0.3942 | 115 |
| Hard | 0.5405 | 0.5660 | 0.5530 | 106 |

**domain:reading_writing**: balanced accuracy 0.9866; weighted F1 0.9854; log loss 0.0389; Brier 0.0225; ECE 0.0079.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Craft and Structure | 1.0000 | 0.9583 | 0.9787 | 96 |
| Expression of Ideas | 1.0000 | 1.0000 | 1.0000 | 77 |
| Information and Ideas | 0.9444 | 1.0000 | 0.9714 | 85 |
| Standard English Conventions | 1.0000 | 0.9880 | 0.9939 | 83 |

### TF-IDF + Complement NB

CV-selected weighting: skill:reading_writing: ordinary; difficulty: ordinary. [results.json](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_nb/results.json>)

| Target | Weighting | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 0.11345153067354169} | 0.8959 | 0.0117 | 0.5418 |
| skill:reading_writing | balanced | {"C/alpha": 0.1} | 0.8805 | 0.0198 | 0.5242 |
| difficulty | ordinary | {"C/alpha": 1.0} | 0.5113 | 0.0275 | 0.9793 |
| difficulty | balanced | {"C/alpha": 0.0745934328572655} | 0.5103 | 0.0297 | 1.1207 |

| Weighting | Seed | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8764 | 0.4812 | 0.9744 |
| ordinary | 43 | 0.8764 | 0.4812 | 0.9744 |
| ordinary | 44 | 0.8764 | 0.4812 | 0.9744 |
| balanced | 42 | 0.8535 | 0.4985 | 0.9635 |
| balanced | 43 | 0.8535 | 0.4985 | 0.9635 |
| balanced | 44 | 0.8535 | 0.4985 | 0.9635 |

**skill:reading_writing**: balanced accuracy 0.8807; weighted F1 0.8775; log loss 0.3138; Brier 0.1592; ECE 0.0306.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Boundaries | 0.8125 | 0.6190 | 0.7027 | 42 |
| Central Ideas and Details | 1.0000 | 0.4286 | 0.6000 | 28 |
| Command of Evidence | 0.9355 | 1.0000 | 0.9667 | 29 |
| Cross-Text Connections | 1.0000 | 0.9167 | 0.9565 | 12 |
| Form, Structure, and Sense | 0.6923 | 0.8780 | 0.7742 | 41 |
| Inferences | 0.7714 | 0.9643 | 0.8571 | 28 |
| Rhetorical Synthesis | 0.9524 | 1.0000 | 0.9756 | 40 |
| Text Structure and Purpose | 0.8889 | 1.0000 | 0.9412 | 32 |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 |
| Words in Context | 0.9811 | 1.0000 | 0.9905 | 52 |

**difficulty**: balanced accuracy 0.4946; weighted F1 0.4788; log loss 0.9858; Brier 0.5923; ECE 0.0779.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Easy | 0.4615 | 0.7290 | 0.5652 | 107 |
| Medium | 0.4578 | 0.3304 | 0.3838 | 115 |
| Hard | 0.5921 | 0.4245 | 0.4945 | 106 |

**domain:reading_writing**: balanced accuracy 0.9738; weighted F1 0.9735; log loss 0.1021; Brier 0.0494; ECE 0.0431.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Craft and Structure | 0.9406 | 0.9896 | 0.9645 | 96 |
| Expression of Ideas | 0.9872 | 1.0000 | 0.9935 | 77 |
| Information and Ideas | 0.9750 | 0.9176 | 0.9455 | 85 |
| Standard English Conventions | 1.0000 | 0.9880 | 0.9939 | 83 |

### ModernBERT embeddings + XGBoost

CV-selected weighting: skill:reading_writing: balanced; difficulty: ordinary. [results.json](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/xgboost/results.json>)

| Target | Weighting | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"max_depth": 3, "reg_lambda": 1} | 0.9018 | 0.0210 | 0.2576 |
| skill:reading_writing | ordinary | {"max_depth": 3, "reg_lambda": 5} | 0.8983 | 0.0204 | 0.2652 |
| skill:reading_writing | ordinary | {"max_depth": 4, "reg_lambda": 1} | 0.9013 | 0.0179 | 0.2607 |
| skill:reading_writing | ordinary | {"max_depth": 4, "reg_lambda": 5} | 0.8987 | 0.0156 | 0.2694 |
| skill:reading_writing | balanced | {"max_depth": 3, "reg_lambda": 1} | 0.8997 | 0.0162 | 0.2619 |
| skill:reading_writing | balanced | {"max_depth": 3, "reg_lambda": 5} | 0.9022 | 0.0173 | 0.2669 |
| skill:reading_writing | balanced | {"max_depth": 4, "reg_lambda": 1} | 0.8966 | 0.0249 | 0.2655 |
| skill:reading_writing | balanced | {"max_depth": 4, "reg_lambda": 5} | 0.8989 | 0.0179 | 0.2745 |
| difficulty | ordinary | {"max_depth": 3, "reg_lambda": 1} | 0.5658 | 0.0309 | 0.9117 |
| difficulty | ordinary | {"max_depth": 3, "reg_lambda": 5} | 0.5703 | 0.0214 | 0.9080 |
| difficulty | ordinary | {"max_depth": 4, "reg_lambda": 1} | 0.5579 | 0.0273 | 0.9091 |
| difficulty | ordinary | {"max_depth": 4, "reg_lambda": 5} | 0.5635 | 0.0183 | 0.9071 |
| difficulty | balanced | {"max_depth": 3, "reg_lambda": 1} | 0.5550 | 0.0214 | 0.9108 |
| difficulty | balanced | {"max_depth": 3, "reg_lambda": 5} | 0.5573 | 0.0276 | 0.9089 |
| difficulty | balanced | {"max_depth": 4, "reg_lambda": 1} | 0.5558 | 0.0154 | 0.9099 |
| difficulty | balanced | {"max_depth": 4, "reg_lambda": 5} | 0.5563 | 0.0315 | 0.9076 |

| Weighting | Seed | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8832 | 0.5563 | 0.9679 |
| ordinary | 43 | 0.8714 | 0.5552 | 0.9655 |
| ordinary | 44 | 0.8801 | 0.5325 | 0.9623 |
| balanced | 42 | 0.8753 | 0.5531 | 0.9682 |
| balanced | 43 | 0.8782 | 0.5536 | 0.9625 |
| balanced | 44 | 0.8784 | 0.5554 | 0.9686 |

**skill:reading_writing**: balanced accuracy 0.8733; weighted F1 0.8807; log loss 0.3338; Brier 0.1772; ECE 0.0431.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Boundaries | 0.8286 | 0.6905 | 0.7532 | 42 |
| Central Ideas and Details | 0.8636 | 0.6786 | 0.7600 | 28 |
| Command of Evidence | 0.7857 | 0.7586 | 0.7719 | 29 |
| Cross-Text Connections | 0.9091 | 0.8333 | 0.8696 | 12 |
| Form, Structure, and Sense | 0.7143 | 0.8537 | 0.7778 | 41 |
| Inferences | 0.9655 | 1.0000 | 0.9825 | 28 |
| Rhetorical Synthesis | 0.9756 | 1.0000 | 0.9877 | 40 |
| Text Structure and Purpose | 0.8571 | 0.9375 | 0.8955 | 32 |
| Transitions | 0.9487 | 1.0000 | 0.9737 | 37 |
| Words in Context | 0.9808 | 0.9808 | 0.9808 | 52 |

**difficulty**: balanced accuracy 0.5622; weighted F1 0.5527; log loss 0.9190; Brier 0.5612; ECE 0.0465.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Easy | 0.6129 | 0.7103 | 0.6580 | 107 |
| Medium | 0.4412 | 0.3913 | 0.4147 | 115 |
| Hard | 0.6078 | 0.5849 | 0.5962 | 106 |

**domain:reading_writing**: balanced accuracy 0.9687; weighted F1 0.9674; log loss 0.1013; Brier 0.0542; ECE 0.0128.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Craft and Structure | 0.9490 | 0.9688 | 0.9588 | 96 |
| Expression of Ideas | 0.9625 | 1.0000 | 0.9809 | 77 |
| Information and Ideas | 0.9747 | 0.9059 | 0.9390 | 85 |
| Standard English Conventions | 0.9881 | 1.0000 | 0.9940 | 83 |

### ModernBERT embeddings + logistic regression

CV-selected weighting: skill:reading_writing: balanced; difficulty: ordinary. [results.json](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_lr/results.json>)

| Target | Weighting | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 0.793113490026326} | 0.8901 | 0.0297 | 0.2723 |
| skill:reading_writing | balanced | {"C/alpha": 0.9846738873614566} | 0.8931 | 0.0288 | 0.2763 |
| difficulty | ordinary | {"C/alpha": 0.0019517224641449498} | 0.5793 | 0.0222 | 0.8802 |
| difficulty | balanced | {"C/alpha": 0.0019517224641449498} | 0.5774 | 0.0265 | 0.8801 |

| Weighting | Seed | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.8705 | 0.5588 | 0.9633 |
| ordinary | 43 | 0.8705 | 0.5588 | 0.9633 |
| ordinary | 44 | 0.8705 | 0.5588 | 0.9633 |
| balanced | 42 | 0.8738 | 0.5575 | 0.9635 |
| balanced | 43 | 0.8738 | 0.5575 | 0.9635 |
| balanced | 44 | 0.8738 | 0.5575 | 0.9635 |

**skill:reading_writing**: balanced accuracy 0.8739; weighted F1 0.8975; log loss 0.3758; Brier 0.1689; ECE 0.0351.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Boundaries | 0.9268 | 0.9048 | 0.9157 | 42 |
| Central Ideas and Details | 0.7200 | 0.6429 | 0.6792 | 28 |
| Command of Evidence | 0.6944 | 0.8621 | 0.7692 | 29 |
| Cross-Text Connections | 0.7500 | 0.7500 | 0.7500 | 12 |
| Form, Structure, and Sense | 0.9000 | 0.8780 | 0.8889 | 41 |
| Inferences | 0.8571 | 0.8571 | 0.8571 | 28 |
| Rhetorical Synthesis | 0.9756 | 1.0000 | 0.9877 | 40 |
| Text Structure and Purpose | 0.9643 | 0.8438 | 0.9000 | 32 |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 |
| Words in Context | 0.9811 | 1.0000 | 0.9905 | 52 |

**difficulty**: balanced accuracy 0.5658; weighted F1 0.5548; log loss 0.8801; Brier 0.5402; ECE 0.0462.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Easy | 0.6387 | 0.7103 | 0.6726 | 107 |
| Medium | 0.4343 | 0.3739 | 0.4019 | 115 |
| Hard | 0.5909 | 0.6132 | 0.6019 | 106 |

**domain:reading_writing**: balanced accuracy 0.9640; weighted F1 0.9620; log loss 0.1053; Brier 0.0572; ECE 0.0171.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Craft and Structure | 0.9570 | 0.9271 | 0.9418 | 96 |
| Expression of Ideas | 0.9872 | 1.0000 | 0.9935 | 77 |
| Information and Ideas | 0.9101 | 0.9529 | 0.9310 | 85 |
| Standard English Conventions | 1.0000 | 0.9759 | 0.9878 | 83 |

### ModernBERT embeddings + Linear SVM

CV-selected weighting: skill:reading_writing: balanced; difficulty: ordinary. [results.json](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm/results.json>)

| Target | Weighting | Configuration | CV macro-F1 | CV SD | CV log loss |
| --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | {"C/alpha": 0.006026889128682512} | 0.9363 | 0.0234 | 0.2347 |
| skill:reading_writing | balanced | {"C/alpha": 0.006026889128682512} | 0.9373 | 0.0222 | 0.2346 |
| difficulty | ordinary | {"C/alpha": 0.0010632044586887642} | 0.5530 | 0.0382 | 0.9007 |
| difficulty | balanced | {"C/alpha": 0.0010359916440554247} | 0.5529 | 0.0381 | 0.9002 |

| Weighting | Seed | Skill macro-F1 | Difficulty macro-F1 | Domain macro-F1 |
| --- | --- | --- | --- | --- |
| ordinary | 42 | 0.9082 | 0.5546 | 0.9855 |
| ordinary | 43 | 0.9082 | 0.5546 | 0.9855 |
| ordinary | 44 | 0.9082 | 0.5546 | 0.9855 |
| balanced | 42 | 0.9082 | 0.5546 | 0.9885 |
| balanced | 43 | 0.9082 | 0.5546 | 0.9885 |
| balanced | 44 | 0.9082 | 0.5546 | 0.9885 |

**skill:reading_writing**: balanced accuracy 0.9085; weighted F1 0.9178; log loss 0.2586; Brier 0.1256; ECE 0.0373.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Boundaries | 0.8605 | 0.8810 | 0.8706 | 42 |
| Central Ideas and Details | 0.7600 | 0.6786 | 0.7170 | 28 |
| Command of Evidence | 0.7353 | 0.8621 | 0.7937 | 29 |
| Cross-Text Connections | 0.9167 | 0.9167 | 0.9167 | 12 |
| Form, Structure, and Sense | 0.8974 | 0.8537 | 0.8750 | 41 |
| Inferences | 0.9259 | 0.8929 | 0.9091 | 28 |
| Rhetorical Synthesis | 1.0000 | 1.0000 | 1.0000 | 40 |
| Text Structure and Purpose | 1.0000 | 1.0000 | 1.0000 | 32 |
| Transitions | 1.0000 | 1.0000 | 1.0000 | 37 |
| Words in Context | 1.0000 | 1.0000 | 1.0000 | 52 |

**difficulty**: balanced accuracy 0.5664; weighted F1 0.5504; log loss 0.8745; Brier 0.5352; ECE 0.0253.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Easy | 0.6328 | 0.7570 | 0.6894 | 107 |
| Medium | 0.4396 | 0.3478 | 0.3883 | 115 |
| Hard | 0.5780 | 0.5943 | 0.5860 | 106 |

**domain:reading_writing**: balanced accuracy 0.9884; weighted F1 0.9883; log loss 0.0560; Brier 0.0253; ECE 0.0228.

| Class | Precision | Recall | F1 | Support |
| --- | --- | --- | --- | --- |
| Craft and Structure | 0.9896 | 0.9896 | 0.9896 | 96 |
| Expression of Ideas | 1.0000 | 1.0000 | 1.0000 | 77 |
| Information and Ideas | 0.9655 | 0.9882 | 0.9767 | 85 |
| Standard English Conventions | 1.0000 | 0.9759 | 0.9878 | 83 |

## Discontinued ModernBERT fine-tuning

| Skill / ordinary configuration | Completed folds | Fold macro-F1 | Mean ± sample SD | Completed-fit seconds |
| --- | --- | --- | --- | --- |
| LR 5e-5 (partial) | 2 | 0.9578, 0.9900 | 0.9739 ± 0.0227 | 746.04 |
| LR 2e-5 | 5 | 0.8885, 0.8472, 0.7771, 0.8814, 0.8157 | 0.8420 ± 0.0465 | 1639.46 |

Seven of forty scheduled CV fits completed on the free Tesla T4: all five skill/ordinary/LR=2e-5 folds, and two skill/ordinary/LR=5e-5 folds. The third higher-LR fold failed while saving a checkpoint, with a terminal ‘No space left on device’ error. The process had exited before the cancellation request; it was not restarted. The higher-LR two-fold average is incomplete and cannot be compared as if it were a five-fold or outer-validation result. No balanced-loss fine-tuning, difficulty CV, final fine-tuned artifact, outer validation, or serving benchmark completed. CPU timing-pilot quality values are omitted because that timing subset overlapped its evaluation subset. [partial-finetune-results.json](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/colab/partial-finetune-results.json>)

## Recommendation and evidence

Use TF-IDF + SVM as the leading skill-classification candidate based on current accuracy and CPU cost. Keep difficulty predictions as administrator-reviewed suggestions; the small embedding-method gains come with roughly 15–16× slower serial CPU inference and low or unreliable high-confidence coverage. Preserve the logistic-regression baseline as a reference. No automatic replacement or deployment has been performed.

Detailed confusion matrices, confidence intervals, all experiments, timings, lineage, and paired comparisons: [classification-expanded-comparison.md](<D:/SAT website/ml-service/reports/classification-expanded-comparison.md>); original baseline/XGBoost report: [classification-comparison.md](<D:/SAT website/ml-service/reports/classification-comparison.md>). Verification: 28 Python tests passed, and all four expanded methods passed artifact reload, private API, and applicable cache-control checks.
