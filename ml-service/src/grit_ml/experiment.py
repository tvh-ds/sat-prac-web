"""Approved reproducible CPU-only real-corpus experiment; baseline completes first."""
import argparse
import gc
import hashlib
import importlib.metadata
import itertools
import json
import os
import subprocess
import time
from pathlib import Path

import mlflow
import numpy as np
from sklearn.utils.class_weight import compute_sample_weight

from .artifacts import load_artifact, save_artifact
from .contracts import skill_domain
from .data import load_rows
from .evaluation import calibrate, fit_temperature, precision_threshold
from .experiment_benchmark import benchmark
from .experiment_data import prepare
from .experiment_metrics import basic, comprehensive, hardware, peak_memory_mb, timed
from .models import Baseline

TASKS = ["skill:reading_writing", "difficulty"]


def target(row, task):
    return row.skill if task.startswith("skill:") else row.trusted_difficulty()


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    temp = Path(str(path) + ".partial")
    temp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temp.replace(path)


def fit_task(kind, rows, task, config, weighting, seed, features=None, validation=None):
    labels = [target(r, task) for r in rows]
    classes = sorted(set(labels))
    if kind == "baseline":
        model = Baseline(seed, "balanced" if weighting == "balanced" else None, config["C"])
        model._fit(task, rows, lambda r: target(r, task))
        return model.estimators[task], classes, None
    from xgboost import XGBClassifier
    arguments = {"objective": "multi:softprob", "num_class": len(classes), "n_estimators": config.get("trees", 500),
                 "max_depth": config["max_depth"], "reg_lambda": config["reg_lambda"], "learning_rate": .05,
                 "subsample": .8, "colsample_bytree": .8, "random_state": seed, "n_jobs": 8, "tree_method": "hist"}
    if validation:
        arguments["early_stopping_rounds"] = 25
    estimator = XGBClassifier(**arguments)
    weights = compute_sample_weight("balanced", labels) if weighting == "balanced" else None
    fit_args = {"sample_weight": weights, "verbose": False}
    if validation:
        val_rows, val_features = validation
        fit_args["eval_set"] = [(val_features, np.array([classes.index(target(r, task)) for r in val_rows]))]
    estimator.fit(features, np.array([classes.index(y) for y in labels]), **fit_args)
    return estimator, classes, int(estimator.best_iteration + 1) if validation else config["trees"]


def predict(estimator, kind, rows, features=None):
    return estimator.predict_proba([r.content.text() for r in rows] if kind == "baseline" else features)


def cross_validate(kind, rows, fold_map, task, weighting, config, folder, features=None):
    classes = sorted({target(r, task) for r in rows})
    oof = np.zeros((len(rows), len(classes)))
    runs = []
    key = hashlib.sha256(json.dumps([kind, task, weighting, config], sort_keys=True).encode()).hexdigest()[:12]
    for fold in range(5):
        path = folder / f"cv-{key}-fold{fold}.json"
        fit_idx = [i for i, r in enumerate(rows) if fold_map[r.id] != fold]
        val_idx = [i for i, r in enumerate(rows) if fold_map[r.id] == fold]
        fit_rows, val_rows = [rows[i] for i in fit_idx], [rows[i] for i in val_idx]
        if path.exists():
            run = json.loads(path.read_text(encoding="utf-8"))
            if run["validation_ids"] != [r.id for r in val_rows]:
                raise ValueError("CV checkpoint belongs to a different split")
        else:
            print(f"{kind} {task} {weighting} {config} fold {fold + 1}/5", flush=True)
            start = time.perf_counter()
            estimator, actual, best_trees = fit_task(kind, fit_rows, task, config, weighting, 42,
                features[fit_idx] if features is not None else None,
                (val_rows, features[val_idx]) if features is not None else None)
            if actual != classes:
                raise ValueError("Fold missing a training class")
            probabilities = predict(estimator, kind, val_rows, features[val_idx] if features is not None else None)
            run = {"fold": fold, "validation_ids": [r.id for r in val_rows],
                   "probabilities": probabilities.tolist(), "seconds": time.perf_counter() - start,
                   "best_trees": best_trees, "scores": basic([target(r, task) for r in val_rows], probabilities, classes)}
            write(path, run)
        oof[val_idx] = np.array(run["probabilities"])
        runs.append(run)
    return {"config": config, "weighting": weighting, "task": task, "classes": classes,
            "macro_f1_mean": float(np.mean([r["scores"]["macro_f1"] for r in runs])),
            "macro_f1_std": float(np.std([r["scores"]["macro_f1"] for r in runs], ddof=1)),
            "log_loss_mean": float(np.mean([r["scores"]["log_loss"] for r in runs])),
            "seconds": sum(r["seconds"] for r in runs),
            "best_trees": [r["best_trees"] for r in runs], "oof": oof.tolist()}


