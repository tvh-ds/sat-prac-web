"""Resumable independent ModernBERT target fine-tuning, on explicit CPU/CUDA."""
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import f1_score
from transformers import AutoModel, AutoTokenizer

from .candidates import TEXT_MODEL
from .experiment import target, write

FINETUNE_PREPROCESSING_VERSION = "fine-field-boundaries-v1"


def fine_chunks(question, tokenizer, max_length):
    core = "\n".join(["[SECTION] " + question.section, "[TYPE] " + question.question_type,
        "[PROMPT] " + question.prompt,
        *[f"[CHOICE {index+1}] {choice}" for index,choice in enumerate(question.choices)], "[PASSAGE] "])
    core_ids = tokenizer.encode(core,add_special_tokens=False)
    room = max_length-len(core_ids)-tokenizer.num_special_tokens_to_add(pair=False)
    if room < 64:
        raise ValueError("Prompt/choices exceed the configured token budget; no silent truncation")
    passage_ids = tokenizer.encode(question.passage,add_special_tokens=False)
    pieces = [passage_ids[index:index+room] for index in range(0,len(passage_ids),room)] or [[]]
    if len(pieces) > 32:
        raise ValueError("Passage requires more than 32 chunks; manual classification required")
    return [tokenizer.prepare_for_model(core_ids+piece,truncation=False,return_attention_mask=True) for piece in pieces]


def representations(encoder, tokenizer, questions, device, max_length=1024):
    pieces, owners = [], []
    for index, question in enumerate(questions):
        items = fine_chunks(question, tokenizer, max_length)
        pieces.extend(items)
        owners.extend([index] * len(items))
    inputs = {key: value.to(device) for key, value in tokenizer.pad(pieces, return_tensors="pt").items()
              if key in {"input_ids", "attention_mask"}}
    hidden = encoder(**inputs).last_hidden_state
    mask = inputs["attention_mask"].unsqueeze(-1)
    pooled = (hidden * mask).sum(1) / mask.sum(1).clamp_min(1)
    return torch.stack([pooled[[i for i, owner in enumerate(owners) if owner == index]].mean(0)
                        for index in range(len(questions))])


def weighted_loss(logits, labels, weights):
    # Weighted sum / question count: unlike weighted-mean CE, weights remain effective with microbatch size 1.
    losses = torch.nn.functional.cross_entropy(logits, labels, reduction="none")
    return (losses * weights[labels]).sum()


class FineTunedModernBert:
    supports_images = False

    def __init__(self, config=None):
        self.config = config or {"inference_threads": 8, "max_length": 1024}
        self.estimators, self.classes = {}, {}

    def probabilities(self, task, contents):
        torch.set_num_threads(min(8, self.config.get("inference_threads", 8)))
        encoder, tokenizer, head = self.estimators[task]
        device = self.config.get("inference_device", "cpu")
        encoder.to(device)
        head.to(device)
        encoder.eval()
        head.eval()
        output = []
        with torch.no_grad():
            for offset in range(0, len(contents), 2):
                rep = representations(encoder, tokenizer, contents[offset:offset+2], device, self.config["max_length"])
                output.extend(head(rep).softmax(-1).cpu().numpy())
        return np.array(output)


