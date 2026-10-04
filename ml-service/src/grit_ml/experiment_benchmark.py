import concurrent.futures
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .artifacts import load_artifact
from .experiment_metrics import latency_summary, peak_memory_mb, timed
from .predictor import Predictor


def benchmark(artifact, rows, output):
    output = Path(output)
    model_meta, load_seconds = timed(lambda: load_artifact(artifact))
    model, metadata = model_meta
    if hasattr(model, "config"):
        model.config["use_cache"] = False
    predictor = Predictor(model, metadata)
    questions = [r.content for r in rows]
    for q in questions[:10]:
        predictor.predict(q)
    direct = []
    for repeat in range(3):
        for i, question in enumerate(questions):
            _, seconds = timed(lambda question=question: predictor.predict(question))
            direct.append(seconds)
            if i and i % 100 == 0:
                print(f"direct benchmark pass {repeat + 1}: {i}/{len(questions)}", flush=True)
    hundred = []
    for question in (questions * 2)[:100]:
        _, seconds = timed(lambda question=question: predictor.predict(question))
        hundred.append(seconds)
    tree_only = None
    if hasattr(model, "features"):
        features, preparation = timed(lambda: model.features(questions))
        times = []
        for _ in range(3):
            for i in range(len(questions)):
                _, seconds = timed(lambda i=i: [e.predict_proba(features[i:i + 1]) for e in model.estimators.values()])
                times.append(seconds)
        tree_only = {**latency_summary(times), "feature_preparation_seconds": preparation,
                     "excludes_encoder_and_api": True}
    token = secrets.token_hex(32)
    port = 18083
    env = {**os.environ, "ML_SERVICE_TOKEN": token, "ML_ARTIFACT_PATH": str(Path(artifact).resolve()),
           "GRIT_BENCHMARK_NO_CACHE": "1", "OMP_NUM_THREADS": "8", "MKL_NUM_THREADS": "8"}
    log = (output / "benchmark-api.log").open("w", encoding="utf-8")
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "grit_ml.api:create_app", "--factory",
                                "--host", "127.0.0.1", "--port", str(port), "--no-access-log"], env=env,
                               stdout=log, stderr=log)

    def request(path, question=None):
        body = question.model_dump_json().encode() if question else None
        req = urllib.request.Request(f"http://127.0.0.1:{port}" + path, data=body,
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        start = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                response.read()
                return response.status, time.perf_counter() - start
        except urllib.error.HTTPError as error:
            return error.code, time.perf_counter() - start

    try:
        start = time.perf_counter()
        while True:
            if process.poll() is not None:
                raise RuntimeError("Benchmark API failed; inspect private log")
            try:
                if request("/health")[0] == 200:
                    break
            except (OSError, urllib.error.URLError):
                pass
            if time.perf_counter() - start > 120:
                raise TimeoutError("Benchmark service startup exceeded 120 seconds")
            time.sleep(.2)
        startup = time.perf_counter() - start
        for question in questions[:10]:
            assert request("/v1/classify", question)[0] == 200
        serial = []
        for repeat in range(3):
            for i, question in enumerate(questions):
                status, seconds = request("/v1/classify", question)
                if status != 200:
                    raise RuntimeError(f"Serial API benchmark returned {status}")
                serial.append(seconds)
                if i and i % 100 == 0:
                    print(f"API benchmark pass {repeat + 1}: {i}/{len(questions)}", flush=True)
        start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            concurrent_results = list(pool.map(lambda q: request("/v1/classify", q), questions * 3))
        duration = time.perf_counter() - start
        successes = [seconds for status, seconds in concurrent_results if status == 200]
        load = {"clients": 4, "attempts": len(concurrent_results), "successful": len(successes),
                "busy_429": sum(status == 429 for status, _ in concurrent_results),
                "other_errors": sum(status not in {200, 429} for status, _ in concurrent_results),
                "elapsed_seconds": duration, "successful_questions_per_second": len(successes) / duration,
                "successful_latency": latency_summary(successes) if successes else None}
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        log.close()
    result = {"artifact": str(artifact), "load_seconds": load_seconds, "api_startup_seconds": startup,
              "artifact_bytes": sum(p.stat().st_size for p in Path(artifact).rglob("*") if p.is_file()),
              "peak_process_memory_mb": peak_memory_mb(), "warmup_requests": 10, "passes": 3,
              "feature_cache_reads": False, "direct": latency_summary(direct), "api_serial": latency_summary(serial),
              "direct_100_questions_seconds": sum(hundred), "api_100_questions_seconds": sum(serial[:100]),
              "four_client_load": load, "tree_only": tree_only}
    (output / "benchmark.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result
