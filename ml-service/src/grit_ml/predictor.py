import time

from .contracts import FieldPrediction, Prediction, QuestionInput, skill_domain
from .evaluation import calibrate


class Predictor:
    def __init__(self, model, metadata):
        self.model, self.metadata = model, metadata

    def _field(self, task, question, computed=None):
        policy = self.metadata.get("policies", {}).get(task)
        if task not in self.model.classes:
            return FieldPrediction(abstention_reason="insufficient_training_labels")
        if not policy or policy.get("temperature") is None:
            return FieldPrediction(abstention_reason="insufficient_calibration_labels")
        raw = computed[task] if computed is not None and task in computed else self.model.probabilities(task, [question])
        probs = calibrate(raw, policy["temperature"])[0]
        classes = self.model.classes[task]
        mapping = {str(label): float(p) for label, p in zip(classes, probs)}
        best = max(mapping, key=mapping.get)
        threshold = policy.get("threshold")
        accepted = threshold is not None and mapping[best] >= threshold
        return FieldPrediction(value=best if accepted else None, confidence=mapping[best], probabilities=mapping,
                               abstention_reason=None if accepted else "below_validated_threshold")

    def predict(self, question: QuestionInput):
        start = time.perf_counter()
        blocked = question.requires_image and (not self.model.supports_images or not question.image_base64)
        if blocked:
            reason = "essential_image_missing" if not question.image_base64 else "text_model_visual_abstention"
            skill = domain = difficulty = FieldPrediction(abstention_reason=reason)
        else:
            computed = self.model.probabilities_many([question]) if hasattr(self.model, "probabilities_many") else None
            skill = self._field("skill:" + question.section, question, computed)
            domain_probs = {}
            for label, probability in skill.probabilities.items():
                name = skill_domain(question.section, label)
                domain_probs[name] = domain_probs.get(name, 0) + probability
            policy = self.metadata.get("policies", {}).get("domain:" + question.section, {})
            best = max(domain_probs, key=domain_probs.get) if domain_probs else None
            threshold = policy.get("threshold")
            accepted = best is not None and threshold is not None and domain_probs[best] >= threshold
            domain = FieldPrediction(value=best if accepted else None, confidence=domain_probs.get(best),
                                     probabilities=domain_probs, abstention_reason=None if accepted else "below_validated_threshold")
            difficulty = self._field("difficulty", question, computed)
            if difficulty.value is not None:
                difficulty.value = int(difficulty.value)
        return Prediction(input_hash=question.content_hash(), model_version=self.metadata["model_version"],
                          skill=skill, domain=domain, difficulty=difficulty,
                          latency_ms=(time.perf_counter() - start) * 1000)
