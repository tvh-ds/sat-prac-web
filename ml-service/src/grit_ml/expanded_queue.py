"""One local experiment at a time, with durable logs and explicit GPU handoff."""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from .experiment import write


def run(wait_pid=None):
    root = Path("ml-service/artifacts/cpu-expanded-v1")
    root.mkdir(parents=True,exist_ok=True)
    state = root/"queue-status.json"
    if wait_pid:
        if os.name != "nt":
            raise ValueError("Existing-process wait is a Windows-only queue operation")
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32",use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.OpenProcess.argtypes = [wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE,wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000,False,wait_pid)
        if not handle and ctypes.get_last_error() != 87:
            raise OSError("Cannot verify the existing process has stopped; refusing parallel experiments")
        if handle:
            # The handle identifies this process even if its PID is later reused.
            write(state,{"phase":"tfidf_svm","status":"waiting_for_existing_process","pid":wait_pid})
            try:
                while kernel.WaitForSingleObject(handle,10000) == 258:
                    pass
            finally:
                kernel.CloseHandle(handle)
    env = {**os.environ,"OMP_NUM_THREADS":"8","MKL_NUM_THREADS":"8","OPENBLAS_NUM_THREADS":"8",
        "MLFLOW_DISABLE_AGENT_HINT":"1","HF_HOME":str(Path("ml-service/artifacts/cpu-comparison-v1/huggingface-cache").resolve()),
        "HF_HUB_OFFLINE":"1"}
    phases = [(method,["-m","grit_ml.expanded_experiment",method])
              for method in ["tfidf_svm","tfidf_nb","embedding_lr","embedding_svm"]]
    phases.append(("finetune_pilot",["-m","grit_ml.finetune_pilot"]))
    for phase,arguments in phases:
        write(state,{"phase":phase,"status":"running","started_unix":time.time()})
        print(f"Starting {phase}",flush=True)
        with (root/f"queue-{phase}.log").open("a",encoding="utf-8") as log:
            result = subprocess.run([sys.executable,*arguments],env=env,stdout=log,stderr=subprocess.STDOUT,check=False)
        if result.returncode:
            write(state,{"phase":phase,"status":"failed","exit_code":result.returncode,"log":str(root/f"queue-{phase}.log")})
            raise RuntimeError(f"{phase} failed; inspect its durable log")
        if phase != "finetune_pilot":
            with (root/f"queue-{phase}.log").open("a",encoding="utf-8") as log:
                verification = subprocess.run([sys.executable,"-m","grit_ml.expanded_verify",phase],
                    env=env,stdout=log,stderr=subprocess.STDOUT,check=False)
            if verification.returncode:
                write(state,{"phase":phase,"status":"serving_verification_failed","exit_code":verification.returncode})
                raise RuntimeError(f"{phase} serving verification failed; inspect durable log")
        import importlib

        from . import expanded_report
        importlib.reload(expanded_report).render(root,Path("ml-service/artifacts/cpu-comparison-v1"))
    import json
    decision = json.loads((root/"finetune/pilot.json").read_text())["decision"]
    from .colab_bundle import build
    build()
    if decision == "free_colab_gpu":
        write(state,{"phase":"finetune","status":"ready_for_free_colab_gpu","pilot":str(root/"finetune/pilot.json")})
        print("Classical phases complete; CPU pilot requires free Colab GPU fallback",flush=True)
        return
    write(state,{"phase":"finetune","status":"running_cpu"})
    with (root/"queue-finetune.log").open("a",encoding="utf-8") as log:
        result = subprocess.run([sys.executable,"-m","grit_ml.finetune_experiment"],env=env,stdout=log,stderr=subprocess.STDOUT,check=False)
    write(state,{"phase":"finetune","status":"complete" if result.returncode == 0 else "failed","exit_code":result.returncode})
    if result.returncode:
        raise RuntimeError("Fine-tuning failed; inspect durable log")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--wait-pid",type=int)
    run(parser.parse_args().wait_pid)
