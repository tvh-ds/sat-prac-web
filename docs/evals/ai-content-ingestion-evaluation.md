# AI content ingestion evaluation report

Report status: **Not measured**

Last evaluated: **Not measured**
Owner: **Not assigned**

This document is the reporting contract for AI-reviewed ingestion. Do not replace `Not measured` with estimates or targets. Populate results only from a saved, versioned evaluation run and link its machine-readable JSON artifact.

Generate a versioned JSON result and matching Markdown summary with:

```powershell
cd backend\worker
npm run eval:ai-ingestion -- --gold <gold.json> --run <candidate-run.json> --out tmp\ai-ingestion-eval\results.json
```

The gold file contains the frozen question fields and adjudicated issues. The run file contains extracted fields, three-state review outcomes, findings, review time, and operational totals. The evaluator reports numerator/denominator counts and Wilson intervals, and never substitutes zero for unavailable measurements.

## 1. Run identity and reproducibility

| Field | Value |
| --- | --- |
| Evaluation run ID | **Not measured** |
| Run date/time (UTC) | **Not measured** |
| Git commit | **Not measured** |
| Environment | **Not measured** |
| Evaluation artifact path/hash | **Not measured** |
| Frozen corpus manifest path/hash | **Not measured** |
| Gold annotation version | **Not measured** |
| Baseline parser/reviewer version | **Not measured** |
| Candidate parser/reviewer version | **Not measured** |
| OCR provider/model | **Not measured** |
| Review provider/model | **Not measured** |
| Prompt version | **Not measured** |
| Risk-policy version | **Not measured** |
| Pricing configuration/version | **Not measured** |
| Random/bootstrap seed | **Not measured** |

Record all configuration that can change an output: OCR mode, render scale/detail, retry limits, model parameters, repair threshold, timeouts, cost ceiling, and parser feature flags. Store secrets nowhere in the artifact.

## 2. Evaluation sets and annotation

Use three related sets:

1. **Frozen regression cohort:** the existing 36 imports used to measure parser/OCR changes over time.
2. **Frozen controls:** the existing 20 imports used to detect regressions on previously stable inputs.
3. **Question-level gold set:** independently adjudicated questions with exact field transcription and labeled review issues. Include clean cases as well as known OCR, boundary, choice, key, visual, and crop defects.

The manifest records opaque document ID, cryptographic source hash, section, scan type, visual status, page range, and split. Private PDFs and copyrighted content remain outside version control. Commit only the manifest schema, shareable synthetic fixtures, annotation guidance, and aggregate results.

Split by whole source test and duplicate group. All pages/questions from one source test stay in one split. Near or exact duplicates must share a split. Freeze the test set before prompt/policy tuning.

Two qualified reviewers independently annotate the gold set against the source page. Resolve disagreements through adjudication and record agreement before adjudication. A review issue annotation contains issue type, severity, affected field, source page/evidence, and the accepted correction where one exists.

Severity rubric:

- `major`: can change the correct answer, omit/add a question, associate the wrong source/visual, publish unsupported content, or prevent reliable answering/review;
- `minor`: localized defect that does not change the correct response but still needs correction.

| Dataset statistic | Value |
| --- | ---: |
| Regression imports | **Not measured** |
| Control imports | **Not measured** |
| Gold documents | **Not measured** |
| Gold questions | **Not measured** |
| Clean gold questions | **Not measured** |
| Questions with major issues | **Not measured** |
| Questions with minor issues | **Not measured** |
| Reading and Writing questions | **Not measured** |
| Math questions | **Not measured** |
| Visual questions | **Not measured** |
| Scanned-source questions | **Not measured** |
| Inter-annotator agreement | **Not measured** |

## 3. Experiment design

Run two comparisons and never combine their gains:

- **Same-OCR comparison:** replay baseline and candidate parsers/reviewers against identical saved OCR/page evidence. This isolates parser, risk policy, and reviewer changes.
- **Fresh-OCR end-to-end comparison:** process source documents from OCR through human-routing output. This measures the deployed system including OCR variance, retries, latency, and cost.

