"""Summarize completed immutable results without fitting any model."""
import json
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ("TF-IDF + logistic regression", "cpu-comparison-v1", "baseline"),
    ("TF-IDF + Linear SVM", "cpu-expanded-v1", "tfidf_svm"),
    ("TF-IDF + Complement NB", "cpu-expanded-v1", "tfidf_nb"),
    ("ModernBERT embeddings + XGBoost", "cpu-comparison-v1", "xgboost"),
    ("ModernBERT embeddings + logistic regression", "cpu-expanded-v1", "embedding_lr"),
    ("ModernBERT embeddings + Linear SVM", "cpu-expanded-v1", "embedding_svm"),
]
DATA = [(name, ROOT / "artifacts" / version / method / "results.json") for name, version, method in SOURCES]
ROWS = [(name, path, json.loads(path.read_text())) for name, path in DATA]
assert all(d["complete"] for _, _, d in ROWS)
assert len({d["dataset"]["dataset_version"] for _, _, d in ROWS}) == 1
for _, _, d in ROWS:
    assert d["selected_metrics"]["skill:reading_writing"]["count"] == 341
    assert d["selected_metrics"]["difficulty"]["count"] == 328

OUT = []
def paragraph(text):
    OUT.extend([text, ""])
def table(headers, rows):
    paragraph("\n".join(["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |", *["| " + " | ".join(map(str, row)) + " |" for row in rows]]))
def fmt(x):
    return "—" if x is None else f"{x:.4f}"
def ci(m):
    return "–".join(fmt(x) for x in m["macro_f1_ci95"])
def link(path):
    return f"[{path.name}](<{path.as_posix()}>)"

