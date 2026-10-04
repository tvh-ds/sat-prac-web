"""Sequential prompt-only retraining of six completed methods on frozen evaluation membership."""
import argparse
import gc
import hashlib
import importlib.metadata
import itertools
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from functools import partial
from pathlib import Path

import mlflow
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from . import expanded_experiment as expanded
from .artifacts import load_artifact, save_artifact
from .classical import fit_estimator as classical_fit
from .classical import text_features
from .data import load_rows
from .experiment import TASKS, cross_validate, evaluate, fit_task, policies_for, target, write
from .experiment_benchmark import benchmark
from .experiment_metrics import hardware, peak_memory_mb, timed
from .prompt_models import FEATURE_VERSION, PromptEmbedding, PromptText, prompt_rows

ROOT = Path("ml-service/artifacts/prompt-only-v1")
REFERENCE = Path("ml-service/artifacts/cpu-comparison-v1")
METHODS = ["tfidf_lr", "tfidf_svm", "tfidf_nb", "embedding_xgb", "embedding_lr", "embedding_svm"]


def fit_prompt(kind, rows, task, value, weighting, seed, folds, features=None):
    if kind == "tfidf_lr":
        estimator = Pipeline([("features", text_features()), ("classifier", LogisticRegression(
            C=value, class_weight="balanced" if weighting == "balanced" else None, max_iter=2000, random_state=seed))])
        estimator.fit([r.content.prompt for r in rows], [target(r, task) for r in rows])
        return estimator, list(estimator.classes_)
    return classical_fit(kind, prompt_rows(rows), task, value, weighting, seed, folds, features)


