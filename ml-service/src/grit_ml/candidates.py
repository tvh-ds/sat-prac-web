"""Optional GPU candidates. Imports and pretrained downloads occur only when explicitly trained."""
import base64
import hashlib
import io
import json
import time
from pathlib import Path

import numpy as np

TEXT_MODEL = "answerdotai/ModernBERT-base"
IMAGE_MODEL = "google/siglip2-base-patch16-224"


def tasks(rows):
    for section in ["math", "reading_writing"]:
        selected = [r for r in rows if r.content.section == section and r.skill]
        yield "skill:" + section, selected, [r.skill for r in selected]
    selected = [r for r in rows if r.trusted_difficulty()]
    yield "difficulty", selected, [r.trusted_difficulty() for r in selected]


def chunks(question, tokenizer, max_length):
    # Preserve prompt/choices completely and consume the entire passage in bounded chunks.
    core = question.model_copy(update={"passage": ""}).text()
    core_ids = tokenizer.encode(core, add_special_tokens=False)
    room = max_length - len(core_ids) - tokenizer.num_special_tokens_to_add(pair=False)
    if room < 64:
        raise ValueError("Prompt/choices exceed the configured token budget; no silent truncation")
    passage_ids = tokenizer.encode(question.passage, add_special_tokens=False)
    pieces = [passage_ids[i:i + room] for i in range(0, len(passage_ids), room)] or [[]]
    if len(pieces) > 32:
        raise ValueError("Passage requires more than 32 chunks; manual classification required")
    return [tokenizer.prepare_for_model(core_ids + piece, truncation=False, return_attention_mask=True)
            for piece in pieces]


def encode_question(encoder, tokenizer, question, max_length, device):
    import torch
    representations = []
    for chunk in chunks(question, tokenizer, max_length):
        inputs = tokenizer.pad([chunk], return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items() if k in {"input_ids", "attention_mask"}}
        hidden = encoder(**inputs).last_hidden_state
        mask = inputs["attention_mask"].unsqueeze(-1)
        representations.append((hidden * mask).sum(1) / mask.sum(1).clamp_min(1))
    return torch.stack(representations).mean(0)


class ModernBert:
    supports_images = False

    def __init__(self, config):
        self.config, self.classes, self.estimators = config, {}, {}

    def probabilities(self, task, contents):
        import torch
        encoder, tokenizer, head, ordinal = self.estimators[task]
        encoder.eval()
        head.eval()
        output = []
        with torch.no_grad():
            for question in contents:
                rep = encode_question(encoder, tokenizer, question, self.config.get("max_length", 1024), "cpu")
                logits = head(rep)
                if ordinal:
                    # Parameterization ensures P(y > Easy) >= P(y > Medium).
                    a = torch.sigmoid(logits[:, 0])
                    b = torch.sigmoid(logits[:, 0] - torch.nn.functional.softplus(logits[:, 1]))
                    output.append(torch.stack([1 - a, a - b, b], dim=1)[0].numpy())
                else:
                    output.append(logits.softmax(-1)[0].numpy())
        return np.array(output)