paragraph("# Current classification results")
paragraph("Fine-tuning is discontinued at the user's request. No further fitting, tuning, promotion, or deployment is authorized by this report. All six completed methods below were evaluated on identical frozen outer-validation questions. Their selected seed-42 configurations were chosen using training-only five-fold CV; outer results did not select configurations.")
paragraph("The source contains 1,713 R&W questions. After the documented image/malformed-input exclusions, skill has 1,369 training / 341 validation questions; verified difficulty has 1,363 training / 328 validation questions. Skill has ten observed classes; difficulty remains Easy/Medium/Hard (stored class IDs 1/3/5). The deterministic seed-42 80/20 split uses group-aware, multi-target stratification; five frozen inner folds stay within training. Natural evaluation distributions are retained. These outer results are exploratory final validation, not an independently sourced test or evidence of full-length generalization.")
paragraph("## Completed model comparison")
table(["Method", "Skill accuracy", "Skill macro-F1", "Skill 95% CI", "Difficulty accuracy", "Difficulty macro-F1", "Difficulty 95% CI", "Joint correct"], [[name, fmt(d["selected_metrics"]["skill:reading_writing"]["accuracy"]), fmt(d["selected_metrics"]["skill:reading_writing"]["macro_f1"]), ci(d["selected_metrics"]["skill:reading_writing"]), fmt(d["selected_metrics"]["difficulty"]["accuracy"]), fmt(d["selected_metrics"]["difficulty"]["macro_f1"]), ci(d["selected_metrics"]["difficulty"]), fmt(d["selected_metrics"]["joint"]["both_correct"])] for name, _, d in ROWS])
paragraph("TF-IDF + SVM has the highest observed skill macro-F1. Frozen embeddings + logistic regression has the highest observed difficulty macro-F1, narrowly ahead of XGBoost and embedding SVM. Overlapping uncertainty means the small difficulty differences do not establish a reliable winner. Difficulty is substantially harder than skill for every completed model; no model has earned automatic difficulty acceptance.")
paragraph("## CPU inference and execution measurements")
table(["Method", "HTTP p50 ms", "HTTP p95 ms", "HTTP p99 ms", "Serial questions/s", "100 HTTP questions s", "Artifact MiB", "Recorded phase min"], [[name, *[f"{d['benchmark']['api_serial'][k]:.2f}" for k in ["p50_ms", "p95_ms", "p99_ms", "questions_per_second"]], f"{d['benchmark']['api_100_questions_seconds']:.2f}", f"{d['benchmark']['artifact_bytes']/1024**2:.2f}", f"{d.get('elapsed_seconds',d.get('total_phase_seconds'))/60:.2f}"] for name, _, d in ROWS])
paragraph("Benchmarks use ten warm-up requests and three validation passes. ModernBERT costs include fresh encoding, with feature-cache reads disabled. CPU math threads are capped at eight. Phase times have different inherited-cache/resume boundaries and are not clean standalone training-cost comparisons; the detailed reports disclose extraction, tuning, interrupted attempts, loading, and benchmarking separately. Original embedding extraction took 12,247.31 seconds and was reused by subsequent embedding methods. Four-client burst tests return many intentional 429 busy responses; their successful throughput is not sustained capacity.")
table(["Method", "4-client successes", "429 busy", "Other errors", "Direct p95 ms", "Load s"], [[name, d["benchmark"]["four_client_load"]["successful"], d["benchmark"]["four_client_load"]["busy_429"], d["benchmark"]["four_client_load"]["other_errors"], f"{d['benchmark']['direct']['p95_ms']:.2f}", f"{d['benchmark']['load_seconds']:.3f}"] for name, _, d in ROWS])
paragraph("## Calibration and difficulty abstention")
table(["Method", "Skill coverage", "Skill precision", "Difficulty threshold", "Difficulty coverage", "Difficulty precision", "Difficulty ECE", "Ordinal error", "Easy↔Hard error"], [[name, fmt(d["selected_metrics"]["skill:reading_writing"]["coverage"]), fmt(d["selected_metrics"]["skill:reading_writing"]["suggestion_precision"]), fmt(d["selected_metrics"]["difficulty"]["policy"]["threshold"]), fmt(d["selected_metrics"]["difficulty"]["coverage"]), fmt(d["selected_metrics"]["difficulty"]["suggestion_precision"]), fmt(d["selected_metrics"]["difficulty"]["ece"]), fmt(d["selected_metrics"]["difficulty"]["ordinal_error"]), fmt(d["selected_metrics"]["difficulty"]["extreme_error_rate"])] for name, _, d in ROWS])
paragraph("Thresholds and temperatures use training OOF predictions only. Zero coverage means complete abstention, not zero classification accuracy. Embedding logistic regression retained only 16 difficulty suggestions, all correct: the exact 95% precision interval is approximately 79.4%–100%, so this does not establish 90% population precision. Embedding SVM retained 23, of which 18 were correct (78.3%); it missed the target.")
paragraph("## Per-skill recall")
skills = ROWS[0][2]["selected_metrics"]["skill:reading_writing"]["per_class"]
table(["Skill", "Validation support", *[name for name, _, _ in ROWS]], [[skill, values["support"], *[fmt(d["selected_metrics"]["skill:reading_writing"]["per_class"][skill]["recall"]) for _, _, d in ROWS]] for skill, values in skills.items()])
paragraph("Cross-Text Connections has only 12 validation questions; its estimates are especially uncertain. Perfect observed recall on a small set is not proof of perfect generalization.")
paragraph("## CV, weighting, seeds, and full per-class results")
for name, path, d in ROWS:
    paragraph(f"### {name}")
    paragraph("CV-selected weighting: " + "; ".join(f"{task}: {weight}" for task, weight in d["selected_weights"].items()) + ". " + link(path))
    cv = d["cv"] if "cv" in d else d["configurations"]
    if isinstance(cv, dict):
        cv = [row for variants in cv.values() for row in variants.values()]
    table(["Target", "Weighting", "Configuration", "CV macro-F1", "CV SD", "CV log loss"], [[row["task"], row["weighting"], json.dumps(row.get("config", {"C/alpha": row.get("parameter")}), sort_keys=True), fmt(row["macro_f1_mean"]), fmt(row["macro_f1_std"]), fmt(row["log_loss_mean"])] for row in cv])
    table(["Weighting", "Seed", "Skill macro-F1", "Difficulty macro-F1", "Domain macro-F1"], [[r["weighting"], r["seed"], *[fmt(r["metrics"][task]["macro_f1"]) for task in ["skill:reading_writing", "difficulty", "domain:reading_writing"]]] for r in d["final"]])
    for task in ["skill:reading_writing", "difficulty", "domain:reading_writing"]:
        m = d["selected_metrics"][task]
        paragraph(f"**{task}**: balanced accuracy {fmt(m['balanced_accuracy'])}; weighted F1 {fmt(m['weighted_f1'])}; log loss {fmt(m['log_loss'])}; Brier {fmt(m['brier'])}; ECE {fmt(m['ece'])}.")
        table(["Class", "Precision", "Recall", "F1", "Support"], [[{"1": "Easy", "3": "Medium", "5": "Hard"}.get(label,label), fmt(r["precision"]), fmt(r["recall"]), fmt(r["f1"]), r["support"]] for label, r in m["per_class"].items()])

