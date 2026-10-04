# Expanded classification comparison

Current status: Fine-tuning is discontinued at the user's request. The GPU run had already exited after a checkpoint storage failure; no restart is authorized. Seven skill CV fits are preserved as partial evidence, with no fine-tuned outer validation or final artifact. The consolidated report of all six completed methods is [classification-current-results.md](classification-current-results.md). Historical continuation notes below describe earlier states.

Local sequential experiments; three categorical difficulty labels. No model promotion. The existing 80/20 membership and five group-aware CV folds are reused. Further outer-validation comparisons are exploratory: previous results were already inspected. Independent full-length evidence remains unavailable.

Inputs are known section/type, passage, prompt, and ordered answer-choice text. Answer keys, correct-choice flags, explanations, source identifiers, and existing labels are excluded from features. Skill and verified difficulty use independent estimators; domain probabilities sum the probabilities of skills with each parent domain. No predicted skill is used as a difficulty feature.

Dataset `0d78eb3734e065ed`; seed42; 1710 audited groups, largest group one question. Grouping checks shared passages, duplicate IDs, and identical content. The compiled PDF is a container rather than one indivisible source group. Two essential-image questions and one malformed multiple-choice question are excluded. Two Cross-text Connections labels normalize to Cross-Text Connections locally. Staging labels are unchanged.

Split technique: deterministic group-wise vector stratification with greedy assignment and local improvements, seed42. Skill and verified-difficulty marginals are primary balancing objectives; their joint combinations receive secondary weight. Five equal-fraction training folds use the same technique. Whole groups are indivisible. The tables show actual ratios rather than assuming perfect stratification.

| Skill | All | Train | Validation | Validation fraction |
| --- | --- | --- | --- | --- |
| Boundaries | 213 | 171 | 42 | 19.718% |
| Central Ideas and Details | 137 | 109 | 28 | 20.438% |
| Command of Evidence | 144 | 115 | 29 | 20.139% |
| Cross-Text Connections | 61 | 49 | 12 | 19.672% |
| Form, Structure, and Sense | 208 | 167 | 41 | 19.712% |
| Inferences | 140 | 112 | 28 | 20.000% |
| Rhetorical Synthesis | 204 | 164 | 40 | 19.608% |
| Text Structure and Purpose | 149 | 117 | 32 | 21.477% |
| Transitions | 194 | 157 | 37 | 19.072% |
| Words in Context | 260 | 208 | 52 | 20.000% |

| Verified difficulty | All | Train | Validation | Validation fraction |
| --- | --- | --- | --- | --- |
| Easy | 555 | 448 | 107 | 19.279% |
| Medium | 582 | 467 | 115 | 19.759% |
| Hard | 554 | 448 | 106 | 19.134% |

No independent test set exists for this run. No oversampling or evaluation weighting is applied. Existing categorical storage IDs 1/3/5 mean Easy/Medium/Hard; these are class IDs, not numerical difficulty scores. Per-run macro-F1, accuracy, and recall intervals use 200 group-bootstrap resamples, seed42; paired method differences use 1,000 resamples. Intervals are approximate, especially for small supports. A bootstrap recall interval of [1,1] when no observed errors exist cannot quantify unseen errors; it is not proof of perfect population recall. The 19 remaining unverified difficulty labels contribute to skill training only. These comprise 6 training and 13 validation questions; difficulty support therefore differs from skill support. [Dataset audit and checksums](<D:/SAT website/ml-service/artifacts/cpu-comparison-v1/dataset/manifest.json>) · [Original comparison](<D:/SAT website/ml-service/reports/classification-comparison.md>).

[Software and split verification](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/verification.json>). Offline fixture tests verify pipeline behavior and checkpoint recovery; they do not establish corpus quality.

## TF-IDF + Linear SVM

Independent skill/difficulty estimators; source-verified difficulty only. Domain is derived from skill probabilities. Features remain fixed. Ordinary and balanced training are compared independently for each target. Twenty Optuna TPE trials per target/weight variant, including initial 0.1/1/10 settings; logarithmic C/alpha range [0.001,100], seed 42. All trials use five complete frozen CV folds. Selection uses mean macro-F1, then lower log loss, then stronger regularization. SVM sigmoid calibration is fitted within each training partition using restricted frozen folds. OOF temperature/threshold fitting never uses outer validation. Final fits use seeds 42/43/44.

Word TF-IDF 1–2 grams and character TF-IDF 2–5 grams, capped at 30,000 features each. Vocabulary/IDF are fitted within training partitions. Naive Bayes uses inverse-frequency sample weights for balanced training.

Dataset `0d78eb3734e065ed`: 1710 eligible skill questions, 1691 verified difficulty labels; 1369 train / 341 validation. Compiled PDF container exception, aliases, three exclusions, singleton groups, and missing-provenance imbalance remain exactly as audited in the original comparison. Evaluation retains natural distributions.

| Target | Weight | Trial | Parameter | CV F1 | SD | Log loss | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0 | {"C": 0.1} | 0.9408 | 0.0217 | 0.2274 | 79.93 |
| skill:reading_writing | ordinary | 1 | {"C": 1.0} | 0.9516 | 0.0223 | 0.1739 | 78.26 |
| skill:reading_writing | ordinary | 2 | {"C": 10.0} | 0.9525 | 0.0201 | 0.1686 | 89.65 |
| skill:reading_writing | ordinary | 3 | {"C": 0.0745934328572655} | 0.9397 | 0.0198 | 0.2410 | 90.60 |
| skill:reading_writing | ordinary | 4 | {"C": 56.69849511478853} | 0.9525 | 0.0201 | 0.1682 | 87.89 |
| skill:reading_writing | ordinary | 5 | {"C": 4.5705630998014515} | 0.9525 | 0.0201 | 0.1692 | 81.77 |
| skill:reading_writing | ordinary | 6 | {"C": 0.9846738873614566} | 0.9516 | 0.0223 | 0.1740 | 80.42 |
| skill:reading_writing | ordinary | 7 | {"C": 0.006026889128682512} | 0.9155 | 0.0263 | 0.3374 | 73.47 |
| skill:reading_writing | ordinary | 8 | {"C": 0.0060252157362038605} | 0.9155 | 0.0263 | 0.3374 | 79.77 |
| skill:reading_writing | ordinary | 9 | {"C": 0.0019517224641449498} | 0.7840 | 0.0275 | 0.6114 | 81.88 |
| skill:reading_writing | ordinary | 10 | {"C": 69.86660528656624} | 0.9525 | 0.0201 | 0.1682 | 91.40 |
| skill:reading_writing | ordinary | 11 | {"C": 44.98741977424376} | 0.9525 | 0.0201 | 0.1682 | 84.26 |
| skill:reading_writing | ordinary | 12 | {"C": 7.915926907224517} | 0.9525 | 0.0201 | 0.1687 | 76.09 |
| skill:reading_writing | ordinary | 13 | {"C": 13.82218690258212} | 0.9525 | 0.0201 | 0.1685 | 95.84 |
| skill:reading_writing | ordinary | 14 | {"C": 1.7367748819881088} | 0.9537 | 0.0200 | 0.1712 | 90.80 |
| skill:reading_writing | ordinary | 15 | {"C": 1.3391099997840592} | 0.9529 | 0.0209 | 0.1723 | 75.71 |
| skill:reading_writing | ordinary | 16 | {"C": 0.5449280398972807} | 0.9502 | 0.0223 | 0.1795 | 63.50 |
| skill:reading_writing | ordinary | 17 | {"C": 0.22438613475191138} | 0.9474 | 0.0235 | 0.1974 | 61.02 |
| skill:reading_writing | ordinary | 18 | {"C": 3.466873172700983} | 0.9525 | 0.0201 | 0.1696 | 64.80 |
| skill:reading_writing | ordinary | 19 | {"C": 0.05276663485892001} | 0.9357 | 0.0188 | 0.2580 | 60.82 |
| skill:reading_writing | balanced | 0 | {"C": 0.1} | 0.9412 | 0.0214 | 0.2261 | 59.70 |
| skill:reading_writing | balanced | 1 | {"C": 1.0} | 0.9518 | 0.0238 | 0.1736 | 63.11 |
| skill:reading_writing | balanced | 2 | {"C": 10.0} | 0.9525 | 0.0201 | 0.1686 | 67.71 |
| skill:reading_writing | balanced | 3 | {"C": 0.0745934328572655} | 0.9391 | 0.0189 | 0.2397 | 60.50 |
| skill:reading_writing | balanced | 4 | {"C": 56.69849511478853} | 0.9525 | 0.0201 | 0.1682 | 66.15 |
| skill:reading_writing | balanced | 5 | {"C": 4.5705630998014515} | 0.9525 | 0.0201 | 0.1691 | 64.07 |
| skill:reading_writing | balanced | 6 | {"C": 0.9846738873614566} | 0.9518 | 0.0238 | 0.1737 | 62.71 |
| skill:reading_writing | balanced | 7 | {"C": 0.006026889128682512} | 0.9203 | 0.0221 | 0.3116 | 55.81 |
| skill:reading_writing | balanced | 8 | {"C": 0.0060252157362038605} | 0.9203 | 0.0221 | 0.3116 | 56.34 |
| skill:reading_writing | balanced | 9 | {"C": 0.0019517224641449498} | 0.8137 | 0.0190 | 0.5662 | 57.06 |
| skill:reading_writing | balanced | 10 | {"C": 69.86660528656624} | 0.9525 | 0.0201 | 0.1682 | 64.19 |
| skill:reading_writing | balanced | 11 | {"C": 44.98741977424376} | 0.9525 | 0.0201 | 0.1682 | 64.00 |
| skill:reading_writing | balanced | 12 | {"C": 7.915926907224517} | 0.9525 | 0.0201 | 0.1687 | 64.70 |
| skill:reading_writing | balanced | 13 | {"C": 13.82218690258212} | 0.9525 | 0.0201 | 0.1685 | 66.00 |
| skill:reading_writing | balanced | 14 | {"C": 1.7367748819881088} | 0.9537 | 0.0200 | 0.1711 | 63.22 |
| skill:reading_writing | balanced | 15 | {"C": 1.3391099997840592} | 0.9525 | 0.0214 | 0.1720 | 62.72 |
| skill:reading_writing | balanced | 16 | {"C": 0.21490275329086686} | 0.9467 | 0.0222 | 0.1977 | 60.49 |
| skill:reading_writing | balanced | 17 | {"C": 4.520770312488261} | 0.9531 | 0.0206 | 0.1692 | 63.95 |
| skill:reading_writing | balanced | 18 | {"C": 0.29731820838102996} | 0.9475 | 0.0233 | 0.1893 | 61.07 |
| skill:reading_writing | balanced | 19 | {"C": 2.3014895834912275} | 0.9537 | 0.0200 | 0.1703 | 63.94 |
| difficulty | ordinary | 0 | {"C": 0.1} | 0.5286 | 0.0136 | 0.9368 | 51.46 |
| difficulty | ordinary | 1 | {"C": 1.0} | 0.5254 | 0.0273 | 0.9402 | 55.71 |
| difficulty | ordinary | 2 | {"C": 10.0} | 0.5144 | 0.0373 | 0.9479 | 58.74 |
| difficulty | ordinary | 3 | {"C": 0.0745934328572655} | 0.5268 | 0.0153 | 0.9401 | 51.53 |
| difficulty | ordinary | 4 | {"C": 56.69849511478853} | 0.5122 | 0.0402 | 0.9490 | 58.29 |
| difficulty | ordinary | 5 | {"C": 4.5705630998014515} | 0.5157 | 0.0362 | 0.9466 | 57.04 |
| difficulty | ordinary | 6 | {"C": 0.9846738873614566} | 0.5247 | 0.0262 | 0.9401 | 54.85 |
| difficulty | ordinary | 7 | {"C": 0.006026889128682512} | 0.5006 | 0.0230 | 0.9806 | 49.90 |
| difficulty | ordinary | 8 | {"C": 0.0060252157362038605} | 0.5006 | 0.0230 | 0.9806 | 50.01 |
| difficulty | ordinary | 9 | {"C": 0.0019517224641449498} | 0.4850 | 0.0311 | 0.9973 | 49.97 |
| difficulty | ordinary | 10 | {"C": 0.12241215283849362} | 0.5234 | 0.0143 | 0.9351 | 50.96 |
| difficulty | ordinary | 11 | {"C": 0.07715710608842291} | 0.5268 | 0.0152 | 0.9396 | 50.52 |
| difficulty | ordinary | 12 | {"C": 0.05704566204262226} | 0.5218 | 0.0147 | 0.9438 | 51.17 |
| difficulty | ordinary | 13 | {"C": 0.28365900391318116} | 0.5291 | 0.0103 | 0.9335 | 52.55 |
| difficulty | ordinary | 14 | {"C": 0.6730780896119948} | 0.5280 | 0.0220 | 0.9377 | 54.21 |
| difficulty | ordinary | 15 | {"C": 0.29088654769986744} | 0.5291 | 0.0103 | 0.9335 | 52.06 |
| difficulty | ordinary | 16 | {"C": 0.4282343181689891} | 0.5290 | 0.0183 | 0.9351 | 52.89 |
| difficulty | ordinary | 17 | {"C": 4.570770754207071} | 0.5157 | 0.0362 | 0.9466 | 57.24 |
| difficulty | ordinary | 18 | {"C": 0.016785610444605824} | 0.4979 | 0.0198 | 0.9647 | 49.74 |
| difficulty | ordinary | 19 | {"C": 0.34494593277406377} | 0.5267 | 0.0142 | 0.9341 | 52.62 |
| difficulty | balanced | 0 | {"C": 0.1} | 0.5286 | 0.0136 | 0.9367 | 51.13 |
| difficulty | balanced | 1 | {"C": 1.0} | 0.5254 | 0.0273 | 0.9402 | 54.16 |
| difficulty | balanced | 2 | {"C": 10.0} | 0.5144 | 0.0373 | 0.9479 | 57.43 |
| difficulty | balanced | 3 | {"C": 0.0745934328572655} | 0.5268 | 0.0153 | 0.9400 | 51.02 |
| difficulty | balanced | 4 | {"C": 56.69849511478853} | 0.5122 | 0.0402 | 0.9490 | 57.62 |
| difficulty | balanced | 5 | {"C": 4.5705630998014515} | 0.5157 | 0.0362 | 0.9466 | 56.60 |
| difficulty | balanced | 6 | {"C": 0.9846738873614566} | 0.5256 | 0.0265 | 0.9401 | 55.51 |
| difficulty | balanced | 7 | {"C": 0.006026889128682512} | 0.4998 | 0.0245 | 0.9804 | 50.46 |
| difficulty | balanced | 8 | {"C": 0.0060252157362038605} | 0.4998 | 0.0245 | 0.9804 | 50.18 |
| difficulty | balanced | 9 | {"C": 0.0019517224641449498} | 0.4892 | 0.0292 | 0.9965 | 51.19 |
| difficulty | balanced | 10 | {"C": 0.12241215283849362} | 0.5234 | 0.0143 | 0.9350 | 51.57 |
| difficulty | balanced | 11 | {"C": 0.07715710608842291} | 0.5268 | 0.0152 | 0.9395 | 51.43 |
| difficulty | balanced | 12 | {"C": 0.05704566204262226} | 0.5218 | 0.0147 | 0.9437 | 50.93 |
| difficulty | balanced | 13 | {"C": 0.28365900391318116} | 0.5291 | 0.0103 | 0.9334 | 56.76 |
| difficulty | balanced | 14 | {"C": 0.6730780896119948} | 0.5281 | 0.0221 | 0.9377 | 55.58 |
| difficulty | balanced | 15 | {"C": 0.29088654769986744} | 0.5284 | 0.0104 | 0.9335 | 53.11 |
| difficulty | balanced | 16 | {"C": 0.018932906660686234} | 0.5004 | 0.0203 | 0.9626 | 50.41 |
| difficulty | balanced | 17 | {"C": 4.480208677914649} | 0.5150 | 0.0367 | 0.9465 | 56.94 |
| difficulty | balanced | 18 | {"C": 0.016464302151392666} | 0.4965 | 0.0212 | 0.9650 | 50.16 |
| difficulty | balanced | 19 | {"C": 0.3375229824880464} | 0.5282 | 0.0122 | 0.9340 | 52.62 |

CV-selected weighting: `{"skill:reading_writing": "balanced", "difficulty": "balanced"}`.

| Target | Weight | Validation macro-F1 mean | Seed SD |
| --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0.9356 | 0.0000 |
| skill:reading_writing | balanced | 0.9356 | 0.0000 |
| difficulty | ordinary | 0.5266 | 0.0000 |
| difficulty | balanced | 0.5206 | 0.0000 |

### ordinary — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9384 | 0.9325 | 0.9356 | 0.9379 | 0.2063 | 0.1023 | 0.0264 | [0.9091, 0.9599] |
| domain:reading_writing | 341 | 0.9853 | 0.9866 | 0.9860 | 0.9854 | 0.0393 | 0.0226 | 0.0078 | [0.9742, 0.9947] |
| difficulty | 328 | 0.5305 | 0.5350 | 0.5266 | 0.5233 | 0.9303 | 0.5631 | 0.0578 | [0.4732, 0.5835] |