def policies_for(task, rows, probabilities, classes):
    labels = [target(r, task) for r in rows]
    temperature = fit_temperature(labels, probabilities, classes)
    calibrated = calibrate(probabilities, temperature)
    policies = {task: {"temperature": temperature, "threshold": precision_threshold(labels, calibrated, classes),
                       "fitted_on": "training_out_of_fold_only"}}
    if task.startswith("skill:"):
        domains = sorted({skill_domain("reading_writing", c) for c in classes})
        dp = np.array([[sum(p[i] for i, c in enumerate(classes) if skill_domain("reading_writing", c) == d)
                        for d in domains] for p in calibrated])
        policies["domain:reading_writing"] = {"threshold": precision_threshold([r.domain for r in rows], dp, domains)}
    return policies


def evaluate(model, rows, groups, policies):
    scores, predictions = {}, {}
    computed = model.probabilities_many([r.content for r in rows]) if hasattr(model, "probabilities_many") else None
    for task in TASKS:
        selected = [i for i, r in enumerate(rows) if target(r, task)]
        eligible = [rows[i] for i in selected]
        raw = computed[task][selected] if computed is not None else model.probabilities(task, [r.content for r in eligible])
        calibrated = calibrate(raw, policies[task]["temperature"])
        classes = model.classes[task]
        y, group_ids = [target(r, task) for r in eligible], [groups[r.id] for r in eligible]
        scores[task] = comprehensive(y, calibrated, classes, policies[task]["threshold"], group_ids)
        scores[task]["uncalibrated"] = basic(y, raw, classes)
        scores[task]["policy"] = policies[task]
        idx = [i for i, r in enumerate(eligible) if len(r.content.passage) > 4000 or len(r.content.text()) > 4000]
        scores[task]["long_input"] = comprehensive([y[i] for i in idx], calibrated[idx], classes,
            policies[task]["threshold"], [group_ids[i] for i in idx]) if idx else {"count": 0}
        predictions[task] = {r.id: {"true": y[i], "predicted": classes[int(calibrated[i].argmax())],
                                  "probabilities": calibrated[i].tolist()} for i, r in enumerate(eligible)}
        if task.startswith("skill:"):
            domains = sorted({skill_domain("reading_writing", c) for c in classes})
            dp = np.array([[sum(p[i] for i, c in enumerate(classes) if skill_domain("reading_writing", c) == d)
                            for d in domains] for p in calibrated])
            scores["domain:reading_writing"] = comprehensive([r.domain for r in eligible], dp, domains,
                policies["domain:reading_writing"]["threshold"], group_ids)
            scores["domain:reading_writing"]["policy"] = policies["domain:reading_writing"]
    both = set(predictions[TASKS[0]]) & set(predictions["difficulty"])
    scores["joint"] = {"count": len(both), "both_correct": float(np.mean([
        all(predictions[t][i]["true"] == predictions[t][i]["predicted"] for t in TASKS) for i in both]))}
    return scores, predictions


