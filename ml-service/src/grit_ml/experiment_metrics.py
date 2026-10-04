import ctypes
import os
import platform
import time

import numpy as np
from sklearn.metrics import balanced_accuracy_score, f1_score, log_loss

from .evaluation import report


def peak_memory_mb():
    if os.name == "nt":
        class Counters(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
                (name, ctypes.c_size_t) for name in ["peak", "working", "paged_peak", "paged", "nonpaged_peak",
                                                    "nonpaged", "pagefile", "pagefile_peak"]]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(handle), ctypes.byref(counters), counters.cb)
        return counters.peak / 1048576
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def hardware():
    cpu = platform.processor()
    if os.name == "nt":
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
            cpu = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
    return {"platform": platform.platform(), "cpu": cpu, "logical_cpus": os.cpu_count(),
            "threads": 8, "gpu_used": False}


def basic(y, probabilities, classes):
    predicted = np.array(classes)[probabilities.argmax(axis=1)]
    return {"macro_f1": float(f1_score(y, predicted, labels=classes, average="macro", zero_division=0)),
            "log_loss": float(log_loss(y, probabilities, labels=classes)),
            "accuracy": float(np.mean(predicted == np.array(y)))}


def comprehensive(y, probabilities, classes, threshold, groups):
    result = report(y, probabilities, classes, threshold, groups)
    predicted = np.array(classes)[probabilities.argmax(axis=1)]
    result.update(log_loss=float(log_loss(y, probabilities, labels=classes)),
                  balanced_accuracy=float(balanced_accuracy_score(y, predicted)),
                  weighted_f1=float(f1_score(y, predicted, labels=classes, average="weighted", zero_division=0)),
                  rare_classes=[c for c in classes if result["per_class"][c]["support"] < 20])
    rng = np.random.default_rng(42)
    group_array = np.array(groups)
    unique = np.unique(group_array)
    recalls = {label: [] for label in classes}
    truth = np.array(y)
    accuracy = []
    for _ in range(200):
        selected = rng.choice(unique, size=len(unique), replace=True)
        indices = np.concatenate([np.flatnonzero(group_array == group) for group in selected])
        accuracy.append(float(np.mean(predicted[indices] == truth[indices])))
        for label in classes:
            mask = truth[indices] == label
            if mask.any():
                recalls[label].append(float(np.mean(predicted[indices][mask] == label)))
    result["accuracy_ci95"] = np.quantile(accuracy, [.025, .975]).tolist()
    for label in classes:
        result["per_class"][label]["recall_ci95"] = np.quantile(recalls[label], [.025, .975]).tolist() if recalls[label] else None
    return result


def latency_summary(times, elapsed=None):
    times = np.array(times)
    return {"requests": len(times), "p50_ms": float(np.quantile(times, .5) * 1000),
            "p95_ms": float(np.quantile(times, .95) * 1000), "p99_ms": float(np.quantile(times, .99) * 1000),
            "elapsed_seconds": float(elapsed if elapsed is not None else times.sum()),
            "questions_per_second": float(len(times) / (elapsed if elapsed is not None else times.sum()))}


def timed(call):
    start = time.perf_counter()
    value = call()
    return value, time.perf_counter() - start