Joint correctness 0.5000 on 328 questions. Ordinal difficulty MAE 0.5549; Easy↔Hard rate 0.0854.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8085 | 0.9048 | [0.8139, 0.9762] | 0.8539 |  |
| Central Ideas and Details | 28 | 0.8621 | 0.8929 | [0.7584, 1.0000] | 0.8772 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes |
| Form, Structure, and Sense | 41 | 0.8857 | 0.7561 | [0.6399, 0.8714] | 0.8158 |  |
| Inferences | 28 | 0.9333 | 1.0000 | [1.0000, 1.0000] | 0.9655 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 25 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 9 | 1 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9384.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9384 |
| 0.7 | 0.9267 | 0.9589 |
| 0.8 | 0.8944 | 0.9639 |
| 0.9 | 0.8446 | 0.9757 |
| 0.95 | 0.7801 | 0.9887 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9824 | 0.9910 |
| 0.8 | 0.9765 | 0.9910 |
| 0.9 | 0.9677 | 0.9939 |
| 0.95 | 0.9413 | 0.9969 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5806 | 0.6729 | [0.5962, 0.7551] | 0.6234 |  |
| 3 | 115 | 0.4409 | 0.3565 | [0.2707, 0.4637] | 0.3942 |  |
| 5 | 106 | 0.5495 | 0.5755 | [0.4716, 0.6771] | 0.5622 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 72 | 21 | 14 |
| 3 | 38 | 41 | 36 |
| 5 | 14 | 31 | 61 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6341 | 0.6106 |
| 0.7 | 0.1372 | 0.8000 |
| 0.8 | 0.0061 | 0.5000 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 18.787701000110246, "difficulty": 16.46791529993061}`; evaluation 4.36s; reload parity passed.

### ordinary — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9384 | 0.9325 | 0.9356 | 0.9379 | 0.2063 | 0.1023 | 0.0264 | [0.9091, 0.9599] |
| domain:reading_writing | 341 | 0.9853 | 0.9866 | 0.9860 | 0.9854 | 0.0393 | 0.0226 | 0.0078 | [0.9742, 0.9947] |
| difficulty | 328 | 0.5305 | 0.5350 | 0.5266 | 0.5233 | 0.9303 | 0.5631 | 0.0578 | [0.4732, 0.5835] |

Joint correctness 0.5000 on 328 questions. Ordinal difficulty MAE 0.5549; Easy↔Hard rate 0.0854.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8085 | 0.9048 | [0.8139, 0.9762] | 0.8539 |  |
| Central Ideas and Details | 28 | 0.8621 | 0.8929 | [0.7584, 1.0000] | 0.8772 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes |
| Form, Structure, and Sense | 41 | 0.8857 | 0.7561 | [0.6399, 0.8714] | 0.8158 |  |
| Inferences | 28 | 0.9333 | 1.0000 | [1.0000, 1.0000] | 0.9655 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 25 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 9 | 1 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9384.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9384 |
| 0.7 | 0.9267 | 0.9589 |
| 0.8 | 0.8944 | 0.9639 |
| 0.9 | 0.8446 | 0.9757 |
| 0.95 | 0.7801 | 0.9887 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9824 | 0.9910 |
| 0.8 | 0.9765 | 0.9910 |
| 0.9 | 0.9677 | 0.9939 |
| 0.95 | 0.9413 | 0.9969 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5806 | 0.6729 | [0.5962, 0.7551] | 0.6234 |  |
| 3 | 115 | 0.4409 | 0.3565 | [0.2707, 0.4637] | 0.3942 |  |
| 5 | 106 | 0.5495 | 0.5755 | [0.4716, 0.6771] | 0.5622 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 72 | 21 | 14 |
| 3 | 38 | 41 | 36 |
| 5 | 14 | 31 | 61 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6341 | 0.6106 |
| 0.7 | 0.1372 | 0.8000 |
| 0.8 | 0.0061 | 0.5000 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 19.42049849999603, "difficulty": 16.0745599999791}`; evaluation 4.22s; reload parity passed.

### ordinary — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9384 | 0.9325 | 0.9356 | 0.9379 | 0.2063 | 0.1023 | 0.0264 | [0.9091, 0.9599] |
| domain:reading_writing | 341 | 0.9853 | 0.9866 | 0.9860 | 0.9854 | 0.0393 | 0.0226 | 0.0078 | [0.9742, 0.9947] |
| difficulty | 328 | 0.5305 | 0.5350 | 0.5266 | 0.5233 | 0.9303 | 0.5631 | 0.0578 | [0.4732, 0.5835] |

Joint correctness 0.5000 on 328 questions. Ordinal difficulty MAE 0.5549; Easy↔Hard rate 0.0854.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8085 | 0.9048 | [0.8139, 0.9762] | 0.8539 |  |
| Central Ideas and Details | 28 | 0.8621 | 0.8929 | [0.7584, 1.0000] | 0.8772 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes |
| Form, Structure, and Sense | 41 | 0.8857 | 0.7561 | [0.6399, 0.8714] | 0.8158 |  |
| Inferences | 28 | 0.9333 | 1.0000 | [1.0000, 1.0000] | 0.9655 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 25 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 9 | 1 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9384.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9384 |
| 0.7 | 0.9267 | 0.9589 |
| 0.8 | 0.8944 | 0.9639 |
| 0.9 | 0.8446 | 0.9757 |
| 0.95 | 0.7801 | 0.9887 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9824 | 0.9910 |
| 0.8 | 0.9765 | 0.9910 |
| 0.9 | 0.9677 | 0.9939 |
| 0.95 | 0.9413 | 0.9969 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5806 | 0.6729 | [0.5962, 0.7551] | 0.6234 |  |
| 3 | 115 | 0.4409 | 0.3565 | [0.2707, 0.4637] | 0.3942 |  |
| 5 | 106 | 0.5495 | 0.5755 | [0.4716, 0.6771] | 0.5622 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 72 | 21 | 14 |
| 3 | 38 | 41 | 36 |
| 5 | 14 | 31 | 61 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6341 | 0.6106 |
| 0.7 | 0.1372 | 0.8000 |
| 0.8 | 0.0061 | 0.5000 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 19.321038299938664, "difficulty": 15.931037800037302}`; evaluation 4.21s; reload parity passed.

### balanced — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9384 | 0.9325 | 0.9356 | 0.9379 | 0.2065 | 0.1018 | 0.0268 | [0.9091, 0.9599] |
| domain:reading_writing | 341 | 0.9853 | 0.9866 | 0.9860 | 0.9854 | 0.0389 | 0.0225 | 0.0079 | [0.9742, 0.9947] |
| difficulty | 328 | 0.5244 | 0.5287 | 0.5206 | 0.5175 | 0.9303 | 0.5632 | 0.0561 | [0.4656, 0.5755] |

Joint correctness 0.4939 on 328 questions. Ordinal difficulty MAE 0.5671; Easy↔Hard rate 0.0915.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8085 | 0.9048 | [0.8139, 0.9762] | 0.8539 |  |
| Central Ideas and Details | 28 | 0.8621 | 0.8929 | [0.7584, 1.0000] | 0.8772 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes |
| Form, Structure, and Sense | 41 | 0.8857 | 0.7561 | [0.6399, 0.8714] | 0.8158 |  |
| Inferences | 28 | 0.9333 | 1.0000 | [1.0000, 1.0000] | 0.9655 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 25 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 9 | 1 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9384.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9384 |
| 0.7 | 0.9267 | 0.9589 |
| 0.8 | 0.8944 | 0.9639 |
| 0.9 | 0.8475 | 0.9758 |
| 0.95 | 0.7830 | 0.9888 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9824 | 0.9910 |
| 0.8 | 0.9765 | 0.9910 |
| 0.9 | 0.9677 | 0.9939 |
| 0.95 | 0.9413 | 0.9969 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5726 | 0.6636 | [0.5850, 0.7460] | 0.6147 |  |
| 3 | 115 | 0.4409 | 0.3565 | [0.2707, 0.4637] | 0.3942 |  |
| 5 | 106 | 0.5405 | 0.5660 | [0.4602, 0.6757] | 0.5530 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 71 | 21 | 15 |
| 3 | 38 | 41 | 36 |
| 5 | 15 | 31 | 60 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6341 | 0.6106 |
| 0.7 | 0.1372 | 0.8000 |
| 0.8 | 0.0061 | 0.5000 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 19.549096600036137, "difficulty": 16.31228660000488}`; evaluation 4.57s; reload parity passed.

### balanced — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9384 | 0.9325 | 0.9356 | 0.9379 | 0.2065 | 0.1018 | 0.0268 | [0.9091, 0.9599] |
| domain:reading_writing | 341 | 0.9853 | 0.9866 | 0.9860 | 0.9854 | 0.0389 | 0.0225 | 0.0079 | [0.9742, 0.9947] |
| difficulty | 328 | 0.5244 | 0.5287 | 0.5206 | 0.5175 | 0.9303 | 0.5632 | 0.0561 | [0.4656, 0.5755] |

Joint correctness 0.4939 on 328 questions. Ordinal difficulty MAE 0.5671; Easy↔Hard rate 0.0915.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8085 | 0.9048 | [0.8139, 0.9762] | 0.8539 |  |
| Central Ideas and Details | 28 | 0.8621 | 0.8929 | [0.7584, 1.0000] | 0.8772 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes |
| Form, Structure, and Sense | 41 | 0.8857 | 0.7561 | [0.6399, 0.8714] | 0.8158 |  |
| Inferences | 28 | 0.9333 | 1.0000 | [1.0000, 1.0000] | 0.9655 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 25 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 9 | 1 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9384.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9384 |
| 0.7 | 0.9267 | 0.9589 |
| 0.8 | 0.8944 | 0.9639 |
| 0.9 | 0.8475 | 0.9758 |
| 0.95 | 0.7830 | 0.9888 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9824 | 0.9910 |
| 0.8 | 0.9765 | 0.9910 |
| 0.9 | 0.9677 | 0.9939 |
| 0.95 | 0.9413 | 0.9969 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5726 | 0.6636 | [0.5850, 0.7460] | 0.6147 |  |
| 3 | 115 | 0.4409 | 0.3565 | [0.2707, 0.4637] | 0.3942 |  |
| 5 | 106 | 0.5405 | 0.5660 | [0.4602, 0.6757] | 0.5530 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 71 | 21 | 15 |
| 3 | 38 | 41 | 36 |
| 5 | 15 | 31 | 60 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6341 | 0.6106 |
| 0.7 | 0.1372 | 0.8000 |
| 0.8 | 0.0061 | 0.5000 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 20.647974999970756, "difficulty": 16.344490200048313}`; evaluation 4.18s; reload parity passed.

### balanced — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9384 | 0.9325 | 0.9356 | 0.9379 | 0.2065 | 0.1018 | 0.0268 | [0.9091, 0.9599] |
| domain:reading_writing | 341 | 0.9853 | 0.9866 | 0.9860 | 0.9854 | 0.0389 | 0.0225 | 0.0079 | [0.9742, 0.9947] |
| difficulty | 328 | 0.5244 | 0.5287 | 0.5206 | 0.5175 | 0.9303 | 0.5632 | 0.0561 | [0.4656, 0.5755] |

Joint correctness 0.4939 on 328 questions. Ordinal difficulty MAE 0.5671; Easy↔Hard rate 0.0915.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8085 | 0.9048 | [0.8139, 0.9762] | 0.8539 |  |
| Central Ideas and Details | 28 | 0.8621 | 0.8929 | [0.7584, 1.0000] | 0.8772 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.8333 | [0.5710, 1.0000] | 0.9091 | Yes |
| Form, Structure, and Sense | 41 | 0.8857 | 0.7561 | [0.6399, 0.8714] | 0.8158 |  |
| Inferences | 28 | 0.9333 | 1.0000 | [1.0000, 1.0000] | 0.9655 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 0.9375 | [0.8458, 1.0000] | 0.9677 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 25 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 10 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 9 | 1 | 0 | 0 | 31 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 28 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9384.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9384 |
| 0.7 | 0.9267 | 0.9589 |
| 0.8 | 0.8944 | 0.9639 |
| 0.9 | 0.8475 | 0.9758 |
| 0.95 | 0.7830 | 0.9888 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 1.0000 | 0.9583 | [0.9130, 0.9896] | 0.9787 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9444 | 1.0000 | [1.0000, 1.0000] | 0.9714 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 92 | 0 | 4 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 0 | 0 | 85 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9824 | 0.9910 |
| 0.8 | 0.9765 | 0.9910 |
| 0.9 | 0.9677 | 0.9939 |
| 0.95 | 0.9413 | 0.9969 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.5726 | 0.6636 | [0.5850, 0.7460] | 0.6147 |  |
| 3 | 115 | 0.4409 | 0.3565 | [0.2707, 0.4637] | 0.3942 |  |
| 5 | 106 | 0.5405 | 0.5660 | [0.4602, 0.6757] | 0.5530 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 71 | 21 | 15 |
| 3 | 38 | 41 | 36 |
| 5 | 15 | 31 | 60 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.6341 | 0.6106 |
| 0.7 | 0.1372 | 0.8000 |
| 0.8 | 0.0061 | 0.5000 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 19.76725879998412, "difficulty": 15.942409100010991}`; evaluation 4.35s; reload parity passed.

### Operational measurements

| Package | Version |
| --- | --- |
| numpy | 2.5.3 |
| optuna | 4.9.0 |
| scikit-learn | 1.9.1 |
| torch | 2.14.1 |
| transformers | 4.57.6 |

Hardware `{"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}`. Code/dependencies are frozen before training. TF-IDF preparation is included in fit/evaluate times. Training feature-cache preparation 0.00s; run wall time 5285.32s; peak process memory 420.67MB; artifact 11189611 bytes; load 0.39s; API startup 2.81s.

Peak RAM is the main experiment process high-water mark; the separate HTTP server child's peak RAM was not instrumented. CPU math threads are capped at eight per process.

| Path | N | p50 ms | p95 ms | p99 ms | Questions/s |
| --- | --- | --- | --- | --- | --- |
| Direct complete | 1023 | 6.82 | 9.73 | 11.48 | 141.18 |
| HTTP complete | 1023 | 11.66 | 31.34 | 34.83 | 66.25 |

100 questions: direct 0.73s, HTTP 1.67s. Four-client burst: 401 success / 622 busy / 0 unexpected errors; 89.08 successful questions/s. Ten warm-ups and three complete validation passes. Busy responses are not retried; burst throughput is not sustained capacity.

[Metrics and predictions](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_svm/results.json>) · [Configurations](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_svm/configuration-freeze.json>) · [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_svm/selected-seed42/manifest.json>).

Private API authorization and direct/API prediction parity verified. [Serving checks](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_svm/serving-verification.json>).

## TF-IDF + Complement Naive Bayes

Independent skill/difficulty estimators; source-verified difficulty only. Domain is derived from skill probabilities. Features remain fixed. Ordinary and balanced training are compared independently for each target. Twenty Optuna TPE trials per target/weight variant, including initial 0.1/1/10 settings; logarithmic C/alpha range [0.001,100], seed 42. All trials use five complete frozen CV folds. Selection uses mean macro-F1, then lower log loss, then stronger regularization. SVM sigmoid calibration is fitted within each training partition using restricted frozen folds. OOF temperature/threshold fitting never uses outer validation. Final fits use seeds 42/43/44.

Word TF-IDF 1–2 grams and character TF-IDF 2–5 grams, capped at 30,000 features each. Vocabulary/IDF are fitted within training partitions. Naive Bayes uses inverse-frequency sample weights for balanced training.

Dataset `0d78eb3734e065ed`: 1710 eligible skill questions, 1691 verified difficulty labels; 1369 train / 341 validation. Compiled PDF container exception, aliases, three exclusions, singleton groups, and missing-provenance imbalance remain exactly as audited in the original comparison. Evaluation retains natural distributions.

