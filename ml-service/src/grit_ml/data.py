import hashlib
import json
import subprocess
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from .contracts import PREPROCESSING_VERSION, TAXONOMY_VERSION, LabeledQuestion


def load_rows(path: Path) -> list[LabeledQuestion]:
    return [LabeledQuestion.model_validate(json.loads(line)) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def build_dataset(source: Path, output: Path, seed: int = 42, source_query: str = "reviewed question-bank export"):
    """Connected-component splitting prevents transitive passage/document/duplicate leakage."""
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    audit_path = Path(str(source) + ".manifest.json")
    source_audit = json.loads(audit_path.read_text()) if audit_path.exists() else None
    if source_audit and source_audit.get("snapshot_sha256") != source_hash:
        raise ValueError("Source snapshot checksum disagrees with export audit")
    rows, quarantine = [], []
    for i, line in enumerate(source.read_text(encoding="utf-8-sig").splitlines()):
        if not line.strip():
            continue
        try:
            rows.append(LabeledQuestion.model_validate(json.loads(line)))
        except (ValueError, TypeError) as exc:
            quarantine.append({"line": i + 1, "reason": str(exc)})
    if len({r.id for r in rows}) != len(rows):
        raise ValueError("Duplicate row IDs; resolve source export before dataset build")
    parent = list(range(len(rows)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    groups = {}
    for i, row in enumerate(rows):
        passage = hashlib.sha256(row.content.passage.encode()).hexdigest() if row.content.passage.strip() else None
        for key in [("source", row.source_group), ("passage", row.passage_group), ("passage_text", passage),
                    ("duplicate", row.duplicate_group), ("content", row.content.content_hash())]:
            if key[1]:
                if key in groups:
                    parent[root(i)] = root(groups[key])
                groups[key] = i
    components = {}
    for i, row in enumerate(rows):
        components.setdefault(root(i), []).append(row)
    # Hash assignment is reproducible and independent of label values or row order.
    splits = {"train": [], "validation": [], "test": []}
    for component in components.values():
        key = min(r.id for r in component)
        bucket = int(hashlib.sha256(f"{seed}:{key}".encode()).hexdigest()[:8], 16) % 100
        name = "train" if bucket < 70 else "validation" if bucket < 85 else "test"
        splits[name].extend(component)
    if any(not v for v in splits.values()):
        raise ValueError("Too few independent source groups for a nonempty grouped split; gather more sources")
    if output.exists():
        raise ValueError("Dataset output must be a new immutable directory")
    output.mkdir(parents=True)
    checksums = {}
    for name, split in splits.items():
        raw = "\n".join(r.model_dump_json() for r in sorted(split, key=lambda r: r.id)) + "\n"
        (output / f"{name}.jsonl").write_text(raw, encoding="utf-8")
        checksums[name] = hashlib.sha256(raw.encode()).hexdigest()
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], text=True).strip())
    except (OSError, subprocess.CalledProcessError):
        commit, dirty = "unknown", True
    manifest = {"source_sha256": source_hash, "source_query": source_query, "source_audit": source_audit,
                "seed": seed, "code_commit": commit, "working_tree_dirty": dirty,
                "taxonomy_version": TAXONOMY_VERSION, "preprocessing_version": PREPROCESSING_VERSION,
                "created_at": datetime.now(UTC).isoformat(), "checksums": checksums,
                "counts": {k: len(v) for k, v in splits.items()}, "independent_groups": len(components),
                "skills": dict(Counter(f"{r.content.section}:{r.skill}" for r in rows if r.skill)),
                "trusted_difficulties": dict(Counter(r.trusted_difficulty() for r in rows if r.trusted_difficulty())),
                "visual_count": sum(r.content.requires_image for r in rows), "quarantined": quarantine}
    manifest["dataset_version"] = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest()[:16]
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
