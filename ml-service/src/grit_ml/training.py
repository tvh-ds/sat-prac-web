import importlib.metadata
import json
import subprocess
import time
from pathlib import Path

import mlflow
import numpy as np

from .artifacts import save_artifact
from .contracts import skill_domain
from .data import load_rows
from .evaluation import calibrate, fit_temperature, precision_threshold, report
from .models import Baseline


def evaluate_model(model, rows, policies):
    results = {}
    for task, classes in model.classes.items():
        selected = [r for r in rows if (not r.content.requires_image or model.supports_images and r.content.image_base64)
                    and (r.trusted_difficulty() if task == "difficulty" else r.skill and r.content.section == task.split(":")[1])]
        if not selected:
            results[task] = {"count": 0}
            continue
        y = [r.trusted_difficulty() if task == "difficulty" else r.skill for r in selected]
        probs = model.probabilities(task, [r.content for r in selected])
        policy = policies.get(task, {})
        if policy.get("temperature") is not None:
            probs = calibrate(probs, policy["temperature"])
        results[task] = report(y, probs, classes, policy.get("threshold"), [r.source_group for r in selected])
        results[task]["slices"] = {}
        slices = {"visual": lambda r: r.content.requires_image, "text": lambda r: not r.content.requires_image,
                  "long_passage": lambda r: len(r.content.passage) > 4000,
                  "math": lambda r: r.content.section == "math", "reading_writing": lambda r: r.content.section == "reading_writing"}
        for name, selector in slices.items():
            idx = [i for i, r in enumerate(selected) if selector(r)]
            results[task]["slices"][name] = report([y[i] for i in idx], probs[idx], classes, policy.get("threshold"),
                                                  [selected[i].source_group for i in idx])
        if task.startswith("skill:"):
            section = task.split(":")[1]
            domains = sorted({skill_domain(section, c) for c in classes})
            domain_probs = np.array([[sum(p[i] for i, c in enumerate(classes) if skill_domain(section, c) == d)
                                     for d in domains] for p in probs])
            results["domain:" + section] = report([r.domain for r in selected], domain_probs, domains,
                                                  policies.get("domain:" + section, {}).get("threshold"),
                                                  [r.source_group for r in selected])
    return results


def train(dataset, output, kind="baseline", seed=42, config=None):
    dataset, output = Path(dataset), Path(output)
    config = config or {}
    train_rows, validation = load_rows(dataset / "train.jsonl"), load_rows(dataset / "validation.jsonl")
    manifest = json.loads((dataset / "manifest.json").read_text())
    # Deliberately never read test.jsonl during training/tuning.
    mlflow.set_tracking_uri(config.get("tracking_uri", "sqlite:///mlflow.db"))
    mlflow.set_experiment("grit-question-classification")
    with mlflow.start_run() as run:
        start = time.perf_counter()
        if kind == "baseline":
            model = Baseline(seed).fit(train_rows)
        else:
            from .candidates import train_candidate
            model = train_candidate(kind, train_rows, validation, seed, config)
        if not model.classes:
            raise ValueError("No targets have at least two trustworthy training classes")
        policies = {}
        for task, classes in model.classes.items():
            selected = [r for r in validation if (not r.content.requires_image or model.supports_images and r.content.image_base64)
                        and (r.trusted_difficulty() if task == "difficulty" else r.skill and r.content.section == task.split(":")[1])]
            y = [r.trusted_difficulty() if task == "difficulty" else r.skill for r in selected]
            probs = model.probabilities(task, [r.content for r in selected]) if selected else np.empty((0, len(classes)))
            temp = fit_temperature(y, probs, classes)
            policies[task] = {"temperature": temp, "threshold": None}
            if temp is not None:
                calibrated = calibrate(probs, temp)
                policies[task]["threshold"] = precision_threshold(y, calibrated, classes)
                if task.startswith("skill:"):
                    section = task.split(":")[1]
                    domains = sorted({skill_domain(section, c) for c in classes})
                    dp = np.array([[sum(p[i] for i, c in enumerate(classes) if skill_domain(section, c) == d)
                                    for d in domains] for p in calibrated])
                    policies["domain:" + section] = {"threshold": precision_threshold([r.domain for r in selected], dp, domains)}
        metrics = evaluate_model(model, validation, policies)
        try:
            commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        except (OSError, subprocess.CalledProcessError):
            commit = "unknown"
        metadata = {"model_version": f"{kind}-{run.info.run_id}", "kind": kind, "seed": seed,
                    "dataset": manifest, "code_commit": commit, "run_id": run.info.run_id,
                    "policies": policies, "validation_metrics": metrics, "config": config,
                    "training_seconds": time.perf_counter() - start, "stage": "candidate",
                    "environment": {name: importlib.metadata.version(name) for name in ["numpy", "scikit-learn", "pydantic", "mlflow-skinny"]}}
        mlflow.log_params({"kind": kind, "seed": seed, "dataset_version": manifest["dataset_version"], "code_commit": commit})
        for task, values in metrics.items():
            for name in ["macro_f1", "ece", "coverage"]:
                if name in values:
                    mlflow.log_metric(task.replace(":", "_") + "_" + name, values[name])
        save_artifact(output, model, metadata)
        mlflow.log_artifacts(str(output), artifact_path="classifier")
        # Generic pyfunc wrapper exposes the same predictor used by FastAPI.
        from .registry import RegistryModel
        registered = mlflow.pyfunc.log_model(name="serving", python_model=RegistryModel(),
                                             artifacts={"classifier": str(output.resolve())},
                                             registered_model_name="grit-question-classifier")
        (output / "registry.json").write_text(json.dumps({"model_uri": registered.model_uri,
                                                         "version": registered.registered_model_version}), encoding="utf-8")
        return metadata
