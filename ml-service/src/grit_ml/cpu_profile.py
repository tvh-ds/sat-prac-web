import json
import time
from pathlib import Path

import numpy as np


def profile(model, rows, output):
    import torch
    path = Path(output)
    if path.exists():
        result = json.loads(path.read_text())
        torch.set_num_threads(result["selected_threads"])
        model.config["inference_threads"] = result["selected_threads"]
        return result
    questions = [r.content for r in rows[:2]]
    model.config["use_cache"] = True
    reference = model.features(questions)
    model.config["use_cache"] = False
    results = []
    for threads in [1, 2, 4, 8]:
        torch.set_num_threads(threads)
        times, error = [], 0
        for _ in range(3):
            start = time.perf_counter()
            actual = model.features(questions)
            times.append((time.perf_counter() - start) / len(questions))
            error = max(error, float(np.max(np.abs(actual-reference))))
            np.testing.assert_allclose(actual, reference, rtol=1e-5, atol=1e-5)
        results.append({"threads": threads, "median_question_seconds": float(np.median(times)),
                        "maximum_absolute_feature_error": error})
        print(f"CPU thread profile {threads}: {np.median(times):.3f} seconds/question", flush=True)
    best = min(results, key=lambda r: (r["median_question_seconds"], r["threads"]))
    result = {"selected_threads": best["threads"], "results": results, "probe": "first two training questions, 3 repeats",
              "reason": "reduce measured CPU encoder overhead; no labels or holdout used"}
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    model.config.update(use_cache=True, inference_threads=best["threads"])
    torch.set_num_threads(best["threads"])
    return result