| Target | Weight | Trial | Parameter | CV F1 | SD | Log loss | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0 | {"alpha": 0.1} | 0.8950 | 0.0094 | 0.5316 | 11.41 |
| skill:reading_writing | ordinary | 1 | {"alpha": 1.0} | 0.7831 | 0.0194 | 0.9468 | 11.57 |
| skill:reading_writing | ordinary | 2 | {"alpha": 10.0} | 0.3654 | 0.0116 | 1.7876 | 11.79 |
| skill:reading_writing | ordinary | 3 | {"alpha": 0.0745934328572655} | 0.8910 | 0.0078 | 0.5111 | 11.70 |
| skill:reading_writing | ordinary | 4 | {"alpha": 56.69849511478853} | 0.2376 | 0.0065 | 2.1573 | 11.34 |
| skill:reading_writing | ordinary | 5 | {"alpha": 4.5705630998014515} | 0.4467 | 0.0158 | 1.5126 | 11.56 |
| skill:reading_writing | ordinary | 6 | {"alpha": 0.9846738873614566} | 0.7888 | 0.0187 | 0.9419 | 11.60 |
| skill:reading_writing | ordinary | 7 | {"alpha": 0.006026889128682512} | 0.8775 | 0.0202 | 0.4411 | 11.38 |
| skill:reading_writing | ordinary | 8 | {"alpha": 0.0060252157362038605} | 0.8775 | 0.0202 | 0.4411 | 11.60 |
| skill:reading_writing | ordinary | 9 | {"alpha": 0.0019517224641449498} | 0.8669 | 0.0275 | 0.4415 | 11.37 |
| skill:reading_writing | ordinary | 10 | {"alpha": 0.12241215283849362} | 0.8941 | 0.0094 | 0.5485 | 11.50 |
| skill:reading_writing | ordinary | 11 | {"alpha": 0.11345153067354169} | 0.8959 | 0.0117 | 0.5418 | 11.50 |
| skill:reading_writing | ordinary | 12 | {"alpha": 0.07495496143577177} | 0.8910 | 0.0078 | 0.5114 | 11.76 |
| skill:reading_writing | ordinary | 13 | {"alpha": 0.22088180319677747} | 0.8954 | 0.0134 | 0.6135 | 11.26 |
| skill:reading_writing | ordinary | 14 | {"alpha": 0.6662536878998746} | 0.8561 | 0.0100 | 0.8285 | 11.65 |
| skill:reading_writing | ordinary | 15 | {"alpha": 0.03182908215905919} | 0.8880 | 0.0088 | 0.4708 | 11.88 |
| skill:reading_writing | ordinary | 16 | {"alpha": 0.3375594090264211} | 0.8908 | 0.0224 | 0.6793 | 11.34 |
| skill:reading_writing | ordinary | 17 | {"alpha": 0.02322171907367821} | 0.8877 | 0.0132 | 0.4613 | 11.41 |
| skill:reading_writing | ordinary | 18 | {"alpha": 5.288158909550533} | 0.4339 | 0.0174 | 1.5675 | 11.35 |
| skill:reading_writing | ordinary | 19 | {"alpha": 0.2719257326770212} | 0.8935 | 0.0232 | 0.6435 | 11.52 |
| skill:reading_writing | balanced | 0 | {"alpha": 0.1} | 0.8805 | 0.0198 | 0.5242 | 11.70 |
| skill:reading_writing | balanced | 1 | {"alpha": 1.0} | 0.8351 | 0.0116 | 0.9464 | 11.76 |
| skill:reading_writing | balanced | 2 | {"alpha": 10.0} | 0.7420 | 0.0198 | 1.8599 | 11.38 |
| skill:reading_writing | balanced | 3 | {"alpha": 0.0745934328572655} | 0.8783 | 0.0177 | 0.5044 | 11.40 |
| skill:reading_writing | balanced | 4 | {"alpha": 56.69849511478853} | 0.6336 | 0.0209 | 2.1948 | 11.39 |
| skill:reading_writing | balanced | 5 | {"alpha": 4.5705630998014515} | 0.7719 | 0.0151 | 1.5734 | 11.43 |
| skill:reading_writing | balanced | 6 | {"alpha": 0.9846738873614566} | 0.8360 | 0.0119 | 0.9411 | 12.67 |
| skill:reading_writing | balanced | 7 | {"alpha": 0.006026889128682512} | 0.8635 | 0.0141 | 0.4376 | 13.82 |
| skill:reading_writing | balanced | 8 | {"alpha": 0.0060252157362038605} | 0.8635 | 0.0141 | 0.4376 | 13.19 |
| skill:reading_writing | balanced | 9 | {"alpha": 0.0019517224641449498} | 0.8553 | 0.0118 | 0.4385 | 11.51 |
| skill:reading_writing | balanced | 10 | {"alpha": 0.12241215283849362} | 0.8804 | 0.0197 | 0.5405 | 11.53 |
| skill:reading_writing | balanced | 11 | {"alpha": 0.11345153067354169} | 0.8799 | 0.0200 | 0.5341 | 11.99 |
| skill:reading_writing | balanced | 12 | {"alpha": 0.0797982490645102} | 0.8803 | 0.0188 | 0.5086 | 11.82 |
| skill:reading_writing | balanced | 13 | {"alpha": 0.22088180319677747} | 0.8799 | 0.0178 | 0.6037 | 11.44 |
| skill:reading_writing | balanced | 14 | {"alpha": 0.019235544518260355} | 0.8675 | 0.0128 | 0.4522 | 11.52 |
| skill:reading_writing | balanced | 15 | {"alpha": 0.6000984619892432} | 0.8490 | 0.0133 | 0.7926 | 11.37 |
| skill:reading_writing | balanced | 16 | {"alpha": 0.023528360694758662} | 0.8669 | 0.0123 | 0.4570 | 11.40 |
| skill:reading_writing | balanced | 17 | {"alpha": 4.965557659377531} | 0.7708 | 0.0159 | 1.6072 | 11.48 |
| skill:reading_writing | balanced | 18 | {"alpha": 0.29731820838102996} | 0.8729 | 0.0176 | 0.6471 | 11.66 |
| skill:reading_writing | balanced | 19 | {"alpha": 0.031035553725379993} | 0.8728 | 0.0132 | 0.4649 | 11.56 |
| difficulty | ordinary | 0 | {"alpha": 0.1} | 0.5105 | 0.0253 | 1.0970 | 11.29 |
| difficulty | ordinary | 1 | {"alpha": 1.0} | 0.5113 | 0.0275 | 0.9793 | 11.31 |
| difficulty | ordinary | 2 | {"alpha": 10.0} | 0.4732 | 0.0268 | 1.0373 | 11.18 |
| difficulty | ordinary | 3 | {"alpha": 0.0745934328572655} | 0.5097 | 0.0298 | 1.1187 | 11.17 |
| difficulty | ordinary | 4 | {"alpha": 56.69849511478853} | 0.4559 | 0.0248 | 1.0814 | 11.33 |
| difficulty | ordinary | 5 | {"alpha": 4.5705630998014515} | 0.4816 | 0.0252 | 1.0082 | 11.22 |
| difficulty | ordinary | 6 | {"alpha": 0.9846738873614566} | 0.5090 | 0.0266 | 0.9795 | 11.38 |
| difficulty | ordinary | 7 | {"alpha": 0.006026889128682512} | 0.4998 | 0.0226 | 1.3272 | 11.62 |
| difficulty | ordinary | 8 | {"alpha": 0.0060252157362038605} | 0.4998 | 0.0226 | 1.3272 | 11.24 |
| difficulty | ordinary | 9 | {"alpha": 0.0019517224641449498} | 0.4912 | 0.0216 | 1.4444 | 11.28 |
| difficulty | ordinary | 10 | {"alpha": 0.23863437635100831} | 0.5072 | 0.0171 | 1.0366 | 11.17 |
| difficulty | ordinary | 11 | {"alpha": 0.11345153067354169} | 0.5068 | 0.0285 | 1.0878 | 11.23 |
| difficulty | ordinary | 12 | {"alpha": 0.5133552899237402} | 0.5097 | 0.0221 | 0.9959 | 11.22 |
| difficulty | ordinary | 13 | {"alpha": 0.05423185466354646} | 0.5105 | 0.0287 | 1.1426 | 11.50 |
| difficulty | ordinary | 14 | {"alpha": 2.353448990022641} | 0.5005 | 0.0329 | 0.9871 | 11.43 |
| difficulty | ordinary | 15 | {"alpha": 0.03182908215905919} | 0.5100 | 0.0297 | 1.1837 | 11.39 |
| difficulty | ordinary | 16 | {"alpha": 47.588407679365766} | 0.4573 | 0.0280 | 1.0786 | 11.25 |
| difficulty | ordinary | 17 | {"alpha": 0.01583855835060528} | 0.5060 | 0.0197 | 1.2404 | 11.32 |
| difficulty | ordinary | 18 | {"alpha": 0.5467530386354753} | 0.5105 | 0.0264 | 0.9935 | 11.20 |
| difficulty | ordinary | 19 | {"alpha": 13.720747558007119} | 0.4707 | 0.0246 | 1.0482 | 11.37 |
| difficulty | balanced | 0 | {"alpha": 0.1} | 0.5090 | 0.0234 | 1.0997 | 11.43 |
| difficulty | balanced | 1 | {"alpha": 1.0} | 0.4991 | 0.0094 | 0.9859 | 11.31 |
| difficulty | balanced | 2 | {"alpha": 10.0} | 0.4659 | 0.0220 | 1.0394 | 11.28 |
| difficulty | balanced | 3 | {"alpha": 0.0745934328572655} | 0.5103 | 0.0297 | 1.1207 | 11.25 |
| difficulty | balanced | 4 | {"alpha": 56.69849511478853} | 0.4548 | 0.0212 | 1.0816 | 11.45 |
| difficulty | balanced | 5 | {"alpha": 4.5705630998014515} | 0.4704 | 0.0195 | 1.0119 | 11.46 |
| difficulty | balanced | 6 | {"alpha": 0.9846738873614566} | 0.4991 | 0.0094 | 0.9861 | 11.40 |
| difficulty | balanced | 7 | {"alpha": 0.006026889128682512} | 0.4973 | 0.0155 | 1.3276 | 11.30 |
| difficulty | balanced | 8 | {"alpha": 0.0060252157362038605} | 0.4973 | 0.0155 | 1.3276 | 11.21 |
| difficulty | balanced | 9 | {"alpha": 0.0019517224641449498} | 0.4902 | 0.0180 | 1.4446 | 11.34 |
| difficulty | balanced | 10 | {"alpha": 0.1152321528294806} | 0.5080 | 0.0261 | 1.0897 | 11.31 |
| difficulty | balanced | 11 | {"alpha": 0.07715710608842291} | 0.5101 | 0.0282 | 1.1183 | 11.40 |
| difficulty | balanced | 12 | {"alpha": 0.058599430252151814} | 0.5052 | 0.0286 | 1.1384 | 11.23 |
| difficulty | balanced | 13 | {"alpha": 0.04459044569339295} | 0.5096 | 0.0271 | 1.1588 | 11.25 |
| difficulty | balanced | 14 | {"alpha": 0.5802098971430103} | 0.5033 | 0.0120 | 0.9981 | 11.24 |
| difficulty | balanced | 15 | {"alpha": 0.03182908215905919} | 0.5087 | 0.0324 | 1.1846 | 11.25 |
| difficulty | balanced | 16 | {"alpha": 0.29234201785862296} | 0.5075 | 0.0075 | 1.0299 | 11.26 |
| difficulty | balanced | 17 | {"alpha": 0.010799206857905324} | 0.5048 | 0.0211 | 1.2739 | 11.19 |
| difficulty | balanced | 18 | {"alpha": 5.288158909550533} | 0.4678 | 0.0230 | 1.0170 | 11.19 |
| difficulty | balanced | 19 | {"alpha": 0.0011638142281027624} | 0.4886 | 0.0221 | 1.5042 | 11.17 |

CV-selected weighting: `{"skill:reading_writing": "ordinary", "difficulty": "ordinary"}`.

| Target | Weight | Validation macro-F1 mean | Seed SD |
| --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0.8764 | 0.0000 |
| skill:reading_writing | balanced | 0.8535 | 0.0000 |
| difficulty | ordinary | 0.4812 | 0.0000 |
| difficulty | balanced | 0.4985 | 0.0000 |

### ordinary — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8856 | 0.8807 | 0.8764 | 0.8775 | 0.3138 | 0.1592 | 0.0306 | [0.8356, 0.9057] |
| domain:reading_writing | 341 | 0.9736 | 0.9738 | 0.9744 | 0.9735 | 0.1021 | 0.0494 | 0.0431 | [0.9549, 0.9890] |
| difficulty | 328 | 0.4909 | 0.4946 | 0.4812 | 0.4788 | 0.9858 | 0.5923 | 0.0779 | [0.4242, 0.5301] |

Joint correctness 0.4207 on 328 questions. Ordinal difficulty MAE 0.6463; Easy↔Hard rate 0.1372.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8125 | 0.6190 | [0.4897, 0.7778] | 0.7027 |  |
| Central Ideas and Details | 28 | 1.0000 | 0.4286 | [0.2493, 0.6092] | 0.6000 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.9167 | [0.7143, 1.0000] | 0.9565 | Yes |
| Form, Structure, and Sense | 41 | 0.6923 | 0.8780 | [0.7853, 0.9744] | 0.7742 |  |
| Inferences | 28 | 0.7714 | 0.9643 | [0.8889, 1.0000] | 0.8571 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.8889 | 1.0000 | [1.0000, 1.0000] | 0.9412 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 26 | 0 | 0 | 0 | 16 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 1 | 12 | 2 | 0 | 0 | 7 | 2 | 4 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 27 | 0 | 0 | 0 | 1 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.2300; coverage 0.9971; abstention 0.0029; retained precision 0.8882.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9326 | 0.9151 |
| 0.7 | 0.7947 | 0.9668 |
| 0.8 | 0.7214 | 0.9878 |
| 0.9 | 0.6598 | 0.9867 |
| 0.95 | 0.6305 | 0.9907 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9406 | 0.9896 | [0.9615, 1.0000] | 0.9645 |  |
| Expression of Ideas | 77 | 0.9872 | 1.0000 | [1.0000, 1.0000] | 0.9935 |  |
| Information and Ideas | 85 | 0.9750 | 0.9176 | [0.8480, 0.9756] | 0.9455 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 6 | 1 | 78 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9736.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9765 | 0.9850 |
| 0.7 | 0.9296 | 0.9905 |
| 0.8 | 0.8768 | 0.9933 |
| 0.9 | 0.7977 | 0.9963 |
| 0.95 | 0.7449 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.4615 | 0.7290 | [0.6509, 0.8086] | 0.5652 |  |
| 3 | 115 | 0.4578 | 0.3304 | [0.2452, 0.4380] | 0.3838 |  |
| 5 | 106 | 0.5921 | 0.4245 | [0.3363, 0.5166] | 0.4945 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 78 | 21 | 8 |
| 3 | 54 | 38 | 23 |
| 5 | 37 | 24 | 45 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5671 | 0.6075 |
| 0.7 | 0.1098 | 0.7500 |
| 0.8 | 0.0213 | 0.8571 |
| 0.9 | 0.0030 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 2.4214804000221193, "difficulty": 2.5012854000087827}`; evaluation 4.24s; reload parity passed.

### ordinary — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8856 | 0.8807 | 0.8764 | 0.8775 | 0.3138 | 0.1592 | 0.0306 | [0.8356, 0.9057] |
| domain:reading_writing | 341 | 0.9736 | 0.9738 | 0.9744 | 0.9735 | 0.1021 | 0.0494 | 0.0431 | [0.9549, 0.9890] |
| difficulty | 328 | 0.4909 | 0.4946 | 0.4812 | 0.4788 | 0.9858 | 0.5923 | 0.0779 | [0.4242, 0.5301] |

Joint correctness 0.4207 on 328 questions. Ordinal difficulty MAE 0.6463; Easy↔Hard rate 0.1372.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8125 | 0.6190 | [0.4897, 0.7778] | 0.7027 |  |
| Central Ideas and Details | 28 | 1.0000 | 0.4286 | [0.2493, 0.6092] | 0.6000 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.9167 | [0.7143, 1.0000] | 0.9565 | Yes |
| Form, Structure, and Sense | 41 | 0.6923 | 0.8780 | [0.7853, 0.9744] | 0.7742 |  |
| Inferences | 28 | 0.7714 | 0.9643 | [0.8889, 1.0000] | 0.8571 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.8889 | 1.0000 | [1.0000, 1.0000] | 0.9412 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 26 | 0 | 0 | 0 | 16 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 1 | 12 | 2 | 0 | 0 | 7 | 2 | 4 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 27 | 0 | 0 | 0 | 1 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.2300; coverage 0.9971; abstention 0.0029; retained precision 0.8882.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9326 | 0.9151 |
| 0.7 | 0.7947 | 0.9668 |
| 0.8 | 0.7214 | 0.9878 |
| 0.9 | 0.6598 | 0.9867 |
| 0.95 | 0.6305 | 0.9907 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9406 | 0.9896 | [0.9615, 1.0000] | 0.9645 |  |
| Expression of Ideas | 77 | 0.9872 | 1.0000 | [1.0000, 1.0000] | 0.9935 |  |
| Information and Ideas | 85 | 0.9750 | 0.9176 | [0.8480, 0.9756] | 0.9455 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 6 | 1 | 78 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9736.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9765 | 0.9850 |
| 0.7 | 0.9296 | 0.9905 |
| 0.8 | 0.8768 | 0.9933 |
| 0.9 | 0.7977 | 0.9963 |
| 0.95 | 0.7449 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.4615 | 0.7290 | [0.6509, 0.8086] | 0.5652 |  |
| 3 | 115 | 0.4578 | 0.3304 | [0.2452, 0.4380] | 0.3838 |  |
| 5 | 106 | 0.5921 | 0.4245 | [0.3363, 0.5166] | 0.4945 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 78 | 21 | 8 |
| 3 | 54 | 38 | 23 |
| 5 | 37 | 24 | 45 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5671 | 0.6075 |
| 0.7 | 0.1098 | 0.7500 |
| 0.8 | 0.0213 | 0.8571 |
| 0.9 | 0.0030 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 2.613253499963321, "difficulty": 2.522884799982421}`; evaluation 4.23s; reload parity passed.

### ordinary — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8856 | 0.8807 | 0.8764 | 0.8775 | 0.3138 | 0.1592 | 0.0306 | [0.8356, 0.9057] |
| domain:reading_writing | 341 | 0.9736 | 0.9738 | 0.9744 | 0.9735 | 0.1021 | 0.0494 | 0.0431 | [0.9549, 0.9890] |
| difficulty | 328 | 0.4909 | 0.4946 | 0.4812 | 0.4788 | 0.9858 | 0.5923 | 0.0779 | [0.4242, 0.5301] |

Joint correctness 0.4207 on 328 questions. Ordinal difficulty MAE 0.6463; Easy↔Hard rate 0.1372.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8125 | 0.6190 | [0.4897, 0.7778] | 0.7027 |  |
| Central Ideas and Details | 28 | 1.0000 | 0.4286 | [0.2493, 0.6092] | 0.6000 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 1.0000 | 0.9167 | [0.7143, 1.0000] | 0.9565 | Yes |
| Form, Structure, and Sense | 41 | 0.6923 | 0.8780 | [0.7853, 0.9744] | 0.7742 |  |
| Inferences | 28 | 0.7714 | 0.9643 | [0.8889, 1.0000] | 0.8571 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.8889 | 1.0000 | [1.0000, 1.0000] | 0.9412 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 26 | 0 | 0 | 0 | 16 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 1 | 12 | 2 | 0 | 0 | 7 | 2 | 4 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 0 | 0 | 27 | 0 | 0 | 0 | 1 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.2300; coverage 0.9971; abstention 0.0029; retained precision 0.8882.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9326 | 0.9151 |
| 0.7 | 0.7947 | 0.9668 |
| 0.8 | 0.7214 | 0.9878 |
| 0.9 | 0.6598 | 0.9867 |
| 0.95 | 0.6305 | 0.9907 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9406 | 0.9896 | [0.9615, 1.0000] | 0.9645 |  |
| Expression of Ideas | 77 | 0.9872 | 1.0000 | [1.0000, 1.0000] | 0.9935 |  |
| Information and Ideas | 85 | 0.9750 | 0.9176 | [0.8480, 0.9756] | 0.9455 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9615, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 6 | 1 | 78 | 0 |
| Standard English Conventions | 0 | 0 | 1 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9736.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9765 | 0.9850 |
| 0.7 | 0.9296 | 0.9905 |
| 0.8 | 0.8768 | 0.9933 |
| 0.9 | 0.7977 | 0.9963 |
| 0.95 | 0.7449 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.4615 | 0.7290 | [0.6509, 0.8086] | 0.5652 |  |
| 3 | 115 | 0.4578 | 0.3304 | [0.2452, 0.4380] | 0.3838 |  |
| 5 | 106 | 0.5921 | 0.4245 | [0.3363, 0.5166] | 0.4945 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 78 | 21 | 8 |
| 3 | 54 | 38 | 23 |
| 5 | 37 | 24 | 45 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5671 | 0.6075 |
| 0.7 | 0.1098 | 0.7500 |
| 0.8 | 0.0213 | 0.8571 |
| 0.9 | 0.0030 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 2.5397741000633687, "difficulty": 2.509924400015734}`; evaluation 4.21s; reload parity passed.

### balanced — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8739 | 0.8676 | 0.8535 | 0.8664 | 0.3165 | 0.1657 | 0.0322 | [0.8140, 0.8914] |
| domain:reading_writing | 341 | 0.9619 | 0.9621 | 0.9635 | 0.9616 | 0.1033 | 0.0535 | 0.0320 | [0.9464, 0.9844] |
| difficulty | 328 | 0.5091 | 0.5146 | 0.4985 | 0.4950 | 0.9708 | 0.5819 | 0.0576 | [0.4464, 0.5443] |

Joint correctness 0.4268 on 328 questions. Ordinal difficulty MAE 0.6128; Easy↔Hard rate 0.1220.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8065 | 0.5952 | [0.4706, 0.7556] | 0.6849 |  |
| Central Ideas and Details | 28 | 1.0000 | 0.4286 | [0.2606, 0.6002] | 0.6000 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 0.6875 | 0.9167 | [0.7143, 1.0000] | 0.7857 | Yes |
| Form, Structure, and Sense | 41 | 0.6792 | 0.8780 | [0.7853, 0.9744] | 0.7660 |  |
| Inferences | 28 | 0.7500 | 0.8571 | [0.7200, 0.9643] | 0.8000 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 0.8889 | 1.0000 | [1.0000, 1.0000] | 0.9412 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 25 | 0 | 0 | 0 | 17 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 1 | 12 | 2 | 2 | 0 | 7 | 0 | 4 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 3 | 0 | 24 | 0 | 0 | 0 | 1 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.3500; coverage 0.9707; abstention 0.0293; retained precision 0.8912.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9326 | 0.9025 |
| 0.7 | 0.7889 | 0.9628 |
| 0.8 | 0.7331 | 0.9880 |
| 0.9 | 0.6628 | 0.9912 |
| 0.95 | 0.6364 | 0.9908 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.8879 | 0.9896 | [0.9615, 1.0000] | 0.9360 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9865 | 0.8588 | [0.7931, 0.9432] | 0.9182 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 12 | 0 | 73 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9824 | 0.9731 |
| 0.7 | 0.9238 | 0.9937 |
| 0.8 | 0.8827 | 0.9967 |
| 0.9 | 0.8006 | 1.0000 |
| 0.95 | 0.7537 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.4935 | 0.7103 | [0.6302, 0.7980] | 0.5824 |  |
| 3 | 115 | 0.4595 | 0.2957 | [0.2118, 0.3802] | 0.3598 |  |
| 5 | 106 | 0.5700 | 0.5377 | [0.4475, 0.6265] | 0.5534 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 19 | 12 |
| 3 | 50 | 34 | 31 |
| 5 | 28 | 21 | 57 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5396 | 0.5989 |
| 0.7 | 0.1037 | 0.7353 |
| 0.8 | 0.0366 | 0.9167 |
| 0.9 | 0.0091 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 2.5901537999743596, "difficulty": 2.558274600072764}`; evaluation 4.24s; reload parity passed.

