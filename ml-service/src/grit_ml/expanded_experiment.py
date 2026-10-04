"""Sequential, resumable Optuna comparison on the approved frozen real corpus."""
import argparse
import hashlib
import importlib.metadata
import json
import os
import pickle
import time
from pathlib import Path

import mlflow
import numpy as np
import optuna

from .artifacts import load_artifact, save_artifact
from .classical import EmbeddingClassical, TextClassical, fit_estimator
from .data import load_rows
from .experiment import TASKS, evaluate, policies_for, target, write
from .experiment_benchmark import benchmark
from .experiment_data import prepare
from .experiment_metrics import basic, hardware, peak_memory_mb, timed
from .registry import RegistryModel

METHODS = ["tfidf_svm", "tfidf_nb", "embedding_lr", "embedding_svm"]
REFERENCE = Path("ml-service/artifacts/cpu-comparison-v1")
ROOT = Path("ml-service/artifacts/cpu-expanded-v1")


def code_lineage(root):
    sources = ["classical", "expanded_experiment", "experiment", "experiment_metrics", "experiment_benchmark",
               "models", "candidates", "data", "contracts", "artifacts", "evaluation", "predictor", "api", "registry"]
    paths = sorted([*[Path(f"ml-service/src/grit_ml/{name}.py") for name in sources], Path("ml-service/uv.lock"),
                    Path("ml-service/pyproject.toml")])
    hashes = {p.as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    version = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:16]
    destination = root / "source" / version
    for path in paths:
        copied = destination / path
        copied.parent.mkdir(parents=True, exist_ok=True)
        if copied.exists():
            if copied.read_bytes() != path.read_bytes():
                raise ValueError("Immutable code snapshot changed")
        else:
            copied.write_bytes(path.read_bytes())
    return {"version": version, "hashes": hashes, "snapshot": str(destination.resolve())}


def cv_trial(kind, rows, task, value, weighting, folds, folder, features=None):
    classes = sorted({target(r, task) for r in rows})
    oof = np.zeros((len(rows), len(classes)))
    scores = []
    key = hashlib.sha256(json.dumps([kind, task, value, weighting]).encode()).hexdigest()[:16]
    for fold in range(5):
        path = folder / f"cv-{key}-fold{fold}.json"
        fit = [i for i, r in enumerate(rows) if folds[r.id] != fold]
        held = [i for i, r in enumerate(rows) if folds[r.id] == fold]
        if path.exists():
            result = json.loads(path.read_text())
            if result["ids"] != [rows[i].id for i in held]:
                raise ValueError("CV checkpoint split mismatch")
        else:
            start = time.perf_counter()
            model, actual = fit_estimator(kind, [rows[i] for i in fit], task, value, weighting, 42, folds,
                                         features[fit] if features is not None else None)
            if actual != classes:
                raise ValueError("CV fitting labels incomplete")
            x = features[held] if features is not None else [rows[i].content.text() for i in held]
            probabilities = model.predict_proba(x)
            result = {"ids": [rows[i].id for i in held], "probabilities": probabilities.tolist(),
                      "seconds": time.perf_counter() - start,
                      "scores": basic([target(rows[i], task) for i in held], probabilities, classes)}
            write(path, result)
        oof[held] = result["probabilities"]
        scores.append(result)
    return {"task": task, "weighting": weighting, "parameter": value, "classes": classes,
            "macro_f1_mean": float(np.mean([r["scores"]["macro_f1"] for r in scores])),
            "macro_f1_std": float(np.std([r["scores"]["macro_f1"] for r in scores], ddof=1)),
            "log_loss_mean": float(np.mean([r["scores"]["log_loss"] for r in scores])),
            "seconds": sum(r["seconds"] for r in scores), "oof": oof.tolist()}


