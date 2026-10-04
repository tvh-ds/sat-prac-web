import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from grit_ml.api import create_app
from grit_ml.artifacts import load_artifact
from grit_ml.contracts import TAXONOMY, LabeledQuestion, QuestionInput
from grit_ml.data import build_dataset, load_rows
from grit_ml.evaluation import precision_threshold, report
from grit_ml.predictor import Predictor
from grit_ml.training import train


def row(i):
    section = "math" if i % 2 else "reading_writing"
    domain = "Algebra" if section == "math" else "Information and Ideas"
    skill = TAXONOMY[section][domain][(i // 2) % 2]
    difficulty = [1, 3, 5][i % 3]
    return LabeledQuestion(id=f"q{i}", source_group=f"document{i}", content=QuestionInput(
        section=section, question_type="multiple_choice", prompt=f"{skill} {difficulty} fixture index {i}",
        choices=[f"{skill} choice alpha", "choice beta"]), domain=domain, skill=skill,
        difficulty=difficulty, difficulty_provenance="source")


@pytest.fixture(scope="module")
def artifact(tmp_path_factory):
    root = tmp_path_factory.mktemp("ml")
    source = root / "rows.jsonl"
    source.write_text("\n".join(row(i).model_dump_json() for i in range(500)), encoding="utf-8")
    dataset = root / "dataset"
    build_dataset(source, dataset)
    output = root / "baseline"
    train(dataset, output, config={"tracking_uri": "sqlite:///" + (root / "tracking.db").as_posix()})
    return dataset, output


def test_grouped_split_and_immutable_manifest(tmp_path):
    rows = [row(i) for i in range(100)]
    rows[1].passage_group = rows[2].passage_group = "shared-passage"
    rows[2].duplicate_group = rows[3].duplicate_group = "duplicate-chain"
    rows[3].passage_group = "different-database-id-a"
    rows[4].passage_group = "different-database-id-b"
    rows[3].content.passage = rows[4].content.passage = "Identical passage stored under two IDs."
    source = tmp_path / "source.jsonl"
    source.write_text("\n".join(r.model_dump_json() for r in rows), encoding="utf-8")
    build_dataset(source, tmp_path / "dataset")
    locations = {r.id: split for split in ["train", "validation", "test"] for r in load_rows(tmp_path / "dataset" / f"{split}.jsonl")}
    assert locations["q1"] == locations["q2"] == locations["q3"] == locations["q4"]
    with pytest.raises(ValueError, match="immutable"):
        build_dataset(source, tmp_path / "dataset")


def test_label_provenance_and_input_leakage():
    unverified = row(1).model_copy(update={"difficulty_provenance": "default"})
    assert unverified.trusted_difficulty() is None
    with pytest.raises(ValidationError):
        QuestionInput.model_validate({**row(1).content.model_dump(), "correct_answer": "A"})
    with pytest.raises(ValidationError):
        LabeledQuestion.model_validate({**row(1).model_dump(), "skill": "Inferences"})
    assert "document1" not in row(1).content.text()


def test_artifact_reload_api_and_abstention(artifact):
    _, output = artifact
    model, metadata = load_artifact(output)
    predictor = Predictor(model, metadata)
    request = row(9).content
    before = predictor.predict(request)
    after = Predictor(*load_artifact(output)).predict(request)
    assert before.skill == after.skill
    assert before.difficulty == after.difficulty
    client = TestClient(create_app(predictor, "t" * 32))
    assert client.post("/v1/classify", json=request.model_dump()).status_code in {401, 403}
    response = client.post("/v1/classify", json=request.model_dump(), headers={"Authorization": "Bearer " + "t" * 32})
    assert response.status_code == 200
    assert response.json()["model_version"] == metadata["model_version"]
    visual = predictor.predict(request.model_copy(update={"requires_image": True}))
    assert visual.skill.value is None
    assert visual.skill.abstention_reason == "essential_image_missing"
    invalid = client.post("/v1/classify", json={**request.model_dump(), "prompt": ""}, headers={"Authorization": "Bearer " + "t" * 32})
    assert invalid.status_code == 422
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["dataset"]["dataset_version"]
    assert (output / "registry.json").exists()


def test_thresholds_require_evidence_and_report_unknown_labels():
    assert precision_threshold(["a"], np.array([[0.99, 0.01]]), ["a", "b"]) is None
    result = report(["unseen"], np.array([[0.99, 0.01]]), ["a", "b"])
    assert result["accuracy"] == 0
    assert "unseen" in result["per_class"]