def phase(kind, dataset, folder, report_folder):
    folder.mkdir(parents=True, exist_ok=True)
    completed = folder / "results.json"
    if completed.exists():
        return json.loads(completed.read_text(encoding="utf-8"))
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    started = time.perf_counter()
    train_rows = load_rows(dataset / "train.jsonl")
    fold_map = json.loads((dataset / "folds.json").read_text())
    groups = json.loads((dataset / "groups.json").read_text())
    encoder_model, train_features, embedding_seconds, revision = None, None, 0, None
    if kind == "xgboost":
        import torch
        from huggingface_hub import model_info

        from .candidates import TEXT_MODEL, EmbeddingsXGBoost
        torch.set_num_threads(min(8, os.cpu_count() or 1))
        revision_path = folder / "encoder-revision.json"
        if revision_path.exists():
            revision = json.loads(revision_path.read_text())["revision"]
        else:
            revision = model_info(TEXT_MODEL).sha
            write(revision_path, {"model": TEXT_MODEL, "revision": revision})
        encoder_model = EmbeddingsXGBoost({"text_revision": revision, "max_length": 1024, "images": False,
                                           "cache_dir": str((folder / "embedding-cache").resolve()), "use_cache": True})
        _, init_seconds = timed(encoder_model.initialize)
        from .cpu_profile import profile
        profile(encoder_model, train_rows, folder / "cpu-thread-profile.json")
        print("Frozen ModernBERT loaded; extracting training embeddings", flush=True)
        blocks, extraction = [], 0
        for offset in range(0, len(train_rows), 25):
            block, seconds = timed(lambda offset=offset: encoder_model.features([r.content for r in train_rows[offset:offset + 25]]))
            blocks.append(block)
            extraction += seconds
            print(f"training embeddings {min(offset + 25, len(train_rows))}/{len(train_rows)}", flush=True)
        train_features = np.concatenate(blocks)
        timing_path = folder / "embedding-timing.json"
        if timing_path.exists():
            original_timing = json.loads(timing_path.read_text())
            embedding_seconds = original_timing["encoder_load_seconds"] + original_timing["training_extraction_seconds"]
        else:
            embedding_seconds = init_seconds + extraction
            write(timing_path, {"encoder_load_seconds": init_seconds, "training_extraction_seconds": extraction,
                               "cache_entries": len(list((folder / "embedding-cache").glob("*.npy")))})
    grid = [{"C": c} for c in [.1, 1., 10.]] if kind == "baseline" else [
        {"max_depth": d, "reg_lambda": reg} for d, reg in itertools.product([3, 4], [1, 5])]
    experiments, winners, policies = [], {}, {}
    for task in TASKS:
        indices = [i for i, r in enumerate(train_rows) if target(r, task)]
        eligible = [train_rows[i] for i in indices]
        features = train_features[indices] if train_features is not None else None
        winners[task] = {}
        for weighting in ["ordinary", "balanced"]:
            candidates = [cross_validate(kind, eligible, fold_map, task, weighting, config, folder, features) for config in grid]
            experiments.extend(candidates)
            selected = min(candidates, key=lambda c: (-c["macro_f1_mean"], c["log_loss_mean"],
                            c["config"].get("C", c["config"].get("max_depth", 0)), -c["config"].get("reg_lambda", 0)))
            winners[task][weighting] = selected
            policies[(task, weighting)] = policies_for(task, eligible, np.array(selected["oof"]), selected["classes"])
    # This freeze happens before the first read of outer validation contents.
    freeze = {task: {weight: {k: v for k, v in result.items() if k != "oof"}
                    for weight, result in variants.items()} for task, variants in winners.items()}
    write(folder / "configuration-freeze.json", freeze)
    validation = load_rows(dataset / "validation.jsonl")
    final_rows, val_embedding_seconds = [], 0
    if encoder_model:
        _, val_embedding_seconds = timed(lambda: encoder_model.features([r.content for r in validation]))
    mlflow.set_tracking_uri("sqlite:///" + str((folder.parent / "mlflow.db").resolve()).replace("\\", "/"))
    mlflow.set_experiment("grit-real-corpus-cpu-80-20")
    artifact_paths = {}
    for weighting, seed in itertools.product(["ordinary", "balanced"], [42, 43, 44]):
        path = folder / f"{weighting}-seed{seed}"
        evaluation_path = folder / f"evaluation-{weighting}-seed{seed}.json"
        if path.exists():
            model, metadata = load_artifact(path)
        else:
            model = Baseline(seed) if kind == "baseline" else encoder_model
            model.estimators, model.classes = {}, {}
            fit_seconds, fitted_configs, model_policies = {}, {}, {}
            for task in TASKS:
                result = winners[task][weighting]
                config = dict(result["config"])
                if kind == "xgboost":
                    config["trees"] = int(np.median(result["best_trees"]))
                indices = [i for i, r in enumerate(train_rows) if target(r, task)]
                eligible = [train_rows[i] for i in indices]
                fitted, seconds = timed(lambda eligible=eligible, task=task, config=config, weighting=weighting, seed=seed, indices=indices: fit_task(kind, eligible, task, config, weighting, seed,
                                                        train_features[indices] if train_features is not None else None))
                estimator, classes, _ = fitted
                model.estimators[task], model.classes[task] = estimator, classes
                fit_seconds[task], fitted_configs[task] = seconds, config
                model_policies.update(policies[(task, weighting)])
            with mlflow.start_run() as run:
                metadata = {"model_version": f"cpu-{kind}-{weighting}-{seed}-{manifest['dataset_version']}",
                            "stage": "candidate", "kind": kind, "weighting": weighting, "seed": seed,
                            "dataset": manifest, "policies": model_policies, "configurations": fitted_configs,
                            "training_seconds": fit_seconds, "encoder_revision": revision, "run_id": run.info.run_id,
                            "hardware": hardware(), "code_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                            "working_tree_dirty": True,
                            "environment": {name: importlib.metadata.version(name) for name in ["numpy", "scikit-learn", "torch", "transformers", "xgboost", "mlflow-skinny"]}}
                mlflow.log_params({"method": kind, "weighting": weighting, "seed": seed, "dataset": manifest["dataset_version"]})
                save_artifact(path, model, metadata)
                reloaded, _ = load_artifact(path)
                for task in TASKS:
                    golden = [r.content for r in train_rows if target(r, task)][:10]
                    np.testing.assert_allclose(model.probabilities(task, golden), reloaded.probabilities(task, golden), rtol=1e-6, atol=1e-7)
                del reloaded
                mlflow.log_dict(metadata, "lineage.json")
                from .registry import RegistryModel
                registered = mlflow.pyfunc.log_model(name="serving", python_model=RegistryModel(),
                    artifacts={"classifier": str(path.resolve())}, registered_model_name="grit-cpu-comparison")
                write(path / "registry.json", {"model_uri": registered.model_uri, "version": registered.registered_model_version})
        if evaluation_path.exists():
            evaluation = json.loads(evaluation_path.read_text())
        else:
            (scores, predictions), evaluation_seconds = timed(lambda model=model, metadata=metadata: evaluate(model, validation, groups, metadata["policies"]))
            evaluation = {"weighting": weighting, "seed": seed, "metrics": scores, "predictions": predictions,
                          "training_seconds": metadata["training_seconds"], "evaluation_seconds": evaluation_seconds,
                          "artifact": str(path.resolve()), "model_version": metadata["model_version"]}
            write(evaluation_path, evaluation)
        with mlflow.start_run(run_id=metadata["run_id"]):
            mlflow.log_dict(evaluation["metrics"], "final-validation.json")
            for task in TASKS:
                for name in ["macro_f1", "accuracy", "log_loss", "ece", "coverage"]:
                    mlflow.log_metric(task.replace(":", "_") + "_" + name, evaluation["metrics"][task][name])
        final_rows.append(evaluation)
        artifact_paths[(weighting, seed)] = path
        print(f"{kind} final {weighting} seed {seed}: skill F1={evaluation['metrics'][TASKS[0]]['macro_f1']:.4f}; difficulty F1={evaluation['metrics']['difficulty']['macro_f1']:.4f}", flush=True)
    selected_weights = {task: min(winners[task], key=lambda w: (-winners[task][w]["macro_f1_mean"],
                        winners[task][w]["log_loss_mean"], w != "ordinary")) for task in TASKS}
    selected_path = folder / "selected-seed42"
    if not selected_path.exists():
        selected_model, selected_meta = load_artifact(artifact_paths[(selected_weights[TASKS[0]], 42)])
        difficulty_model, difficulty_meta = load_artifact(artifact_paths[(selected_weights["difficulty"], 42)])
        selected_model.estimators["difficulty"] = difficulty_model.estimators["difficulty"]
        selected_meta["policies"]["difficulty"] = difficulty_meta["policies"]["difficulty"]
        selected_meta["configurations"]["difficulty"] = difficulty_meta["configurations"]["difficulty"]
        selected_meta["training_seconds"]["difficulty"] = difficulty_meta["training_seconds"]["difficulty"]
        selected_meta.update(model_version=f"cpu-{kind}-selected-{manifest['dataset_version']}",
                             selected_weights=selected_weights, weighting="per_target_cv_selection")
        save_artifact(selected_path, selected_model, selected_meta)
        del selected_model, difficulty_model
        gc.collect()
    benchmark_path = folder / "benchmark.json"
    operational = json.loads(benchmark_path.read_text()) if benchmark_path.exists() else benchmark(selected_path, validation, folder)
    selected_model, selected_meta = load_artifact(selected_path)
    selected_scores, selected_predictions = evaluate(selected_model, validation, groups, selected_meta["policies"])
    results = {"complete": True, "method": kind, "dataset": manifest, "hardware": hardware(),
               "encoder_revision": revision, "embedding_seconds": embedding_seconds,
               "validation_embedding_seconds": val_embedding_seconds,
               "cache_bytes": sum(p.stat().st_size for p in (folder / "embedding-cache").glob("*.npy")),
               "cv": [{k: v for k, v in e.items() if k != "oof"} for e in experiments],
               "selected_weights": selected_weights, "final": final_rows, "selected_metrics": selected_scores,
               "selected_predictions": selected_predictions, "benchmark": operational,
               "total_phase_seconds": time.perf_counter() - started, "peak_memory_mb": peak_memory_mb()}
    if kind == "xgboost":
        results["encoder_thread_profile"] = json.loads((folder / "cpu-thread-profile.json").read_text())
        results["resumed_elapsed_seconds"] = results["total_phase_seconds"]
        results["total_phase_seconds"] += embedding_seconds
        results["runtime_note"] = "Resumed after encoder profiling; total adds initial encoder work to resumed wall time. Initial CV overhead is listed in accumulated fold times."
    write(completed, results)
    from .experiment_report import render
    render(folder.parent, report_folder)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["baseline", "xgboost"])
    parser.add_argument("--source", type=Path, default=Path("ml-service/datasets/raw/staging-bank-only-source-audited-v2.jsonl"))
    parser.add_argument("--root", type=Path, default=Path("ml-service/artifacts/cpu-comparison-v1"))
    args = parser.parse_args()
    for name in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"]:
        os.environ[name] = "8"
    dataset = args.root / "dataset"
    prepare(args.source, dataset)
    if args.phase == "xgboost" and not (args.root / "baseline/results.json").exists():
        parser.error("Complete baseline training, validation, benchmark, and report before XGBoost")
    phase(args.phase, dataset, args.root / args.phase, Path("ml-service/reports"))


if __name__ == "__main__":
    main()