def train_target(rows, validation, task, revision, config, seed, directory, device="cpu", max_seconds=None):
    """Epoch choice uses inner validation only; final fits pass no validation and fixed epoch count."""
    start = time.perf_counter()
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(8)
    torch.manual_seed(seed)
    if device == "cuda":
        if not torch.cuda.is_available():
            raise ValueError("CUDA GPU unavailable")
        torch.cuda.manual_seed_all(seed)
        torch.cuda.reset_peak_memory_stats()
    loading_start = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(TEXT_MODEL, revision=revision, trust_remote_code=False)
    encoder = AutoModel.from_pretrained(TEXT_MODEL, revision=revision, trust_remote_code=False,
                                       use_safetensors=True, attn_implementation="sdpa",
                                       reference_compile=False).to(device)
    encoder.train()
    for parameter in encoder.parameters():
        parameter.requires_grad_(True)
    classes = sorted({target(r, task) for r in rows})
    labels = np.array([classes.index(target(r, task)) for r in rows])
    head = torch.nn.Linear(encoder.config.hidden_size, len(classes)).to(device)
    counts = np.bincount(labels, minlength=len(classes))
    weights = torch.tensor(len(rows)/(len(classes)*counts) if config["weighting"] == "balanced"
                           else np.ones(len(classes)), dtype=torch.float32, device=device)
    optimizer = torch.optim.AdamW([*encoder.parameters(), *head.parameters()], lr=config["learning_rate"], weight_decay=.01)
    scaler = torch.amp.GradScaler("cuda",enabled=device == "cuda")
    precision = "float16_autocast_float32_parameters" if device == "cuda" else "float32"
    epochs = config.get("epochs", 3)
    effective_batch = 16
    steps_per_epoch = math.ceil(len(rows)/effective_batch)
    total_steps = steps_per_epoch * epochs
    warmup = max(1, math.ceil(total_steps*.1))
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer,
        lambda step: min((step+1)/warmup, max(0., (total_steps-step)/max(1,total_steps-warmup))))
    current = directory / "state.pt"
    best_file = directory / "best.pt"
    completed = directory / "training.json"
    fingerprint = hashlib.sha256("\n".join(r.model_dump_json() for r in [*rows,*validation]).encode()).hexdigest()
    epoch_start, offset_start, best_score, best_epoch, stale, updates = 0, 0, -1., 0, 0, 0
    history = []
    prior_seconds = 0.
    prior_times = {}
    if current.exists():
        checkpoint = torch.load(current, map_location=device, weights_only=True)
        if (checkpoint["config"] != config or checkpoint["seed"] != seed
            or checkpoint["ids"] != [r.id for r in rows] or checkpoint["revision"] != revision
            or checkpoint["validation_ids"] != [r.id for r in validation] or checkpoint["task"] != task
            or checkpoint["input_fingerprint"] != fingerprint or checkpoint["training_precision"] != precision
            or checkpoint.get("preprocessing_version") != FINETUNE_PREPROCESSING_VERSION):
            raise ValueError("Fine-tuning checkpoint lineage mismatch")
        encoder.load_state_dict(checkpoint["encoder"])
        head.load_state_dict(checkpoint["head"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        scheduler.load_state_dict(checkpoint["scheduler"])
        scaler.load_state_dict(checkpoint["scaler"])
        torch.set_rng_state(checkpoint["rng"].cpu())
        if device == "cuda":
            torch.cuda.set_rng_state_all([value.cpu() for value in checkpoint["cuda_rng"]])
        epoch_start, offset_start = checkpoint["epoch"], checkpoint["offset"]
        best_score, best_epoch, stale, updates = checkpoint["best_score"], checkpoint["best_epoch"], checkpoint["stale"], checkpoint["updates"]
        history = checkpoint["history"]
        prior_seconds = checkpoint.get("elapsed_seconds",0.)
        prior_times = checkpoint.get("timings",{})
        del checkpoint
    phase_times = {"loading_seconds": time.perf_counter()-loading_start,
                   "train_seconds": 0., "evaluation_seconds": 0., "checkpoint_seconds": 0.}
    phase_times = {key:value+prior_times.get(key,0.) for key,value in phase_times.items()}
    if completed.exists():
        best = torch.load(best_file, map_location=device, weights_only=True)
        encoder.load_state_dict(best["encoder"])
        head.load_state_dict(best["head"])
        return (encoder.cpu(), tokenizer, head.cpu()), classes, json.loads(completed.read_text())

    def save(epoch, offset):
        before = time.perf_counter()
        temporary = directory / "state.partial"
        torch.save({"config": config, "seed": seed, "ids": [r.id for r in rows], "revision": revision,
            "validation_ids": [r.id for r in validation], "task": task,"input_fingerprint":fingerprint,
            "encoder": encoder.state_dict(),
            "head": head.state_dict(), "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(),
            "scaler":scaler.state_dict(),"training_precision":precision,
            "preprocessing_version":FINETUNE_PREPROCESSING_VERSION,
            "rng": torch.get_rng_state(), "cuda_rng": torch.cuda.get_rng_state_all() if device == "cuda" else [],
            "epoch": epoch, "offset": offset, "best_score": best_score, "best_epoch": best_epoch,
            "stale": stale, "updates": updates, "history": history,"timings":phase_times,
            "elapsed_seconds":prior_seconds+time.perf_counter()-start}, temporary)
        temporary.replace(current)
        phase_times["checkpoint_seconds"] += time.perf_counter() - before

    for epoch in range(epoch_start, epochs):
        if validation and stale >= 1:
            break
        encoder.train()
        head.train()
        indices = np.random.default_rng(seed+epoch).permutation(len(rows)).tolist()
        # Sort short shuffled buckets by length; keep stochastic bucket membership.
        indices = [i for offset in range(0,len(indices),128)
                   for i in sorted(indices[offset:offset+128], key=lambda i: len(rows[i].content.text()))]
        for offset in range(offset_start if epoch == epoch_start else 0, len(indices), effective_batch):
            selected = indices[offset:offset+effective_batch]
            before = time.perf_counter()
            optimizer.zero_grad(set_to_none=True)
            for sub in range(0,len(selected),2):
                batch = selected[sub:sub+2]
                with torch.autocast(device_type=device,dtype=torch.float16,enabled=device == "cuda"):
                    rep = representations(encoder, tokenizer, [rows[i].content for i in batch], device)
                    y = torch.tensor(labels[batch], device=device)
                    loss = weighted_loss(head(rep), y, weights) / len(selected)
                scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_([*encoder.parameters(), *head.parameters()],1.)
            previous_scale = scaler.get_scale()
            scaler.step(optimizer)
            scaler.update()
            if scaler.get_scale() >= previous_scale:
                scheduler.step()
            if device == "cuda":
                torch.cuda.synchronize()
            updates += 1
            phase_times["train_seconds"] += time.perf_counter()-before
            if updates % 50 == 0:
                save(epoch, offset+len(selected))
            if max_seconds is not None and time.perf_counter()-start > max_seconds:
                save(epoch, offset+len(selected))
                raise TimeoutError("Bounded fine-tuning runtime exceeded; checkpoint retained")
        before = time.perf_counter()
        score = None
        if validation:
            encoder.eval()
            head.eval()
            predictions = []
            with torch.no_grad():
                for offset in range(0,len(validation),2):
                    rep = representations(encoder, tokenizer, [r.content for r in validation[offset:offset+2]], device)
                    predictions.extend(head(rep).argmax(-1).cpu().tolist())
            score = float(f1_score([classes.index(target(r,task)) for r in validation], predictions,
                                   labels=list(range(len(classes))), average="macro", zero_division=0))
            phase_times["evaluation_seconds"] += time.perf_counter()-before
            before = time.perf_counter()
            if score > best_score:
                best_score, best_epoch, stale = score, epoch+1, 0
                torch.save({"encoder": encoder.state_dict(), "head": head.state_dict()}, best_file)
            else:
                stale += 1
        else:
            best_epoch = epoch+1
            torch.save({"encoder": encoder.state_dict(), "head": head.state_dict()}, best_file)
        phase_times["checkpoint_seconds"] += time.perf_counter()-before
        history.append({"epoch": epoch+1, "validation_macro_f1": score})
        save(epoch+1, 0)
        print(f"{task} epoch {epoch+1}: macro-F1={score}", flush=True)
        if validation and stale >= 1:
            break
    best = torch.load(best_file, map_location=device, weights_only=True)
    encoder.load_state_dict(best["encoder"])
    head.load_state_dict(best["head"])
    result = {"best_epoch": best_epoch, "history": history, "seconds": prior_seconds+time.perf_counter()-start,
              "timings": phase_times, "device": device, "dtype": "float32", "encoder_finetuned": True}
    result["training_precision"] = precision
    result["preprocessing_version"] = FINETUNE_PREPROCESSING_VERSION
    result.update(attention_implementation="sdpa",reference_compile=False)
    if device == "cuda":
        result.update(gpu=torch.cuda.get_device_name(0),cuda_version=torch.version.cuda,
            gpu_peak_allocated_mb=torch.cuda.max_memory_allocated()/1048576,
            gpu_peak_reserved_mb=torch.cuda.max_memory_reserved()/1048576)
    write(completed,result)
    return (encoder.cpu(), tokenizer, head.cpu()), classes, result
