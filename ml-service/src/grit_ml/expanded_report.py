"""Measured expanded comparisons without modifying the original report."""
import itertools
import json
from pathlib import Path

import numpy as np
from scipy.stats import binomtest

from .experiment_report import interval, number, table

NAMES = {"tfidf_svm": "TF-IDF + Linear SVM", "tfidf_nb": "TF-IDF + Complement Naive Bayes",
         "embedding_lr": "Frozen ModernBERT + logistic regression", "embedding_svm": "Frozen ModernBERT + Linear SVM",
         "finetune":"Fine-tuned ModernBERT"}


def paired_macro_f1(a, b, groups, resamples=1000, seed=42):
    """Resample whole groups; vectorized confusion counts preserve the ordinary macro-F1 statistic."""
    if set(a) != set(b) or any(a[i]['true'] != b[i]['true'] for i in a):
        raise ValueError("Paired predictions must have identical questions and truth")
    ids = sorted(a)
    grouped = {}
    for identifier in ids:
        grouped.setdefault(groups[identifier], []).append(identifier)
    labels = sorted({a[i]['true'] for i in ids})
    positions = {label:index for index,label in enumerate(labels)}
    rng = np.random.default_rng(seed)
    counts = np.stack([np.bincount(rng.choice(len(grouped),len(grouped),replace=True),
        minlength=len(grouped)) for _ in range(resamples)]).astype(float)
    scores = []
    for predictions in [a,b]:
        matrices = np.zeros((len(grouped),len(labels),len(labels)))
        for index, members in enumerate(grouped.values()):
            for identifier in members:
                value = predictions[identifier]
                matrices[index,positions[value['true']],positions[value['predicted']]] += 1
        confusion = (counts @ matrices.reshape(len(grouped),-1)).reshape(resamples,len(labels),len(labels))
        denominator = confusion.sum(1)+confusion.sum(2)
        numerator = 2*np.diagonal(confusion,axis1=1,axis2=2)
        f1 = np.divide(numerator,denominator,out=np.zeros_like(numerator),where=denominator != 0)
        scores.append(f1.mean(1))
    return np.quantile(scores[1]-scores[0],[.025,.975]).tolist()


def retained_precision(metrics):
    count = round(metrics['count']*metrics['coverage'])
    if not count:
        return count,None
    correct = round(metrics['suggestion_precision']*count)
    ci = binomtest(correct,count).proportion_ci(confidence_level=.95,method='exact')
    return count,[ci.low,ci.high]


