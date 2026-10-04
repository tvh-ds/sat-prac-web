import hashlib
import json
from pathlib import Path

import joblib

from .contracts import PREPROCESSING_VERSION, TAXONOMY_VERSION


def save_artifact(output, model, metadata):
    output = Path(output)
    if output.exists():
        raise ValueError("Artifact directories are immutable; choose a new version")
    output.mkdir(parents=True)
    joblib.dump(model, output / "model.joblib")
    metadata.update(taxonomy_version=TAXONOMY_VERSION, preprocessing_version=PREPROCESSING_VERSION)
    # Encoder checkpoints are packaged by candidate objects before serialization.
    metadata["sha256"] = hashlib.sha256((output / "model.joblib").read_bytes()).hexdigest()
    (output / "manifest.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def load_artifact(path):
    path = Path(path)
    metadata = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    if metadata["taxonomy_version"] != TAXONOMY_VERSION or metadata["preprocessing_version"] != PREPROCESSING_VERSION:
        raise ValueError("Artifact contract version mismatch")
    if metadata["sha256"] != hashlib.sha256((path / "model.joblib").read_bytes()).hexdigest():
        raise ValueError("Artifact checksum mismatch")
    # joblib is executable: load only operator-owned registry artifacts, never HTTP uploads.
    return joblib.load(path / "model.joblib"), metadata
