"""Post-run evidence audit; does not retrain, tune, or rewrite model artifacts."""
import hashlib
import json
from pathlib import Path

from .data import load_rows
from .experiment_data import prepare
from .experiment_report import render


def audit(root=Path("ml-service/artifacts/cpu-comparison-v1")):
    root = Path(root)
    source = Path("ml-service/datasets/raw/staging-bank-only-source-audited-v2.jsonl")
    manifest = prepare(source, root / "dataset")
    reproduced = prepare(source, root / "audit-reproduced-dataset")
    assert reproduced["checksums"] == manifest["checksums"]
    train = load_rows(root / "dataset/train.jsonl")
    validation = load_rows(root / "dataset/validation.jsonl")
    groups = json.loads((root / "dataset/groups.json").read_text())
    folds = json.loads((root / "dataset/folds.json").read_text())
    assert not {groups[r.id] for r in train} & {groups[r.id] for r in validation}
    assert not {r.id for r in train} & {r.id for r in validation}
    assert set(folds) == {r.id for r in train}
    expected_skills = {r.skill for r in train + validation}
    expected_difficulty = {r.trusted_difficulty() for r in train + validation} - {None}
    for fold in range(5):
        fitting = [r for r in train if folds[r.id] != fold]
        assert {r.skill for r in fitting} == expected_skills
        assert {r.trusted_difficulty() for r in fitting} - {None} == expected_difficulty
        assert not {groups[r.id] for r in fitting} & {groups[r.id] for r in train if folds[r.id] == fold}
    methods = {}
    for kind, expected_cv in [("baseline", 60), ("xgboost", 80)]:
        result = json.loads((root / kind / "results.json").read_text())
        assert result["complete"] and len(result["final"]) == 6
        assert len(result["verification"]) == 6
        assert result["dataset"]["checksums"] == manifest["checksums"]
        assert len(list((root / kind).glob("cv-*-fold*.json"))) == expected_cv
        benchmark = result["benchmark"]
        assert benchmark["warmup_requests"] == 10 and benchmark["passes"] == 3
        assert not benchmark["feature_cache_reads"]
        assert benchmark["four_client_load"]["other_errors"] == 0
        for task, predictions in result["selected_predictions"].items():
            eligible = {r.id for r in validation if r.skill} if task.startswith("skill:") else {
                r.id for r in validation if r.trusted_difficulty()}
            assert set(predictions) == eligible
        methods[kind] = {"final_artifacts": 6, "reload_checks": "passed", "completed_cv_folds": expected_cv,
                         "cache_free_benchmarks": "passed", "unexpected_http_errors": 0}
    paths = sorted([*Path("ml-service/src").rglob("*.py"), *Path("ml-service/tests").rglob("*.py"),
                    Path("ml-service/pyproject.toml"), Path("ml-service/uv.lock")])
    checksums = {p.as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    version = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest()[:16]
    snapshot = root / "verified-source" / version
    for path in paths:
        destination = snapshot / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            assert destination.read_bytes() == path.read_bytes()
        else:
            destination.write_bytes(path.read_bytes())
    evidence = {"dataset_version": manifest["dataset_version"], "reproducible_split_checksums": "passed",
                "outer_group_overlap": 0, "inner_group_overlap": 0, "supported_training_labels": "passed",
                "train_questions": len(train), "validation_questions": len(validation), "methods": methods,
                "source_snapshot": str(snapshot.resolve()), "source_checksums": checksums,
                "lineage_note": "Post-run verified source; dirty-source hashes were not recorded at fit start."}
    (root / "verification.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    render(root, Path("ml-service/reports"))
    report = Path("ml-service/reports/classification-comparison.md").read_text(encoding="utf-8")
    assert len([line for line in report.splitlines() if line.startswith("# ")]) == 3
    assert "Pending:" not in report
    print(json.dumps({k: v for k, v in evidence.items() if k != "source_checksums"}, indent=2))


if __name__ == "__main__":
    audit()