def tune(kind, rows, task, weight, folds, folder, features):
    parameter = "alpha" if kind == "tfidf_nb" else "C"
    name = f"{kind}-{task}-{weight}"
    # An artifact-folder restart must never inherit trials from a different code/solver lineage.
    storage = "sqlite:///" + str((folder / "optuna.db").resolve()).replace("\\", "/")
    sampler_path = folder / f"sampler-{task.replace(':', '-')}-{weight}.pkl"
    sampler = pickle.loads(sampler_path.read_bytes()) if sampler_path.exists() else optuna.samplers.TPESampler(seed=42)
    study = optuna.create_study(study_name=name, storage=storage, load_if_exists=True,
                               sampler=sampler, direction="maximize")
    if not study.trials:
        for value in [.1, 1., 10.]:
            study.enqueue_trial({parameter: value})
    # Interrupted RUNNING trials are explicitly failed, with fold checkpoints retained.
    for trial in study.get_trials(states=(optuna.trial.TrialState.RUNNING,)):
        study.tell(trial.number, state=optuna.trial.TrialState.FAIL)
        study.enqueue_trial(trial.params)
    while len([t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]) < 20:
        trial = study.ask()
        value = trial.suggest_float(parameter, .001, 100., log=True)
        sampler_path.write_bytes(pickle.dumps(study.sampler))
        print(f"{name} trial {trial.number + 1}: {parameter}={value:.6g}", flush=True)
        try:
            result = cv_trial(kind, rows, task, value, weight, folds, folder, features)
            trial.set_user_attr("result", {k: v for k, v in result.items() if k != "oof"})
            with mlflow.start_run(run_name=name + f"-trial{trial.number}"):
                mlflow.log_params({"method": kind, "target": task, "weighting": weight, parameter: value})
                mlflow.log_metrics({k: result[k] for k in ["macro_f1_mean", "macro_f1_std", "log_loss_mean", "seconds"]})
            study.tell(trial, result["macro_f1_mean"])
        except Exception:
            study.tell(trial, state=optuna.trial.TrialState.FAIL)
            sampler_path.write_bytes(pickle.dumps(study.sampler))
            raise
        sampler_path.write_bytes(pickle.dumps(study.sampler))
    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    best = min(completed, key=lambda t: (-t.value, t.user_attrs["result"]["log_loss_mean"],
                                       -t.params[parameter] if parameter == "alpha" else t.params[parameter]))
    result = cv_trial(kind, rows, task, best.params[parameter], weight, folds, folder, features)
    write(folder / f"study-{task.replace(':', '-')}-{weight}.json", [
        {"number": t.number, "state": t.state.name, "params": t.params, "value": t.value,
         "result": t.user_attrs.get("result")} for t in study.trials])
    return result


