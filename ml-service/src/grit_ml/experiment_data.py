"""Frozen multi-target, grouped holdout and CV for the approved CPU experiment."""
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
from pydantic import ValidationError

from .contracts import TAXONOMY, LabeledQuestion


def checksum(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def groups_for(rows):
    parent = list(range(len(rows)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen = {}
    for i, row in enumerate(rows):
        passage = " ".join(row.content.passage.split())
        for key in [("duplicate", row.duplicate_group), ("passage", row.passage_group),
                    ("passage_text", passage), ("content", row.content.content_hash())]:
            if key[1]:
                if key in seen:
                    parent[root(i)] = root(seen[key])
                seen[key] = i
    components = {}
    for i, row in enumerate(rows):
        components.setdefault(root(i), []).append(row.id)
    return {identifier: min(ids) for ids in components.values() for identifier in ids}


def assign_groups(rows, groups, fractions, seed=42):
    """Greedy vector stratification with local improvements; whole groups are indivisible."""
    skills = sorted({r.skill for r in rows if r.skill})
    difficulties = ["1", "3", "5"]
    pairs = sorted({(r.skill, r.trusted_difficulty()) for r in rows if r.skill and r.trusted_difficulty()})
    width = 1 + len(skills) + len(difficulties) + len(pairs)
    vectors = {}
    for row in rows:
        vector = vectors.setdefault(groups[row.id], np.zeros(width))
        vector[0] += 1
        if row.skill:
            vector[1 + skills.index(row.skill)] += 1
        difficulty = row.trusted_difficulty()
        if difficulty:
            vector[1 + len(skills) + difficulties.index(difficulty)] += 1
            if row.skill:
                vector[1 + len(skills) + 3 + pairs.index((row.skill, difficulty))] += 1
    total = sum(vectors.values())
    target = np.array(fractions)[:, None] * total
    denominator = np.maximum(total, 1)
    weights = np.array([4] + [1 / max(len(skills), 1)] * len(skills) + [1 / 3] * 3
                       + [0.2 / max(len(pairs), 1)] * len(pairs))
    counts = np.zeros_like(target)
    assigned = {}
    ordered = sorted(vectors, key=lambda g: (-float((vectors[g] / denominator).sum()),
                                            hashlib.sha256(f"{seed}:{g}".encode()).hexdigest()))

    def objective(value):
        return float((((value - target) / denominator) ** 2 * weights).sum())

    for group in ordered:
        choices = []
        for slot in range(len(fractions)):
            proposed = counts.copy()
            proposed[slot] += vectors[group]
            choices.append(objective(proposed))
        slot = int(np.argmin(choices))
        assigned[group] = slot
        counts[slot] += vectors[group]
    for _ in range(8):
        changed = False
        for group in ordered:
            old = assigned[group]
            best, score = old, objective(counts)
            for slot in range(len(fractions)):
                if slot == old or counts[old, 0] <= vectors[group][0]:
                    continue
                proposed = counts.copy()
                proposed[old] -= vectors[group]
                proposed[slot] += vectors[group]
                candidate = objective(proposed)
                if candidate < score - 1e-12:
                    best, score = slot, candidate
            if best != old:
                counts[old] -= vectors[group]
                counts[best] += vectors[group]
                assigned[group] = best
                changed = True
        if not changed:
            break
    return {r.id: assigned[groups[r.id]] for r in rows}


def distributions(rows):
    return {"questions": len(rows), "skills": dict(Counter(r.skill for r in rows)),
            "verified_difficulty": dict(Counter(r.trusted_difficulty() for r in rows if r.trusted_difficulty())),
            "joint": dict(Counter(f"{r.skill} / {r.trusted_difficulty()}" for r in rows if r.trusted_difficulty()))}


def prepare(source, output):
    source, output = Path(source), Path(output)
    if output.exists():
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        if manifest["source_sha256"] != checksum(source):
            raise ValueError("Frozen source changed")
        for name, expected in manifest["checksums"].items():
            if checksum(output / name) != expected:
                raise ValueError("Frozen split changed")
        return manifest
    audit = json.loads(Path(str(source) + ".manifest.json").read_text(encoding="utf-8"))
    if audit["snapshot_sha256"] != checksum(source):
        raise ValueError("Export checksum mismatch")
    canonical = {skill.casefold(): skill for domains in TAXONOMY.values() for skills in domains.values() for skill in skills}
    rows, changes, excluded = [], [], []
    for line in source.read_text(encoding="utf-8").splitlines():
        raw = json.loads(line)
        if raw["content"]["requires_image"]:
            excluded.append({"id": raw["id"], "reason": "essential_image"})
            continue
        original = raw["skill"]
        raw["skill"] = canonical.get(original.casefold(), original) if original else None
        if original != raw["skill"]:
            changes.append({"id": raw["id"], "original_skill": original, "canonical_skill": raw["skill"],
                            "difficulty_provenance": raw["difficulty_provenance"]})
        # Compiled-bank container exception is explicit and source PDF remains in audit.
        raw["source_group"] = "bank-item:" + (raw.get("duplicate_group") or raw["id"])
        try:
            rows.append(LabeledQuestion.model_validate(raw))
        except ValidationError as error:
            excluded.append({"id": raw["id"], "reason": "invalid_input", "detail": error.errors()[0]["msg"]})
    rows.sort(key=lambda r: r.id)
    groups = groups_for(rows)
    outer = assign_groups(rows, groups, [0.8, 0.2])
    train_rows = [r for r in rows if outer[r.id] == 0]
    validation = [r for r in rows if outer[r.id] == 1]
    folds = assign_groups(train_rows, groups, [0.2] * 5)
    expected_skills = {r.skill for r in rows}
    if {r.skill for r in train_rows} != expected_skills:
        raise ValueError("Training does not represent all skills")
    for fold in range(5):
        fitting = [r for r in train_rows if folds[r.id] != fold]
        if {r.skill for r in fitting} != expected_skills:
            raise ValueError("CV training fold missing a skill")
    output.mkdir(parents=True)
    files = {"train.jsonl": "\n".join(r.model_dump_json() for r in train_rows) + "\n",
             "validation.jsonl": "\n".join(r.model_dump_json() for r in validation) + "\n",
             "groups.json": json.dumps(groups, sort_keys=True), "folds.json": json.dumps(folds, sort_keys=True)}
    for name, content in files.items():
        (output / name).write_text(content, encoding="utf-8")
    manifest = {"source_sha256": checksum(source), "source_audit": audit, "seed": 42,
                "technique": "grouped multi-target greedy stratification; skill/difficulty marginals, joint secondary",
                "compiled_container_exception": True, "normalizations": changes, "excluded": excluded,
                "group_count": len(set(groups.values())), "largest_group": max(Counter(groups.values()).values()),
                "all": distributions(rows), "train": distributions(train_rows), "validation": distributions(validation),
                "folds": {str(i): distributions([r for r in train_rows if folds[r.id] == i]) for i in range(5)},
                "checksums": {name: checksum(output / name) for name in files}}
    manifest["dataset_version"] = hashlib.sha256(json.dumps(manifest["checksums"], sort_keys=True).encode()).hexdigest()[:16]
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
