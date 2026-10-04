"""Classical alternatives with training-contained features and SVM calibration."""
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC
from sklearn.utils.class_weight import compute_sample_weight

from .candidates import EmbeddingsXGBoost


def text_features():
    return FeatureUnion([
        ("words", TfidfVectorizer(ngram_range=(1, 2), token_pattern=r"(?u)\b\w+\b", max_features=30000)),
        ("characters", TfidfVectorizer(analyzer="char", ngram_range=(2, 5), max_features=30000)),
    ])


def calibration_splits(rows, folds):
    """Restrict the existing frozen folds to this fitting partition."""
    ids = np.array([folds[r.id] for r in rows])
    splits = [(np.flatnonzero(ids != fold), np.flatnonzero(ids == fold)) for fold in sorted(set(ids))]
    if len(splits) < 2:
        raise ValueError("SVM calibration requires independent fitting groups")
    return splits


def fit_estimator(kind, rows, task, value, weighting, seed, folds, features=None):
    from .experiment import target
    labels = np.array([target(r, task) for r in rows])
    balanced = weighting == "balanced"
    embedding = kind.startswith("embedding_")
    x = features if embedding else [r.content.text() for r in rows]
    if embedding and features is None:
        raise ValueError("Frozen embedding features are required")
    if kind.endswith("svm"):
        base = Pipeline([("features", StandardScaler() if embedding else text_features()),
                         ("classifier", LinearSVC(C=value, class_weight="balanced" if balanced else None,
                                                  random_state=seed, max_iter=10000,
                                                  dual=True if embedding else "auto"))])
        splits = calibration_splits(rows, folds)
        for fit, held in splits:
            if set(labels[fit]) != set(labels) or not len(held):
                raise ValueError("Calibration fitting fold missing a class")
        estimator = CalibratedClassifierCV(base, method="sigmoid", cv=splits, ensemble=False, n_jobs=1)
        estimator.fit(x, labels)
    elif kind == "tfidf_nb":
        estimator = Pipeline([("features", text_features()), ("classifier", ComplementNB(alpha=value))])
        weights = compute_sample_weight("balanced", labels) if balanced else None
        estimator.fit(x, labels, classifier__sample_weight=weights)
    elif kind == "embedding_lr":
        estimator = Pipeline([("features", StandardScaler()),
                              ("classifier", LogisticRegression(C=value, max_iter=2000,
                                  class_weight="balanced" if balanced else None, random_state=seed))])
        estimator.fit(x, labels)
    else:
        raise ValueError("Unsupported classical method")
    return estimator, list(estimator.classes_)


class TextClassical:
    supports_images = False

    def __init__(self):
        self.classes, self.estimators = {}, {}

    def probabilities(self, task, contents):
        return self.estimators[task].predict_proba([q.text() for q in contents])


class EmbeddingClassical(EmbeddingsXGBoost):
    """Same frozen encoder, pooling, and features as the saved XGBoost experiment."""

    @classmethod
    def from_reference(cls, reference):
        model = cls(dict(reference.config))
        model.encoder, model.tokenizer = reference.encoder, reference.tokenizer
        return model