### balanced — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8739 | 0.8676 | 0.8535 | 0.8664 | 0.3165 | 0.1657 | 0.0322 | [0.8140, 0.8914] |
| domain:reading_writing | 341 | 0.9619 | 0.9621 | 0.9635 | 0.9616 | 0.1033 | 0.0535 | 0.0320 | [0.9464, 0.9844] |
| difficulty | 328 | 0.5091 | 0.5146 | 0.4985 | 0.4950 | 0.9708 | 0.5819 | 0.0576 | [0.4464, 0.5443] |

Joint correctness 0.4268 on 328 questions. Ordinal difficulty MAE 0.6128; Easy↔Hard rate 0.1220.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8065 | 0.5952 | [0.4706, 0.7556] | 0.6849 |  |
| Central Ideas and Details | 28 | 1.0000 | 0.4286 | [0.2606, 0.6002] | 0.6000 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 0.6875 | 0.9167 | [0.7143, 1.0000] | 0.7857 | Yes |
| Form, Structure, and Sense | 41 | 0.6792 | 0.8780 | [0.7853, 0.9744] | 0.7660 |  |
| Inferences | 28 | 0.7500 | 0.8571 | [0.7200, 0.9643] | 0.8000 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 0.8889 | 1.0000 | [1.0000, 1.0000] | 0.9412 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 25 | 0 | 0 | 0 | 17 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 1 | 12 | 2 | 2 | 0 | 7 | 0 | 4 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 3 | 0 | 24 | 0 | 0 | 0 | 1 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.3500; coverage 0.9707; abstention 0.0293; retained precision 0.8912.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9326 | 0.9025 |
| 0.7 | 0.7889 | 0.9628 |
| 0.8 | 0.7331 | 0.9880 |
| 0.9 | 0.6628 | 0.9912 |
| 0.95 | 0.6364 | 0.9908 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.8879 | 0.9896 | [0.9615, 1.0000] | 0.9360 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9865 | 0.8588 | [0.7931, 0.9432] | 0.9182 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 12 | 0 | 73 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9824 | 0.9731 |
| 0.7 | 0.9238 | 0.9937 |
| 0.8 | 0.8827 | 0.9967 |
| 0.9 | 0.8006 | 1.0000 |
| 0.95 | 0.7537 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.4935 | 0.7103 | [0.6302, 0.7980] | 0.5824 |  |
| 3 | 115 | 0.4595 | 0.2957 | [0.2118, 0.3802] | 0.3598 |  |
| 5 | 106 | 0.5700 | 0.5377 | [0.4475, 0.6265] | 0.5534 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 19 | 12 |
| 3 | 50 | 34 | 31 |
| 5 | 28 | 21 | 57 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5396 | 0.5989 |
| 0.7 | 0.1037 | 0.7353 |
| 0.8 | 0.0366 | 0.9167 |
| 0.9 | 0.0091 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 2.6213145999936387, "difficulty": 2.4790772000560537}`; evaluation 4.24s; reload parity passed.

### balanced — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8739 | 0.8676 | 0.8535 | 0.8664 | 0.3165 | 0.1657 | 0.0322 | [0.8140, 0.8914] |
| domain:reading_writing | 341 | 0.9619 | 0.9621 | 0.9635 | 0.9616 | 0.1033 | 0.0535 | 0.0320 | [0.9464, 0.9844] |
| difficulty | 328 | 0.5091 | 0.5146 | 0.4985 | 0.4950 | 0.9708 | 0.5819 | 0.0576 | [0.4464, 0.5443] |

Joint correctness 0.4268 on 328 questions. Ordinal difficulty MAE 0.6128; Easy↔Hard rate 0.1220.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8065 | 0.5952 | [0.4706, 0.7556] | 0.6849 |  |
| Central Ideas and Details | 28 | 1.0000 | 0.4286 | [0.2606, 0.6002] | 0.6000 |  |
| Command of Evidence | 29 | 0.9355 | 1.0000 | [1.0000, 1.0000] | 0.9667 |  |
| Cross-Text Connections | 12 | 0.6875 | 0.9167 | [0.7143, 1.0000] | 0.7857 | Yes |
| Form, Structure, and Sense | 41 | 0.6792 | 0.8780 | [0.7853, 0.9744] | 0.7660 |  |
| Inferences | 28 | 0.7500 | 0.8571 | [0.7200, 0.9643] | 0.8000 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 0.8889 | 1.0000 | [1.0000, 1.0000] | 0.9412 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 25 | 0 | 0 | 0 | 17 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 1 | 12 | 2 | 2 | 0 | 7 | 0 | 4 | 0 | 0 |
| Command of Evidence | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 0 | 0 | 0 | 3 | 0 | 24 | 0 | 0 | 0 | 1 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.3500; coverage 0.9707; abstention 0.0293; retained precision 0.8912.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9326 | 0.9025 |
| 0.7 | 0.7889 | 0.9628 |
| 0.8 | 0.7331 | 0.9880 |
| 0.9 | 0.6628 | 0.9912 |
| 0.95 | 0.6364 | 0.9908 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.8879 | 0.9896 | [0.9615, 1.0000] | 0.9360 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9865 | 0.8588 | [0.7931, 0.9432] | 0.9182 |  |
| Standard English Conventions | 83 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 12 | 0 | 73 | 0 |
| Standard English Conventions | 0 | 0 | 0 | 83 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9824 | 0.9731 |
| 0.7 | 0.9238 | 0.9937 |
| 0.8 | 0.8827 | 0.9967 |
| 0.9 | 0.8006 | 1.0000 |
| 0.95 | 0.7537 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.4935 | 0.7103 | [0.6302, 0.7980] | 0.5824 |  |
| 3 | 115 | 0.4595 | 0.2957 | [0.2118, 0.3802] | 0.3598 |  |
| 5 | 106 | 0.5700 | 0.5377 | [0.4475, 0.6265] | 0.5534 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 19 | 12 |
| 3 | 50 | 34 | 31 |
| 5 | 28 | 21 | 57 |

Threshold Unavailable; coverage 0.0000; abstention 1.0000; retained precision Unavailable.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.5396 | 0.5989 |
| 0.7 | 0.1037 | 0.7353 |
| 0.8 | 0.0366 | 0.9167 |
| 0.9 | 0.0091 | 1.0000 |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 2.5281582000898197, "difficulty": 2.5279075000435114}`; evaluation 4.21s; reload parity passed.

### Operational measurements

| Package | Version |
| --- | --- |
| numpy | 2.5.3 |
| optuna | 4.9.0 |
| scikit-learn | 1.9.1 |
| torch | 2.14.1 |
| transformers | 4.57.6 |

Hardware `{"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}`. Code/dependencies are frozen before training. TF-IDF preparation is included in fit/evaluate times. Training feature-cache preparation 0.00s; run wall time 1058.49s; peak process memory 474.11MB; artifact 17914931 bytes; load 0.39s; API startup 2.80s.

Peak RAM is the main experiment process high-water mark; the separate HTTP server child's peak RAM was not instrumented. CPU math threads are capped at eight per process.

| Path | N | p50 ms | p95 ms | p99 ms | Questions/s |
| --- | --- | --- | --- | --- | --- |
| Direct complete | 1023 | 8.12 | 11.09 | 12.41 | 118.54 |
| HTTP complete | 1023 | 14.54 | 33.74 | 36.97 | 57.18 |

100 questions: direct 0.83s, HTTP 1.71s. Four-client burst: 313 success / 710 busy / 0 unexpected errors; 82.96 successful questions/s. Ten warm-ups and three complete validation passes. Busy responses are not retried; burst throughput is not sustained capacity.

[Metrics and predictions](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_nb/results.json>) · [Configurations](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_nb/configuration-freeze.json>) · [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_nb/selected-seed42/manifest.json>).

Private API authorization and direct/API prediction parity verified. [Serving checks](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/tfidf_nb/serving-verification.json>).

## Frozen ModernBERT + logistic regression

Independent skill/difficulty estimators; source-verified difficulty only. Domain is derived from skill probabilities. Features remain fixed. Ordinary and balanced training are compared independently for each target. Twenty Optuna TPE trials per target/weight variant, including initial 0.1/1/10 settings; logarithmic C/alpha range [0.001,100], seed 42. All trials use five complete frozen CV folds. Selection uses mean macro-F1, then lower log loss, then stronger regularization. SVM sigmoid calibration is fitted within each training partition using restricted frozen folds. OOF temperature/threshold fitting never uses outer validation. Final fits use seeds 42/43/44.

Original ModernBERT checkpoint/pooling and seven structural features match the existing XGBoost experiment. The original cache's passage-marker limitation is described in the fine-tuning section; no new cache is substituted into these completed comparisons. The structural features are passage character length, prompt character length, choice count, digit count, operator count, supplied-image indicator, and essential-image indicator. Cached vectors are reused; scaling is fitted on each fitting partition only. End-to-end inference bypasses feature caches.

Dataset `0d78eb3734e065ed`: 1710 eligible skill questions, 1691 verified difficulty labels; 1369 train / 341 validation. Compiled PDF container exception, aliases, three exclusions, singleton groups, and missing-provenance imbalance remain exactly as audited in the original comparison. Evaluation retains natural distributions.

| Target | Weight | Trial | Parameter | CV F1 | SD | Log loss | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0 | {"C": 0.1} | 0.8884 | 0.0226 | 0.2833 | 0.75 |
| skill:reading_writing | ordinary | 1 | {"C": 1.0} | 0.8854 | 0.0274 | 0.2855 | 0.42 |
| skill:reading_writing | ordinary | 2 | {"C": 10.0} | 0.8684 | 0.0359 | 0.4176 | 0.33 |
| skill:reading_writing | ordinary | 3 | {"C": 0.0745934328572655} | 0.8852 | 0.0256 | 0.2895 | 0.73 |
| skill:reading_writing | ordinary | 4 | {"C": 56.69849511478853} | 0.8552 | 0.0388 | 0.6061 | 0.22 |
| skill:reading_writing | ordinary | 5 | {"C": 4.5705630998014515} | 0.8763 | 0.0216 | 0.3531 | 0.27 |
| skill:reading_writing | ordinary | 6 | {"C": 0.9846738873614566} | 0.8886 | 0.0325 | 0.2774 | 0.52 |
| skill:reading_writing | ordinary | 7 | {"C": 0.006026889128682512} | 0.8648 | 0.0253 | 0.4521 | 0.67 |
| skill:reading_writing | ordinary | 8 | {"C": 0.0060252157362038605} | 0.8648 | 0.0253 | 0.4521 | 0.69 |
| skill:reading_writing | ordinary | 9 | {"C": 0.0019517224641449498} | 0.8187 | 0.0228 | 0.6364 | 0.55 |
| skill:reading_writing | ordinary | 10 | {"C": 0.23792327863502857} | 0.8881 | 0.0239 | 0.2732 | 0.66 |
| skill:reading_writing | ordinary | 11 | {"C": 0.11345153067354169} | 0.8870 | 0.0237 | 0.2812 | 0.76 |
| skill:reading_writing | ordinary | 12 | {"C": 0.5066966900201715} | 0.8895 | 0.0281 | 0.2701 | 0.57 |
| skill:reading_writing | ordinary | 13 | {"C": 1.0197585764947972} | 0.8861 | 0.0288 | 0.2826 | 0.48 |
| skill:reading_writing | ordinary | 14 | {"C": 0.793113490026326} | 0.8901 | 0.0297 | 0.2723 | 0.53 |
| skill:reading_writing | ordinary | 15 | {"C": 6.8913649022123} | 0.8669 | 0.0284 | 0.3861 | 0.27 |
| skill:reading_writing | ordinary | 16 | {"C": 0.018932906660686234} | 0.8809 | 0.0260 | 0.3469 | 0.83 |
| skill:reading_writing | ordinary | 17 | {"C": 35.36750296445846} | 0.8559 | 0.0401 | 0.5819 | 0.21 |
| skill:reading_writing | ordinary | 18 | {"C": 0.46603652220832364} | 0.8891 | 0.0250 | 0.2692 | 0.75 |
| skill:reading_writing | ordinary | 19 | {"C": 1.6541073183400044} | 0.8810 | 0.0248 | 0.3032 | 0.31 |
| skill:reading_writing | balanced | 0 | {"C": 0.1} | 0.8913 | 0.0251 | 0.2825 | 0.86 |
| skill:reading_writing | balanced | 1 | {"C": 1.0} | 0.8888 | 0.0321 | 0.2783 | 0.50 |
| skill:reading_writing | balanced | 2 | {"C": 10.0} | 0.8648 | 0.0296 | 0.4107 | 0.28 |
| skill:reading_writing | balanced | 3 | {"C": 0.0745934328572655} | 0.8913 | 0.0251 | 0.2882 | 0.71 |
| skill:reading_writing | balanced | 4 | {"C": 56.69849511478853} | 0.8590 | 0.0341 | 0.6105 | 0.21 |
| skill:reading_writing | balanced | 5 | {"C": 4.5705630998014515} | 0.8755 | 0.0265 | 0.3592 | 0.26 |
| skill:reading_writing | balanced | 6 | {"C": 0.9846738873614566} | 0.8931 | 0.0288 | 0.2763 | 0.49 |
| skill:reading_writing | balanced | 7 | {"C": 0.006026889128682512} | 0.8742 | 0.0236 | 0.4509 | 0.70 |
| skill:reading_writing | balanced | 8 | {"C": 0.0060252157362038605} | 0.8742 | 0.0236 | 0.4509 | 0.69 |
| skill:reading_writing | balanced | 9 | {"C": 0.0019517224641449498} | 0.8433 | 0.0223 | 0.6399 | 0.54 |
| skill:reading_writing | balanced | 10 | {"C": 0.23792327863502857} | 0.8912 | 0.0256 | 0.2727 | 0.68 |
| skill:reading_writing | balanced | 11 | {"C": 0.11345153067354169} | 0.8918 | 0.0265 | 0.2798 | 0.74 |
| skill:reading_writing | balanced | 12 | {"C": 0.8973543284902247} | 0.8921 | 0.0300 | 0.2747 | 0.57 |
| skill:reading_writing | balanced | 13 | {"C": 1.123031365566296} | 0.8881 | 0.0329 | 0.2839 | 0.49 |
| skill:reading_writing | balanced | 14 | {"C": 0.793113490026326} | 0.8906 | 0.0236 | 0.2718 | 0.64 |
| skill:reading_writing | balanced | 15 | {"C": 8.94819973838644} | 0.8660 | 0.0291 | 0.4070 | 0.28 |
| skill:reading_writing | balanced | 16 | {"C": 45.844255175278796} | 0.8591 | 0.0322 | 0.6006 | 0.22 |
| skill:reading_writing | balanced | 17 | {"C": 0.02387351004746776} | 0.8881 | 0.0266 | 0.3310 | 0.78 |
| skill:reading_writing | balanced | 18 | {"C": 2.5444280527737275} | 0.8807 | 0.0231 | 0.3228 | 0.32 |
| skill:reading_writing | balanced | 19 | {"C": 0.42949714073257245} | 0.8927 | 0.0251 | 0.2699 | 0.58 |
| difficulty | ordinary | 0 | {"C": 0.1} | 0.5325 | 0.0358 | 1.3535 | 0.69 |
| difficulty | ordinary | 1 | {"C": 1.0} | 0.5058 | 0.0300 | 2.4369 | 0.81 |
| difficulty | ordinary | 2 | {"C": 10.0} | 0.5129 | 0.0411 | 3.7572 | 0.82 |
| difficulty | ordinary | 3 | {"C": 0.0745934328572655} | 0.5359 | 0.0393 | 1.2642 | 0.58 |
| difficulty | ordinary | 4 | {"C": 56.69849511478853} | 0.5030 | 0.0365 | 4.9560 | 0.65 |
| difficulty | ordinary | 5 | {"C": 4.5705630998014515} | 0.5093 | 0.0366 | 3.3068 | 0.93 |
| difficulty | ordinary | 6 | {"C": 0.9846738873614566} | 0.5059 | 0.0302 | 2.4275 | 0.71 |
| difficulty | ordinary | 7 | {"C": 0.006026889128682512} | 0.5743 | 0.0331 | 0.9065 | 0.33 |
| difficulty | ordinary | 8 | {"C": 0.0060252157362038605} | 0.5743 | 0.0331 | 0.9065 | 0.31 |
| difficulty | ordinary | 9 | {"C": 0.0019517224641449498} | 0.5793 | 0.0222 | 0.8802 | 0.30 |
| difficulty | ordinary | 10 | {"C": 0.0014083688910684416} | 0.5792 | 0.0218 | 0.8808 | 0.28 |
| difficulty | ordinary | 11 | {"C": 0.0010221922977737942} | 0.5768 | 0.0222 | 0.8843 | 0.25 |
| difficulty | ordinary | 12 | {"C": 0.0010907785690006122} | 0.5778 | 0.0190 | 0.8834 | 0.26 |
| difficulty | ordinary | 13 | {"C": 0.010413933418730792} | 0.5633 | 0.0324 | 0.9398 | 0.46 |
| difficulty | ordinary | 14 | {"C": 0.032054611579718756} | 0.5419 | 0.0434 | 1.0739 | 0.50 |
| difficulty | ordinary | 15 | {"C": 0.004551735572636133} | 0.5751 | 0.0321 | 0.8952 | 0.34 |
| difficulty | ordinary | 16 | {"C": 0.0011170894645947907} | 0.5747 | 0.0209 | 0.8830 | 0.26 |
| difficulty | ordinary | 17 | {"C": 0.022971761198021898} | 0.5490 | 0.0408 | 1.0226 | 0.37 |
| difficulty | ordinary | 18 | {"C": 0.0030538232605893693} | 0.5784 | 0.0305 | 0.8849 | 0.32 |
| difficulty | ordinary | 19 | {"C": 0.15416083477987214} | 0.5248 | 0.0267 | 1.5099 | 0.58 |
| difficulty | balanced | 0 | {"C": 0.1} | 0.5338 | 0.0366 | 1.3528 | 0.69 |
| difficulty | balanced | 1 | {"C": 1.0} | 0.5079 | 0.0300 | 2.4330 | 0.86 |
| difficulty | balanced | 2 | {"C": 10.0} | 0.5130 | 0.0359 | 3.7663 | 0.79 |
| difficulty | balanced | 3 | {"C": 0.0745934328572655} | 0.5349 | 0.0409 | 1.2635 | 0.52 |
| difficulty | balanced | 4 | {"C": 56.69849511478853} | 0.5074 | 0.0325 | 4.9800 | 0.63 |
| difficulty | balanced | 5 | {"C": 4.5705630998014515} | 0.5094 | 0.0369 | 3.3032 | 0.89 |
| difficulty | balanced | 6 | {"C": 0.9846738873614566} | 0.5064 | 0.0295 | 2.4231 | 0.98 |
| difficulty | balanced | 7 | {"C": 0.006026889128682512} | 0.5725 | 0.0304 | 0.9064 | 0.42 |
| difficulty | balanced | 8 | {"C": 0.0060252157362038605} | 0.5725 | 0.0304 | 0.9064 | 0.36 |
| difficulty | balanced | 9 | {"C": 0.0019517224641449498} | 0.5774 | 0.0265 | 0.8801 | 0.35 |
| difficulty | balanced | 10 | {"C": 0.0014083688910684416} | 0.5764 | 0.0257 | 0.8807 | 0.41 |
| difficulty | balanced | 11 | {"C": 0.0010221922977737942} | 0.5727 | 0.0205 | 0.8842 | 0.27 |
| difficulty | balanced | 12 | {"C": 0.0010907785690006122} | 0.5714 | 0.0223 | 0.8833 | 0.25 |
| difficulty | balanced | 13 | {"C": 0.010413933418730792} | 0.5658 | 0.0317 | 0.9397 | 0.35 |
| difficulty | balanced | 14 | {"C": 0.032054611579718756} | 0.5417 | 0.0430 | 1.0735 | 0.42 |
| difficulty | balanced | 15 | {"C": 0.004551735572636133} | 0.5750 | 0.0285 | 0.8951 | 0.33 |
| difficulty | balanced | 16 | {"C": 0.0011170894645947907} | 0.5730 | 0.0220 | 0.8830 | 0.30 |
| difficulty | balanced | 17 | {"C": 0.022971761198021898} | 0.5456 | 0.0369 | 1.0224 | 0.37 |
| difficulty | balanced | 18 | {"C": 0.0030538232605893693} | 0.5737 | 0.0262 | 0.8848 | 0.36 |
| difficulty | balanced | 19 | {"C": 0.15416083477987214} | 0.5260 | 0.0255 | 1.5082 | 0.66 |