For stochastic model calls, run the frozen test set at least three times with the production parameters when budget permits. Report the aggregate and run-to-run variation. Preserve each raw structured response in restricted evaluation storage long enough to audit scoring.

Human-effort comparison uses the same review task definition and editor instrumentation for baseline and candidate. Randomize or counterbalance task order when the same reviewers participate, and exclude idle browser time using explicit review-session activity rules.

Every proportion must report numerator/denominator and a 95% Wilson confidence interval. For paired baseline/candidate metrics, report the paired absolute and relative change and a bootstrap 95% interval at the source-document level. Report medians with bootstrap intervals for latency, cost, and review time. Do not claim improvement from point estimates whose uncertainty is material.

## 4. Metric definitions

### 4.1 Extraction correctness

Count a predicted question as matched to a gold question only after source-test/module identity and source position align. Then score fields after Unicode normalization that preserves meaningful punctuation, numbers, mathematical symbols, negation, and choice order.

| Metric | Definition |
| --- | --- |
| Question precision | matched extracted questions / all extracted questions |
| Question recall | matched extracted questions / all gold questions |
| Module completeness | modules with exactly the expected source-backed questions / gold modules |
| Prompt exact correctness | matched questions with exact normalized prompt / matched questions |
| Passage exact correctness | matched questions with exact normalized passage / matched questions requiring a passage |
| Choice exact correctness | matched MCQs with exact ordered labels and text / matched MCQs |
| Visual association correctness | visual questions linked to the correct visual/page region / gold visual questions |
| Answer-key coverage | questions with a safely matched usable key / gold questions requiring a key |
| Answer-key accuracy | exactly correct keys / questions with a predicted matched key |

### 4.2 Review and routing quality

Match a predicted finding to a gold issue only when draft, issue type, affected field, and evidence location agree. One prediction can match at most one gold issue.

| Metric | Definition |
| --- | --- |
| Finding precision | matched findings / all predicted findings |
| Finding recall | matched findings / all gold issues |
| Major-issue recall | matched major findings / all gold major issues |
| Clean-question specificity | clean questions without a predicted finding / all clean questions |
| Serious-defect Complete rate | Complete questions containing any gold major issue / all Complete questions |
| Complete coverage | Complete questions / all evaluated questions |
| Human Review rate | Review questions / all evaluated questions |
| Failed rate | Failed questions / all evaluated questions |
| Correction acceptance rate | accepted proposed corrections / decided proposed corrections |
| Finding dismissal rate | dismissed findings / decided findings |

The primary safety metric is the serious-defect Complete rate. A zero observed numerator must still report its sample size and confidence interval; it is not proof of zero population risk.

### 4.3 Human effort

Review time starts when a reviewer opens an eligible draft and stops on approve, reject, or save-and-exit, excluding intervals classified as idle. Report both per-question and per-import distributions.

| Metric | Definition |
| --- | --- |
| Median review time/question | median active seconds from open to decision |
| p95 review time/question | 95th percentile active seconds from open to decision |
| Median review time/import | median summed active minutes for one import |
| p95 review time/import | 95th percentile summed active minutes for one import |
| Admin actions/question | edits + finding decisions + crop actions + approval actions / reviewed questions |
| Re-review rate | questions invalidated and reviewed more than once / reviewed questions |

### 4.4 Reliability, latency, and cost

| Metric | Definition |
| --- | --- |
| OCR page success rate | pages successfully processed / pages attempted |
| OCR fallback rate | pages requiring fallback/retry / pages attempted |
| Review request success rate | valid structured responses / review requests |
| Review retry rate | retried requests / review requests |
| Import completion rate | imports reaching parser completion / imports started |
| Review completion rate | jobs reaching completed or completed-with-errors / jobs started |
| p50/p95 ingestion latency | upload-to-drafts duration, excluding queued AI review |
| p50/p95 review latency | job queue-to-terminal duration and model-call duration, reported separately |
| Input/output tokens | provider-reported tokens, totals and per reviewed draft |
| OCR pages billed | provider-reported billed parse pages |
| Review cost/import | versioned token/image price estimate summed per import |
| Cost/approved question | total OCR plus review cost / human-approved questions |

