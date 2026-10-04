"""Verify complete candidate serving artifacts without retuning on validation."""
import argparse
import os
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from .api import create_app
from .artifacts import load_artifact
from .data import load_rows
from .experiment import TASKS, write
from .predictor import Predictor


def verify(method):
    folder = Path("ml-service/artifacts/cpu-expanded-v1")/method
    model,metadata = load_artifact(folder/"selected-seed42")
    rows = load_rows(Path("ml-service/artifacts/cpu-comparison-v1/dataset/validation.jsonl"))[:10]
    contents = [r.content for r in rows]
    raw = {t:model.probabilities(t,contents) for t in TASKS}
    cache_verified = False
    if hasattr(model,"features"):
        model.config["use_cache"] = False
        with patch("numpy.load",side_effect=AssertionError("Disabled inference cache was read")), \
             patch("numpy.save",side_effect=AssertionError("Disabled inference cache was written")):
            direct = model.probabilities_many(contents)
        for task in TASKS:
            np.testing.assert_allclose(raw[task],direct[task],rtol=1e-4,atol=1e-5)
            np.testing.assert_array_equal(raw[task].argmax(1),direct[task].argmax(1))
        cache_verified = True
    os.environ["GRIT_BENCHMARK_NO_CACHE"] = "1"
    predictor = Predictor(model,metadata)
    client = TestClient(create_app(predictor,"g"*32))
    question = contents[0]
    assert client.post("/v1/classify",json=question.model_dump()).status_code in {401,403}
    response = client.post("/v1/classify",json=question.model_dump(),headers={"Authorization":"Bearer "+"g"*32})
    assert response.status_code == 200
    expected,actual = predictor.predict(question).model_dump(),response.json()
    for field in ["skill","domain","difficulty"]:
        assert actual[field]["value"] == expected[field]["value"]
        assert actual[field]["abstention_reason"] == expected[field]["abstention_reason"]
        np.testing.assert_allclose(list(actual[field]["probabilities"].values()),list(expected[field]["probabilities"].values()),rtol=1e-6,atol=1e-7)
    assert actual["input_hash"] == expected["input_hash"]
    assert actual["model_version"] == expected["model_version"]
    write(folder/"serving-verification.json",{"goldens":len(rows),"api_direct_parity":"passed","authorization":"passed",
        "cache_bypass_and_numerical_parity":"passed" if cache_verified else "not applicable","no_retuning":True})
    print(f"Verified {method} private API, authorization, and serving parity",flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("method")
    verify(parser.parse_args().method)
