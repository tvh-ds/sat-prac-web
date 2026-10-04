import json
from pathlib import Path

import numpy as np
from sklearn.metrics import f1_score


def table(headers, rows):
    return "\n".join(["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |",
                      *["| " + " | ".join(str(v) for v in row) + " |" for row in rows]]) + "\n\n"


def number(value):
    return "Unavailable" if value is None else f"{value:.4f}"


def interval(value):
    return "Unavailable" if value is None else f"[{value[0]:.4f}, {value[1]:.4f}]"


def method_section(result, name, root):
    if result is None:
        return f"# {name}\n\nPending: baseline must finish before this method starts. No candidate results are claimed.\n\n"
    method = result["method"]
    manifest = result["dataset"]
    text = f"# {name}\n\n## Methods and reproducibility\n\n"
    text += ("Independent skill and difficulty estimators; domain probabilities are aggregated from skill. "
             "Inputs contain section, type, passage, prompt, and ordered choices, without answer keys, explanations, or source identifiers. "
             "Ordinary and inverse-frequency class-balanced losses use training-fold counts only. "
             "Parameters and weighting are selected using five-fold CV inside the frozen training 80%; "
             "calibration and suggestion thresholds use training out-of-fold predictions. "
             "The outer 20% is final validation, not an independent test.\n\n")
    text += f"Dataset version: `{manifest['dataset_version']}`. Seed 42 split; final fit seeds 42, 43, 44. "
    text += f"{manifest['all']['questions']} eligible text questions, {sum(manifest['all']['verified_difficulty'].values())} verified difficulty labels. "
    text += f"{len(manifest['normalizations'])} audited casing normalizations; "
    text += f"{sum(e['reason']=='essential_image' for e in manifest['excluded'])} image-dependent exclusions and "
    text += f"{sum(e['reason']=='invalid_input' for e in manifest['excluded'])} invalid-input exclusions. "
    text += f"{manifest['group_count']} indivisible groups; largest group {manifest['largest_group']}. "
    text += "The compiled bank is treated as a container; shared passages and duplicate/content groups remain intact.\n\n"
    text += table(["Split", "Questions", "%", "Verified difficulty"], [
        [label, manifest[label]["questions"], f"{manifest[label]['questions']/manifest['all']['questions']*100:.2f}",
         sum(manifest[label]["verified_difficulty"].values())] for label in ["train", "validation"]])
    text += table(["Skill", "All", "Train", "Validation"], [
        [skill, count, manifest["train"]["skills"].get(skill, 0), manifest["validation"]["skills"].get(skill, 0)]
        for skill, count in sorted(manifest["all"]["skills"].items())])
    text += table(["Difficulty", "All", "Train", "Validation"], [
        [{"1": "Easy", "3": "Medium", "5": "Hard"}[label], manifest["all"]["verified_difficulty"].get(label, 0),
         manifest["train"]["verified_difficulty"].get(label, 0), manifest["validation"]["verified_difficulty"].get(label, 0)]
        for label in ["1", "3", "5"]])
    text += f"Unknown difficulty provenance: {manifest['train']['questions']-sum(manifest['train']['verified_difficulty'].values())} training and "
    text += f"{manifest['validation']['questions']-sum(manifest['validation']['verified_difficulty'].values())} validation questions. "
    text += "This missing-label subset is not an explicit stratification target; its split is uneven. "
    text += "The observed-label distributions and exact counts above are retained without post-result resplitting.\n\n"
    text += "Deterministic greedy assignment and local improvements minimize normalized deviations: total-size weight 4, "
    text += "skill and verified-difficulty marginal weights 1 per target, and joint-combination weight 0.2. "
    text += "Groups are indivisible; seed 42 hashes break ordering ties. Identical membership is reused by both estimators and methods.\n\n"
    text += table(["Inner CV fold", "Held-out questions", "Verified difficulty", "Skill counts"], [
        [fold, counts["questions"], sum(counts["verified_difficulty"].values()), json.dumps(counts["skills"], sort_keys=True)]
        for fold, counts in manifest["folds"].items()])
    if method == "baseline":
        text += "Word TF-IDF (1–2 grams) and character TF-IDF (2–5 grams), each capped at 30,000 features; "
        text += "logistic regression, C ∈ {0.1, 1, 10}. Vocabulary and IDF are fitted separately within each training fold.\n\n"
    else:
        text += f"Frozen original `answerdotai/ModernBERT-base`, revision `{result['encoder_revision']}`; "
        text += "masked mean pooling with full passage chunking (1,024 tokens; at most 32 chunks), plus structural features. "
        text += "No encoder fine-tuning, visual features, or dimensionality reduction. XGBoost multiclass probabilities: "
        text += "depth {3,4}, lambda {1,5}, learning rate 0.05, maximum 500 trees, early stopping 25. "
        text += "Final tree counts use median best inner-fold iteration. Embeddings are reused during training; end-to-end benchmarks bypass the cache.\n\n"
    text += "## Cross-validation experiments\n\n"
    text += "Each configuration has five fits. Selection maximizes mean macro-F1, then minimizes log loss, "
    text += "then prefers smaller C/depth and stronger tree regularization. Weighting ties prefer ordinary loss.\n\n"
    text += table(["Target", "Loss", "Parameters", "Macro-F1 mean", "SD", "Log loss", "Fit/evaluate seconds"], [
        [run["task"], run["weighting"], json.dumps(run["config"]), number(run["macro_f1_mean"]), number(run["macro_f1_std"]),
         number(run["log_loss_mean"]), f"{run['seconds']:.2f}"] for run in result["cv"]])
    text += f"CV-selected weighting per target: `{json.dumps(result['selected_weights'])}`. "
    text += "Final-validation outcomes below did not influence this choice.\n\n## Final-validation results\n\n"
    if method == "baseline":
        text += "The logistic-regression solver is deterministic here: changing its seed alone yields identical final predictions. "
        text += "These repeated fits are not independent datasets; CV fold variation and bootstrap intervals provide more useful uncertainty estimates.\n\n"
    for run in result["final"]:
        text += f"### {run['weighting'].title()} loss, seed {run['seed']}\n\n"
        scores = run["metrics"]
        text += table(["Target", "N", "Accuracy", "Balanced accuracy", "Macro-F1", "Weighted-F1", "Log loss", "Brier", "ECE", "F1 95% CI"], [
            [task, values["count"], number(values["accuracy"]), number(values["balanced_accuracy"]), number(values["macro_f1"]),
             number(values["weighted_f1"]), number(values["log_loss"]), number(values["brier"]), number(values["ece"]),
             interval(values["macro_f1_ci95"])] for task, values in scores.items() if task != "joint"])
        text += f"Both skill and difficulty correct: {number(scores['joint']['both_correct'])} on {scores['joint']['count']} questions. "
        text += f"Difficulty ordinal MAE: {number(scores['difficulty']['ordinal_error'])}; Easy↔Hard error rate: {number(scores['difficulty']['extreme_error_rate'])}.\n\n"
        for task, values in scores.items():
            if task == "joint":
                continue
            text += f"**{task} — per-class results**\n\n"
            text += table(["Class", "Support", "Precision", "Recall", "Recall 95% CI", "F1", "Small support"], [
                [label, metrics["support"], number(metrics["precision"]), number(metrics["recall"]),
                 interval(metrics.get("recall_ci95")), number(metrics["f1"]),
                 "Yes (<20)" if metrics["support"] < 20 else ""] for label, metrics in values["per_class"].items()])
            text += "Confusion matrix: rows are true labels; columns are predicted labels.\n\n"
            text += table(["True / predicted", *values["confusion_labels"]], [
                [label, *counts] for label, counts in zip(values["confusion_labels"], values["confusion_matrix"])])
            threshold = values.get("policy", {}).get("threshold")
            text += f"Suggestion threshold: {number(threshold)}; coverage: {number(values['coverage'])}; "
            text += f"abstention: {number(1-values['coverage'])}; retained precision: {number(values['suggestion_precision'])}.\n\n"
            text += table(["Confidence threshold", "Coverage", "Precision"], [
                [item["threshold"], number(item["coverage"]), number(item["precision"])] for item in values["reliability"]])
            if "long_input" in values:
                long = values["long_input"]
                text += f"Long-input slice (>4,000 characters): {long['count']} questions; macro-F1 {number(long.get('macro_f1'))}.\n\n"
        text += "Training seconds by target: `" + json.dumps(run["training_seconds"]) + "`. "
        text += f"Evaluation: {run['evaluation_seconds']:.2f} seconds. [Artifact lineage](<{Path(run['artifact']).as_posix()}/manifest.json>).\n\n"
    benchmark = result["benchmark"]
    text += "## Runtime, throughput, and resource usage\n\n"
    text += f"Hardware/software: `{json.dumps(result['hardware'])}`. Eight-thread ceiling, CPU only, one experiment at a time. "
    text += "Dependency versions and code revision are in each artifact manifest; the implementation is an unpushed working-tree change.\n\n"
    if result.get("encoder_thread_profile"):
        profile = result["encoder_thread_profile"]
        text += f"Encoder inference uses {profile['selected_threads']} threads, selected solely by timing training inputs. "
        text += "The initial embedding extraction used eight threads; those original costs remain included. "
        text += "All profiled representations passed numerical parity against cached embeddings (rtol/atol 1e-5).\n\n"
        text += table(["Encoder threads", "Median seconds/question", "Maximum absolute feature difference"], [
            [r["threads"], f"{r['median_question_seconds']:.4f}", r["maximum_absolute_feature_error"]] for r in profile["results"]])
        text += result.get("runtime_note", "") + "\n\n"
    resume_path = root / method / "resume-audit.json"
    if resume_path.exists():
        resume = json.loads(resume_path.read_text())
        text += "Interrupted attempt: " + resume["reason"] + ". "
        text += f"{resume['completed_saved_cv_folds']} completed CV folds and all embeddings were preserved. "
        text += "One in-progress fold was discarded and rerun; its interrupted runtime was not captured. "
        text += "Timing totals are measured completed work, not a billing estimate or an uninterrupted execution guarantee.\n\n"
    embedding_timing = root / method / "embedding-timing.json"
    if embedding_timing.exists():
        timing = json.loads(embedding_timing.read_text())
        text += f"Initial encoder load: {timing['encoder_load_seconds']:.2f} seconds; "
        text += f"training embedding extraction: {timing['training_extraction_seconds']:.2f} seconds. "
        text += "These are the measured initial costs, distinct from the later warmed serial benchmark.\n\n"
    else:
        text += "TF-IDF vocabulary/IDF fitting and transforms are included in the measured fit/evaluate times; "
        text += "a separate feature-preparation timer was not recorded.\n\n"
    text += table(["Measurement", "Seconds / value"], [
        ["Total phase wall time", f"{result['total_phase_seconds']:.2f}"],
        ["CV accumulated fit/evaluate time", f"{sum(r['seconds'] for r in result['cv']):.2f}"],
        ["Encoder loading + training embedding extraction", f"{result['embedding_seconds']:.2f}"],
        ["Validation embedding preparation", f"{result['validation_embedding_seconds']:.2f}"],
        ["Feature cache bytes", result["cache_bytes"]], ["Artifact bytes", benchmark["artifact_bytes"]],
        ["Artifact reload", f"{benchmark['load_seconds']:.2f}"], ["API startup", f"{benchmark['api_startup_seconds']:.2f}"],
        ["Peak experiment process memory MB", f"{result['peak_memory_mb']:.2f}"],
        ["Direct 100-question time", f"{benchmark['direct_100_questions_seconds']:.2f}"],
        ["Serial API first 100-question time", f"{benchmark['api_100_questions_seconds']:.2f}"]])
    latency = [("Direct, complete prediction", benchmark["direct"]), ("Private HTTP API, serial", benchmark["api_serial"])]
    if benchmark["tree_only"]:
        latency.append(("Trees only, prepared features", benchmark["tree_only"]))
        text += f"Uncached feature preparation for the tree-only benchmark: {benchmark['tree_only']['feature_preparation_seconds']:.2f} seconds. "
        text += "Tree-only latency excludes this preparation, calibration, and HTTP overhead.\n\n"
    text += table(["Path", "Requests", "p50 ms", "p95 ms", "p99 ms", "Questions/sec"], [
        [name, values["requests"], f"{values['p50_ms']:.2f}", f"{values['p95_ms']:.2f}", f"{values['p99_ms']:.2f}",
         f"{values['questions_per_second']:.2f}"] for name, values in latency])
    load = benchmark["four_client_load"]
    text += f"Four-client load: {load['attempts']} attempts, {load['successful']} successful, {load['busy_429']} busy (429), "
    text += f"{load['other_errors']} other errors; {load['elapsed_seconds']:.2f} seconds, {load['successful_questions_per_second']:.2f} successful questions/sec. "
    text += "The API intentionally serializes inference and returns 429 for overlap; busy responses are not counted as successful classification throughput.\n\n"
    if load["successful_latency"]:
        latency = load["successful_latency"]
        text += f"Four-client successful-request p50/p95/p99: {latency['p50_ms']:.2f}/{latency['p95_ms']:.2f}/{latency['p99_ms']:.2f} ms. "
    text += "Load-test clients do not retry 429 responses; this burst result is not sustained capacity under backoff.\n\n"
    text += "Ten warm-ups, three full validation passes per serial path. XGBoost complete paths include tokenization, encoding, features, both heads, calibration, and output construction; no feature-cache reads. "
    text += "Process peak memory is measured over the phase and is not total system or simultaneous parent/API memory. Cold loading is separate from warmed latency.\n\n"
    text += "## Limitations and machine-readable evidence\n\n"
    text += "One R&W bank source; no independently human-labeled full-length holdout, Math coverage, or visual evaluation. "
    text += "Rare-class recalls and joint label combinations have small support; group-bootstrap intervals do not address source-domain shift. "
    text += "A training-OOF target of 90% suggestion precision does not guarantee 90% on final validation or future imports. "
    text += "These results do not promote or deploy a model.\n\n"
    text += "The artifacts record Git revision and a dirty-working-tree flag. A post-experiment source snapshot preserves "
    text += "the verified implementation; exact dirty-source hashes at the start of each training fit were not recorded. "
    text += "That historical code-lineage limitation is retained rather than rewriting trained artifact manifests.\n\n"
    text += f"[Complete metrics and predictions](<{(root / method / 'results.json').resolve().as_posix()}>) · "
    text += f"[Frozen configurations](<{(root / method / 'configuration-freeze.json').resolve().as_posix()}>) · "
    text += f"[Dataset and fold audit](<{(root / 'dataset/manifest.json').resolve().as_posix()}>).\n\n"
    text += f"[Verification and source evidence](<{(root / 'verification.json').resolve().as_posix()}>).\n\n"
    return text


