import argparse
import json
from pathlib import Path

from .artifacts import load_artifact
from .data import build_dataset, load_rows
from .training import evaluate_model, train


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("dataset")
    build.add_argument("source", type=Path)
    build.add_argument("output", type=Path)
    fit = sub.add_parser("train")
    fit.add_argument("dataset", type=Path)
    fit.add_argument("output", type=Path)
    fit.add_argument("--kind", choices=["baseline", "modernbert", "xgboost"], default="baseline")
    fit.add_argument("--seed", type=int, default=42)
    fit.add_argument("--config", type=Path)
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("artifact", type=Path)
    evaluate.add_argument("holdout", type=Path)
    evaluate.add_argument("--final-test", action="store_true", help="Explicitly unlock untouched final test evaluation")
    args = parser.parse_args()
    if args.command == "dataset":
        result = build_dataset(args.source, args.output)
    elif args.command == "train":
        config = json.loads(args.config.read_text()) if args.config else {}
        result = train(args.dataset, args.output, args.kind, args.seed, config)
    else:
        if not args.final_test:
            parser.error("Final holdout evaluation requires --final-test; tune on validation only")
        model, metadata = load_artifact(args.artifact)
        result = evaluate_model(model, load_rows(args.holdout), metadata["policies"])
        (args.artifact / "final-evaluation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
