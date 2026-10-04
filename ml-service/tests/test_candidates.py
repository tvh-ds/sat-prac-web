import numpy as np
import pytest

from grit_ml.candidates import EmbeddingsXGBoost, chunks, train_candidate, train_modernbert, train_xgboost
from grit_ml.contracts import LabeledQuestion, QuestionInput


def rows():
    result = []
    for i in range(24):
        result.append(LabeledQuestion(id=str(i), source_group=str(i), domain="Algebra",
            skill=["Linear equations in one variable", "Linear functions in one variable"][i % 2],
            difficulty=[1, 3, 5][i % 3], difficulty_provenance="source",
            content=QuestionInput(section="math", question_type="student_produced", prompt="solve linear " + str(i))))
    return result


@pytest.fixture
def tiny_encoder(monkeypatch):
    import torch
    from tokenizers import Tokenizer
    from tokenizers.models import WordLevel
    from tokenizers.pre_tokenizers import Whitespace
    from transformers import AutoModel, AutoTokenizer, BertConfig, BertModel, PreTrainedTokenizerFast
    torch.set_num_threads(1)
    tokenizer = Tokenizer(WordLevel({"[UNK]": 0, "[PAD]": 1, "solve": 2, "linear": 3}, unk_token="[UNK]"))
    tokenizer.pre_tokenizer = Whitespace()
    fast = PreTrainedTokenizerFast(tokenizer_object=tokenizer, unk_token="[UNK]", pad_token="[PAD]")
    monkeypatch.setattr(AutoTokenizer, "from_pretrained", lambda *a, **kw: fast)
    monkeypatch.setattr(AutoModel, "from_pretrained", lambda *a, **kw: BertModel(BertConfig(
        vocab_size=4, hidden_size=16, intermediate_size=32, num_hidden_layers=1, num_attention_heads=2)))
    return fast


@pytest.mark.parametrize("head", ["multiclass", "ordinal"])
def test_modernbert_training_and_probabilities(tiny_encoder, head):
    # Random tiny encoder validates gradient/early-stop/serialization paths; no paid run/download.
    model = train_modernbert(rows(), rows()[:9], 42, {"text_revision": "0" * 40, "epochs": 1,
        "max_length": 128, "difficulty_head": head, "max_training_seconds": 60})
    assert set(model.classes) == {"skill:math", "difficulty"}
    p = model.probabilities("difficulty", [rows()[0].content])
    assert p.shape == (1, 3)
    assert np.all(p >= 0)
    np.testing.assert_allclose(p.sum(axis=1), 1, atol=1e-6)


def test_xgboost_classifier_uses_frozen_features(monkeypatch):
    monkeypatch.setattr(EmbeddingsXGBoost, "initialize", lambda self: None)
    monkeypatch.setattr(EmbeddingsXGBoost, "features", lambda self, contents: np.array([
        [int(q.prompt.split()[-1]) % 2, int(q.prompt.split()[-1]) % 3] for q in contents]))
    model = train_xgboost(rows(), rows()[:9], 42, {"text_revision": "0" * 40, "trees": 30})
    assert model.probabilities("skill:math", [rows()[0].content]).shape == (1, 2)
    np.testing.assert_allclose(model.probabilities("difficulty", [rows()[0].content]).sum(), 1, atol=1e-6)


def test_budget_gate_and_long_passage_preservation(tiny_encoder):
    with pytest.raises(ValueError, match="Budget"):
        train_candidate("modernbert", rows(), rows(), 42, {})
    question = rows()[0].content.model_copy(update={"passage": "linear " * 1000})
    parts = chunks(question, tiny_encoder, 128)
    assert len(parts) > 1
    expected = len(tiny_encoder.encode(question.passage, add_special_tokens=False))
    core = len(tiny_encoder.encode(question.model_copy(update={"passage": ""}).text(), add_special_tokens=False))
    assert sum(len(p["input_ids"]) - core for p in parts) == expected
