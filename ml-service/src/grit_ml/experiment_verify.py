"""Verify saved real-corpus artifacts and enrich metrics without selecting on holdout."""
import json
from pathlib import Path

import mlflow
import numpy as np

from .artifacts import load_artifact
from .data import load_rows
from .evaluation import calibrate
from .experiment import TASKS, evaluate, target, write
from .experiment_report import render


def verify(root, kind):
    root = Path(root)
    folder = root / kind
    result = json.loads((folder / "results.json").read_text(encoding="utf-8"))
    rows = load_rows(root / "dataset/validation.jsonl")
    groups = json.loads((root / "dataset/groups.json").read_text())
    checks = []
    mlflow.set_tracking_uri("sqlite:///" + str((root / "mlflow.db").resolve()).replace("\\", "/"))
    for run in result["final"]:
        model, metadata = load_artifact(run["artifact"])
        for task in TASKS:
            golden = [r for r in rows if target(r, task)][:10]
            raw = model.probabilities(task, [r.content for r in golden])
            actual = calibrate(raw, metadata["policies"][task]["temperature"])
            stored = np.array([run["predictions"][task][r.id]["probabilities"] for r in golden])
            np.testing.assert_allclose(actual, stored, rtol=1e-6, atol=1e-7)
        # Re-evaluation adds class-recall intervals using the same frozen predictions/policies.
        run["metrics"], run["predictions"] = evaluate(model, rows, groups, metadata["policies"])
        with mlflow.start_run(run_id=metadata["run_id"]):
            mlflow.log_dict(run["metrics"], "final-validation.json")
            for task in TASKS:
                for name in ["macro_f1", "accuracy", "log_loss", "ece", "coverage"]:
                    mlflow.log_metric(task.replace(":", "_") + "_" + name, run["metrics"][task][name])
        write(folder / f"evaluation-{run['weighting']}-seed{run['seed']}.json", run)
        checks.append({"artifact": run["artifact"], "golden_per_target": 10, "reload_parity": "passed"})
    model, metadata = load_artifact(folder / "selected-seed42")
    result["selected_metrics"], result["selected_predictions"] = evaluate(model, rows, groups, metadata["policies"])
    result["verification"] = checks
    if kind == "xgboost" and (folder / "resume-audit.json").exists():
        resume = json.loads((folder / "resume-audit.json").read_text())
        result["resume_audit"] = resume
        if not result.get("prior_cv_time_included"):
            result["total_phase_seconds"] += resume["prior_completed_cv_seconds"]
            result["prior_cv_time_included"] = True
    write(folder / "results.json", result)
    render(root, Path("ml-service/reports"))
    print(f"Verified {len(checks)} {kind} artifacts and completed per-class confidence intervals", flush=True)


if __name__ == "__main__":
    import sys
    verify(sys.argv[1], sys.argv[2])