paragraph("## Discontinued ModernBERT fine-tuning")
partial_path = ROOT / "artifacts/cpu-expanded-v1/colab/partial-finetune-results.json"
partial = json.loads(partial_path.read_text())
groups = {}
for row in partial["completed_folds"]:
    groups.setdefault(row["file"].split("-fold")[0], []).append(row)
table(["Skill / ordinary configuration", "Completed folds", "Fold macro-F1", "Mean ± sample SD", "Completed-fit seconds"], [["LR 2e-5" if len(items)==5 else "LR 5e-5 (partial)", len(items), ", ".join(fmt(x["scores"]["macro_f1"]) for x in items), f"{statistics.mean(x['scores']['macro_f1'] for x in items):.4f} ± {statistics.stdev(x['scores']['macro_f1'] for x in items):.4f}", f"{sum(x['seconds'] for x in items):.2f}"] for items in groups.values()])
paragraph("Seven of forty scheduled CV fits completed on the free Tesla T4: all five skill/ordinary/LR=2e-5 folds, and two skill/ordinary/LR=5e-5 folds. The third higher-LR fold failed while saving a checkpoint, with a terminal ‘No space left on device’ error. The process had exited before the cancellation request; it was not restarted. The higher-LR two-fold average is incomplete and cannot be compared as if it were a five-fold or outer-validation result. No balanced-loss fine-tuning, difficulty CV, final fine-tuned artifact, outer validation, or serving benchmark completed. CPU timing-pilot quality values are omitted because that timing subset overlapped its evaluation subset. " + link(partial_path))
paragraph("## Recommendation and evidence")
paragraph("Use TF-IDF + SVM as the leading skill-classification candidate based on current accuracy and CPU cost. Keep difficulty predictions as administrator-reviewed suggestions; the small embedding-method gains come with roughly 15–16× slower serial CPU inference and low or unreliable high-confidence coverage. Preserve the logistic-regression baseline as a reference. No automatic replacement or deployment has been performed.")
paragraph("Detailed confusion matrices, confidence intervals, all experiments, timings, lineage, and paired comparisons: " + link(ROOT / "reports/classification-expanded-comparison.md") + "; original baseline/XGBoost report: " + link(ROOT / "reports/classification-comparison.md") + ". Verification: 28 Python tests passed, and all four expanded methods passed artifact reload, private API, and applicable cache-control checks.")
output = ROOT / "reports/classification-current-results.md"
output.write_text("\n".join(OUT), encoding="utf-8")
(ROOT / "reports/classification-current-results.json").write_text(json.dumps({"fine_tuning_status": "discontinued_by_user", "models": {name: {"source": str(path), "selected_weights": d["selected_weights"], "selected_metrics": d["selected_metrics"], "final": d["final"], "benchmark": d["benchmark"]} for name,path,d in ROWS}, "partial_finetuning": partial},indent=2),encoding="utf-8")
print(output)
for name, _, d in ROWS:
    print(name, fmt(d['selected_metrics']['skill:reading_writing']['macro_f1']),fmt(d['selected_metrics']['difficulty']['macro_f1']),f"{d['benchmark']['api_serial']['p95_ms']:.2f}")
