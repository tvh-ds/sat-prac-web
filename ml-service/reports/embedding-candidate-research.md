# Embedding candidates for SAT R&W classification

Research checked 2026-10-04. These are suggestions for a later experiment; neither model has been trained or evaluated on this bank in the current comparison.

The existing cache uses the original masked-language-model checkpoint `answerdotai/ModernBERT-base`. Its pooled vectors were not trained specifically to represent questions for skill or difficulty classification. Fine-tuning directly on the bank addresses that mismatch. A separately trained embedding checkpoint is another way to test the representation without changing the downstream classifier.

## First choice: GTE ModernBERT-base

[`Alibaba-NLP/gte-modernbert-base`](https://huggingface.co/Alibaba-NLP/gte-modernbert-base) is an English embedding model built on ModernBERT, with 149 million parameters, 768-dimensional output, and an 8,192-token context. Its model card specifies CLS pooling and optional L2 normalization, and reports generic classification benchmarks as part of MTEB. The published license is Apache 2.0.

I recommend this as the next frozen-embedding experiment because its size and output dimension are close to the current encoder, while its training objective is designed for embeddings. That is an inference about experimental usefulness, not evidence that it will improve SAT classification. Use its documented CLS pooling, pin an immutable revision, generate a separate cache, and compare logistic regression and Linear SVM with the same frozen groups and training-only tuning. Never mix its vectors with the original ModernBERT cache.

## Alternative: Jina embeddings v3 with the classification adapter

[`jinaai/jina-embeddings-v3`](https://huggingface.co/jinaai/jina-embeddings-v3) provides a classification-specific task adapter. The authors' [paper](https://arxiv.org/abs/2409.10173) describes a 570-million-parameter backbone, task-specific LoRA adapters, and an 8,192-token context. This makes its classification adapter relevant to a feature-based experiment, although the larger model adds encoding cost. The released checkpoint's [file listing](https://huggingface.co/jinaai/jina-embeddings-v3/tree/main) identifies a CC BY-NC 4.0 license; commercial production use would need a separate license decision before adoption.

## Education-specific research, rather than a verified replacement checkpoint

[TACNN (AAAI 2017)](https://ojs.aaai.org/index.php/AAAI/article/view/10740) directly studies English reading-question difficulty. It uses question text, attention over sentences, historical test logs, and test-dependent pairwise learning. Its relevance is architectural: model relationships between passage, prompt, and options instead of relying only on one pooled vector. It is not evidence for a ready-made encoder trained on this project's skill taxonomy or three editorial labels, and its historical-test-log setup differs from the current text-only labels.

[QuesNet (KDD 2019)](https://arxiv.org/abs/1905.10949) specifically studies representations of heterogeneous educational questions, combining linguistic information with domain logic and knowledge. It is a useful research direction for educational pretraining. The cited abstract does not establish a directly compatible English SAT checkpoint or performance on our labels, so it is not selected as a replacement in this run.

If the approved fine-tuning experiment still leaves difficulty weak, a later question-aware pooling/attention experiment is more targeted than merely swapping the tree classifier. This is a proposed hypothesis requiring the same leakage controls and independent evaluation, not a measured improvement.

## What these models cannot establish

Neither cited source establishes performance on this project's ten R&W skills, source-verified Easy/Medium/Hard labels, or independent full-length drafts. Generic embedding scores do not measure question-solving difficulty. Any future evaluation must preserve prompts, choice order, numbers, negation, and passage boundaries; exclude answer keys and explanations; and report long-input coverage, per-skill recall, difficulty errors, calibration, and complete encoding latency.

The current experiment proceeds with the already approved original-cache classifiers and supervised ModernBERT fine-tuning. The existing outer bank validation has been inspected during earlier development, so results there remain exploratory. A new, independently labeled full-length holdout is necessary before making a production promotion decision.
