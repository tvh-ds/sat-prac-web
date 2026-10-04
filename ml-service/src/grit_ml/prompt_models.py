"""Prompt-only ablation models. No field markers, structural features, or fine-tuning."""
import hashlib
import json
from pathlib import Path

import numpy as np

from .candidates import EmbeddingsXGBoost
from .contracts import QuestionInput

FEATURE_VERSION = "prompt-only-v1"


class PromptOnlyInput(QuestionInput):
    def text(self):
        return self.prompt


def prompt_rows(rows):
    return [row.model_copy(update={"content": PromptOnlyInput(**row.content.model_dump())}) for row in rows]


class PromptText:
    supports_images = False

    def __init__(self):
        self.estimators, self.classes = {}, {}

    def probabilities(self, task, contents):
        return self.estimators[task].predict_proba([q.prompt for q in contents])


class PromptEmbedding(EmbeddingsXGBoost):
    """Use the original frozen encoder; only raw prompt tokens enter its input."""
    @classmethod
    def from_reference(cls, reference, cache):
        model = cls({**reference.config, "images": False, "cache_dir": str(Path(cache).resolve()),
                     "use_cache": True, "inference_threads": 8, "feature_version": FEATURE_VERSION})
        model.encoder, model.tokenizer = reference.encoder, reference.tokenizer
        if any(p.requires_grad for p in model.encoder.parameters()):
            raise ValueError("Prompt experiment requires a frozen original encoder")
        return model

    def features(self, contents):
        import torch
        torch.set_num_threads(8)
        self.encoder.eval()
        cache = Path(self.config["cache_dir"])
        cache.mkdir(parents=True, exist_ok=True)
        max_length = self.config.get("max_length", 1024)
        outputs = []
        for question in contents:
            definition = [FEATURE_VERSION, self.config["text_revision"], max_length, question.prompt]
            key = hashlib.sha256(json.dumps(definition, ensure_ascii=False).encode()).hexdigest()
            path = cache / (key + ".npy")
            if self.config.get("use_cache", True) and path.exists():
                vector = np.load(path, allow_pickle=False)
            else:
                ids = self.tokenizer.encode(question.prompt, add_special_tokens=False)
                room = max_length - self.tokenizer.num_special_tokens_to_add(pair=False)
                chunks = [ids[i:i+room] for i in range(0, len(ids), room)] or [[]]
                if len(chunks) > 32:
                    raise ValueError("Prompt exceeds bounded chunk budget; no silent truncation")
                pooled = []
                with torch.no_grad():
                    for chunk in chunks:
                        encoded = self.tokenizer.prepare_for_model(chunk, truncation=False, return_attention_mask=True)
                        inputs = self.tokenizer.pad([encoded], return_tensors="pt")
                        inputs = {k:v for k,v in inputs.items() if k in {"input_ids", "attention_mask"}}
                        hidden = self.encoder(**inputs).last_hidden_state
                        mask = inputs["attention_mask"].unsqueeze(-1)
                        pooled.append(((hidden*mask).sum(1)/mask.sum(1).clamp_min(1))[0])
                    vector = torch.stack(pooled).mean(0).cpu().numpy()
                if self.config.get("use_cache", True):
                    temporary = path.with_suffix(".partial.npy")
                    np.save(temporary, vector, allow_pickle=False)
                    temporary.replace(path)
            if vector.shape != (768,) or not np.isfinite(vector).all():
                raise ValueError("Unexpected prompt embedding shape/values")
            outputs.append(vector)
        return np.asarray(outputs)