def train_modernbert(rows, validation, seed, config):
    import torch
    from transformers import AutoModel, AutoTokenizer
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ModernBert(config)
    for task, selected, labels in tasks([r for r in rows if not r.content.requires_image]):
        classes = sorted(set(labels))
        if len(classes) < 2:
            continue
        val_tasks = {name: (rs, ys) for name, rs, ys in tasks([r for r in validation if not r.content.requires_image])}
        vr, vy = val_tasks[task]
        valid = [(r, y) for r, y in zip(vr, vy) if y in classes]
        if not valid:
            continue
        revision = config["text_revision"]  # Pin a checkpoint commit, not a floating branch.
        tokenizer = AutoTokenizer.from_pretrained(TEXT_MODEL, revision=revision)
        encoder = AutoModel.from_pretrained(TEXT_MODEL, revision=revision).to(device)
        ordinal = task == "difficulty" and config.get("difficulty_head", "multiclass") == "ordinal"
        if ordinal:
            classes = ["1", "3", "5"]
        head = torch.nn.Linear(encoder.config.hidden_size, 2 if ordinal else len(classes)).to(device)
        optimizer = torch.optim.AdamW(list(encoder.parameters()) + list(head.parameters()), lr=config.get("learning_rate", 2e-5))
        best, stale, best_state = float("inf"), 0, None
        start = time.monotonic()

        def loss_for(row, label, encoder=encoder, tokenizer=tokenizer, head=head, ordinal=ordinal, classes=classes):
            rep = encode_question(encoder, tokenizer, row.content, config.get("max_length", 1024), device)
            logits = head(rep)
            if ordinal:
                logits = torch.stack([logits[:, 0], logits[:, 0] - torch.nn.functional.softplus(logits[:, 1])], dim=1)
                rank = classes.index(label)
                target = torch.tensor([[float(rank > 0), float(rank > 1)]], device=device)
                return torch.nn.functional.binary_cross_entropy_with_logits(logits, target)
            return torch.nn.functional.cross_entropy(logits, torch.tensor([classes.index(label)], device=device))

        for _ in range(min(config.get("epochs", 4), 10)):
            encoder.train()
            head.train()
            for i in np.random.permutation(len(selected)):
                if time.monotonic() - start > config.get("max_training_seconds", 3600):
                    raise TimeoutError("Bounded training time exceeded")
                optimizer.zero_grad()
                loss = loss_for(selected[i], labels[i])
                loss.backward()
                torch.nn.utils.clip_grad_norm_(list(encoder.parameters()) + list(head.parameters()), 1.0)
                optimizer.step()
            encoder.eval()
            head.eval()
            with torch.no_grad():
                score = np.mean([float(loss_for(r, y).cpu()) for r, y in valid])
            if score < best:
                best, stale = score, 0
                best_state = ({k: v.detach().cpu().clone() for k, v in encoder.state_dict().items()},
                              {k: v.detach().cpu().clone() for k, v in head.state_dict().items()})
            else:
                stale += 1
                if stale >= 2:
                    break
        encoder.load_state_dict(best_state[0])
        head.load_state_dict(best_state[1])
        model.estimators[task] = (encoder.cpu(), tokenizer, head.cpu(), ordinal)
        model.classes[task] = classes
    return model


class EmbeddingsXGBoost:
    def __init__(self, config):
        self.config, self.classes, self.estimators = config, {}, {}
        self.supports_images = bool(config.get("images", False))
        self.encoder = self.tokenizer = self.image_encoder = self.image_processor = None

    def initialize(self):
        import torch
        from transformers import AutoModel, AutoProcessor, AutoTokenizer
        torch.set_num_threads(min(8, self.config.get("inference_threads", 8)))
        self.tokenizer = AutoTokenizer.from_pretrained(TEXT_MODEL, revision=self.config["text_revision"], trust_remote_code=False)
        self.encoder = AutoModel.from_pretrained(TEXT_MODEL, revision=self.config["text_revision"],
                                                  trust_remote_code=False, use_safetensors=True).eval()
        for parameter in self.encoder.parameters():
            parameter.requires_grad_(False)
        if self.supports_images:
            self.image_encoder = AutoModel.from_pretrained(IMAGE_MODEL, revision=self.config["image_revision"]).eval()
            self.image_processor = AutoProcessor.from_pretrained(IMAGE_MODEL, revision=self.config["image_revision"])
            for parameter in self.image_encoder.parameters():
                parameter.requires_grad_(False)

    def features(self, contents):
        import torch
        from PIL import Image
        configured_threads = self.config.get("inference_threads")
        if configured_threads is not None and torch.get_num_threads() != configured_threads:
            torch.set_num_threads(min(8, configured_threads))
        cache = Path(self.config.get("cache_dir", "artifacts/embedding-cache"))
        cache.mkdir(parents=True, exist_ok=True)
        values = []
        for question in contents:
            definition = {"text_revision": self.config["text_revision"], "image_revision": self.config.get("image_revision"),
                          "images": self.supports_images, "max_length": self.config.get("max_length", 1024), "version": "embedding-v1"}
            key = hashlib.sha256((question.content_hash() + json.dumps(definition, sort_keys=True)).encode()).hexdigest()
            file = cache / (key + ".npy")
            if self.config.get("use_cache", True) and file.exists():
                values.append(np.load(file, allow_pickle=False))
                continue
            with torch.no_grad():
                text = encode_question(self.encoder, self.tokenizer, question, self.config.get("max_length", 1024), "cpu")[0].numpy()
                parts = [text]
                if self.supports_images:
                    size = self.image_encoder.config.vision_config.hidden_size
                    image = np.zeros(size, dtype=np.float32)
                    if question.image_base64:
                        raw = base64.b64decode(question.image_base64, validate=True)
                        picture = Image.open(io.BytesIO(raw))
                        if picture.width * picture.height > 20000000:
                            raise ValueError("Image exceeds pixel limit")
                        result = self.image_encoder.vision_model(**self.image_processor(images=picture.convert("RGB"), return_tensors="pt"))
                        image = result.pooler_output[0].numpy()
                    parts.append(image)
            full = question.text()
            structural = np.array([len(question.passage), len(question.prompt), len(question.choices),
                                   sum(c.isdigit() for c in full), sum(c in "+-=×÷<>^" for c in full),
                                   int(bool(question.image_base64)), int(question.requires_image)], dtype=np.float32)
            feature = np.concatenate([*parts, structural])
            if self.config.get("use_cache", True):
                np.save(file, feature, allow_pickle=False)
            values.append(feature)
        return np.array(values)

    def probabilities(self, task, contents):
        return self.estimators[task].predict_proba(self.features(contents))

    def probabilities_many(self, contents):
        features = self.features(contents)
        return {task: estimator.predict_proba(features) for task, estimator in self.estimators.items()}