def compare(baseline, candidate, root):
    text = "# Comparison\n\n"
    if not candidate:
        return text + "Baseline is complete. XGBoost is pending; no comparative winner is asserted.\n"
    text += "Both methods use identical frozen train/validation membership and CV folds. "
    text += "Primary comparisons use CV-selected weighting for each target, seed 42; all weighting/seed results are reported above.\n\n"
    text += table(["Target", "Baseline F1", "XGBoost F1", "Difference", "Baseline accuracy", "XGBoost accuracy"], [
        [task, number(baseline["selected_metrics"][task]["macro_f1"]), number(candidate["selected_metrics"][task]["macro_f1"]),
         number(candidate["selected_metrics"][task]["macro_f1"]-baseline["selected_metrics"][task]["macro_f1"]),
         number(baseline["selected_metrics"][task]["accuracy"]), number(candidate["selected_metrics"][task]["accuracy"])]
        for task in ["skill:reading_writing", "difficulty", "domain:reading_writing"]])
    text += f"Joint correctness: baseline {number(baseline['selected_metrics']['joint']['both_correct'])}, "
    text += f"candidate {number(candidate['selected_metrics']['joint']['both_correct'])}.\n\n"
    a_classes = baseline["selected_metrics"]["skill:reading_writing"]["per_class"]
    b_classes = candidate["selected_metrics"]["skill:reading_writing"]["per_class"]
    text += table(["Skill", "Validation support", "Baseline recall", "XGBoost recall", "Recall difference"], [
        [label, a_classes[label]["support"], number(a_classes[label]["recall"]), number(b_classes[label]["recall"]),
         number(b_classes[label]["recall"]-a_classes[label]["recall"])] for label in sorted(a_classes)])
    text += "Ordinary versus balanced loss on the unchanged final validation:\n\n"
    text += table(["Method", "Loss", "Target", "F1 mean across seeds", "F1 SD across seeds"], [
        [result["method"], weight, task,
         number(float(np.mean([r["metrics"][task]["macro_f1"] for r in result["final"] if r["weighting"] == weight]))),
         number(float(np.std([r["metrics"][task]["macro_f1"] for r in result["final"] if r["weighting"] == weight], ddof=1)))]
        for result in [baseline, candidate] for weight in ["ordinary", "balanced"] for task in ["skill:reading_writing", "difficulty"]])
    groups = json.loads((root / "dataset/groups.json").read_text())
    paired = {}
    for task in ["skill:reading_writing", "difficulty"]:
        a, b = baseline["selected_predictions"][task], candidate["selected_predictions"][task]
        ids = sorted(set(a) & set(b))
        grouped = {}
        for identifier in ids:
            grouped.setdefault(groups[identifier], []).append(identifier)
        rng = np.random.default_rng(42)
        differences = []
        for _ in range(1000):
            selected = [i for g in rng.choice(list(grouped), size=len(grouped), replace=True) for i in grouped[g]]
            y = [a[i]["true"] for i in selected]
            labels = sorted({a[i]["true"] for i in ids})
            scores = [f1_score(y, [p[i]["predicted"] for i in selected], labels=labels, average="macro", zero_division=0) for p in [a, b]]
            differences.append(scores[1]-scores[0])
        paired[task] = np.quantile(differences, [.025, .975]).tolist()
    text += "Paired group-bootstrap 95% intervals for candidate − baseline macro-F1 (1,000 resamples):\n\n"
    text += table(["Target", "95% difference interval"], [[task, interval(ci)] for task, ci in paired.items()])
    (root / "paired-comparison.json").write_text(json.dumps({"resamples": 1000, "seed": 42,
        "statistic": "candidate-minus-baseline macro-F1", "ci95": paired}, indent=2), encoding="utf-8")
    text += f"[Machine-readable paired intervals](<{(root / 'paired-comparison.json').resolve().as_posix()}>).\n\n"
    text += table(["Operational measurement", "Baseline", "XGBoost complete path"], [
        ["Direct p95 ms", f"{baseline['benchmark']['direct']['p95_ms']:.2f}", f"{candidate['benchmark']['direct']['p95_ms']:.2f}"],
        ["API p95 ms", f"{baseline['benchmark']['api_serial']['p95_ms']:.2f}", f"{candidate['benchmark']['api_serial']['p95_ms']:.2f}"],
        ["Serial API questions/sec", f"{baseline['benchmark']['api_serial']['questions_per_second']:.2f}", f"{candidate['benchmark']['api_serial']['questions_per_second']:.2f}"],
        ["100-question serial API seconds", f"{baseline['benchmark']['api_100_questions_seconds']:.2f}", f"{candidate['benchmark']['api_100_questions_seconds']:.2f}"],
        ["Total phase seconds", f"{baseline['total_phase_seconds']:.2f}", f"{candidate['total_phase_seconds']:.2f}"]])
    text += "## Recommendation\n\n"
    for task, ci in paired.items():
        if ci[0] > 0:
            text += f"For {task}, XGBoost has a positive measured macro-F1 difference with a paired interval above zero. "
            text += "Treat it as a quality candidate and weigh its full encoder latency and lower throughput before promotion.\n\n"
        else:
            text += f"For {task}, the experiment does not establish a reliable positive XGBoost gain. Retain the simpler baseline pending independent full-length evaluation.\n\n"
    text += "Measured winners are experimental recommendations, not deployment decisions. "
    text += "Keep final validation frozen; a future independently reviewed full-length test is required to assess import generalization.\n"
    text += "\nTechnical gates measured on this CPU: warmed serial API p95 ≤2,000 ms and 100 questions ≤600 seconds.\n\n"
    text += table(["Method", "API p95 gate", "100-question gate"], [[r["method"],
        "Pass" if r["benchmark"]["api_serial"]["p95_ms"] <= 2000 else "Fail",
        "Pass" if r["benchmark"]["api_100_questions_seconds"] <= 600 else "Fail"] for r in [baseline, candidate]])
    return text


def render(root, output):
    root, output = Path(root), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    for kind in ["baseline", "xgboost"]:
        path = root / kind / "results.json"
        results[kind] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    text = method_section(results["baseline"], "Baseline: TF-IDF + logistic regression", root)
    text += method_section(results["xgboost"], "Frozen ModernBERT + XGBoost", root)
    text += compare(results["baseline"], results["xgboost"], root)
    (output / "classification-comparison.md").write_text(text, encoding="utf-8")
