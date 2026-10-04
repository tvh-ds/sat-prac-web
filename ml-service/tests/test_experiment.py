import hashlib
import json

import numpy as np
import pytest
from test_pipeline import row

from grit_ml.candidates import EmbeddingsXGBoost
from grit_ml.experiment import fit_task
from grit_ml.experiment_data import prepare
from grit_ml.predictor import Predictor


def test_frozen_multitarget_groups_and_provenance(tmp_path):
    rows = [row(i).model_dump() for i in range(200)]
    # Container-level source ID must not merge the entire bank.
    for r in rows:
        r["source_group"] = "compiled-bank"
    rows[1]["passage_group"] = rows[2]["passage_group"] = "shared"
    rows[2]["duplicate_group"] = rows[3]["duplicate_group"] = "dupe"
    rows[4]["skill"] = "central ideas and details"
    rows[5]["content"]["requires_image"] = True
    rows[6]["content"]["choices"] = []
    source = tmp_path / "source.jsonl"
    source.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    (tmp_path / "source.jsonl.manifest.json").write_text(json.dumps({"snapshot_sha256": checksum}))
    a, b = prepare(source, tmp_path / "a"), prepare(source, tmp_path / "b")
    assert a["checksums"] == b["checksums"]
    assert a["all"]["questions"] == 198
    assert any(e["reason"] == "invalid_input" for e in a["excluded"])
    assert a["normalizations"][0]["original_skill"] == "central ideas and details"
    groups = json.loads((tmp_path / "a/groups.json").read_text())
    assert groups["q1"] == groups["q2"] == groups["q3"]
    training = [json.loads(s) for s in (tmp_path / "a/train.jsonl").read_text().splitlines()]
    validation = [json.loads(s) for s in (tmp_path / "a/validation.jsonl").read_text().splitlines()]
    assert not {groups[r["id"]] for r in training} & {groups[r["id"]] for r in validation}
    assert abs(len(training) / 198 - .8) < .03
    folds = json.loads((tmp_path / "a/folds.json").read_text())
    assert set(folds.values()) == set(range(5))
    assert len({folds[r["id"]] for r in training if r["id"] in {"q1", "q2", "q3"}}) <= 1
    assert prepare(source, tmp_path / "a")["checksums"] == a["checksums"]
    (tmp_path / "a/train.jsonl").write_text("tampered")
    with pytest.raises(ValueError, match="Frozen split"):
        prepare(source, tmp_path / "a")


def test_loss_variants_fit_and_keep_training_vocabulary():
    rows = [row(i) for i in range(40) if i % 2 == 0]
    a, _, _ = fit_task("baseline", rows, "skill:reading_writing", {"C": 1}, "ordinary", 42)
    b, _, _ = fit_task("baseline", rows, "skill:reading_writing", {"C": 1}, "balanced", 42)
    assert a["classifier"].class_weight is None
    assert b["classifier"].class_weight == "balanced"
    assert "heldoutonly" not in a["features"].transformer_list[0][1].vocabulary_


def test_predictor_shares_candidate_features(monkeypatch):
    model = EmbeddingsXGBoost({"text_revision": "0" * 40})
    model.classes = {"skill:reading_writing": ["Central Ideas and Details", "Command of Evidence"], "difficulty": ["1", "3", "5"]}
    calls = []
    monkeypatch.setattr(model, "probabilities_many", lambda contents: calls.append(len(contents)) or {
        "skill:reading_writing": np.array([[.95, .05]]), "difficulty": np.array([[.95, .03, .02]])})
    policies = {task: {"temperature": 1., "threshold": .9} for task in model.classes}
    policies["domain:reading_writing"] = {"threshold": .9}
    prediction = Predictor(model, {"model_version": "fixture", "policies": policies}).predict(row(0).content)
    assert calls == [1]
    assert prediction.skill.value == "Central Ideas and Details"
    assert prediction.difficulty.value == 1


def test_encoder_frozen_cache_bypass_and_pinned_safe_loading(monkeypatch, tmp_path):
    import torch
    from transformers import AutoModel, AutoTokenizer

    from grit_ml import candidates
    encoder = torch.nn.Linear(8, 8)
    options = []
    monkeypatch.setattr(AutoModel, "from_pretrained", lambda *a, **kw: options.append(kw) or encoder)
    monkeypatch.setattr(AutoTokenizer, "from_pretrained", lambda *a, **kw: object())
    calls = []
    monkeypatch.setattr(candidates, "encode_question", lambda *a, **kw: calls.append(1) or torch.ones(1, 8))
    model = EmbeddingsXGBoost({"text_revision": "a" * 40, "cache_dir": str(tmp_path)})
    model.initialize()
    assert not any(parameter.requires_grad for parameter in encoder.parameters())
    assert options[0]["revision"] == "a" * 40
    assert options[0]["trust_remote_code"] is False
    assert options[0]["use_safetensors"] is True
    first = model.features([row(0).content])
    np.testing.assert_allclose(model.features([row(0).content]), first)
    assert len(calls) == 1
    model.config["use_cache"] = False
    np.testing.assert_allclose(model.features([row(0).content]), first)
    assert len(calls) == 2


def test_xgboost_balanced_weights_use_training_counts(monkeypatch):
    import xgboost
    received = []

    class Estimator:
        def __init__(self, **kwargs):
            assert kwargs["n_jobs"] == 8

        def fit(self, features, labels, **kwargs):
            received.append(kwargs["sample_weight"])

    monkeypatch.setattr(xgboost, "XGBClassifier", Estimator)
    training = [row(2 * i) for i in range(16)]
    for i, r in enumerate(training):
        r.skill = "Central Ideas and Details" if i < 12 else "Command of Evidence"
    config = {"max_depth": 3, "reg_lambda": 1, "trees": 10}
    for weighting in ["ordinary", "balanced"]:
        fit_task("xgboost", training, "skill:reading_writing", config, weighting, 42, np.ones((16, 8)))
    assert received[0] is None
    np.testing.assert_allclose(received[1][:12], 16 / (2 * 12))
    np.testing.assert_allclose(received[1][12:], 16 / (2 * 4))