def train_xgboost(rows, validation, seed, config):
    from xgboost import XGBClassifier
    model = EmbeddingsXGBoost(config)
    model.initialize()
    if model.supports_images and sum(r.content.requires_image and bool(r.content.image_base64) for r in rows) < 30:
        raise ValueError("At least 30 labeled visual examples are required for the experimental image candidate")
    train_rows = [r for r in rows if not r.content.requires_image or model.supports_images and r.content.image_base64]
    val_rows = [r for r in validation if not r.content.requires_image or model.supports_images and r.content.image_base64]
    val_tasks = {name: (rs, ys) for name, rs, ys in tasks(val_rows)}
    for task, selected, labels in tasks(train_rows):
        classes = sorted(set(labels))
        if len(classes) < 2:
            continue
        vr, vy = val_tasks[task]
        valid = [(r, y) for r, y in zip(vr, vy) if y in classes]
        if not valid:
            continue
        estimator = XGBClassifier(objective="multi:softprob", num_class=len(classes), n_estimators=config.get("trees", 500),
                                  max_depth=config.get("max_depth", 4), learning_rate=config.get("learning_rate", 0.05),
                                  subsample=0.8, colsample_bytree=0.8, reg_lambda=config.get("reg_lambda", 5),
                                  random_state=seed, n_jobs=2, tree_method="hist", early_stopping_rounds=25)
        estimator.fit(model.features([r.content for r in selected]), np.array([classes.index(y) for y in labels]),
                      eval_set=[(model.features([r.content for r, _ in valid]), np.array([classes.index(y) for _, y in valid]))],
                      verbose=False)
        model.classes[task] = classes
        model.estimators[task] = estimator
    return model


def train_candidate(kind, rows, validation, seed, config):
    if not config.get("budget_usd") or not config.get("paid_runs_authorized", False):
        raise ValueError("Budget is TBD. Resolve budget_usd and paid_runs_authorized before candidate training")
    for name in ["text_revision"] + (["image_revision"] if config.get("images") else []):
        if len(config.get(name, "")) != 40 or any(c not in "0123456789abcdef" for c in config[name]):
            raise ValueError(f"{name} must pin a 40-character checkpoint commit")
    if kind == "modernbert":
        return train_modernbert(rows, validation, seed, config)
    if kind == "xgboost":
        return train_xgboost(rows, validation, seed, config)
    raise ValueError("Unknown model candidate")