def lineage():
    paths = [*sorted(Path("ml-service/src/grit_ml").glob("*.py")), Path("ml-service/pyproject.toml"), Path("ml-service/uv.lock")]
    hashes = {p.as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    version = hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()[:16]
    for p in paths:
        dest = ROOT / "source" / version / p
        dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists() and dest.read_bytes() != p.read_bytes():
            raise ValueError("Immutable source changed")
        if not dest.exists():
            dest.write_bytes(p.read_bytes())
    return {"version":version,"hashes":hashes}


def audit_prompts(train, validation):
    def grouped(rows):
        result = defaultdict(list)
        for row in rows:
            result[row.content.prompt].append(row)
        return result
    fitting, held = grouped(train), grouped(validation)
    both = fitting.keys() & held.keys()
    audit = {"training_questions":len(train),"validation_questions":len(validation),
             "unique_training_prompts":len(fitting),"unique_validation_prompts":len(held),
             "shared_prompt_strings":len(both),"validation_questions_with_seen_prompt":sum(len(held[p]) for p in both),
             "note":"Original full-content groups and split are frozen. Repeated prompt templates may cross partitions; report as template-overlap ablation, not prompt-disjoint generalization."}
    for task in TASKS:
        mixed = [rows for rows in fitting.values() if len({target(r,task) for r in rows if target(r,task)}) > 1]
        audit[task] = {"training_prompts_with_conflicting_labels":len(mixed),
                       "training_questions_in_conflicting_prompts":sum(bool(target(r,task)) for rows in mixed for r in rows)}
    return audit


def verify(model, rows, metadata, folder):
    # Materially perturb every excluded field and verify probabilities are identical.
    samples = [r.content for r in rows[:10]]
    changed = [q.model_copy(update={"passage":"EXCLUDED PASSAGE CHANGED", "choices":["unrelated a","unrelated b"],
                                  "question_type":"student_produced", "section":"math", "image_base64":"ignored", "requires_image":True}) for q in samples]
    for task in TASKS:
        np.testing.assert_allclose(model.probabilities(task,samples),model.probabilities(task,changed),rtol=0,atol=0)
    if hasattr(model,"config"):
        from unittest.mock import patch
        model.config["use_cache"] = False
        with patch("numpy.load",side_effect=AssertionError("Cache read forbidden")), patch("numpy.save",side_effect=AssertionError("Cache write forbidden")):
            for task in TASKS:
                actual = model.probabilities(task,samples)
                assert np.isfinite(actual).all()
        model.config["use_cache"] = True
    from fastapi.testclient import TestClient

    from .api import create_app
    from .predictor import Predictor
    token = "local-prompt-verification-token-32plus"
    client = TestClient(create_app(predictor=Predictor(model,metadata),token=token))
    assert client.post("/v1/classify",json=samples[0].model_dump()).status_code in {401,403}
    response = client.post("/v1/classify",json=samples[0].model_dump(),headers={"Authorization":"Bearer "+token})
    assert response.status_code == 200
    write(folder/"verification.json",{"excluded_field_invariance":"passed", "artifact_reload":"passed",
          "private_api_authorization":"passed", "cache_bypass":"passed" if hasattr(model,"config") else "not applicable"})


def run(kind):
    start = time.perf_counter()
    folder = ROOT/kind
    folder.mkdir(parents=True,exist_ok=True)
    if (folder/"results.json").exists():
        return
    dataset = REFERENCE/"dataset"
    manifest = json.loads((dataset/"manifest.json").read_text())
    for name,checksum in manifest["checksums"].items():
        if hashlib.sha256((dataset/name).read_bytes()).hexdigest() != checksum:
            raise ValueError("Frozen dataset checksum mismatch")
    source = lineage()
    state = {"feature_version":FEATURE_VERSION,"sole_feature":"raw question prompt", "dataset_version":manifest["dataset_version"],
             "source_version":source["version"],"method":kind,"seeds":[42,43,44],"optuna_trials":20 if kind != "embedding_xgb" else None}
    if (folder/"experiment-manifest.json").exists() and json.loads((folder/"experiment-manifest.json").read_text()) != state:
        raise ValueError("Prompt experiment lineage changed; use a new version")
    write(folder/"experiment-manifest.json",state)
    rows = prompt_rows(load_rows(dataset/"train.jsonl"))
    folds = json.loads((dataset/"folds.json").read_text())
    groups = json.loads((dataset/"groups.json").read_text())
    assert set(folds) == {r.id for r in rows}
    assert set(folds.values()) == set(range(5))
    mlflow.set_tracking_uri("sqlite:///"+str((ROOT/"mlflow.db").resolve()).replace("\\","/"))
    mlflow.set_experiment("grit-prompt-only")
    expanded.fit_estimator = fit_prompt
    encoder, features, preparation = None, None, 0.
    if kind.startswith("embedding_"):
        reference, reference_metadata = load_artifact(REFERENCE/"xgboost/selected-seed42")
        encoder = PromptEmbedding.from_reference(reference,ROOT/"embedding-cache")
        del reference
        print("Preparing prompt-only embeddings (768 dimensions; no structural features)",flush=True)
        (features,preparation) = timed(partial(encoder.features, [r.content for r in rows]))
        write(folder/"embedding-timing.json",{"seconds":preparation,"rows":len(rows),"dimensions":768,
             "cache_entries":len(list((ROOT/"embedding-cache").glob("*.npy"))),"encoder_revision":reference_metadata["encoder_revision"]})
    winners, policies = {}, {}
    for task in TASKS:
        indices = [i for i,r in enumerate(rows) if target(r,task)]
        eligible = [rows[i] for i in indices]
        winners[task] = {}
        for weight in ["ordinary","balanced"]:
            if kind == "embedding_xgb":
                runs = [cross_validate("xgboost",eligible,folds,task,weight,{"max_depth":depth,"reg_lambda":reg},folder,features[indices])
                        for depth,reg in itertools.product([3,4],[1,5])]
                result = min(runs,key=lambda r:(-r["macro_f1_mean"],r["log_loss_mean"],r["config"]["max_depth"],-r["config"]["reg_lambda"]))
                write(folder/f"grid-{task.replace(':','-')}-{weight}.json",[{k:v for k,v in r.items() if k != "oof"} for r in runs])
                with mlflow.start_run(run_name=f"{kind}-{task}-{weight}-selected-cv"):
                    mlflow.log_params({"feature_version":FEATURE_VERSION,"task":task,"weight":weight,**result["config"]})
                    mlflow.log_metrics({k:result[k] for k in ["macro_f1_mean","macro_f1_std","log_loss_mean","seconds"]})
            else:
                result = expanded.tune(kind,eligible,task,weight,folds,folder,features[indices] if features is not None else None)
            winners[task][weight] = {k:v for k,v in result.items() if k != "oof"}
            policies[(task,weight)] = policies_for(task,eligible,np.array(result["oof"]),result["classes"])
    write(folder/"configuration-freeze.json",winners)
    validation = prompt_rows(load_rows(dataset/"validation.jsonl"))
    assert not ({groups[r.id] for r in rows} & {groups[r.id] for r in validation})
    write(ROOT/"prompt-audit.json",audit_prompts(rows,validation))
    finals = []
    for weight in ["ordinary","balanced"]:
        for seed in [42,43,44]:
            path = folder/f"{weight}-seed{seed}"
            evaluation = folder/f"evaluation-{weight}-seed{seed}.json"
            if path.exists():
                model, metadata = load_artifact(path)
            else:
                model = PromptEmbedding.from_reference(encoder,ROOT/"embedding-cache") if encoder else PromptText()
                training, model_policies, configurations = {},{},{}
                for task in TASKS:
                    indices = [i for i,r in enumerate(rows) if target(r,task)]
                    chosen = winners[task][weight]
                    if kind == "embedding_xgb":
                        config = {**chosen["config"],"trees":int(np.median(chosen["best_trees"]))}
                        (estimator, classes,_),seconds = timed(partial(fit_task,"xgboost",[rows[i] for i in indices],task,config,weight,seed,features[indices]))
                    else:
                        config = {"C/alpha":chosen["parameter"]}
                        (estimator,classes),seconds = timed(partial(fit_prompt,kind,[rows[i] for i in indices],task,chosen["parameter"],weight,seed,folds,features[indices] if features is not None else None))
                    model.estimators[task],model.classes[task] = estimator,classes
                    training[task],configurations[task] = seconds,config
                    model_policies.update(policies[(task,weight)])
                metadata = {"model_version":f"prompt-only-{kind}-{weight}-{seed}-{manifest['dataset_version']}", "kind":kind,"stage":"candidate",
                    "dataset":manifest,"policies":model_policies,"feature_version":FEATURE_VERSION,"sole_feature":"raw question prompt",
                    "seed":seed,"weighting":weight,"training_seconds":training,"configurations":configurations,"code_lineage":source,
                    "encoder_revision":reference_metadata["encoder_revision"] if encoder else None,
                    "environment":{p:importlib.metadata.version(p) for p in ["scikit-learn","numpy","torch","transformers","xgboost","optuna"]}}
                save_artifact(path,model,metadata)
            if evaluation.exists():
                result = json.loads(evaluation.read_text())
            else:
                (scores,predictions),seconds = timed(partial(evaluate,model,validation,groups,metadata["policies"]))
                reloaded,_ = load_artifact(path)
                for task in TASKS:
                    samples = [r.content for r in validation if target(r,task)][:10]
                    np.testing.assert_allclose(model.probabilities(task,samples),reloaded.probabilities(task,samples),rtol=1e-6)
                del reloaded
                result = {"weighting":weight,"seed":seed,"metrics":scores,"predictions":predictions,"training_seconds":metadata["training_seconds"],
                          "evaluation_seconds":seconds,"artifact":str(path.resolve()),"reload_parity":"passed"}
                write(evaluation,result)
                with mlflow.start_run(run_name=f"{kind}-{weight}-{seed}"):
                    mlflow.log_params({"feature_version":FEATURE_VERSION,"method":kind,"seed":seed,"weight":weight})
                    mlflow.log_dict(scores,"final-validation.json")
            finals.append(result)
            print(f"{kind} {weight} seed{seed}: skill={result['metrics'][TASKS[0]]['macro_f1']:.4f} difficulty={result['metrics']['difficulty']['macro_f1']:.4f}",flush=True)
            del model
            gc.collect()
    selected = {task:min(winners[task],key=lambda w:(-winners[task][w]["macro_f1_mean"],winners[task][w]["log_loss_mean"],w!="ordinary")) for task in TASKS}
    path = folder/"selected-seed42"
    if not path.exists():
        model, metadata = load_artifact(folder/f"{selected[TASKS[0]]}-seed42")
        other, other_metadata = load_artifact(folder/f"{selected['difficulty']}-seed42")
        model.estimators["difficulty"] = other.estimators["difficulty"]
        metadata["policies"]["difficulty"] = other_metadata["policies"]["difficulty"]
        metadata.update(model_version=f"prompt-only-{kind}-selected-{manifest['dataset_version']}",selected_weights=selected)
        save_artifact(path,model,metadata)
        del model,other
    model,metadata = load_artifact(path)
    scores,predictions = evaluate(model,validation,groups,metadata["policies"])
    verify(model,validation,metadata,folder)
    if not (path/"registry.json").exists():
        from .registry import RegistryModel
        with mlflow.start_run(run_name=f"{kind}-prompt-only-candidate"):
            registered = mlflow.pyfunc.log_model(name="serving",python_model=RegistryModel(),
                artifacts={"classifier":str(path.resolve())},registered_model_name="grit-prompt-only-candidates")
            write(path/"registry.json",{"uri":registered.model_uri,"version":registered.registered_model_version,"stage":"candidate"})
    del model,encoder
    gc.collect()
    operations = json.loads((folder/"benchmark.json").read_text()) if (folder/"benchmark.json").exists() else benchmark(path,validation,folder)
    write(folder/"results.json",{"complete":True,"method":kind,"feature_version":FEATURE_VERSION,"dataset":manifest,"configurations":winners,
          "selected_weights":selected,"final":finals,"selected_metrics":scores,"selected_predictions":predictions,"benchmark":operations,
          "hardware":hardware(),"feature_preparation_seconds":preparation,"elapsed_seconds":time.perf_counter()-start,"peak_memory_mb":peak_memory_mb(),"code_lineage":source})
    from .prompt_report import render
    render()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("method",choices=[*METHODS,"all"])
    args = parser.parse_args()
    for key in ["OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS"]:
        os.environ[key] = "8"
    if args.method != "all":
        run(args.method)
        return
    ROOT.mkdir(parents=True,exist_ok=True)
    for method in METHODS:
        write(ROOT/"queue-status.json",{"method":method,"status":"running"})
        with (ROOT/f"queue-{method}.log").open("a",encoding="utf-8") as log:
            process = subprocess.run([sys.executable,"-u","-m","grit_ml.prompt_experiment",method],stdout=log,stderr=subprocess.STDOUT,check=False)
        if process.returncode:
            write(ROOT/"queue-status.json",{"method":method,"status":"failed","exit_code":process.returncode})
            raise RuntimeError(f"Prompt-only {method} failed; inspect its saved log")
        print(f"Completed prompt-only {method}",flush=True)
    write(ROOT/"queue-status.json",{"status":"complete","methods":METHODS})


if __name__ == "__main__":
    main()
