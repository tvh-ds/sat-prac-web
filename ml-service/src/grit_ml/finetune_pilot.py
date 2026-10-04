"""Training-only CPU feasibility pilot, prior to any full ModernBERT fine-tuning."""
import json
import math
import time
from pathlib import Path

import numpy as np

from .data import load_rows
from .experiment import TASKS, target, write
from .experiment_metrics import hardware, peak_memory_mb
from .finetune import train_target


def run():
    reference = Path("ml-service/artifacts/cpu-comparison-v1")
    output = Path("ml-service/artifacts/cpu-expanded-v1/finetune")
    output.mkdir(parents=True, exist_ok=True)
    rows = [r for r in load_rows(reference / "dataset/train.jsonl") if r.trusted_difficulty()]
    rng = np.random.default_rng(42)
    by_skill = {}
    for row in rows:
        by_skill.setdefault(row.skill, []).append(row)
    chosen = []
    for skill in sorted(by_skill):
        candidates = by_skill[skill]
        chosen.extend([candidates[i] for i in rng.choice(len(candidates),size=8,replace=False)])
    ids = {r.id for r in chosen}
    chosen.extend(sorted([r for r in rows if r.id not in ids], key=lambda r: (-len(r.content.text()),r.id))[:48])
    revision = json.loads((reference/"xgboost/encoder-revision.json").read_text())["revision"]
    started = time.perf_counter()
    measured = {}
    try:
        for task in TASKS:
            model, classes, result = train_target(chosen, chosen[:32], task, revision,
                {"learning_rate": 2e-5,"weighting":"ordinary","epochs":1},42,output/task.replace(":","-"),
                max_seconds=max(1,1800-(time.perf_counter()-started)))
            # Pilot validation is training-only timing input, never used for model selection.
            measured[task] = {"classes":classes, **result}
            del model
    except TimeoutError as error:
        write(output/"pilot.json", {"decision":"free_colab_gpu", "pilot_completed":False,
            "pilot_seconds":time.perf_counter()-started,"reason":str(error),"targets":measured,
            "encoder_revision":revision,"no_outer_validation_used":True,"hardware":hardware(),
            "runtime_threshold_hours":12,"pilot_budget_seconds":1800})
        return
    counts = {task:sum(bool(target(r,task)) for r in load_rows(reference/"dataset/train.jsonl")) for task in TASKS}
    projected = time.perf_counter()-started
    for task in TASKS:
        measured_time = measured[task]["timings"]
        train_per_question = measured_time["train_seconds"]/len(chosen)
        eval_per_question = measured_time["evaluation_seconds"]/32
        # 20 CV fits per target (2 LR x 2 weights x 5 folds), six final fits per target.
        projected += train_per_question*(20*counts[task]*.8*3 + 6*counts[task]*3)
        projected += eval_per_question*(20*counts[task]*.2*3 + 6*341 + 6*341*3)
        # Include cold checkpoint loading and optimizer-state writes every 50 updates plus epoch boundaries.
        projected += measured_time["loading_seconds"]*26
        checkpoint_count = 3*(20*(math.ceil(counts[task]*.8/16)//50+1)+6*(math.ceil(counts[task]/16)//50+1))
        projected += measured_time["checkpoint_seconds"]*checkpoint_count
    projected *= 1.25
    report = {"pilot_completed":True,"pilot_questions":len(chosen),"selection":"8 per skill plus 48 longest remaining training questions",
        "no_outer_validation_used":True,"encoder_revision":revision,"hardware":hardware(),"targets":measured,
        "pilot_seconds":time.perf_counter()-started,"projected_seconds_with_margin":projected,
        "projected_hours":projected/3600,"runtime_threshold_hours":12,
        "decision":"cpu" if projected <= 12*3600 else "free_colab_gpu",
        "peak_memory_mb":peak_memory_mb(),"projection_note":"Conservative 3-epoch schedule, timing inputs include long questions; not a runtime guarantee."}
    write(output/"pilot.json",report)
    print(json.dumps(report,indent=2),flush=True)


if __name__ == "__main__":
    run()