CV-selected weighting: `{"skill:reading_writing": "balanced", "difficulty": "ordinary"}`.

| Target | Weight | Validation macro-F1 mean | Seed SD |
| --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0.8705 | 0.0000 |
| skill:reading_writing | balanced | 0.8738 | 0.0000 |
| difficulty | ordinary | 0.5588 | 0.0000 |
| difficulty | balanced | 0.5575 | 0.0000 |

### ordinary — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8944 | 0.8690 | 0.8705 | 0.8928 | 0.3670 | 0.1692 | 0.0316 | [0.8209, 0.9037] |
| domain:reading_writing | 341 | 0.9619 | 0.9641 | 0.9633 | 0.9619 | 0.1044 | 0.0576 | 0.0245 | [0.9444, 0.9797] |
| difficulty | 328 | 0.5610 | 0.5658 | 0.5588 | 0.5548 | 0.8801 | 0.5402 | 0.0462 | [0.5135, 0.6076] |

Joint correctness 0.5000 on 328 questions. Ordinal difficulty MAE 0.4878; Easy↔Hard rate 0.0488.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.9268 | 0.9048 | [0.8235, 1.0000] | 0.9157 |  |
| Central Ideas and Details | 28 | 0.7391 | 0.6071 | [0.4074, 0.7813] | 0.6667 |  |
| Command of Evidence | 29 | 0.7188 | 0.7931 | [0.6519, 0.9448] | 0.7541 |  |
| Cross-Text Connections | 12 | 0.8182 | 0.7500 | [0.4444, 1.0000] | 0.7826 | Yes |
| Form, Structure, and Sense | 41 | 0.9024 | 0.9024 | [0.8162, 0.9778] | 0.9024 |  |
| Inferences | 28 | 0.8276 | 0.8571 | [0.7391, 0.9631] | 0.8421 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.9032 | 0.8750 | [0.7419, 0.9677] | 0.8889 |  |
| Transitions | 37 | 0.9737 | 1.0000 | [1.0000, 1.0000] | 0.9867 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 17 | 4 | 1 | 0 | 3 | 0 | 2 | 0 | 1 |
| Command of Evidence | 0 | 3 | 23 | 0 | 0 | 1 | 1 | 0 | 1 | 0 |
| Cross-Text Connections | 0 | 0 | 2 | 9 | 0 | 0 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 3 | 0 | 0 | 0 | 37 | 0 | 1 | 0 | 0 | 0 |
| Inferences | 0 | 1 | 2 | 1 | 0 | 24 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 28 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.8944.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9648 | 0.9088 |
| 0.7 | 0.8710 | 0.9394 |
| 0.8 | 0.8182 | 0.9534 |
| 0.9 | 0.7361 | 0.9641 |
| 0.95 | 0.6657 | 0.9692 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9570 | 0.9271 | [0.8795, 0.9689] | 0.9418 |  |
| Expression of Ideas | 77 | 0.9747 | 1.0000 | [1.0000, 1.0000] | 0.9872 |  |
| Information and Ideas | 85 | 0.9195 | 0.9412 | [0.8953, 0.9792] | 0.9302 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9605, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 89 | 0 | 7 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 1 | 80 | 0 |
| Standard English Conventions | 0 | 1 | 0 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.9644 |
| 0.7 | 0.9472 | 0.9814 |
| 0.8 | 0.9179 | 0.9872 |
| 0.9 | 0.8592 | 1.0000 |
| 0.95 | 0.8006 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6387 | 0.7103 | [0.6306, 0.7946] | 0.6726 |  |
| 3 | 115 | 0.4343 | 0.3739 | [0.2712, 0.4701] | 0.4019 |  |
| 5 | 106 | 0.5909 | 0.6132 | [0.5333, 0.7055] | 0.6019 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 24 | 7 |
| 3 | 34 | 43 | 38 |
| 5 | 9 | 32 | 65 |

Threshold 0.8600; coverage 0.0488; abstention 0.9512; retained precision 1.0000.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7500 | 0.6098 |
| 0.7 | 0.2561 | 0.7381 |
| 0.8 | 0.1067 | 0.7714 |
| 0.9 | 0.0183 | 1.0000 |
| 0.95 | 0.0061 | 1.0000 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 0.1361482999054715, "difficulty": 0.05440109991468489}`; evaluation 3.67s; reload parity passed.

### ordinary — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8944 | 0.8690 | 0.8705 | 0.8928 | 0.3670 | 0.1692 | 0.0316 | [0.8209, 0.9037] |
| domain:reading_writing | 341 | 0.9619 | 0.9641 | 0.9633 | 0.9619 | 0.1044 | 0.0576 | 0.0245 | [0.9444, 0.9797] |
| difficulty | 328 | 0.5610 | 0.5658 | 0.5588 | 0.5548 | 0.8801 | 0.5402 | 0.0462 | [0.5135, 0.6076] |

Joint correctness 0.5000 on 328 questions. Ordinal difficulty MAE 0.4878; Easy↔Hard rate 0.0488.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.9268 | 0.9048 | [0.8235, 1.0000] | 0.9157 |  |
| Central Ideas and Details | 28 | 0.7391 | 0.6071 | [0.4074, 0.7813] | 0.6667 |  |
| Command of Evidence | 29 | 0.7188 | 0.7931 | [0.6519, 0.9448] | 0.7541 |  |
| Cross-Text Connections | 12 | 0.8182 | 0.7500 | [0.4444, 1.0000] | 0.7826 | Yes |
| Form, Structure, and Sense | 41 | 0.9024 | 0.9024 | [0.8162, 0.9778] | 0.9024 |  |
| Inferences | 28 | 0.8276 | 0.8571 | [0.7391, 0.9631] | 0.8421 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.9032 | 0.8750 | [0.7419, 0.9677] | 0.8889 |  |
| Transitions | 37 | 0.9737 | 1.0000 | [1.0000, 1.0000] | 0.9867 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 17 | 4 | 1 | 0 | 3 | 0 | 2 | 0 | 1 |
| Command of Evidence | 0 | 3 | 23 | 0 | 0 | 1 | 1 | 0 | 1 | 0 |
| Cross-Text Connections | 0 | 0 | 2 | 9 | 0 | 0 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 3 | 0 | 0 | 0 | 37 | 0 | 1 | 0 | 0 | 0 |
| Inferences | 0 | 1 | 2 | 1 | 0 | 24 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 28 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.8944.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9648 | 0.9088 |
| 0.7 | 0.8710 | 0.9394 |
| 0.8 | 0.8182 | 0.9534 |
| 0.9 | 0.7361 | 0.9641 |
| 0.95 | 0.6657 | 0.9692 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9570 | 0.9271 | [0.8795, 0.9689] | 0.9418 |  |
| Expression of Ideas | 77 | 0.9747 | 1.0000 | [1.0000, 1.0000] | 0.9872 |  |
| Information and Ideas | 85 | 0.9195 | 0.9412 | [0.8953, 0.9792] | 0.9302 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9605, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 89 | 0 | 7 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 1 | 80 | 0 |
| Standard English Conventions | 0 | 1 | 0 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.9644 |
| 0.7 | 0.9472 | 0.9814 |
| 0.8 | 0.9179 | 0.9872 |
| 0.9 | 0.8592 | 1.0000 |
| 0.95 | 0.8006 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6387 | 0.7103 | [0.6306, 0.7946] | 0.6726 |  |
| 3 | 115 | 0.4343 | 0.3739 | [0.2712, 0.4701] | 0.4019 |  |
| 5 | 106 | 0.5909 | 0.6132 | [0.5333, 0.7055] | 0.6019 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 24 | 7 |
| 3 | 34 | 43 | 38 |
| 5 | 9 | 32 | 65 |

Threshold 0.8600; coverage 0.0488; abstention 0.9512; retained precision 1.0000.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7500 | 0.6098 |
| 0.7 | 0.2561 | 0.7381 |
| 0.8 | 0.1067 | 0.7714 |
| 0.9 | 0.0183 | 1.0000 |
| 0.95 | 0.0061 | 1.0000 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 0.15362589992582798, "difficulty": 0.052237699972465634}`; evaluation 3.51s; reload parity passed.

### ordinary — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8944 | 0.8690 | 0.8705 | 0.8928 | 0.3670 | 0.1692 | 0.0316 | [0.8209, 0.9037] |
| domain:reading_writing | 341 | 0.9619 | 0.9641 | 0.9633 | 0.9619 | 0.1044 | 0.0576 | 0.0245 | [0.9444, 0.9797] |
| difficulty | 328 | 0.5610 | 0.5658 | 0.5588 | 0.5548 | 0.8801 | 0.5402 | 0.0462 | [0.5135, 0.6076] |

Joint correctness 0.5000 on 328 questions. Ordinal difficulty MAE 0.4878; Easy↔Hard rate 0.0488.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.9268 | 0.9048 | [0.8235, 1.0000] | 0.9157 |  |
| Central Ideas and Details | 28 | 0.7391 | 0.6071 | [0.4074, 0.7813] | 0.6667 |  |
| Command of Evidence | 29 | 0.7188 | 0.7931 | [0.6519, 0.9448] | 0.7541 |  |
| Cross-Text Connections | 12 | 0.8182 | 0.7500 | [0.4444, 1.0000] | 0.7826 | Yes |
| Form, Structure, and Sense | 41 | 0.9024 | 0.9024 | [0.8162, 0.9778] | 0.9024 |  |
| Inferences | 28 | 0.8276 | 0.8571 | [0.7391, 0.9631] | 0.8421 |  |
| Rhetorical Synthesis | 40 | 0.9524 | 1.0000 | [1.0000, 1.0000] | 0.9756 |  |
| Text Structure and Purpose | 32 | 0.9032 | 0.8750 | [0.7419, 0.9677] | 0.8889 |  |
| Transitions | 37 | 0.9737 | 1.0000 | [1.0000, 1.0000] | 0.9867 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 17 | 4 | 1 | 0 | 3 | 0 | 2 | 0 | 1 |
| Command of Evidence | 0 | 3 | 23 | 0 | 0 | 1 | 1 | 0 | 1 | 0 |
| Cross-Text Connections | 0 | 0 | 2 | 9 | 0 | 0 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 3 | 0 | 0 | 0 | 37 | 0 | 1 | 0 | 0 | 0 |
| Inferences | 0 | 1 | 2 | 1 | 0 | 24 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 2 | 1 | 0 | 0 | 1 | 0 | 28 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.8944.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9648 | 0.9088 |
| 0.7 | 0.8710 | 0.9394 |
| 0.8 | 0.8182 | 0.9534 |
| 0.9 | 0.7361 | 0.9641 |
| 0.95 | 0.6657 | 0.9692 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9570 | 0.9271 | [0.8795, 0.9689] | 0.9418 |  |
| Expression of Ideas | 77 | 0.9747 | 1.0000 | [1.0000, 1.0000] | 0.9872 |  |
| Information and Ideas | 85 | 0.9195 | 0.9412 | [0.8953, 0.9792] | 0.9302 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9880 | [0.9605, 1.0000] | 0.9939 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 89 | 0 | 7 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 1 | 80 | 0 |
| Standard English Conventions | 0 | 1 | 0 | 82 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.9644 |
| 0.7 | 0.9472 | 0.9814 |
| 0.8 | 0.9179 | 0.9872 |
| 0.9 | 0.8592 | 1.0000 |
| 0.95 | 0.8006 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6387 | 0.7103 | [0.6306, 0.7946] | 0.6726 |  |
| 3 | 115 | 0.4343 | 0.3739 | [0.2712, 0.4701] | 0.4019 |  |
| 5 | 106 | 0.5909 | 0.6132 | [0.5333, 0.7055] | 0.6019 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 76 | 24 | 7 |
| 3 | 34 | 43 | 38 |
| 5 | 9 | 32 | 65 |

Threshold 0.8600; coverage 0.0488; abstention 0.9512; retained precision 1.0000.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7500 | 0.6098 |
| 0.7 | 0.2561 | 0.7381 |
| 0.8 | 0.1067 | 0.7714 |
| 0.9 | 0.0183 | 1.0000 |
| 0.95 | 0.0061 | 1.0000 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 0.1639506999636069, "difficulty": 0.053095499984920025}`; evaluation 3.60s; reload parity passed.

### balanced — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8974 | 0.8739 | 0.8738 | 0.8975 | 0.3758 | 0.1689 | 0.0351 | [0.8256, 0.9073] |
| domain:reading_writing | 341 | 0.9619 | 0.9640 | 0.9635 | 0.9620 | 0.1053 | 0.0572 | 0.0171 | [0.9444, 0.9783] |
| difficulty | 328 | 0.5610 | 0.5660 | 0.5575 | 0.5535 | 0.8804 | 0.5401 | 0.0473 | [0.5120, 0.6124] |

Joint correctness 0.5061 on 328 questions. Ordinal difficulty MAE 0.4909; Easy↔Hard rate 0.0518.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.9268 | 0.9048 | [0.8235, 1.0000] | 0.9157 |  |
| Central Ideas and Details | 28 | 0.7200 | 0.6429 | [0.4514, 0.8215] | 0.6792 |  |
| Command of Evidence | 29 | 0.6944 | 0.8621 | [0.7419, 0.9697] | 0.7692 |  |
| Cross-Text Connections | 12 | 0.7500 | 0.7500 | [0.4444, 1.0000] | 0.7500 | Yes |
| Form, Structure, and Sense | 41 | 0.9000 | 0.8780 | [0.7754, 0.9535] | 0.8889 |  |
| Inferences | 28 | 0.8571 | 0.8571 | [0.7391, 0.9631] | 0.8571 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.9643 | 0.8438 | [0.7096, 0.9311] | 0.9000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 18 | 5 | 2 | 0 | 2 | 0 | 0 | 0 | 1 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 2 | 9 | 0 | 0 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 3 | 0 | 1 | 0 | 36 | 0 | 1 | 0 | 0 | 0 |
| Inferences | 0 | 1 | 2 | 1 | 0 | 24 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 3 | 1 | 0 | 0 | 1 | 0 | 27 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.8974.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9619 | 0.9116 |
| 0.7 | 0.8739 | 0.9396 |
| 0.8 | 0.8270 | 0.9539 |
| 0.9 | 0.7654 | 0.9579 |
| 0.95 | 0.6774 | 0.9697 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9570 | 0.9271 | [0.8721, 0.9674] | 0.9418 |  |
| Expression of Ideas | 77 | 0.9872 | 1.0000 | [1.0000, 1.0000] | 0.9935 |  |
| Information and Ideas | 85 | 0.9101 | 0.9529 | [0.9070, 0.9886] | 0.9310 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9759 | [0.9390, 1.0000] | 0.9878 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 89 | 0 | 7 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 0 | 81 | 0 |
| Standard English Conventions | 0 | 1 | 1 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.9644 |
| 0.7 | 0.9472 | 0.9783 |
| 0.8 | 0.9150 | 0.9904 |
| 0.9 | 0.8680 | 0.9966 |
| 0.95 | 0.8152 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6311 | 0.7196 | [0.6484, 0.8054] | 0.6725 |  |
| 3 | 115 | 0.4375 | 0.3652 | [0.2636, 0.4629] | 0.3981 |  |
| 5 | 106 | 0.5909 | 0.6132 | [0.5333, 0.7055] | 0.6019 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 77 | 23 | 7 |
| 3 | 35 | 42 | 38 |
| 5 | 10 | 31 | 65 |

Threshold 0.8600; coverage 0.0488; abstention 0.9512; retained precision 1.0000.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7439 | 0.6107 |
| 0.7 | 0.2561 | 0.7381 |
| 0.8 | 0.1067 | 0.7714 |
| 0.9 | 0.0183 | 1.0000 |
| 0.95 | 0.0061 | 1.0000 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 0.11387949995696545, "difficulty": 0.07679870002903044}`; evaluation 3.49s; reload parity passed.

### balanced — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8974 | 0.8739 | 0.8738 | 0.8975 | 0.3758 | 0.1689 | 0.0351 | [0.8256, 0.9073] |
| domain:reading_writing | 341 | 0.9619 | 0.9640 | 0.9635 | 0.9620 | 0.1053 | 0.0572 | 0.0171 | [0.9444, 0.9783] |
| difficulty | 328 | 0.5610 | 0.5660 | 0.5575 | 0.5535 | 0.8804 | 0.5401 | 0.0473 | [0.5120, 0.6124] |

