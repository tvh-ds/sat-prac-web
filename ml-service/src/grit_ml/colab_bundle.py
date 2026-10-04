"""Create a whitelist-only training bundle and notebook; no credentials or outer-validation content."""
import hashlib
import importlib.metadata
import json
import zipfile
from pathlib import Path


def build():
    output = Path("ml-service/artifacts/cpu-expanded-v1/colab")
    output.mkdir(parents=True,exist_ok=True)
    reference = Path("ml-service/artifacts/cpu-comparison-v1")
    experiment = output.parent
    required = [experiment/method/"results.json" for method in ["tfidf_svm","tfidf_nb","embedding_lr","embedding_svm"]]
    pilot_path = experiment/"finetune/pilot.json"
    ready = all(p.exists() and json.loads(p.read_text()).get("complete") for p in required) and pilot_path.exists()
    authorization = experiment/"finetune-authorization.json"
    if ready:
        pilot = json.loads(pilot_path.read_text())
        authorization.write_text(json.dumps({"classical_phases_complete":True,"pilot":pilot,
            "classical_results_sha256":{p.parent.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in required},
            "allowed_training_device":"cuda" if pilot["decision"] == "free_colab_gpu" else "cpu",
            "paid_compute_authorized":False,"budget_usd":0},indent=2),encoding="utf-8")
    paths = [*sorted(Path("ml-service/src/grit_ml").glob("*.py")),Path("ml-service/src/grit_ml/taxonomy.json"),
        Path("ml-service/pyproject.toml"),Path("ml-service/uv.lock"),
        *[reference/"dataset"/name for name in ["train.jsonl","folds.json","groups.json","manifest.json"]],
        reference/"xgboost/encoder-revision.json"]
    if ready:
        paths.append(authorization)
    package = output/"modernbert-training-bundle.zip"
    hashes = {p.as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    with zipfile.ZipFile(package,"w",zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path,path.as_posix())
        archive.writestr("bundle-manifest.json",json.dumps(hashes,sort_keys=True))
    checksum = hashlib.sha256(package.read_bytes()).hexdigest()
    packages = ["transformers","numpy","scikit-learn","mlflow-skinny","pydantic","fastapi","uvicorn",
                "pandas","sqlalchemy","alembic","pillow","safetensors","optuna",
                "scipy","joblib","threadpoolctl","huggingface-hub","tokenizers"]
    dependencies = [p+"=="+importlib.metadata.version(p) for p in packages]
    # Keep the GPU Torch wheel; record its CUDA build separately from the local CPU experiment.
    dependencies.append("torch=="+importlib.metadata.version("torch").split("+")[0])
    bootstrap = f'''# Run only after the completed CPU pilot selects the free Colab fallback.
from pathlib import Path
import hashlib, json, os, subprocess, sys, zipfile
from google.colab import drive
drive.mount('/content/drive')
workspace = Path('/content/drive/MyDrive/modernBERT_finetuned')
bundle = workspace / 'modernbert-training-bundle.zip'
assert bundle.exists(), 'Upload the prepared bundle to the dedicated folder first'
assert hashlib.sha256(bundle.read_bytes()).hexdigest() == {checksum!r}, 'Bundle checksum mismatch'
code = Path('/content/grit-classification')
code.mkdir(exist_ok=True)
with zipfile.ZipFile(bundle) as archive:
    for item in archive.infolist():
        destination = (code/item.filename).resolve()
        assert destination.is_relative_to(code.resolve()), 'Invalid bundle path'
    archive.extractall(code)
manifest = json.loads((code/'bundle-manifest.json').read_text())
for name, checksum in manifest.items():
    assert hashlib.sha256((code/name).read_bytes()).hexdigest() == checksum
subprocess.run([sys.executable,'-m','pip','install','--only-binary=:all:',*{dependencies!r}],check=True)
subprocess.run([sys.executable,'-m','pip','install','--no-deps','-e',str(code/'ml-service')],check=True)
artifact_root = code/'ml-service/artifacts/cpu-expanded-v1'
artifact_root.mkdir(parents=True,exist_ok=True)
persistent = workspace/'finetune'
persistent.mkdir(exist_ok=True)
if (artifact_root/'finetune').exists():
    assert (artifact_root/'finetune').resolve() == persistent.resolve(), 'Unexpected artifact directory'
else:
    (artifact_root/'finetune').symlink_to(persistent,target_is_directory=True)
os.chdir(code)
os.environ.update(OMP_NUM_THREADS='8',MKL_NUM_THREADS='8',OPENBLAS_NUM_THREADS='8',
                  MLFLOW_DISABLE_AGENT_HINT='1',HF_HOME='/content/grit-huggingface-cache')
subprocess.run([sys.executable,'-c',"import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"],check=True)
print('Bundle verified. Ready for free GPU training; outer validation remains local.')
'''
    training = '''import subprocess, sys
subprocess.run([sys.executable,'-m','grit_ml.finetune_experiment','--device','cuda','--training-only'],check=True)
print('CV and final training complete. Download finetune artifacts for local CPU validation and API benchmarking.')
'''
    notebook = {"nbformat":4,"nbformat_minor":5,"metadata":{"colab":{"name":"modernBERT_finetuned.ipynb"},
        "kernelspec":{"name":"python3","display_name":"Python 3"}},"cells":[
        {"cell_type":"markdown","metadata":{},"source":["# ModernBERT categorical classification\n",
            "Use only the authorized free GPU fallback after the CPU pilot. Independent skill and difficulty heads, frozen group-aware CV, ordinary/balanced losses. No paid compute or model promotion. Checkpoints stay in modernBERT_finetuned/finetune.\n"]},
        *[{"cell_type":"code","metadata":{},"execution_count":None,"outputs":[],"source":code.splitlines(keepends=True)}
          for code in [bootstrap,training]] ]}
    (output/"modernBERT_finetuned.ipynb").write_text(json.dumps(notebook,indent=2),encoding="utf-8")
    (output/"bootstrap.py").write_text(bootstrap,encoding="utf-8")
    (output/"bundle-lineage.json").write_text(json.dumps({"sha256":checksum,"files":hashes,
        "outer_validation_included":False,"secrets_included":False,"dependencies":dependencies},indent=2),encoding="utf-8")
    print(f"Prepared {'ready' if ready else 'draft'} local bundle: {package}; {package.stat().st_size} bytes",flush=True)


if __name__ == "__main__":
    build()
