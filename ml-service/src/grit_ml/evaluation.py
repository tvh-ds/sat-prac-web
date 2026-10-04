import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support


def calibrate(probabilities, temperature):
    logits = np.log(np.clip(probabilities, 1e-12, 1)) / temperature
    exp = np.exp(logits - logits.max(axis=1, keepdims=True))
    return exp / exp.sum(axis=1, keepdims=True)


def fit_temperature(y, probabilities, classes):
    if len(y) < 20 or any(label not in classes for label in y):
        return None
    index = np.array([classes.index(label) for label in y])
    candidates = np.geomspace(0.4, 4, 30)
    losses = [-np.log(np.clip(calibrate(probabilities, t)[np.arange(len(y)), index], 1e-12, 1)).mean() for t in candidates]
    return float(candidates[int(np.argmin(losses))])


def precision_threshold(y, probabilities, classes, target=0.90, minimum=20):
    predicted = np.array(classes)[probabilities.argmax(axis=1)]
    scores = probabilities.max(axis=1)
    best = None
    for threshold in np.linspace(0, 1, 101):
        keep = scores >= threshold
        if keep.sum() >= minimum and np.mean(predicted[keep] == np.array(y)[keep]) >= target:
            best = float(threshold)
            break
    return best


def report(y, probabilities, classes, threshold=None, groups=None):
    if not len(y):
        return {"count": 0}
    predictions = np.array(classes)[probabilities.argmax(axis=1)]
    labels = sorted(set(classes) | set(y))
    precision, recall, f1, support = precision_recall_fscore_support(y, predictions, labels=labels, zero_division=0)
    correct = predictions == np.array(y)
    confidence = probabilities.max(axis=1)
    ece = 0.0
    for low in np.linspace(0, 0.9, 10):
        mask = (confidence >= low) & (confidence < low + 0.1 + (1e-8 if low > 0.89 else 0))
        if mask.any():
            ece += float(mask.mean() * abs(confidence[mask].mean() - correct[mask].mean()))
    # Unknown evaluation labels get zero probability rather than disappearing from metrics.
    expanded = np.zeros((len(y), len(labels)))
    for i, label in enumerate(classes):
        expanded[:, labels.index(label)] = probabilities[:, i]
    truth = np.array([[int(value == label) for label in labels] for value in y])
    rng = np.random.default_rng(42)
    group_array = np.array(groups if groups is not None else [str(i) for i in range(len(y))])
    unique = np.unique(group_array)
    samples = []
    if len(unique) > 1:
        for _ in range(200):
            selected = rng.choice(unique, size=len(unique), replace=True)
            indices = np.concatenate([np.flatnonzero(group_array == group) for group in selected])
            samples.append(f1_score(np.array(y)[indices], predictions[indices], labels=labels, average="macro", zero_division=0))
    keep = confidence >= threshold if threshold is not None else np.zeros(len(y), dtype=bool)
    result = {"count": len(y), "accuracy": float(accuracy_score(y, predictions)),
              "macro_f1": float(f1_score(y, predictions, labels=labels, average="macro", zero_division=0)),
              "macro_f1_ci95": np.quantile(samples, [0.025, 0.975]).tolist() if samples else None,
              "per_class": {label: {"precision": float(p), "recall": float(r), "f1": float(f), "support": int(n)}
                            for label, p, r, f, n in zip(labels, precision, recall, f1, support)},
              "confusion_labels": labels, "confusion_matrix": confusion_matrix(y, predictions, labels=labels).tolist(),
              "ece": ece, "brier": float(np.mean(np.sum((expanded - truth) ** 2, axis=1))),
              "coverage": float(keep.mean()), "suggestion_precision": float(correct[keep].mean()) if keep.any() else None,
              "reliability": [{"threshold": float(t), "coverage": float((confidence >= t).mean()),
                               "precision": float(correct[confidence >= t].mean()) if (confidence >= t).any() else None}
                              for t in [0.5, 0.7, 0.8, 0.9, 0.95]]}
    if set(labels) <= {"1", "3", "5"}:
        ordinal = {"1": 0, "3": 1, "5": 2}
        errors = np.array([abs(ordinal[a] - ordinal[b]) for a, b in zip(y, predictions)])
        result.update(ordinal_error=float(errors.mean()), extreme_error_rate=float((errors == 2).mean()))
    return result