Joint correctness 0.5061 on 328 questions. Ordinal difficulty MAE 0.4909; Easy↔Hard rate 0.0518.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.9268 | 0.9048 | [0.8235, 1.0000] | 0.9157 |  |
| Central Ideas and Details | 28 | 0.7200 | 0.6429 | [0.4514, 0.8215] | 0.6792 |  |
| Command of Evidence | 29 | 0.6944 | 0.8621 | [0.7419, 0.9697] | 0.7692 |  |
| Cross-Text Connections | 12 | 0.7500 | 0.7500 | [0.4444, 1.0000] | 0.7500 | Yes |
| Form, Structure, and Sense | 41 | 0.9000 | 0.8780 | [0.7754, 0.9535] | 0.8889 |  |
| Inferences | 28 | 0.8571 | 0.8571 | [0.7391, 0.9631] | 0.8571 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.9643 | 0.8438 | [0.7096, 0.9311] | 0.9000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 18 | 5 | 2 | 0 | 2 | 0 | 0 | 0 | 1 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 2 | 9 | 0 | 0 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 3 | 0 | 1 | 0 | 36 | 0 | 1 | 0 | 0 | 0 |
| Inferences | 0 | 1 | 2 | 1 | 0 | 24 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 3 | 1 | 0 | 0 | 1 | 0 | 27 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.8974.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9619 | 0.9116 |
| 0.7 | 0.8739 | 0.9396 |
| 0.8 | 0.8270 | 0.9539 |
| 0.9 | 0.7654 | 0.9579 |
| 0.95 | 0.6774 | 0.9697 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9570 | 0.9271 | [0.8721, 0.9674] | 0.9418 |  |
| Expression of Ideas | 77 | 0.9872 | 1.0000 | [1.0000, 1.0000] | 0.9935 |  |
| Information and Ideas | 85 | 0.9101 | 0.9529 | [0.9070, 0.9886] | 0.9310 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9759 | [0.9390, 1.0000] | 0.9878 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 89 | 0 | 7 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 0 | 81 | 0 |
| Standard English Conventions | 0 | 1 | 1 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.9644 |
| 0.7 | 0.9472 | 0.9783 |
| 0.8 | 0.9150 | 0.9904 |
| 0.9 | 0.8680 | 0.9966 |
| 0.95 | 0.8152 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6311 | 0.7196 | [0.6484, 0.8054] | 0.6725 |  |
| 3 | 115 | 0.4375 | 0.3652 | [0.2636, 0.4629] | 0.3981 |  |
| 5 | 106 | 0.5909 | 0.6132 | [0.5333, 0.7055] | 0.6019 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 77 | 23 | 7 |
| 3 | 35 | 42 | 38 |
| 5 | 10 | 31 | 65 |

Threshold 0.8600; coverage 0.0488; abstention 0.9512; retained precision 1.0000.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7439 | 0.6107 |
| 0.7 | 0.2561 | 0.7381 |
| 0.8 | 0.1067 | 0.7714 |
| 0.9 | 0.0183 | 1.0000 |
| 0.95 | 0.0061 | 1.0000 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 0.1089513999177143, "difficulty": 0.06342809996567667}`; evaluation 3.46s; reload parity passed.

### balanced — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.8974 | 0.8739 | 0.8738 | 0.8975 | 0.3758 | 0.1689 | 0.0351 | [0.8256, 0.9073] |
| domain:reading_writing | 341 | 0.9619 | 0.9640 | 0.9635 | 0.9620 | 0.1053 | 0.0572 | 0.0171 | [0.9444, 0.9783] |
| difficulty | 328 | 0.5610 | 0.5660 | 0.5575 | 0.5535 | 0.8804 | 0.5401 | 0.0473 | [0.5120, 0.6124] |

Joint correctness 0.5061 on 328 questions. Ordinal difficulty MAE 0.4909; Easy↔Hard rate 0.0518.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.9268 | 0.9048 | [0.8235, 1.0000] | 0.9157 |  |
| Central Ideas and Details | 28 | 0.7200 | 0.6429 | [0.4514, 0.8215] | 0.6792 |  |
| Command of Evidence | 29 | 0.6944 | 0.8621 | [0.7419, 0.9697] | 0.7692 |  |
| Cross-Text Connections | 12 | 0.7500 | 0.7500 | [0.4444, 1.0000] | 0.7500 | Yes |
| Form, Structure, and Sense | 41 | 0.9000 | 0.8780 | [0.7754, 0.9535] | 0.8889 |  |
| Inferences | 28 | 0.8571 | 0.8571 | [0.7391, 0.9631] | 0.8571 |  |
| Rhetorical Synthesis | 40 | 0.9756 | 1.0000 | [1.0000, 1.0000] | 0.9877 |  |
| Text Structure and Purpose | 32 | 0.9643 | 0.8438 | [0.7096, 0.9311] | 0.9000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 0.9811 | 1.0000 | [1.0000, 1.0000] | 0.9905 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 38 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 18 | 5 | 2 | 0 | 2 | 0 | 0 | 0 | 1 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 0 | 2 | 9 | 0 | 0 | 0 | 1 | 0 | 0 |
| Form, Structure, and Sense | 3 | 0 | 1 | 0 | 36 | 0 | 1 | 0 | 0 | 0 |
| Inferences | 0 | 1 | 2 | 1 | 0 | 24 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 3 | 1 | 0 | 0 | 1 | 0 | 27 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.8974.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9619 | 0.9116 |
| 0.7 | 0.8739 | 0.9396 |
| 0.8 | 0.8270 | 0.9539 |
| 0.9 | 0.7654 | 0.9579 |
| 0.95 | 0.6774 | 0.9697 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9570 | 0.9271 | [0.8721, 0.9674] | 0.9418 |  |
| Expression of Ideas | 77 | 0.9872 | 1.0000 | [1.0000, 1.0000] | 0.9935 |  |
| Information and Ideas | 85 | 0.9101 | 0.9529 | [0.9070, 0.9886] | 0.9310 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9759 | [0.9390, 1.0000] | 0.9878 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 89 | 0 | 7 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 4 | 0 | 81 | 0 |
| Standard English Conventions | 0 | 1 | 1 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9619.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9883 | 0.9644 |
| 0.7 | 0.9472 | 0.9783 |
| 0.8 | 0.9150 | 0.9904 |
| 0.9 | 0.8680 | 0.9966 |
| 0.95 | 0.8152 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6311 | 0.7196 | [0.6484, 0.8054] | 0.6725 |  |
| 3 | 115 | 0.4375 | 0.3652 | [0.2636, 0.4629] | 0.3981 |  |
| 5 | 106 | 0.5909 | 0.6132 | [0.5333, 0.7055] | 0.6019 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 77 | 23 | 7 |
| 3 | 35 | 42 | 38 |
| 5 | 10 | 31 | 65 |

Threshold 0.8600; coverage 0.0488; abstention 0.9512; retained precision 1.0000.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7439 | 0.6107 |
| 0.7 | 0.2561 | 0.7381 |
| 0.8 | 0.1067 | 0.7714 |
| 0.9 | 0.0183 | 1.0000 |
| 0.95 | 0.0061 | 1.0000 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 0.10445260000415146, "difficulty": 0.05778659996576607}`; evaluation 3.58s; reload parity passed.

### Operational measurements

| Package | Version |
| --- | --- |
| numpy | 2.5.3 |
| optuna | 4.9.0 |
| scikit-learn | 1.9.1 |
| torch | 2.14.1 |
| transformers | 4.57.6 |

Original frozen encoder revision `8949b909ec900327062f0ebf497f51aef5e6f0c8`. Historical training extraction 12247.31s, encoder load 98.11s. Shared completed cache 5519880 bytes; these are inherited costs, not newly incurred extraction. Current cache-read preparation is measured below.

Hardware `{"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}`. Code/dependencies are frozen before training. TF-IDF preparation is included in fit/evaluate times. Training feature-cache preparation 10.46s; run wall time 938.89s; peak process memory 3611.84MB; artifact 597877677 bytes; load 1.41s; API startup 11.10s.

Peak RAM is the main experiment process high-water mark; the separate HTTP server child's peak RAM was not instrumented. CPU math threads are capped at eight per process.

Uncached classifier-only feature preparation 97.48s is excluded from classifier-only latency.

| Path | N | p50 ms | p95 ms | p99 ms | Questions/s |
| --- | --- | --- | --- | --- | --- |
| Direct complete | 1023 | 255.43 | 490.23 | 618.93 | 3.49 |
| HTTP complete | 1023 | 253.27 | 462.59 | 564.55 | 3.46 |
| Classifier only | 1023 | 0.47 | 0.89 | 1.29 | 1914.78 |

100 questions: direct 28.29s, HTTP 30.54s. Four-client burst: 6 success / 1017 busy / 0 unexpected errors; 1.97 successful questions/s. Ten warm-ups and three complete validation passes. Busy responses are not retried; burst throughput is not sustained capacity.

[Metrics and predictions](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_lr/results.json>) · [Configurations](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_lr/configuration-freeze.json>) · [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_lr/selected-seed42/manifest.json>).

Private API authorization and direct/API prediction parity verified. [Serving checks](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_lr/serving-verification.json>).

## Frozen ModernBERT + Linear SVM

Additional interrupted attempt: Shared Optuna database reused the old solver study; no final configurations or outer validation produced. Restart with per-artifact-folder storage. Completed 7 CV folds; wall time 107.28s; no outer validation used. [Preserved record](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm-attempt2-shared-study/attempt-status.json>).

The automatic/primal-solver attempt was interrupted after 7 inner CV folds (322.00s completed-fit time; 385.25s wall time). No outer validation was accessed. Its partial runs and source lineage are preserved; none are reused in the restarted search. [Interrupted attempt](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm-attempt1-auto-solver/attempt-status.json>).

The restart uses the dual optimizer for the same L2-regularized squared-hinge LinearSVC objective, with a 10,000-iteration cap. The C range, complete five-fold evaluation, weighting, features, and frozen groups remain unchanged.

Training-only solver timing probe (no outer validation or configuration selection):

| C | Fit seconds | Convergence warnings |
| --- | --- | --- |
| 0.1 | 6.74 | 0 |
| 1 | 6.48 | 0 |
| 10 | 6.63 | 0 |

[Probe measurements](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding-svm-solver-probe.json>).

Independent skill/difficulty estimators; source-verified difficulty only. Domain is derived from skill probabilities. Features remain fixed. Ordinary and balanced training are compared independently for each target. Twenty Optuna TPE trials per target/weight variant, including initial 0.1/1/10 settings; logarithmic C/alpha range [0.001,100], seed 42. All trials use five complete frozen CV folds. Selection uses mean macro-F1, then lower log loss, then stronger regularization. SVM sigmoid calibration is fitted within each training partition using restricted frozen folds. OOF temperature/threshold fitting never uses outer validation. Final fits use seeds 42/43/44.

Original ModernBERT checkpoint/pooling and seven structural features match the existing XGBoost experiment. The original cache's passage-marker limitation is described in the fine-tuning section; no new cache is substituted into these completed comparisons. The structural features are passage character length, prompt character length, choice count, digit count, operator count, supplied-image indicator, and essential-image indicator. Cached vectors are reused; scaling is fitted on each fitting partition only. End-to-end inference bypasses feature caches.

Dataset `0d78eb3734e065ed`: 1710 eligible skill questions, 1691 verified difficulty labels; 1369 train / 341 validation. Compiled PDF container exception, aliases, three exclusions, singleton groups, and missing-provenance imbalance remain exactly as audited in the original comparison. Evaluation retains natural distributions.

| Target | Weight | Trial | Parameter | CV F1 | SD | Log loss | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0 | {"C": 0.1} | 0.9271 | 0.0285 | 0.2634 | 27.73 |
| skill:reading_writing | ordinary | 1 | {"C": 1.0} | 0.9240 | 0.0281 | 0.2708 | 32.63 |
| skill:reading_writing | ordinary | 2 | {"C": 10.0} | 0.9240 | 0.0281 | 0.2716 | 33.16 |
| skill:reading_writing | ordinary | 3 | {"C": 0.0745934328572655} | 0.9285 | 0.0293 | 0.2608 | 27.13 |
| skill:reading_writing | ordinary | 4 | {"C": 56.69849511478853} | 0.9240 | 0.0281 | 0.2717 | 32.71 |
| skill:reading_writing | ordinary | 5 | {"C": 4.5705630998014515} | 0.9240 | 0.0281 | 0.2715 | 32.82 |
| skill:reading_writing | ordinary | 6 | {"C": 0.9846738873614566} | 0.9240 | 0.0281 | 0.2708 | 32.35 |
| skill:reading_writing | ordinary | 7 | {"C": 0.006026889128682512} | 0.9363 | 0.0234 | 0.2347 | 15.72 |
| skill:reading_writing | ordinary | 8 | {"C": 0.0060252157362038605} | 0.9363 | 0.0234 | 0.2347 | 15.00 |
| skill:reading_writing | ordinary | 9 | {"C": 0.0019517224641449498} | 0.9266 | 0.0171 | 0.2370 | 11.07 |
| skill:reading_writing | ordinary | 10 | {"C": 0.02363952111661886} | 0.9336 | 0.0242 | 0.2477 | 20.62 |
| skill:reading_writing | ordinary | 11 | {"C": 0.0010359916440554247} | 0.9180 | 0.0202 | 0.2461 | 8.65 |
| skill:reading_writing | ordinary | 12 | {"C": 0.007645565781251344} | 0.9343 | 0.0234 | 0.2353 | 16.18 |
| skill:reading_writing | ordinary | 13 | {"C": 0.00864552861056482} | 0.9343 | 0.0255 | 0.2362 | 16.27 |
| skill:reading_writing | ordinary | 14 | {"C": 0.004929947671137864} | 0.9354 | 0.0235 | 0.2350 | 14.56 |
| skill:reading_writing | ordinary | 15 | {"C": 0.05240077625245937} | 0.9302 | 0.0275 | 0.2571 | 24.61 |
| skill:reading_writing | ordinary | 16 | {"C": 0.17569877116040214} | 0.9262 | 0.0265 | 0.2667 | 30.61 |
| skill:reading_writing | ordinary | 17 | {"C": 0.02077935415642227} | 0.9317 | 0.0254 | 0.2460 | 20.71 |
| skill:reading_writing | ordinary | 18 | {"C": 0.0030538232605893693} | 0.9299 | 0.0230 | 0.2356 | 13.08 |
| skill:reading_writing | ordinary | 19 | {"C": 0.34259074509228377} | 0.9255 | 0.0273 | 0.2691 | 30.80 |
| skill:reading_writing | balanced | 0 | {"C": 0.1} | 0.9281 | 0.0272 | 0.2632 | 27.96 |
| skill:reading_writing | balanced | 1 | {"C": 1.0} | 0.9240 | 0.0281 | 0.2708 | 32.48 |
| skill:reading_writing | balanced | 2 | {"C": 10.0} | 0.9240 | 0.0281 | 0.2716 | 33.31 |
| skill:reading_writing | balanced | 3 | {"C": 0.0745934328572655} | 0.9285 | 0.0293 | 0.2607 | 26.69 |
| skill:reading_writing | balanced | 4 | {"C": 56.69849511478853} | 0.9240 | 0.0281 | 0.2717 | 32.91 |
| skill:reading_writing | balanced | 5 | {"C": 4.5705630998014515} | 0.9240 | 0.0281 | 0.2715 | 33.49 |
| skill:reading_writing | balanced | 6 | {"C": 0.9846738873614566} | 0.9240 | 0.0281 | 0.2708 | 32.47 |
| skill:reading_writing | balanced | 7 | {"C": 0.006026889128682512} | 0.9373 | 0.0222 | 0.2346 | 14.97 |
| skill:reading_writing | balanced | 8 | {"C": 0.0060252157362038605} | 0.9373 | 0.0222 | 0.2346 | 14.98 |
| skill:reading_writing | balanced | 9 | {"C": 0.0019517224641449498} | 0.9286 | 0.0153 | 0.2374 | 11.26 |
| skill:reading_writing | balanced | 10 | {"C": 0.02363952111661886} | 0.9336 | 0.0242 | 0.2475 | 20.74 |
| skill:reading_writing | balanced | 11 | {"C": 0.0010359916440554247} | 0.9203 | 0.0162 | 0.2461 | 8.64 |
| skill:reading_writing | balanced | 12 | {"C": 0.007645565781251344} | 0.9352 | 0.0254 | 0.2355 | 15.79 |
| skill:reading_writing | balanced | 13 | {"C": 0.00864552861056482} | 0.9333 | 0.0259 | 0.2364 | 15.81 |
| skill:reading_writing | balanced | 14 | {"C": 0.004929947671137864} | 0.9354 | 0.0235 | 0.2349 | 14.32 |
| skill:reading_writing | balanced | 15 | {"C": 0.05240077625245937} | 0.9296 | 0.0280 | 0.2571 | 24.97 |
| skill:reading_writing | balanced | 16 | {"C": 0.17569877116040214} | 0.9268 | 0.0259 | 0.2666 | 29.78 |
| skill:reading_writing | balanced | 17 | {"C": 0.02077935415642227} | 0.9336 | 0.0242 | 0.2459 | 19.78 |
| skill:reading_writing | balanced | 18 | {"C": 0.0030538232605893693} | 0.9347 | 0.0224 | 0.2355 | 12.78 |
| skill:reading_writing | balanced | 19 | {"C": 0.34259074509228377} | 0.9255 | 0.0273 | 0.2690 | 31.66 |
| difficulty | ordinary | 0 | {"C": 0.1} | 0.5173 | 0.0373 | 0.9757 | 30.94 |
| difficulty | ordinary | 1 | {"C": 1.0} | 0.5072 | 0.0299 | 0.9857 | 57.85 |
| difficulty | ordinary | 2 | {"C": 10.0} | 0.5078 | 0.0277 | 0.9875 | 67.26 |
| difficulty | ordinary | 3 | {"C": 0.0745934328572655} | 0.5186 | 0.0350 | 0.9732 | 26.38 |
| difficulty | ordinary | 4 | {"C": 56.69849511478853} | 0.5084 | 0.0270 | 0.9877 | 66.67 |
| difficulty | ordinary | 5 | {"C": 4.5705630998014515} | 0.5078 | 0.0277 | 0.9873 | 64.42 |
| difficulty | ordinary | 6 | {"C": 0.9846738873614566} | 0.5072 | 0.0299 | 0.9857 | 58.68 |
| difficulty | ordinary | 7 | {"C": 0.006026889128682512} | 0.5461 | 0.0414 | 0.9363 | 7.08 |
| difficulty | ordinary | 8 | {"C": 0.0060252157362038605} | 0.5461 | 0.0414 | 0.9363 | 7.42 |
| difficulty | ordinary | 9 | {"C": 0.0019517224641449498} | 0.5377 | 0.0463 | 0.9122 | 4.01 |
| difficulty | ordinary | 10 | {"C": 0.02363952111661886} | 0.5301 | 0.0265 | 0.9597 | 13.98 |
| difficulty | ordinary | 11 | {"C": 0.0010359916440554247} | 0.5529 | 0.0381 | 0.9002 | 2.89 |
| difficulty | ordinary | 12 | {"C": 0.0010907785690006122} | 0.5509 | 0.0382 | 0.9011 | 2.98 |
| difficulty | ordinary | 13 | {"C": 0.0010632044586887642} | 0.5530 | 0.0382 | 0.9007 | 3.00 |
| difficulty | ordinary | 14 | {"C": 0.0010926145631265614} | 0.5509 | 0.0382 | 0.9012 | 2.97 |
| difficulty | ordinary | 15 | {"C": 0.008701257752894272} | 0.5433 | 0.0375 | 0.9438 | 8.04 |
| difficulty | ordinary | 16 | {"C": 0.029504036380002784} | 0.5220 | 0.0214 | 0.9625 | 16.16 |
| difficulty | ordinary | 17 | {"C": 0.004352405231106423} | 0.5370 | 0.0404 | 0.9293 | 5.75 |
| difficulty | ordinary | 18 | {"C": 0.01723847096017154} | 0.5349 | 0.0315 | 0.9553 | 11.25 |
| difficulty | ordinary | 19 | {"C": 0.0029103430328238} | 0.5410 | 0.0456 | 0.9205 | 4.69 |
| difficulty | balanced | 0 | {"C": 0.1} | 0.5173 | 0.0373 | 0.9757 | 30.97 |
| difficulty | balanced | 1 | {"C": 1.0} | 0.5072 | 0.0299 | 0.9857 | 58.70 |
| difficulty | balanced | 2 | {"C": 10.0} | 0.5078 | 0.0277 | 0.9875 | 65.64 |
| difficulty | balanced | 3 | {"C": 0.0745934328572655} | 0.5186 | 0.0350 | 0.9733 | 27.09 |
| difficulty | balanced | 4 | {"C": 56.69849511478853} | 0.5084 | 0.0270 | 0.9877 | 65.92 |
| difficulty | balanced | 5 | {"C": 4.5705630998014515} | 0.5078 | 0.0277 | 0.9873 | 65.05 |
| difficulty | balanced | 6 | {"C": 0.9846738873614566} | 0.5072 | 0.0299 | 0.9857 | 56.79 |
| difficulty | balanced | 7 | {"C": 0.006026889128682512} | 0.5461 | 0.0433 | 0.9363 | 6.66 |
| difficulty | balanced | 8 | {"C": 0.0060252157362038605} | 0.5461 | 0.0433 | 0.9363 | 6.84 |
| difficulty | balanced | 9 | {"C": 0.0019517224641449498} | 0.5383 | 0.0460 | 0.9122 | 3.87 |
| difficulty | balanced | 10 | {"C": 0.02363952111661886} | 0.5307 | 0.0265 | 0.9598 | 14.44 |
| difficulty | balanced | 11 | {"C": 0.0010359916440554247} | 0.5529 | 0.0381 | 0.9002 | 2.92 |
| difficulty | balanced | 12 | {"C": 0.0010907785690006122} | 0.5509 | 0.0382 | 0.9011 | 2.89 |
| difficulty | balanced | 13 | {"C": 0.0010632044586887642} | 0.5523 | 0.0390 | 0.9007 | 3.04 |
| difficulty | balanced | 14 | {"C": 0.0010926145631265614} | 0.5509 | 0.0382 | 0.9012 | 2.97 |
| difficulty | balanced | 15 | {"C": 0.008701257752894272} | 0.5425 | 0.0388 | 0.9438 | 8.08 |
| difficulty | balanced | 16 | {"C": 0.029504036380002784} | 0.5227 | 0.0216 | 0.9626 | 16.08 |
| difficulty | balanced | 17 | {"C": 0.004352405231106423} | 0.5377 | 0.0403 | 0.9294 | 5.73 |
| difficulty | balanced | 18 | {"C": 0.01723847096017154} | 0.5348 | 0.0315 | 0.9553 | 11.68 |
| difficulty | balanced | 19 | {"C": 0.0029103430328238} | 0.5409 | 0.0451 | 0.9205 | 4.70 |