def run(kind):
    folder = ROOT / kind
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / "results.json").exists():
        return
    start = time.perf_counter()
    dataset = REFERENCE / "dataset"
    manifest = prepare(Path("ml-service/datasets/raw/staging-bank-only-source-audited-v2.jsonl"), dataset)
    lineage = code_lineage(ROOT)
    state = {"dataset_version": manifest["dataset_version"], "code_version": lineage["version"], "trials": 20}
    run_manifest = folder / "experiment-manifest.json"
    if run_manifest.exists() and json.loads(run_manifest.read_text()) != state:
        raise ValueError("Experiment source/config changed; use a new experiment version")
    write(run_manifest, state)
    rows = load_rows(dataset / "train.jsonl")
    folds = json.loads((dataset / "folds.json").read_text())
    groups = json.loads((dataset / "groups.json").read_text())
    embedding, features, feature_seconds = None, None, 0
    if kind.startswith("embedding_"):
        reference, reference_meta = load_artifact(REFERENCE / "xgboost/selected-seed42")
        embedding = EmbeddingClassical.from_reference(reference)
        embedding.config["use_cache"] = True
        features, feature_seconds = timed(lambda: embedding.features([r.content for r in rows]))
        del reference
    mlflow.set_tracking_uri("sqlite:///" + str((ROOT / "mlflow.db").resolve()).replace("\\", "/"))
    mlflow.set_experiment("grit-expanded-classical")
    winners, policies = {}, {}
    for task in TASKS:
        indices = [i for i, row in enumerate(rows) if target(row, task)]
        eligible = [rows[i] for i in indices]
        winners[task] = {}
        for weight in ["ordinary", "balanced"]:
            result = tune(kind, eligible, task, weight, folds, folder, features[indices] if features is not None else None)
            winners[task][weight] = {k: v for k, v in result.items() if k != "oof"}
            policies[(task, weight)] = policies_for(task, eligible, np.array(result["oof"]), result["classes"])
    write(folder / "configuration-freeze.json", winners)
    validation = load_rows(dataset / "validation.jsonl")
    finals = []
    for weight in ["ordinary", "balanced"]:
        for seed in [42, 43, 44]:
            path = folder / f"{weight}-seed{seed}"
            evaluation_path = folder / f"evaluation-{weight}-seed{seed}.json"
            if path.exists():
                model, metadata = load_artifact(path)
            else:
                model = EmbeddingClassical.from_reference(embedding) if embedding else TextClassical()
                training, model_policies = {}, {}
                for task in TASKS:
                    indices = [i for i, row in enumerate(rows) if target(row, task)]
                    (estimator, classes), seconds = timed(lambda task=task, indices=indices, weight=weight, seed=seed: fit_estimator(
                        kind, [rows[i] for i in indices], task, winners[task][weight]["parameter"], weight, seed,
                        folds, features[indices] if features is not None else None))
                    model.estimators[task], model.classes[task] = estimator, classes
                    training[task] = seconds
                    model_policies.update(policies[(task, weight)])
                metadata = {"model_version": f"{kind}-{weight}-{seed}-{manifest['dataset_version']}",
                    "kind": kind, "stage": "candidate", "dataset": manifest, "policies": model_policies,
                    "code_lineage": lineage, "seed": seed, "weighting": weight, "training_seconds": training,
                    "encoder_revision": reference_meta["encoder_revision"] if embedding else None,
                    "environment": {p: importlib.metadata.version(p) for p in ["scikit-learn", "numpy", "optuna", "torch", "transformers"]}}
                with mlflow.start_run(run_name=f"{kind}-{weight}-{seed}") as run:
                    metadata["run_id"] = run.info.run_id
                    save_artifact(path, model, metadata)
                    registered = mlflow.pyfunc.log_model(name="serving", python_model=RegistryModel(),
                        artifacts={"classifier": str(path.resolve())}, registered_model_name="grit-expanded-classical")
                    write(path / "registry.json", {"uri": registered.model_uri, "version": registered.registered_model_version})
            if evaluation_path.exists():
                evaluation = json.loads(evaluation_path.read_text())
            else:
                (scores, predictions), seconds = timed(lambda model=model, metadata=metadata: evaluate(model, validation, groups, metadata["policies"]))
                reloaded, _ = load_artifact(path)
                for task in TASKS:
                    goldens = [r.content for r in validation if target(r, task)][:10]
                    np.testing.assert_allclose(model.probabilities(task, goldens), reloaded.probabilities(task, goldens), rtol=1e-6)
                evaluation = {"weighting": weight, "seed": seed, "metrics": scores, "predictions": predictions,
                    "training_seconds": metadata["training_seconds"], "evaluation_seconds": seconds,
                    "artifact": str(path.resolve()), "reload_parity": "passed"}
                write(evaluation_path, evaluation)
                with mlflow.start_run(run_id=metadata["run_id"]):
                    mlflow.log_dict(scores, "final-validation.json")
            finals.append(evaluation)
            print(f"{kind} final {weight} seed{seed}: skill={evaluation['metrics'][TASKS[0]]['macro_f1']:.4f}, difficulty={evaluation['metrics']['difficulty']['macro_f1']:.4f}", flush=True)
    selected = {task: min(winners[task], key=lambda w: (-winners[task][w]["macro_f1_mean"],
                winners[task][w]["log_loss_mean"], w != "ordinary")) for task in TASKS}
    path = folder / "selected-seed42"
    if not path.exists():
        model, metadata = load_artifact(folder / f"{selected[TASKS[0]]}-seed42")
        other, other_meta = load_artifact(folder / f"{selected['difficulty']}-seed42")
        model.estimators["difficulty"] = other.estimators["difficulty"]
        metadata["policies"]["difficulty"] = other_meta["policies"]["difficulty"]
        metadata.update(model_version=f"{kind}-selected-{manifest['dataset_version']}", selected_weights=selected)
        save_artifact(path, model, metadata)
    model, metadata = load_artifact(path)
    selected_scores, selected_predictions = evaluate(model, validation, groups, metadata["policies"])
    benchmark_path = folder / "benchmark.json"
    operational = json.loads(benchmark_path.read_text()) if benchmark_path.exists() else benchmark(path, validation, folder)
    result = {"complete": True, "method": kind, "dataset": manifest, "selected_weights": selected,
        "configurations": winners, "final": finals, "selected_metrics": selected_scores,
        "selected_predictions": selected_predictions, "benchmark": operational, "hardware": hardware(),
        "feature_preparation_seconds": feature_seconds, "elapsed_seconds": time.perf_counter() - start,
        "peak_memory_mb": peak_memory_mb(), "code_lineage": lineage}
    write(folder / "results.json", result)
    from .expanded_report import render
    render(ROOT, REFERENCE)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("method", choices=METHODS)
    args = parser.parse_args()
    for key in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"]:
        os.environ[key] = "8"
    run(args.method)


if __name__ == "__main__":
    main()
