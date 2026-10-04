"""Bounded CV/final fine-tuning on CPU or an explicitly authorized free GPU."""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import shutil
import time
from pathlib import Path

import mlflow
import numpy as np

from .artifacts import load_artifact, save_artifact
from .data import load_rows
from .experiment import TASKS, evaluate, policies_for, target, write
from .experiment_benchmark import benchmark
from .experiment_metrics import basic, hardware, peak_memory_mb
from .finetune import FINETUNE_PREPROCESSING_VERSION, FineTunedModernBert, train_target
from .registry import RegistryModel


def remove_completed_checkpoint(path, folder):
    resolved, root = Path(path).resolve(), Path(folder).resolve()
    if resolved == root or not resolved.is_relative_to(root):
        raise ValueError("Checkpoint cleanup escaped experiment directory")
    evidence = resolved/"training.json"
    if not evidence.exists() or json.loads(evidence.read_text()).get("best_epoch",0) < 1:
        raise ValueError("Checkpoint cleanup lacks completed training evidence")
    shutil.rmtree(resolved)


def lineage(folder):
    paths = sorted(Path("ml-service/src/grit_ml").glob("*.py")) + [Path("ml-service/pyproject.toml"),Path("ml-service/uv.lock")]
    hashes = {p.as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    version = hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()[:16]
    for path in paths:
        copied = folder/"source"/version/path
        copied.parent.mkdir(parents=True,exist_ok=True)
        if copied.exists() and copied.read_bytes() != path.read_bytes():
            raise ValueError("Immutable fine-tuning source snapshot mismatch")
        if not copied.exists():
            copied.write_bytes(path.read_bytes())
    return {"version":version,"hashes":hashes}


def cv(rows, task, folds, revision, config, folder, device):
    key = hashlib.sha256(json.dumps([task,config],sort_keys=True).encode()).hexdigest()[:12]
    classes = sorted({target(r,task) for r in rows})
    oof = np.zeros((len(rows),len(classes)))
    runs = []
    for fold in range(5):
        path = folder/f"cv-{key}-fold{fold}.json"
        fit = [r for r in rows if folds[r.id] != fold]
        held = [r for r in rows if folds[r.id] == fold]
        checkpoint = folder/"active-checkpoint"
        active = folder/"active-fit.json"
        identity = {"task":task,"config":config,"fold":fold}
        if path.exists():
            result = json.loads(path.read_text())
            if result["ids"] != [r.id for r in held]:
                raise ValueError("Fine-tuning CV split mismatch")
            if active.exists() and json.loads(active.read_text()) == identity:
                if checkpoint.exists():
                    remove_completed_checkpoint(checkpoint,folder)
                active.unlink()
        else:
            if active.exists() and json.loads(active.read_text()) != identity:
                raise ValueError("Different fit owns the resumable checkpoint")
            write(active,identity)
            print(f"ModernBERT {task} {config} fold {fold+1}/5",flush=True)
            estimators, actual, training = train_target(fit,held,task,revision,config,42,checkpoint,device)
            if actual != classes:
                raise ValueError("CV fitting labels incomplete")
            model = FineTunedModernBert({"inference_threads":8,"max_length":1024,"inference_device":device})
            model.estimators[task], model.classes[task] = estimators, classes
            start = time.perf_counter()
            probabilities = model.probabilities(task,[r.content for r in held])
            result = {"ids":[r.id for r in held],"probabilities":probabilities.tolist(),"training":training,
                "seconds":training["seconds"]+time.perf_counter()-start,
                "scores":basic([target(r,task) for r in held],probabilities,classes)}
            with mlflow.start_run(run_name=f"modernbert-{task}-{key}-fold{fold}"):
                mlflow.log_params({"target":task,**config,"fold":fold,"encoder_revision":revision})
                mlflow.log_dict(training,"training.json")
                mlflow.log_metrics(result["scores"])
            write(path,result)
            del model,estimators
            gc.collect()
            # OOF results are durable; only the current unfinished fit needs optimizer checkpoints.
            remove_completed_checkpoint(checkpoint,folder)
            active.unlink()
        for r,p in zip(held,result["probabilities"]):
            oof[next(i for i,item in enumerate(rows) if item.id == r.id)] = p
        runs.append(result)
    return {"config":config,"task":task,"classes":classes,"oof":oof.tolist(),
        "macro_f1_mean":float(np.mean([r["scores"]["macro_f1"] for r in runs])),
        "macro_f1_std":float(np.std([r["scores"]["macro_f1"] for r in runs],ddof=1)),
        "log_loss_mean":float(np.mean([r["scores"]["log_loss"] for r in runs])),
        "seconds":sum(r["seconds"] for r in runs),"best_epochs":[r["training"]["best_epoch"] for r in runs]}


def run(device="cpu", training_only=False):
    started = time.perf_counter()
    reference = Path("ml-service/artifacts/cpu-comparison-v1")
    folder = Path("ml-service/artifacts/cpu-expanded-v1/finetune")
    folder.mkdir(parents=True,exist_ok=True)
    approval_path = folder.parent/"finetune-authorization.json"
    if not approval_path.exists():
        raise ValueError("Complete classical phases and CPU pilot, then build the authorized training bundle")
    approval = json.loads(approval_path.read_text())
    if not approval["classical_phases_complete"] or approval["paid_compute_authorized"] or approval["budget_usd"] != 0:
        raise ValueError("Fine-tuning requires completed prerequisites and zero-cost compute")
    if not (folder/"training-complete.json").exists() and approval["allowed_training_device"] != device:
        raise ValueError("Training device does not match the CPU feasibility decision")
    dataset = reference/"dataset"
    manifest = json.loads((dataset/"manifest.json").read_text())
    for name,checksum in manifest["checksums"].items():
        path = dataset/name
        if not path.exists() and name == "validation.jsonl" and training_only:
            continue
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            raise ValueError("Frozen fine-tuning dataset checksum mismatch: "+name)
    revision = json.loads((reference/"xgboost/encoder-revision.json").read_text())["revision"]
    source = lineage(folder)
    state = {"dataset_version":manifest["dataset_version"],"code_version":source["version"],"revision":revision,
        "authorization_sha256":hashlib.sha256(approval_path.read_bytes()).hexdigest()}
    experiment_manifest = folder/"experiment-manifest.json"
    if experiment_manifest.exists() and json.loads(experiment_manifest.read_text()) != state:
        raise ValueError("Fine-tuning lineage changed; create a new experiment version")
    write(experiment_manifest,state)
    mlflow.set_tracking_uri("sqlite:///"+str((folder/"mlflow.db").resolve()).replace("\\","/"))
    mlflow.set_experiment("grit-modernbert-finetuned")
    rows = load_rows(dataset/"train.jsonl")
    folds = json.loads((dataset/"folds.json").read_text())
    winners,policies,experiments = {},{},[]
    for task in TASKS:
        eligible = [r for r in rows if target(r,task)]
        winners[task] = {}
        for weight in ["ordinary","balanced"]:
            runs = [cv(eligible,task,folds,revision,{"learning_rate":lr,"weighting":weight,"epochs":3},folder,device)
                    for lr in [2e-5,5e-5]]
            experiments.extend(runs)
            selected = min(runs,key=lambda r:(-r["macro_f1_mean"],r["log_loss_mean"],r["config"]["learning_rate"]))
            winners[task][weight] = {k:v for k,v in selected.items() if k != "oof"}
            policies[(task,weight)] = policies_for(task,eligible,np.array(selected["oof"]),selected["classes"])
    write(folder/"configuration-freeze.json",winners)
    finals = []
    # Training-only mode is suitable for Colab: all final-validation and CPU serving measurements run locally.
    for weight in ["ordinary","balanced"]:
        for seed in [42,43,44]:
            path = folder/f"{weight}-seed{seed}"
            if path.exists():
                # Verify a completed artifact before removing leftover optimizer checkpoints.
                reloaded,_ = load_artifact(path)
                del reloaded
                for task in TASKS:
                    checkpoint = folder/f"final-checkpoint-{weight}-{seed}-{task.replace(':','-')}"
                    if checkpoint.exists():
                        remove_completed_checkpoint(checkpoint,folder)
                continue
            model = FineTunedModernBert()
            timings,configs,model_policies = {},{},{}
            for task in TASKS:
                selected = winners[task][weight]
                config = {**selected["config"],"epochs":int(np.median(selected["best_epochs"]))}
                checkpoint = folder/f"final-checkpoint-{weight}-{seed}-{task.replace(':','-')}"
                estimators,classes,training = train_target([r for r in rows if target(r,task)],[],task,revision,config,seed,checkpoint,device)
                model.estimators[task],model.classes[task] = estimators,classes
                timings[task],configs[task] = training,config
                model_policies.update(policies[(task,weight)])
            metadata = {"model_version":f"modernbert-finetuned-{weight}-{seed}-{manifest['dataset_version']}",
                "kind":"modernbert_finetuned","stage":"candidate","dataset":manifest,"code_lineage":source,
                "preprocessing_version":FINETUNE_PREPROCESSING_VERSION,
                "seed":seed,"weighting":weight,"encoder_revision":revision,"policies":model_policies,
                "configurations":configs,"training_seconds":{t:v["seconds"] for t,v in timings.items()},
                "training_details":timings,"training_hardware":{**hardware(),"gpu_used":device == "cuda"},"training_device":device,
                "environment":{p:importlib.metadata.version(p) for p in
                    ["torch","transformers","numpy","scikit-learn","scipy","joblib","mlflow-skinny","safetensors"]}}
            save_artifact(path,model,metadata)
            del model,estimators
            gc.collect()
            # The immutable artifact now contains each fitted encoder/head; optimizer state is no longer needed.
            for task in TASKS:
                remove_completed_checkpoint(folder/f"final-checkpoint-{weight}-{seed}-{task.replace(':','-')}",folder)
    write(folder/"training-complete.json",{"complete":True,"device":device,"configurations":winners,
        "cv":[{k:v for k,v in r.items() if k != "oof"} for r in experiments]})
    if training_only:
        return
    validation = load_rows(dataset/"validation.jsonl")
    groups = json.loads((dataset/"groups.json").read_text())
    for weight in ["ordinary","balanced"]:
        for seed in [42,43,44]:
            path = folder/f"{weight}-seed{seed}"
            evaluation_path = folder/f"evaluation-{weight}-seed{seed}.json"
            if not evaluation_path.exists():
                model,metadata = load_artifact(path)
                start = time.perf_counter()
                scores,predictions = evaluate(model,validation,groups,metadata["policies"])
                reloaded,_ = load_artifact(path)
                for task in TASKS:
                    goldens = [r.content for r in validation if target(r,task)][:10]
                    np.testing.assert_allclose(model.probabilities(task,goldens),reloaded.probabilities(task,goldens),rtol=1e-6,atol=1e-7)
                    serial = np.vstack([model.probabilities(task,[question]) for question in goldens])
                    np.testing.assert_allclose(model.probabilities(task,goldens),serial,rtol=1e-5,atol=1e-6)
                write(evaluation_path,{"weighting":weight,"seed":seed,"metrics":scores,"predictions":predictions,
                    "evaluation_seconds":time.perf_counter()-start,"training_seconds":metadata["training_seconds"],
                    "reload_parity":"passed","batch_serial_parity":"passed"})
                del model,reloaded
                gc.collect()
            finals.append(json.loads(evaluation_path.read_text()))
            registry_path = path/"registry.json"
            if not registry_path.exists():
                with mlflow.start_run(run_name=f"modernbert-finetuned-{weight}-{seed}") as tracked:
                    mlflow.log_params({"weighting":weight,"seed":seed,"dataset":manifest["dataset_version"],"encoder_revision":revision})
                    mlflow.log_dict(finals[-1]["metrics"],"final-validation.json")
                    registered = mlflow.pyfunc.log_model(name="serving",python_model=RegistryModel(),
                        artifacts={"classifier":str(path.resolve())},registered_model_name="grit-modernbert-finetuned")
                    write(registry_path,{"run_id":tracked.info.run_id,"uri":registered.model_uri,"version":registered.registered_model_version})
    selected_weights = {task:min(winners[task],key=lambda w:(-winners[task][w]["macro_f1_mean"],winners[task][w]["log_loss_mean"],w != "ordinary")) for task in TASKS}
    selected_path = folder/"selected-seed42"
    if not selected_path.exists():
        model,metadata = load_artifact(folder/f"{selected_weights[TASKS[0]]}-seed42")
        other,other_meta = load_artifact(folder/f"{selected_weights['difficulty']}-seed42")
        model.estimators["difficulty"] = other.estimators["difficulty"]
        for key in ["policies","configurations","training_seconds","training_details"]:
            metadata[key]["difficulty"] = other_meta[key]["difficulty"]
        metadata.update(model_version=f"modernbert-finetuned-selected-{manifest['dataset_version']}",selected_weights=selected_weights)
        save_artifact(selected_path,model,metadata)
        del model,other
        gc.collect()
    model,metadata = load_artifact(selected_path)
    scores,predictions = evaluate(model,validation,groups,metadata["policies"])
    del model
    gc.collect()
    operational = json.loads((folder/"benchmark.json").read_text()) if (folder/"benchmark.json").exists() else benchmark(selected_path,validation,folder)
    prior = json.loads((folder/"invocations.json").read_text()) if (folder/"invocations.json").exists() else []
    write(folder/"results.json",{"complete":True,"method":"modernbert_finetuned","dataset":manifest,
        "configurations":winners,"selected_weights":selected_weights,"final":finals,"cv":[{k:v for k,v in r.items() if k != 'oof'} for r in experiments],
        "selected_metrics":scores,"selected_predictions":predictions,"benchmark":operational,"hardware":hardware(),
        "peak_memory_mb":peak_memory_mb(),"encoder_revision":revision,"code_lineage":source,
        "elapsed_seconds":sum(r["seconds"] for r in prior)+time.perf_counter()-started})
    from .expanded_verify import verify
    verify("finetune")
    from .expanded_report import render
    render(folder.parent,reference)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--device",choices=["cpu","cuda"],default="cpu")
    parser.add_argument("--training-only",action="store_true")
    args = parser.parse_args()
    began = time.perf_counter()
    status = "failed_or_interrupted"
    try:
        run(args.device,args.training_only)
        status = "complete"
    finally:
        journal = Path("ml-service/artifacts/cpu-expanded-v1/finetune/invocations.json")
        prior = json.loads(journal.read_text()) if journal.exists() else []
        write(journal,[*prior,{"device":args.device,"training_only":args.training_only,
            "seconds":time.perf_counter()-began,"status":status}])