CV-selected weighting: `{"skill:reading_writing": "balanced", "difficulty": "ordinary"}`.

| Target | Weight | Validation macro-F1 mean | Seed SD |
| --- | --- | --- | --- |
| skill:reading_writing | ordinary | 0.9082 | 0.0000 |
| skill:reading_writing | balanced | 0.9082 | 0.0000 |
| difficulty | ordinary | 0.5546 | 0.0000 |
| difficulty | balanced | 0.5546 | 0.0000 |

### ordinary — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9179 | 0.9085 | 0.9082 | 0.9178 | 0.2557 | 0.1256 | 0.0397 | [0.8825, 0.9368] |
| domain:reading_writing | 341 | 0.9853 | 0.9855 | 0.9855 | 0.9854 | 0.0567 | 0.0264 | 0.0260 | [0.9735, 0.9969] |
| difficulty | 328 | 0.5610 | 0.5664 | 0.5546 | 0.5504 | 0.8745 | 0.5352 | 0.0253 | [0.5071, 0.6104] |

Joint correctness 0.5030 on 328 questions. Ordinal difficulty MAE 0.4939; Easy↔Hard rate 0.0549.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8605 | 0.8810 | [0.7878, 0.9744] | 0.8706 |  |
| Central Ideas and Details | 28 | 0.7600 | 0.6786 | [0.5000, 0.8387] | 0.7170 |  |
| Command of Evidence | 29 | 0.7353 | 0.8621 | [0.7186, 0.9643] | 0.7937 |  |
| Cross-Text Connections | 12 | 0.9167 | 0.9167 | [0.7500, 1.0000] | 0.9167 | Yes |
| Form, Structure, and Sense | 41 | 0.8974 | 0.8537 | [0.7500, 0.9570] | 0.8750 |  |
| Inferences | 28 | 0.9259 | 0.8929 | [0.7727, 0.9689] | 0.9091 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 37 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 7 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 1 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 1 | 1 | 1 | 0 | 0 | 25 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9179.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9233 |
| 0.7 | 0.9120 | 0.9550 |
| 0.8 | 0.8739 | 0.9631 |
| 0.9 | 0.7859 | 0.9627 |
| 0.95 | 0.7038 | 0.9750 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9896 | 0.9896 | [0.9700, 1.0000] | 0.9896 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9651 | 0.9765 | [0.9438, 1.0000] | 0.9708 |  |
| Standard English Conventions | 83 | 0.9878 | 0.9759 | [0.9459, 1.0000] | 0.9818 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 1 | 0 | 83 | 1 |
| Standard English Conventions | 0 | 0 | 2 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9707 | 0.9909 |
| 0.8 | 0.9531 | 0.9938 |
| 0.9 | 0.8944 | 0.9967 |
| 0.95 | 0.8328 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6328 | 0.7570 | [0.6907, 0.8350] | 0.6894 |  |
| 3 | 115 | 0.4396 | 0.3478 | [0.2564, 0.4380] | 0.3883 |  |
| 5 | 106 | 0.5780 | 0.5943 | [0.5089, 0.6824] | 0.5860 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 81 | 20 | 6 |
| 3 | 35 | 40 | 40 |
| 5 | 12 | 31 | 63 |

Threshold 0.7500; coverage 0.0701; abstention 0.9299; retained precision 0.7826.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7256 | 0.6134 |
| 0.7 | 0.1677 | 0.7455 |
| 0.8 | 0.0183 | 0.6667 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 4.897766000009142, "difficulty": 1.0883865000214428}`; evaluation 3.69s; reload parity passed.

### ordinary — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9179 | 0.9085 | 0.9082 | 0.9178 | 0.2557 | 0.1256 | 0.0397 | [0.8825, 0.9368] |
| domain:reading_writing | 341 | 0.9853 | 0.9855 | 0.9855 | 0.9854 | 0.0567 | 0.0264 | 0.0260 | [0.9735, 0.9969] |
| difficulty | 328 | 0.5610 | 0.5664 | 0.5546 | 0.5504 | 0.8745 | 0.5352 | 0.0253 | [0.5071, 0.6104] |

Joint correctness 0.5030 on 328 questions. Ordinal difficulty MAE 0.4939; Easy↔Hard rate 0.0549.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8605 | 0.8810 | [0.7878, 0.9744] | 0.8706 |  |
| Central Ideas and Details | 28 | 0.7600 | 0.6786 | [0.5000, 0.8387] | 0.7170 |  |
| Command of Evidence | 29 | 0.7353 | 0.8621 | [0.7186, 0.9643] | 0.7937 |  |
| Cross-Text Connections | 12 | 0.9167 | 0.9167 | [0.7500, 1.0000] | 0.9167 | Yes |
| Form, Structure, and Sense | 41 | 0.8974 | 0.8537 | [0.7500, 0.9570] | 0.8750 |  |
| Inferences | 28 | 0.9259 | 0.8929 | [0.7727, 0.9689] | 0.9091 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 37 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 7 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 1 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 1 | 1 | 1 | 0 | 0 | 25 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9179.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9233 |
| 0.7 | 0.9120 | 0.9550 |
| 0.8 | 0.8739 | 0.9631 |
| 0.9 | 0.7859 | 0.9627 |
| 0.95 | 0.7038 | 0.9750 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9896 | 0.9896 | [0.9700, 1.0000] | 0.9896 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9651 | 0.9765 | [0.9438, 1.0000] | 0.9708 |  |
| Standard English Conventions | 83 | 0.9878 | 0.9759 | [0.9459, 1.0000] | 0.9818 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 1 | 0 | 83 | 1 |
| Standard English Conventions | 0 | 0 | 2 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9707 | 0.9909 |
| 0.8 | 0.9531 | 0.9938 |
| 0.9 | 0.8944 | 0.9967 |
| 0.95 | 0.8328 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6328 | 0.7570 | [0.6907, 0.8350] | 0.6894 |  |
| 3 | 115 | 0.4396 | 0.3478 | [0.2564, 0.4380] | 0.3883 |  |
| 5 | 106 | 0.5780 | 0.5943 | [0.5089, 0.6824] | 0.5860 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 81 | 20 | 6 |
| 3 | 35 | 40 | 40 |
| 5 | 12 | 31 | 63 |

Threshold 0.7500; coverage 0.0701; abstention 0.9299; retained precision 0.7826.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7256 | 0.6134 |
| 0.7 | 0.1677 | 0.7455 |
| 0.8 | 0.0183 | 0.6667 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 4.82593910000287, "difficulty": 1.0937080999137834}`; evaluation 3.51s; reload parity passed.

### ordinary — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9179 | 0.9085 | 0.9082 | 0.9178 | 0.2557 | 0.1256 | 0.0397 | [0.8825, 0.9368] |
| domain:reading_writing | 341 | 0.9853 | 0.9855 | 0.9855 | 0.9854 | 0.0567 | 0.0264 | 0.0260 | [0.9735, 0.9969] |
| difficulty | 328 | 0.5610 | 0.5664 | 0.5546 | 0.5504 | 0.8745 | 0.5352 | 0.0253 | [0.5071, 0.6104] |

Joint correctness 0.5030 on 328 questions. Ordinal difficulty MAE 0.4939; Easy↔Hard rate 0.0549.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8605 | 0.8810 | [0.7878, 0.9744] | 0.8706 |  |
| Central Ideas and Details | 28 | 0.7600 | 0.6786 | [0.5000, 0.8387] | 0.7170 |  |
| Command of Evidence | 29 | 0.7353 | 0.8621 | [0.7186, 0.9643] | 0.7937 |  |
| Cross-Text Connections | 12 | 0.9167 | 0.9167 | [0.7500, 1.0000] | 0.9167 | Yes |
| Form, Structure, and Sense | 41 | 0.8974 | 0.8537 | [0.7500, 0.9570] | 0.8750 |  |
| Inferences | 28 | 0.9259 | 0.8929 | [0.7727, 0.9689] | 0.9091 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 37 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 7 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 1 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 1 | 1 | 1 | 0 | 0 | 25 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9179.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9233 |
| 0.7 | 0.9120 | 0.9550 |
| 0.8 | 0.8739 | 0.9631 |
| 0.9 | 0.7859 | 0.9627 |
| 0.95 | 0.7038 | 0.9750 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9896 | 0.9896 | [0.9700, 1.0000] | 0.9896 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9651 | 0.9765 | [0.9438, 1.0000] | 0.9708 |  |
| Standard English Conventions | 83 | 0.9878 | 0.9759 | [0.9459, 1.0000] | 0.9818 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 1 | 0 | 83 | 1 |
| Standard English Conventions | 0 | 0 | 2 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9853.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9853 |
| 0.7 | 0.9707 | 0.9909 |
| 0.8 | 0.9531 | 0.9938 |
| 0.9 | 0.8944 | 0.9967 |
| 0.95 | 0.8328 | 1.0000 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6328 | 0.7570 | [0.6907, 0.8350] | 0.6894 |  |
| 3 | 115 | 0.4396 | 0.3478 | [0.2564, 0.4380] | 0.3883 |  |
| 5 | 106 | 0.5780 | 0.5943 | [0.5089, 0.6824] | 0.5860 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 81 | 20 | 6 |
| 3 | 35 | 40 | 40 |
| 5 | 12 | 31 | 63 |

Threshold 0.7500; coverage 0.0701; abstention 0.9299; retained precision 0.7826.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7256 | 0.6134 |
| 0.7 | 0.1677 | 0.7455 |
| 0.8 | 0.0183 | 0.6667 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 5.04438370000571, "difficulty": 1.1075896000256762}`; evaluation 3.55s; reload parity passed.

### balanced — seed 42

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9179 | 0.9085 | 0.9082 | 0.9178 | 0.2586 | 0.1256 | 0.0373 | [0.8825, 0.9368] |
| domain:reading_writing | 341 | 0.9883 | 0.9884 | 0.9885 | 0.9883 | 0.0560 | 0.0253 | 0.0228 | [0.9782, 0.9973] |
| difficulty | 328 | 0.5610 | 0.5664 | 0.5546 | 0.5504 | 0.8743 | 0.5351 | 0.0257 | [0.5071, 0.6104] |

Joint correctness 0.5030 on 328 questions. Ordinal difficulty MAE 0.4939; Easy↔Hard rate 0.0549.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8605 | 0.8810 | [0.7878, 0.9744] | 0.8706 |  |
| Central Ideas and Details | 28 | 0.7600 | 0.6786 | [0.5000, 0.8387] | 0.7170 |  |
| Command of Evidence | 29 | 0.7353 | 0.8621 | [0.7186, 0.9643] | 0.7937 |  |
| Cross-Text Connections | 12 | 0.9167 | 0.9167 | [0.7500, 1.0000] | 0.9167 | Yes |
| Form, Structure, and Sense | 41 | 0.8974 | 0.8537 | [0.7500, 0.9570] | 0.8750 |  |
| Inferences | 28 | 0.9259 | 0.8929 | [0.7727, 0.9689] | 0.9091 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 37 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 7 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 1 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 1 | 1 | 1 | 0 | 0 | 25 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9179.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9233 |
| 0.7 | 0.9150 | 0.9583 |
| 0.8 | 0.8768 | 0.9632 |
| 0.9 | 0.7977 | 0.9632 |
| 0.95 | 0.7126 | 0.9753 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9896 | 0.9896 | [0.9700, 1.0000] | 0.9896 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9655 | 0.9882 | [0.9603, 1.0000] | 0.9767 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9759 | [0.9459, 1.0000] | 0.9878 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 1 | 0 | 84 | 0 |
| Standard English Conventions | 0 | 0 | 2 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9883.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9883 |
| 0.7 | 0.9765 | 0.9910 |
| 0.8 | 0.9531 | 0.9938 |
| 0.9 | 0.9003 | 0.9967 |
| 0.95 | 0.8416 | 0.9965 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6328 | 0.7570 | [0.6907, 0.8350] | 0.6894 |  |
| 3 | 115 | 0.4396 | 0.3478 | [0.2564, 0.4380] | 0.3883 |  |
| 5 | 106 | 0.5780 | 0.5943 | [0.5089, 0.6824] | 0.5860 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 81 | 20 | 6 |
| 3 | 35 | 40 | 40 |
| 5 | 12 | 31 | 63 |

Threshold 0.7500; coverage 0.0701; abstention 0.9299; retained precision 0.7826.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7256 | 0.6134 |
| 0.7 | 0.1677 | 0.7455 |
| 0.8 | 0.0183 | 0.6667 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 5.150023300084285, "difficulty": 1.0552573000313714}`; evaluation 3.50s; reload parity passed.

### balanced — seed 43

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9179 | 0.9085 | 0.9082 | 0.9178 | 0.2586 | 0.1256 | 0.0373 | [0.8825, 0.9368] |
| domain:reading_writing | 341 | 0.9883 | 0.9884 | 0.9885 | 0.9883 | 0.0560 | 0.0253 | 0.0228 | [0.9782, 0.9973] |
| difficulty | 328 | 0.5610 | 0.5664 | 0.5546 | 0.5504 | 0.8743 | 0.5351 | 0.0257 | [0.5071, 0.6104] |

Joint correctness 0.5030 on 328 questions. Ordinal difficulty MAE 0.4939; Easy↔Hard rate 0.0549.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8605 | 0.8810 | [0.7878, 0.9744] | 0.8706 |  |
| Central Ideas and Details | 28 | 0.7600 | 0.6786 | [0.5000, 0.8387] | 0.7170 |  |
| Command of Evidence | 29 | 0.7353 | 0.8621 | [0.7186, 0.9643] | 0.7937 |  |
| Cross-Text Connections | 12 | 0.9167 | 0.9167 | [0.7500, 1.0000] | 0.9167 | Yes |
| Form, Structure, and Sense | 41 | 0.8974 | 0.8537 | [0.7500, 0.9570] | 0.8750 |  |
| Inferences | 28 | 0.9259 | 0.8929 | [0.7727, 0.9689] | 0.9091 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 37 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 7 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 1 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 1 | 1 | 1 | 0 | 0 | 25 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9179.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9233 |
| 0.7 | 0.9150 | 0.9583 |
| 0.8 | 0.8768 | 0.9632 |
| 0.9 | 0.7977 | 0.9632 |
| 0.95 | 0.7126 | 0.9753 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9896 | 0.9896 | [0.9700, 1.0000] | 0.9896 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9655 | 0.9882 | [0.9603, 1.0000] | 0.9767 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9759 | [0.9459, 1.0000] | 0.9878 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 1 | 0 | 84 | 0 |
| Standard English Conventions | 0 | 0 | 2 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9883.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9883 |
| 0.7 | 0.9765 | 0.9910 |
| 0.8 | 0.9531 | 0.9938 |
| 0.9 | 0.9003 | 0.9967 |
| 0.95 | 0.8416 | 0.9965 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6328 | 0.7570 | [0.6907, 0.8350] | 0.6894 |  |
| 3 | 115 | 0.4396 | 0.3478 | [0.2564, 0.4380] | 0.3883 |  |
| 5 | 106 | 0.5780 | 0.5943 | [0.5089, 0.6824] | 0.5860 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 81 | 20 | 6 |
| 3 | 35 | 40 | 40 |
| 5 | 12 | 31 | 63 |