## 5. Aggregate results

### 5.1 Same-OCR baseline versus candidate

| Metric | Baseline | Candidate | Absolute change | Relative change | 95% CI |
| --- | ---: | ---: | ---: | ---: | --- |
| Question precision | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Question recall | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Module completeness | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Prompt exact correctness | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Passage exact correctness | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Choice exact correctness | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Visual association correctness | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Answer-key coverage | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Answer-key accuracy | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |

### 5.2 Review safety and usefulness

| Metric | Result | Numerator / denominator | 95% CI |
| --- | ---: | ---: | --- |
| Finding precision | **Not measured** | **Not measured** | **Not measured** |
| Finding recall | **Not measured** | **Not measured** | **Not measured** |
| Major-issue recall | **Not measured** | **Not measured** | **Not measured** |
| Clean-question specificity | **Not measured** | **Not measured** | **Not measured** |
| Serious-defect Complete rate | **Not measured** | **Not measured** | **Not measured** |
| Complete coverage | **Not measured** | **Not measured** | **Not measured** |
| Human Review rate | **Not measured** | **Not measured** | **Not measured** |
| Failed rate | **Not measured** | **Not measured** | **Not measured** |
| Correction acceptance rate | **Not measured** | **Not measured** | **Not measured** |

### 5.3 Human effort, operations, and cost

| Metric | Baseline | Candidate | Change / result | 95% CI |
| --- | ---: | ---: | ---: | --- |
| Median review time/question | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| p95 review time/question | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Median review time/import | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| p95 review time/import | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| OCR page success rate | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Review request success rate | N/A | **Not measured** | **Not measured** | **Not measured** |
| p50/p95 ingestion latency | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| p50/p95 review latency | N/A | **Not measured** | **Not measured** | **Not measured** |
| Review input/output tokens | N/A | **Not measured** | **Not measured** | N/A |
| OCR pages billed | **Not measured** | **Not measured** | **Not measured** | N/A |
| Review cost/import | N/A | **Not measured** | **Not measured** | **Not measured** |
| Total cost/approved question | **Not measured** | **Not measured** | **Not measured** | **Not measured** |

## 6. Required slices

Repeat the primary extraction and review metrics for each slice. Show `N` and suppress percentages where the sample is too small to interpret.

| Slice | N | Question recall | Answer-key accuracy | Serious-defect Complete rate | Serious-issue recall | Median review time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reading and Writing | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Math | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Text-only | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Visual | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Selectable-text source | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| Scanned source | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |

Also report issue-type precision/recall for OCR corruption, question boundaries, passage/prompt, choices, answer-key conflict, visual association, and crop problems.

## 7. Release gates and interpretation

The pilot may begin when security, authorization, schema validation, idempotency, and stale-result checks pass. Import approval remains disabled until a frozen held-out run meets all safety invariants:

- zero observed major gold defects routed Complete, with numerator, denominator, and confidence interval reported;
- every Complete item has source evidence and a safely matched required answer;
- every visual item with an unconfirmed crop remains outside batch approval;
- malformed output, provider failure, stale jobs, and budget exhaustion fail toward human review;
- no regression in the existing publication gate or control cohort.

After the first valid baseline, preregister numeric efficiency and quality targets in the next report revision before tuning on the held-out set. Until then, targets and measured results remain **Not measured**.

## 8. Findings and limitations

### Findings

**Not measured.**

### Known limitations

**Not measured.** Record corpus coverage gaps, annotation uncertainty, small slices, provider/model drift, repeated-run variance, pricing assumptions, and any manual exclusions.

### Release decision

**Not measured.** Record `ship`, `continue shadow mode`, or `do not ship`, the approving reviewer, date, and the evidence supporting the decision.