def render(root, reference):
    root, reference = Path(root), Path(reference)
    text = "# Expanded classification comparison\n\n"
    text += "Local sequential experiments; three categorical difficulty labels. No model promotion. "
    text += "The existing 80/20 membership and five group-aware CV folds are reused. "
    text += "Further outer-validation comparisons are exploratory: previous results were already inspected. "
    text += "Independent full-length evidence remains unavailable.\n\n"
    text += "Inputs are known section/type, passage, prompt, and ordered answer-choice text. Answer keys, correct-choice flags, explanations, source identifiers, and existing labels are excluded from features. "
    text += "Skill and verified difficulty use independent estimators; domain probabilities sum the probabilities of skills with each parent domain. No predicted skill is used as a difficulty feature.\n\n"
    manifest = json.loads((reference/"dataset/manifest.json").read_text())
    text += f"Dataset `{manifest['dataset_version']}`; seed42; {manifest['group_count']} audited groups, "
    text += "largest group one question. Grouping checks shared passages, duplicate IDs, and identical content. "
    text += "The compiled PDF is a container rather than one indivisible source group. "
    text += "Two essential-image questions and one malformed multiple-choice question are excluded. "
    text += "Two Cross-text Connections labels normalize to Cross-Text Connections locally. "
    text += "Staging labels are unchanged.\n\n"
    text += "Split technique: deterministic group-wise vector stratification with greedy assignment and local improvements, seed42. Skill and verified-difficulty marginals are primary balancing objectives; their joint combinations receive secondary weight. "
    text += "Five equal-fraction training folds use the same technique. Whole groups are indivisible. The tables show actual ratios rather than assuming perfect stratification.\n\n"
    text += table(["Skill","All","Train","Validation","Validation fraction"],[
        [label,count,manifest["train"]["skills"].get(label,0),manifest["validation"]["skills"].get(label,0),
         f"{manifest['validation']['skills'].get(label,0)/count:.3%}"] for label,count in sorted(manifest["all"]["skills"].items())])
    text += table(["Verified difficulty","All","Train","Validation","Validation fraction"],[
        [name,manifest["all"]["verified_difficulty"][label],manifest["train"]["verified_difficulty"][label],
         manifest["validation"]["verified_difficulty"][label],
         f"{manifest['validation']['verified_difficulty'][label]/manifest['all']['verified_difficulty'][label]:.3%}"]
        for label,name in [("1","Easy"),("3","Medium"),("5","Hard")]])
    text += "No independent test set exists for this run. No oversampling or evaluation weighting is applied. "
    text += "Existing categorical storage IDs 1/3/5 mean Easy/Medium/Hard; these are class IDs, not numerical difficulty scores. "
    text += "Per-run macro-F1, accuracy, and recall intervals use 200 group-bootstrap resamples, seed42; "
    text += "paired method differences use 1,000 resamples. Intervals are approximate, especially for small supports. "
    text += "A bootstrap recall interval of [1,1] when no observed errors exist cannot quantify unseen errors; it is not proof of perfect population recall. "
    text += "The 19 remaining unverified difficulty labels contribute to skill training only. "
    text += f"These comprise {manifest['train']['questions']-sum(manifest['train']['verified_difficulty'].values())} training and "
    text += f"{manifest['validation']['questions']-sum(manifest['validation']['verified_difficulty'].values())} validation questions; difficulty support therefore differs from skill support. "
    text += f"[Dataset audit and checksums](<{(reference/'dataset/manifest.json').resolve().as_posix()}>) · "
    text += f"[Original comparison](<{Path('ml-service/reports/classification-comparison.md').resolve().as_posix()}>).\n\n"
    verification = root/"verification.json"
    if verification.exists():
        text += f"[Software and split verification](<{verification.resolve().as_posix()}>). "
        text += "Offline fixture tests verify pipeline behavior and checkpoint recovery; they do not establish corpus quality.\n\n"
    results = []
    for kind, name in NAMES.items():
        text += f"## {name}\n\n"
        if kind == 'finetune':
            text += "Fine-tuning uses explicit section/type, prompt, ordered-choice, and passage markers; each passage chunk starts after its own passage marker. "
            text += "The legacy frozen cache used an empty passage marker before the prompt and appended actual passage text after choices without a new marker. "
            text += "It is preserved for the completed cache-based experiment. Fine-tuning therefore changes input layout as well as learned weights; a future layout-only ablation would be needed to isolate those effects.\n\n"
            for old_pilot in sorted((root/kind).glob('pilot-attempt*/pilot.json')):
                measurement = json.loads(old_pilot.read_text())
                text += f"Superseded CPU timing pilot: {measurement['pilot_seconds']:.2f}s; projected {measurement['projected_hours']:.2f} hours including margin. "
                text += "Its original-boundary checkpoints and code bundle are archived; they are not used for final training or quality evidence. "
                text += f"[Preserved pilot](<{old_pilot.resolve().as_posix()}>).\n\n"
        if kind == 'embedding_svm':
            for extra in sorted(root.glob('embedding_svm-attempt*/attempt-status.json')):
                if extra.parent.name == 'embedding_svm-attempt1-auto-solver':
                    continue
                record = json.loads(extra.read_text())
                text += f"Additional interrupted attempt: {record['reason']} "
                text += f"Completed {record['completed_cv_folds']} CV folds; wall time {record['elapsed_seconds']:.2f}s; "
                text += f"no outer validation used. [Preserved record](<{extra.resolve().as_posix()}>).\n\n"
            attempt = root/'embedding_svm-attempt1-auto-solver/attempt-status.json'
            if attempt.exists():
                interrupted = json.loads(attempt.read_text())
                text += f"The automatic/primal-solver attempt was interrupted after {interrupted['completed_cv_folds']} inner CV folds "
                text += f"({interrupted['completed_fit_seconds']:.2f}s completed-fit time; {interrupted['elapsed_seconds']:.2f}s wall time). "
                text += "No outer validation was accessed. Its partial runs and source lineage are preserved; none are reused in the restarted search. "
                text += f"[Interrupted attempt](<{attempt.resolve().as_posix()}>).\n\n"
                text += "The restart uses the dual optimizer for the same L2-regularized squared-hinge LinearSVC objective, with a 10,000-iteration cap. "
                text += "The C range, complete five-fold evaluation, weighting, features, and frozen groups remain unchanged.\n\n"
            probe = root/'embedding-svm-solver-probe.json'
            if probe.exists():
                text += "Training-only solver timing probe (no outer validation or configuration selection):\n\n"
                text += table(['C','Fit seconds','Convergence warnings'],[[r['C'],f"{r['seconds']:.2f}",r['convergence_warnings']]
                    for r in json.loads(probe.read_text())])
                text += f"[Probe measurements](<{probe.resolve().as_posix()}>).\n\n"
        path = root / kind / "results.json"
        if not path.exists():
            text += "Not yet complete; no results claimed.\n\n"
            folds = [json.loads(p.read_text()) for p in (root/kind).glob("cv-*.json")]
            if folds:
                text += f"Progress: {len(folds)} completed inner CV fold fits; accumulated fitting/measurement time "
                text += f"{sum(r['seconds'] for r in folds):.2f}s. Partial tuning results are not final-validation evidence.\n\n"
            if kind == "finetune" and (root/kind/"pilot.json").exists():
                text += "Pilot evaluation overlaps training and exists only to measure runtime; its F1 is not quality evidence.\n\n"
                text += "CPU feasibility pilot:\n\n```json\n"+(root/kind/"pilot.json").read_text()+"\n```\n\n"
            continue
        result = json.loads(path.read_text())
        results.append(result)
        text += "Independent skill/difficulty estimators; source-verified difficulty only. Domain is derived from skill probabilities. "
        text += "Features remain fixed. Ordinary and balanced training are compared independently for each target. "
        if kind == "finetune":
            text += "Original pinned ModernBERT checkpoint, separate fully trainable encoders and multiclass heads. "
            text += "Learning rates 2e-5/5e-5, ordinary/balanced losses, five group-aware folds: 40 CV fits. "
            text += "Maximum three epochs; stop after one epoch without macro-F1 improvement. "
            text += "Final epochs use median selected-fold best epoch. AdamW decay .01, gradient clipping 1, "
            text += "10% warm-up, microbatch 2, effective batch 16. CPU training uses FP32; the free GPU path uses "
            text += "FP16 autocast, FP32 parameters, and checkpointed dynamic gradient scaling. Validation and CPU inference use FP32. "
            text += "Complete prompts/choices and passage chunks "
            text += "are mean pooled; no cached pretrained embeddings enter fine-tuning. "
            text += "Configuration selection uses mean CV macro-F1, then log loss, then lower learning rate.\n\n"
            text += f"Encoder revision `{result['encoder_revision']}`; CPU inference measurements include both separately fine-tuned encoders.\n\n"
        else:
            text += "Twenty Optuna TPE trials per target/weight variant, including initial 0.1/1/10 settings; "
            text += "logarithmic C/alpha range [0.001,100], seed 42. All trials use five complete frozen CV folds. "
            text += "Selection uses mean macro-F1, then lower log loss, then stronger regularization. "
            text += "SVM sigmoid calibration is fitted within each training partition using restricted frozen folds. "
        text += "OOF temperature/threshold fitting never uses outer validation. Final fits use seeds 42/43/44.\n\n"
        if kind.startswith("embedding_"):
            text += "Original ModernBERT checkpoint/pooling and seven structural features match the existing XGBoost experiment. "
            text += "The original cache's passage-marker limitation is described in the fine-tuning section; no new cache is substituted into these completed comparisons. "
            text += "The structural features are passage character length, prompt character length, choice count, digit count, operator count, supplied-image indicator, and essential-image indicator. "
            text += "Cached vectors are reused; scaling is fitted on each fitting partition only. "
            text += "End-to-end inference bypasses feature caches.\n\n"
        elif kind != "finetune":
            text += "Word TF-IDF 1–2 grams and character TF-IDF 2–5 grams, capped at 30,000 features each. "
            text += "Vocabulary/IDF are fitted within training partitions. Naive Bayes uses inverse-frequency sample weights for balanced training.\n\n"
        manifest = result["dataset"]
        text += f"Dataset `{manifest['dataset_version']}`: {manifest['all']['questions']} eligible skill questions, "
        text += f"{sum(manifest['all']['verified_difficulty'].values())} verified difficulty labels; "
        text += f"{manifest['train']['questions']} train / {manifest['validation']['questions']} validation. "
        text += "Compiled PDF container exception, aliases, three exclusions, singleton groups, and missing-provenance imbalance "
        text += "remain exactly as audited in the original comparison. Evaluation retains natural distributions.\n\n"
        trial_rows = []
        if kind == "finetune":
            for i,r in enumerate(result["cv"]):
                trial_rows.append([r["task"],r["config"]["weighting"],i,json.dumps(r["config"]),
                    number(r["macro_f1_mean"]),number(r["macro_f1_std"]),number(r["log_loss_mean"]),f"{r['seconds']:.2f}"])
        else:
            for task in ["skill:reading_writing", "difficulty"]:
                for weight in ["ordinary", "balanced"]:
                    trials = json.loads((root / kind / f"study-{task.replace(':', '-')}-{weight}.json").read_text())
                    for trial in trials:
                        r = trial.get("result")
                        if r:
                            trial_rows.append([task, weight, trial["number"], json.dumps(trial["params"]),
                                number(r["macro_f1_mean"]), number(r["macro_f1_std"]), number(r["log_loss_mean"]), f"{r['seconds']:.2f}"])
        text += table(["Target", "Weight", "Trial", "Parameter", "CV F1", "SD", "Log loss", "Seconds"], trial_rows)
        text += "CV-selected weighting: `" + json.dumps(result["selected_weights"]) + "`.\n\n"
        text += table(["Target","Weight","Validation macro-F1 mean","Seed SD"],[
            [task,weight,number(float(np.mean([r["metrics"][task]["macro_f1"] for r in result["final"] if r["weighting"] == weight]))),
             number(float(np.std([r["metrics"][task]["macro_f1"] for r in result["final"] if r["weighting"] == weight],ddof=1)))]
            for task in ["skill:reading_writing","difficulty"] for weight in ["ordinary","balanced"]])
        for run in result["final"]:
            text += f"### {run['weighting']} — seed {run['seed']}\n\n"
            metrics = run["metrics"]
            text += table(["Target", "N", "Accuracy", "Balanced accuracy", "Macro-F1", "Weighted-F1", "Log loss", "Brier", "ECE", "F1 CI95"], [
                [task, m["count"], *[number(m[k]) for k in ["accuracy", "balanced_accuracy", "macro_f1", "weighted_f1", "log_loss", "brier", "ece"]], interval(m["macro_f1_ci95"])]
                for task, m in metrics.items() if task != "joint"])
            text += f"Joint correctness {number(metrics['joint']['both_correct'])} on {metrics['joint']['count']} questions. "
            text += f"Ordinal difficulty MAE {number(metrics['difficulty']['ordinal_error'])}; Easy↔Hard rate {number(metrics['difficulty']['extreme_error_rate'])}.\n\n"
            for task, m in metrics.items():
                if task == "joint":
                    continue
                text += f"**{task}**\n\n"
                text += table(["Class", "Support", "Precision", "Recall", "Recall CI95", "F1", "Small support"], [
                    [label, value["support"], number(value["precision"]), number(value["recall"]),
                     interval(value.get("recall_ci95")), number(value["f1"]), "Yes" if value["support"] < 20 else ""]
                    for label, value in m["per_class"].items()])
                text += "Confusion rows=true, columns=predicted.\n\n"
                text += table(["True / predicted", *m["confusion_labels"]], [[label, *counts]
                    for label, counts in zip(m["confusion_labels"], m["confusion_matrix"])])
                text += f"Threshold {number(m['policy']['threshold'])}; coverage {number(m['coverage'])}; "
                text += f"abstention {number(1-m['coverage'])}; retained precision {number(m['suggestion_precision'])}.\n\n"
                text += table(["Confidence", "Coverage", "Precision"], [[v["threshold"], number(v["coverage"]), number(v["precision"])] for v in m["reliability"]])
                if "long_input" in m:
                    text += f"Long-input slice (>4,000 characters): {m['long_input']['count']}; F1 {number(m['long_input'].get('macro_f1'))}.\n\n"
            text += f"Training seconds `{json.dumps(run['training_seconds'])}`; evaluation {run['evaluation_seconds']:.2f}s; reload parity passed.\n\n"
        b = result["benchmark"]
        artifact_manifest = root/kind/"selected-seed42/manifest.json"
        metadata = json.loads(artifact_manifest.read_text())
        text += "### Operational measurements\n\n"
        text += table(["Package","Version"],[[name,version] for name,version in sorted(metadata["environment"].items())])
        if kind == "finetune":
            text += f"Training hardware `{json.dumps(metadata['training_hardware'])}`; CPU serving measurements below were collected locally.\n\n"
            text += table(["Target","Training device","GPU","CUDA","Precision","Peak allocated MB","Peak reserved MB"],[
                [task,details['device'],details.get('gpu','N/A'),details.get('cuda_version','N/A'),
                 details.get('training_precision',details['dtype']),number(details.get('gpu_peak_allocated_mb')),
                 number(details.get('gpu_peak_reserved_mb'))] for task,details in metadata['training_details'].items()])
        if kind.startswith("embedding_"):
            extraction = json.loads((reference/"xgboost/embedding-timing.json").read_text())
            cache_bytes = sum(p.stat().st_size for p in (reference/"xgboost/embedding-cache").glob("*.npy"))
            text += f"Original frozen encoder revision `{metadata['encoder_revision']}`. "
            text += f"Historical training extraction {extraction['training_extraction_seconds']:.2f}s, encoder load "
            text += f"{extraction['encoder_load_seconds']:.2f}s. Shared completed cache {cache_bytes} bytes; "
            text += "these are inherited costs, not newly incurred extraction. Current cache-read preparation is measured below.\n\n"
        text += f"Hardware `{json.dumps(result['hardware'])}`. Code/dependencies are frozen before training. "
        text += "TF-IDF preparation is included in fit/evaluate times. Training feature-cache preparation "
        text += f"{result.get('feature_preparation_seconds',0):.2f}s; run wall time {result['elapsed_seconds']:.2f}s; "
        text += f"peak process memory {result['peak_memory_mb']:.2f}MB; artifact {b['artifact_bytes']} bytes; "
        text += f"load {b['load_seconds']:.2f}s; API startup {b['api_startup_seconds']:.2f}s.\n\n"
        text += "Peak RAM is the main experiment process high-water mark; the separate HTTP server child's peak RAM was not instrumented. CPU math threads are capped at eight per process.\n\n"
        if kind == 'embedding_svm':
            attempt = root/'embedding_svm-attempt1-auto-solver/attempt-status.json'
            if attempt.exists():
                total = result['elapsed_seconds']+sum(json.loads(p.read_text())['elapsed_seconds']
                    for p in root.glob('embedding_svm-attempt*/attempt-status.json'))
                text += f"Experiment wall time including the interrupted attempt: {total:.2f}s. The separately tabulated solver-probe fits are additional; probe startup was not instrumented.\n\n"
            log = root/'queue-embedding_svm.log'
            if log.exists():
                warnings = log.read_text(encoding='utf-8').count('ConvergenceWarning:')
                text += f"Restarted run emitted {warnings} convergence warnings at the iteration cap; these bounded fits are retained in the experiment record. "
                text += f"Inspect [training log](<{log.resolve().as_posix()}>) alongside the frozen selected configurations.\n\n"
        entries = [("Direct complete", b["direct"]), ("HTTP complete", b["api_serial"])]
        if b["tree_only"]:
            entries.append(("Classifier only", b["tree_only"]))
            text += f"Uncached classifier-only feature preparation {b['tree_only']['feature_preparation_seconds']:.2f}s is excluded from classifier-only latency.\n\n"
        text += table(["Path", "N", "p50 ms", "p95 ms", "p99 ms", "Questions/s"], [[name, m["requests"],
            *[f"{m[k]:.2f}" for k in ["p50_ms", "p95_ms", "p99_ms", "questions_per_second"]]] for name, m in entries])
        load = b["four_client_load"]
        text += f"100 questions: direct {b['direct_100_questions_seconds']:.2f}s, HTTP {b['api_100_questions_seconds']:.2f}s. "
        text += f"Four-client burst: {load['successful']} success / {load['busy_429']} busy / {load['other_errors']} unexpected errors; "
        text += f"{load['successful_questions_per_second']:.2f} successful questions/s. "
        text += "Ten warm-ups and three complete validation passes. Busy responses are not retried; burst throughput is not sustained capacity.\n\n"
        text += f"[Metrics and predictions](<{path.resolve().as_posix()}>) · [Configurations](<{(root/kind/'configuration-freeze.json').resolve().as_posix()}>) · "
        text += f"[Artifact lineage](<{artifact_manifest.resolve().as_posix()}>).\n\n"
        verification = root/kind/"serving-verification.json"
        if verification.exists():
            text += f"Private API authorization and direct/API prediction parity verified. [Serving checks](<{verification.resolve().as_posix()}>).\n\n"
    text += "## Comparison and recommendations\n\n"
    text += "The original baseline searched three C values and XGBoost four tree configurations; the new classical methods "
    text += "search twenty C/alpha trials per target/weight variant. This compares the approved model-and-tuning pipelines, "
    text += "not an isolated architecture effect under equal search budgets. Final-seed spread does not measure split uncertainty. "
    text += "These artifacts cover R&W only; Math and essential-image questions require separate validated models or manual classification.\n\n"
    references = [json.loads((reference/k/"results.json").read_text()) for k in ["baseline", "xgboost"]]
    text += table(["Method", "Skill F1", "Difficulty F1", "API p95 ms", "API questions/s"], [[r["method"],
        number(r["selected_metrics"]["skill:reading_writing"]["macro_f1"]), number(r["selected_metrics"]["difficulty"]["macro_f1"]),
        f"{r['benchmark']['api_serial']['p95_ms']:.2f}", f"{r['benchmark']['api_serial']['questions_per_second']:.2f}"] for r in references + results])
    groups = json.loads((reference/"dataset/groups.json").read_text())
    paired = {}
    for first,second in itertools.combinations(references+results,2):
        for task in ["skill:reading_writing", "difficulty"]:
            a,b = first['selected_predictions'][task],second['selected_predictions'][task]
            paired[f"{second['method']} minus {first['method']} / {task}"] = paired_macro_f1(a,b,groups)
    text += table(["Comparison / target", "Paired F1 difference CI95"], [[k,interval(v)] for k,v in paired.items()])
    effects = []
    for r in results:
        for task in ["skill:reading_writing","difficulty"]:
            values = {w:float(np.mean([s["metrics"][task]["macro_f1"] for s in r["final"] if s["weighting"] == w])) for w in ["ordinary","balanced"]}
            effects.append([r["method"],task,number(values["ordinary"]),number(values["balanced"]),number(values["balanced"]-values["ordinary"])])
    text += table(["Method","Target","Ordinary F1 mean","Balanced F1 mean","Balanced minus ordinary"],effects)
    text += "### Suggestion precision and coverage\n\n"
    text += "The 90% precision target is fitted using training OOF predictions; it is not a guarantee on new data. An unavailable threshold produces complete abstention.\n\n"
    text += "Retained-precision intervals are exact binomial 95% intervals for this singleton-group bank, conditional on the frozen policy; they do not cover source-domain shift.\n\n"
    text += table(["Method","Target","Validation coverage","Retained N","Retained precision","Precision CI95","Small retained N"],[
        [r['method'],task,number(r['selected_metrics'][task]['coverage']),
         retained_precision(r['selected_metrics'][task])[0],number(r['selected_metrics'][task]['suggestion_precision']),
         interval(retained_precision(r['selected_metrics'][task])[1]),
         'Yes' if retained_precision(r['selected_metrics'][task])[0] < 20 else '']
        for r in references+results for task in ['skill:reading_writing','difficulty']])
    if results:
        available = references+results
        strongest_skill = max(available,key=lambda r:r['selected_metrics']['skill:reading_writing']['macro_f1'])
        strongest_difficulty = max(available,key=lambda r:r['selected_metrics']['difficulty']['macro_f1'])
        text += f"Among completed pipelines, `{strongest_skill['method']}` has the highest observed skill macro-F1, "
        text += f"while `{strongest_difficulty['method']}` has the highest observed difficulty macro-F1. "
        text += "This is a descriptive comparison of already frozen configurations, not additional tuning on validation. "
        text += "Prefer a fast text pipeline when an encoder-based method does not provide a credible quality or coverage improvement. "
        if all(r['selected_metrics']['difficulty']['coverage'] == 0 for r in available):
            text += "Every completed pipeline abstains on all difficulty suggestions under its training-derived policy; retain manual difficulty labeling. "
        if not (root/'finetune/results.json').exists():
            text += "The fine-tuned candidate is still incomplete, so the recommendation is provisional. "
        text += "Keep the staging classifier unchanged until an explicit promotion decision and independent full-length evaluation.\n\n"
    text += "Paired group-bootstrap: 1,000 resamples, seed42. CIs do not account for source-domain shift or repeated model development. "
    text += "No method is promoted solely from these internal-bank results; require useful precision/coverage and independent full-length evidence.\n"
    text += "\nFor a later frozen-embedding experiment, GTE ModernBERT-base is the first suggested alternative; Jina embeddings v3 offers a classification adapter at higher cost. "
    text += f"These are researched candidates, not measured results here. [Evidence and experimental rationale](<{Path('ml-service/reports/embedding-candidate-research.md').resolve().as_posix()}>).\n"
    (root/"paired-comparison.json").write_text(json.dumps(paired,indent=2), encoding="utf-8")
    Path("ml-service/reports/classification-expanded-comparison.md").write_text(text, encoding="utf-8")