Threshold 0.7500; coverage 0.0701; abstention 0.9299; retained precision 0.7826.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7256 | 0.6134 |
| 0.7 | 0.1677 | 0.7455 |
| 0.8 | 0.0183 | 0.6667 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 4.862888999981806, "difficulty": 1.060688400059007}`; evaluation 3.51s; reload parity passed.

### balanced — seed 44

| Target | N | Accuracy | Balanced accuracy | Macro-F1 | Weighted-F1 | Log loss | Brier | ECE | F1 CI95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skill:reading_writing | 341 | 0.9179 | 0.9085 | 0.9082 | 0.9178 | 0.2586 | 0.1256 | 0.0373 | [0.8825, 0.9368] |
| domain:reading_writing | 341 | 0.9883 | 0.9884 | 0.9885 | 0.9883 | 0.0560 | 0.0253 | 0.0228 | [0.9782, 0.9973] |
| difficulty | 328 | 0.5610 | 0.5664 | 0.5546 | 0.5504 | 0.8743 | 0.5351 | 0.0257 | [0.5071, 0.6104] |

Joint correctness 0.5030 on 328 questions. Ordinal difficulty MAE 0.4939; Easy↔Hard rate 0.0549.

**skill:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 42 | 0.8605 | 0.8810 | [0.7878, 0.9744] | 0.8706 |  |
| Central Ideas and Details | 28 | 0.7600 | 0.6786 | [0.5000, 0.8387] | 0.7170 |  |
| Command of Evidence | 29 | 0.7353 | 0.8621 | [0.7186, 0.9643] | 0.7937 |  |
| Cross-Text Connections | 12 | 0.9167 | 0.9167 | [0.7500, 1.0000] | 0.9167 | Yes |
| Form, Structure, and Sense | 41 | 0.8974 | 0.8537 | [0.7500, 0.9570] | 0.8750 |  |
| Inferences | 28 | 0.9259 | 0.8929 | [0.7727, 0.9689] | 0.9091 |  |
| Rhetorical Synthesis | 40 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Text Structure and Purpose | 32 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Transitions | 37 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Words in Context | 52 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Boundaries | Central Ideas and Details | Command of Evidence | Cross-Text Connections | Form, Structure, and Sense | Inferences | Rhetorical Synthesis | Text Structure and Purpose | Transitions | Words in Context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Boundaries | 37 | 1 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| Central Ideas and Details | 0 | 19 | 7 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| Command of Evidence | 0 | 3 | 25 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| Cross-Text Connections | 0 | 1 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| Form, Structure, and Sense | 5 | 0 | 1 | 0 | 35 | 0 | 0 | 0 | 0 | 0 |
| Inferences | 1 | 1 | 1 | 0 | 0 | 25 | 0 | 0 | 0 | 0 |
| Rhetorical Synthesis | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 0 |
| Text Structure and Purpose | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0 | 0 |
| Transitions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 37 | 0 |
| Words in Context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 52 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9179.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.9941 | 0.9233 |
| 0.7 | 0.9150 | 0.9583 |
| 0.8 | 0.8768 | 0.9632 |
| 0.9 | 0.7977 | 0.9632 |
| 0.95 | 0.7126 | 0.9753 |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

**domain:reading_writing**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| Craft and Structure | 96 | 0.9896 | 0.9896 | [0.9700, 1.0000] | 0.9896 |  |
| Expression of Ideas | 77 | 1.0000 | 1.0000 | [1.0000, 1.0000] | 1.0000 |  |
| Information and Ideas | 85 | 0.9655 | 0.9882 | [0.9603, 1.0000] | 0.9767 |  |
| Standard English Conventions | 83 | 1.0000 | 0.9759 | [0.9459, 1.0000] | 0.9878 |  |

Confusion rows=true, columns=predicted.

| True / predicted | Craft and Structure | Expression of Ideas | Information and Ideas | Standard English Conventions |
| --- | --- | --- | --- | --- |
| Craft and Structure | 95 | 0 | 1 | 0 |
| Expression of Ideas | 0 | 77 | 0 | 0 |
| Information and Ideas | 1 | 0 | 84 | 0 |
| Standard English Conventions | 0 | 0 | 2 | 81 |

Threshold 0.0000; coverage 1.0000; abstention 0.0000; retained precision 0.9883.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 1.0000 | 0.9883 |
| 0.7 | 0.9765 | 0.9910 |
| 0.8 | 0.9531 | 0.9938 |
| 0.9 | 0.9003 | 0.9967 |
| 0.95 | 0.8416 | 0.9965 |

**difficulty**

| Class | Support | Precision | Recall | Recall CI95 | F1 | Small support |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 107 | 0.6328 | 0.7570 | [0.6907, 0.8350] | 0.6894 |  |
| 3 | 115 | 0.4396 | 0.3478 | [0.2564, 0.4380] | 0.3883 |  |
| 5 | 106 | 0.5780 | 0.5943 | [0.5089, 0.6824] | 0.5860 |  |

Confusion rows=true, columns=predicted.

| True / predicted | 1 | 3 | 5 |
| --- | --- | --- | --- |
| 1 | 81 | 20 | 6 |
| 3 | 35 | 40 | 40 |
| 5 | 12 | 31 | 63 |

Threshold 0.7500; coverage 0.0701; abstention 0.9299; retained precision 0.7826.

| Confidence | Coverage | Precision |
| --- | --- | --- |
| 0.5 | 0.7256 | 0.6134 |
| 0.7 | 0.1677 | 0.7455 |
| 0.8 | 0.0183 | 0.6667 |
| 0.9 | 0.0000 | Unavailable |
| 0.95 | 0.0000 | Unavailable |

Long-input slice (>4,000 characters): 0; F1 Unavailable.

Training seconds `{"skill:reading_writing": 4.939546399982646, "difficulty": 1.1855675999540836}`; evaluation 3.49s; reload parity passed.

### Operational measurements

| Package | Version |
| --- | --- |
| numpy | 2.5.3 |
| optuna | 4.9.0 |
| scikit-learn | 1.9.1 |
| torch | 2.14.1 |
| transformers | 4.57.6 |

Original frozen encoder revision `8949b909ec900327062f0ebf497f51aef5e6f0c8`. Historical training extraction 12247.31s, encoder load 98.11s. Shared completed cache 5519880 bytes; these are inherited costs, not newly incurred extraction. Current cache-read preparation is measured below.

Hardware `{"platform": "Windows-11-10.0.26200-SP0", "cpu": "Intel(R) Core(TM) Ultra 5 125H", "logical_cpus": 18, "threads": 8, "gpu_used": false}`. Code/dependencies are frozen before training. TF-IDF preparation is included in fit/evaluate times. Training feature-cache preparation 0.60s; run wall time 2743.33s; peak process memory 3651.30MB; artifact 598032080 bytes; load 1.06s; API startup 11.05s.

Peak RAM is the main experiment process high-water mark; the separate HTTP server child's peak RAM was not instrumented. CPU math threads are capped at eight per process.

Experiment wall time including the interrupted attempt: 3235.86s. The separately tabulated solver-probe fits are additional; probe startup was not instrumented.

Restarted run emitted 6 convergence warnings at the iteration cap; these bounded fits are retained in the experiment record. Inspect [training log](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/queue-embedding_svm.log>) alongside the frozen selected configurations.

Uncached classifier-only feature preparation 97.96s is excluded from classifier-only latency.

| Path | N | p50 ms | p95 ms | p99 ms | Questions/s |
| --- | --- | --- | --- | --- | --- |
| Direct complete | 1023 | 246.41 | 460.36 | 609.74 | 3.64 |
| HTTP complete | 1023 | 256.55 | 463.73 | 573.08 | 3.43 |
| Classifier only | 1023 | 1.64 | 2.58 | 3.11 | 577.15 |

100 questions: direct 26.99s, HTTP 29.50s. Four-client burst: 7 success / 1016 busy / 0 unexpected errors; 2.21 successful questions/s. Ten warm-ups and three complete validation passes. Busy responses are not retried; burst throughput is not sustained capacity.

[Metrics and predictions](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm/results.json>) · [Configurations](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm/configuration-freeze.json>) · [Artifact lineage](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm/selected-seed42/manifest.json>).

Private API authorization and direct/API prediction parity verified. [Serving checks](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/embedding_svm/serving-verification.json>).

## Fine-tuned ModernBERT

Fine-tuning uses explicit section/type, prompt, ordered-choice, and passage markers; each passage chunk starts after its own passage marker. The legacy frozen cache used an empty passage marker before the prompt and appended actual passage text after choices without a new marker. It is preserved for the completed cache-based experiment. Fine-tuning therefore changes input layout as well as learned weights; a future layout-only ablation would be needed to isolate those effects.

Superseded CPU timing pilot: 366.66s; projected 88.80 hours including margin. Its original-boundary checkpoints and code bundle are archived; they are not used for final training or quality evidence. [Preserved pilot](<D:/SAT website/ml-service/artifacts/cpu-expanded-v1/finetune/pilot-attempt1-original-boundaries/pilot.json>).

Not yet complete; no results claimed.

Pilot evaluation overlaps training and exists only to measure runtime; its F1 is not quality evidence.

CPU feasibility pilot:

```json
{
  "pilot_completed": true,
  "pilot_questions": 128,
  "selection": "8 per skill plus 48 longest remaining training questions",
  "no_outer_validation_used": true,
  "encoder_revision": "8949b909ec900327062f0ebf497f51aef5e6f0c8",
  "hardware": {
    "platform": "Windows-11-10.0.26200-SP0",
    "cpu": "Intel(R) Core(TM) Ultra 5 125H",
    "logical_cpus": 18,
    "threads": 8,
    "gpu_used": false
  },
  "targets": {
    "skill:reading_writing": {
      "classes": [
        "Boundaries",
        "Central Ideas and Details",
        "Command of Evidence",
        "Cross-Text Connections",
        "Form, Structure, and Sense",
        "Inferences",
        "Rhetorical Synthesis",
        "Text Structure and Purpose",
        "Transitions",
        "Words in Context"
      ],
      "best_epoch": 1,
      "history": [
        {
          "epoch": 1,
          "validation_macro_f1": 0.06793650793650793
        }
      ],
      "seconds": 169.11871509999037,
      "timings": {
        "loading_seconds": 1.2496520000277087,
        "train_seconds": 152.85585000016727,
        "evaluation_seconds": 12.497717199963517,
        "checkpoint_seconds": 2.0664224999491125
      },
      "device": "cpu",
      "dtype": "float32",
      "encoder_finetuned": true,
      "training_precision": "float32",
      "preprocessing_version": "fine-field-boundaries-v1",
      "attention_implementation": "sdpa",
      "reference_compile": false
    },
    "difficulty": {
      "classes": [
        "1",
        "3",
        "5"
      ],
      "best_epoch": 1,
      "history": [
        {
          "epoch": 1,
          "validation_macro_f1": 0.49316420014094425
        }
      ],
      "seconds": 176.45049010007642,
      "timings": {
        "loading_seconds": 0.3237486000871286,
        "train_seconds": 159.71104939992074,
        "evaluation_seconds": 13.74295520002488,
        "checkpoint_seconds": 2.2146077998913825
      },
      "device": "cpu",
      "dtype": "float32",
      "encoder_finetuned": true,
      "training_precision": "float32",
      "preprocessing_version": "fine-field-boundaries-v1",
      "attention_implementation": "sdpa",
      "reference_compile": false
    }
  },
  "pilot_seconds": 345.98261029995047,
  "projected_seconds_with_margin": 301687.6272044729,
  "projected_hours": 83.80211866790914,
  "runtime_threshold_hours": 12,
  "decision": "free_colab_gpu",
  "peak_memory_mb": 3559.203125,
  "projection_note": "Conservative 3-epoch schedule, timing inputs include long questions; not a runtime guarantee."
}
```

## Comparison and recommendations

The original baseline searched three C values and XGBoost four tree configurations; the new classical methods search twenty C/alpha trials per target/weight variant. This compares the approved model-and-tuning pipelines, not an isolated architecture effect under equal search budgets. Final-seed spread does not measure split uncertainty. These artifacts cover R&W only; Math and essential-image questions require separate validated models or manual classification.

| Method | Skill F1 | Difficulty F1 | API p95 ms | API questions/s |
| --- | --- | --- | --- | --- |
| baseline | 0.8985 | 0.5323 | 31.93 | 65.64 |
| xgboost | 0.8753 | 0.5563 | 526.64 | 3.02 |
| tfidf_svm | 0.9356 | 0.5206 | 31.34 | 66.25 |
| tfidf_nb | 0.8764 | 0.4812 | 33.74 | 57.18 |
| embedding_lr | 0.8738 | 0.5588 | 462.59 | 3.46 |
| embedding_svm | 0.9082 | 0.5546 | 463.73 | 3.43 |

| Comparison / target | Paired F1 difference CI95 |
| --- | --- |
| xgboost minus baseline / skill:reading_writing | [-0.0682, 0.0250] |
| xgboost minus baseline / difficulty | [-0.0232, 0.0742] |
| tfidf_svm minus baseline / skill:reading_writing | [0.0136, 0.0632] |
| tfidf_svm minus baseline / difficulty | [-0.0325, 0.0085] |
| tfidf_nb minus baseline / skill:reading_writing | [-0.0591, 0.0113] |
| tfidf_nb minus baseline / difficulty | [-0.0935, -0.0086] |
| embedding_lr minus baseline / skill:reading_writing | [-0.0669, 0.0170] |
| embedding_lr minus baseline / difficulty | [-0.0207, 0.0774] |
| embedding_svm minus baseline / skill:reading_writing | [-0.0304, 0.0499] |
| embedding_svm minus baseline / difficulty | [-0.0273, 0.0755] |
| tfidf_svm minus xgboost / skill:reading_writing | [0.0163, 0.1050] |
| tfidf_svm minus xgboost / difficulty | [-0.0847, 0.0112] |
| tfidf_nb minus xgboost / skill:reading_writing | [-0.0514, 0.0506] |
| tfidf_nb minus xgboost / difficulty | [-0.1269, -0.0274] |
| embedding_lr minus xgboost / skill:reading_writing | [-0.0450, 0.0424] |
| embedding_lr minus xgboost / difficulty | [-0.0342, 0.0384] |
| embedding_svm minus xgboost / skill:reading_writing | [-0.0050, 0.0707] |
| embedding_svm minus xgboost / difficulty | [-0.0397, 0.0416] |
| tfidf_nb minus tfidf_svm / skill:reading_writing | [-0.0996, -0.0230] |
| tfidf_nb minus tfidf_svm / difficulty | [-0.0805, 0.0015] |
| embedding_lr minus tfidf_svm / skill:reading_writing | [-0.1082, -0.0189] |
| embedding_lr minus tfidf_svm / difficulty | [-0.0086, 0.0863] |
| embedding_svm minus tfidf_svm / skill:reading_writing | [-0.0691, 0.0134] |
| embedding_svm minus tfidf_svm / difficulty | [-0.0177, 0.0870] |
| embedding_lr minus tfidf_nb / skill:reading_writing | [-0.0460, 0.0406] |
| embedding_lr minus tfidf_nb / difficulty | [0.0314, 0.1301] |
| embedding_svm minus tfidf_nb / skill:reading_writing | [-0.0084, 0.0786] |
| embedding_svm minus tfidf_nb / difficulty | [0.0210, 0.1267] |
| embedding_svm minus embedding_lr / skill:reading_writing | [0.0049, 0.0698] |
| embedding_svm minus embedding_lr / difficulty | [-0.0350, 0.0257] |

| Method | Target | Ordinary F1 mean | Balanced F1 mean | Balanced minus ordinary |
| --- | --- | --- | --- | --- |
| tfidf_svm | skill:reading_writing | 0.9356 | 0.9356 | 0.0000 |
| tfidf_svm | difficulty | 0.5266 | 0.5206 | -0.0060 |
| tfidf_nb | skill:reading_writing | 0.8764 | 0.8535 | -0.0230 |
| tfidf_nb | difficulty | 0.4812 | 0.4985 | 0.0173 |
| embedding_lr | skill:reading_writing | 0.8705 | 0.8738 | 0.0033 |
| embedding_lr | difficulty | 0.5588 | 0.5575 | -0.0013 |
| embedding_svm | skill:reading_writing | 0.9082 | 0.9082 | 0.0000 |
| embedding_svm | difficulty | 0.5546 | 0.5546 | 0.0000 |

### Suggestion precision and coverage

The 90% precision target is fitted using training OOF predictions; it is not a guarantee on new data. An unavailable threshold produces complete abstention.

Retained-precision intervals are exact binomial 95% intervals for this singleton-group bank, conditional on the frozen policy; they do not cover source-domain shift.

| Method | Target | Validation coverage | Retained N | Retained precision | Precision CI95 | Small retained N |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | skill:reading_writing | 1.0000 | 341 | 0.9032 | [0.8668, 0.9324] |  |
| baseline | difficulty | 0.0457 | 15 | 0.8667 | [0.5954, 0.9834] | Yes |
| xgboost | skill:reading_writing | 1.0000 | 341 | 0.8827 | [0.8437, 0.9149] |  |
| xgboost | difficulty | 0.0000 | 0 | Unavailable | Unavailable | Yes |
| tfidf_svm | skill:reading_writing | 1.0000 | 341 | 0.9384 | [0.9074, 0.9615] |  |
| tfidf_svm | difficulty | 0.0000 | 0 | Unavailable | Unavailable | Yes |
| tfidf_nb | skill:reading_writing | 0.9971 | 340 | 0.8882 | [0.8498, 0.9197] |  |
| tfidf_nb | difficulty | 0.0000 | 0 | Unavailable | Unavailable | Yes |
| embedding_lr | skill:reading_writing | 1.0000 | 341 | 0.8974 | [0.8602, 0.9275] |  |
| embedding_lr | difficulty | 0.0488 | 16 | 1.0000 | [0.7941, 1.0000] | Yes |
| embedding_svm | skill:reading_writing | 1.0000 | 341 | 0.9179 | [0.8835, 0.9447] |  |
| embedding_svm | difficulty | 0.0701 | 23 | 0.7826 | [0.5630, 0.9254] |  |

Among completed pipelines, `tfidf_svm` has the highest observed skill macro-F1, while `embedding_lr` has the highest observed difficulty macro-F1. This is a descriptive comparison of already frozen configurations, not additional tuning on validation. Prefer a fast text pipeline when an encoder-based method does not provide a credible quality or coverage improvement. The fine-tuned candidate is still incomplete, so the recommendation is provisional. Keep the staging classifier unchanged until an explicit promotion decision and independent full-length evaluation.

Paired group-bootstrap: 1,000 resamples, seed42. CIs do not account for source-domain shift or repeated model development. No method is promoted solely from these internal-bank results; require useful precision/coverage and independent full-length evidence.

For a later frozen-embedding experiment, GTE ModernBERT-base is the first suggested alternative; Jina embeddings v3 offers a classification adapter at higher cost. These are researched candidates, not measured results here. [Evidence and experimental rationale](<D:/SAT website/ml-service/reports/embedding-candidate-research.md>).


Operational handoff status: All four classical methods are complete and the final Python suite passed 28 tests. The corrected CPU pilot projects 83.8 hours including margin. The provided Colab notebook now contains the verified bootstrap and resumable training commands. Full fine-tuning has **not started**: the prepared training-only bundle could not be uploaded because the Chrome extension has no file-URL access. The initial idle runtime disconnected while upload was blocked. User upload of the prepared ZIP to the dedicated Drive folder avoids expanding extension permissions. GPU/package compatibility and Drive authorization remain unverified until bootstrap runs.


Colab continuation: User uploaded the ZIP and connected Drive. SHA256 verification and CUDA availability passed on the free T4 runtime. Two initialization attempts failed before fitting because preinstalled optional torchvision was incompatible with the pinned Torch package. Removing that unused vision package resolved initialization without changing training source. Full GPU training started; the first skill/ordinary/LR=2e-5 fold completed with epoch macro-F1 0.462769, 0.741359, and 0.888478. These are inner-CV progress figures, not final validation. Fold two was running at the latest observation. Training console output is saved to Drive. The results export cell is prepared but unexecuted until training successfully completes; automatic approval review rejected early export. Full fine-tuned results and local serving benchmarks remain pending.
