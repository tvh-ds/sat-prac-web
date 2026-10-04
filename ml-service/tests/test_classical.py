import numpy as np
import pytest
from test_pipeline import row

from grit_ml.classical import calibration_splits, fit_estimator


def examples():
    rows = [row(i) for i in range(80)]
    # Every frozen calibration partition represents both fixture skills.
    folds = {r.id: (i // 2) % 5 for i, r in enumerate(rows)}
    return rows, folds


def test_calibration_stays_inside_fitting_partition():
    rows, folds = examples()
    fitting = [r for r in rows if folds[r.id] != 4]
    for train, held in calibration_splits(fitting, folds):
        assert not set(train) & set(held)
        assert len(train) + len(held) == len(fitting)
        assert not {folds[fitting[i].id] for i in train} & {folds[fitting[i].id] for i in held}


@pytest.mark.parametrize("kind", ["tfidf_svm", "tfidf_nb", "embedding_lr", "embedding_svm"])
def test_classical_fit_probabilities_and_train_only_features(kind):
    rows, folds = examples()
    features = np.array([[i % 2, i % 3, 1.] for i in range(len(rows))]) if kind.startswith("embedding") else None
    estimator, classes = fit_estimator(kind, rows, "skill:reading_writing", 1., "balanced", 42, folds, features)
    x = features if features is not None else [r.content.text() for r in rows]
    p = estimator.predict_proba(x)
    assert p.shape == (80, len(classes))
    np.testing.assert_allclose(p.sum(axis=1), 1.)
    if kind.endswith("svm"):
        assert estimator.ensemble is False
    if kind == "tfidf_nb":
        counts = estimator.named_steps["classifier"].class_count_
        np.testing.assert_allclose(counts, counts[0])


def test_balanced_nb_uses_fitting_counts_and_excludes_held_vocabulary():
    rows,folds = examples()
    fitting = [r for i,r in enumerate(rows) if i % 4 != 0]
    estimator,_ = fit_estimator("tfidf_nb",fitting,"skill:reading_writing",1.,"balanced",42,folds)
    counts = estimator.named_steps["classifier"].class_count_
    np.testing.assert_allclose(counts,np.full_like(counts,len(fitting)/len(counts)))
    held = rows[0].content.model_copy(update={"prompt":"uniquelyheldoutsentinel"})
    estimator.predict_proba([held.text()])
    vocabulary = estimator.named_steps["features"].transformer_list[0][1].vocabulary_
    assert "uniquelyheldoutsentinel" not in vocabulary


def test_embedding_scaler_only_fits_training_features():
    rows,folds = examples()
    features = np.array([[i%2,float(i)] for i in range(len(rows))])
    estimator,_ = fit_estimator("embedding_lr",rows,"skill:reading_writing",1.,"ordinary",42,folds,features)
    np.testing.assert_allclose(estimator.named_steps["features"].mean_,features.mean(0))
    original = estimator.named_steps["features"].mean_.copy()
    estimator.predict_proba([[100000.,100000.]])
    np.testing.assert_array_equal(original,estimator.named_steps["features"].mean_)
