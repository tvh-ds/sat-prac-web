from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline


class Baseline:
    supports_images = False

    def __init__(self, seed=42, class_weight="balanced", regularization=1.0):
        self.seed = seed
        self.class_weight = class_weight
        self.regularization = regularization
        self.estimators = {}
        self.classes = {}

    def fit(self, rows):
        for section in ["math", "reading_writing"]:
            self._fit(f"skill:{section}", [r for r in rows if r.content.section == section and r.skill], lambda r: r.skill)
        self._fit("difficulty", [r for r in rows if r.trusted_difficulty()], lambda r: r.trusted_difficulty())
        return self

    def _fit(self, task, rows, target):
        rows = [r for r in rows if not r.content.requires_image]
        if len({target(r) for r in rows}) < 2:
            return
        model = Pipeline([("features", FeatureUnion([
            ("words", TfidfVectorizer(ngram_range=(1, 2), token_pattern=r"(?u)\b\w+\b", max_features=30000)),
            ("characters", TfidfVectorizer(analyzer="char", ngram_range=(2, 5), max_features=30000)),
        ])), ("classifier", LogisticRegression(max_iter=2000, C=self.regularization,
                                               class_weight=self.class_weight, random_state=self.seed))])
        model.fit([r.content.text() for r in rows], [target(r) for r in rows])
        self.estimators[task] = model
        self.classes[task] = list(model.classes_)

    def probabilities(self, task, contents):
        return self.estimators[task].predict_proba([q.text() for q in contents])
