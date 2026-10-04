from types import SimpleNamespace

import numpy as np
import pytest
import torch
from test_pipeline import row

from grit_ml.finetune import fine_chunks, train_target, weighted_loss


class TinyEncoder(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding = torch.nn.Embedding(16,4)
        self.config = SimpleNamespace(hidden_size=4)

    def forward(self,input_ids,attention_mask):
        return SimpleNamespace(last_hidden_state=self.embedding(input_ids))


class TinyTokenizer:
    def encode(self,text,add_special_tokens=False):
        return [ord(c)%15+1 for c in text[:8]]

    def num_special_tokens_to_add(self,pair=False):
        return 0

    def prepare_for_model(self,ids,**kwargs):
        return {"input_ids":ids,"attention_mask":[1]*len(ids)}

    def pad(self,pieces,return_tensors):
        length = max(len(p["input_ids"]) for p in pieces)
        return {key:torch.tensor([p[key]+[0]*(length-len(p[key])) for p in pieces])
                for key in ["input_ids","attention_mask"]}


def test_balanced_loss_changes_single_example_gradient():
    logits = torch.tensor([[.1,.2]],requires_grad=True)
    loss = weighted_loss(logits,torch.tensor([0]),torch.tensor([3.,1.]))
    unweighted = torch.nn.functional.cross_entropy(logits,torch.tensor([0]))
    assert torch.allclose(loss,3*unweighted)


def test_fine_chunks_keep_fields_and_reconstruct_complete_passage():
    class Characters(TinyTokenizer):
        def encode(self,text,add_special_tokens=False):
            return [ord(character) for character in text]

    question = row(0).content.model_copy(update={'prompt':'Which is NOT 123?',
        'choices':['First 1+2','Second 9-8'],'passage':'A passage with numbers 123 and negation NOT. '*12})
    pieces = fine_chunks(question,Characters(),256)
    decoded = [''.join(chr(value) for value in piece['input_ids']) for piece in pieces]
    assert len(decoded) > 1
    reconstructed = []
    for text in decoded:
        prefix,passage = text.split('[PASSAGE] ',1)
        assert '[PROMPT] Which is NOT 123?' in prefix
        assert prefix.index('[CHOICE 1] First 1+2') < prefix.index('[CHOICE 2] Second 9-8')
        assert len(text) <= 256
        reconstructed.append(passage)
    assert ''.join(reconstructed) == question.passage


def test_full_encoder_training_resume_and_lineage(monkeypatch,tmp_path):
    import grit_ml.finetune as module
    initial = {}

    def encoder(*args,**kwargs):
        result = TinyEncoder()
        initial["weights"] = result.embedding.weight.detach().clone()
        return result

    monkeypatch.setattr(module.AutoModel,"from_pretrained",encoder)
    monkeypatch.setattr(module.AutoTokenizer,"from_pretrained",lambda *args,**kwargs:TinyTokenizer())
    rows = [row(i) for i in range(32)]
    config = {"learning_rate":.01,"weighting":"balanced","epochs":2}
    fitted,classes,result = train_target(rows,[],"difficulty","a"*40,config,42,tmp_path)
    assert result["best_epoch"] == 2
    assert not torch.equal(initial["weights"],fitted[0].embedding.weight)
    assert all(p.requires_grad for p in fitted[0].parameters())
    before = fitted[0].embedding.weight.detach().numpy().copy()
    restored,actual,again = train_target(rows,[],"difficulty","a"*40,config,42,tmp_path)
    np.testing.assert_array_equal(before,restored[0].embedding.weight.detach().numpy())
    assert classes == actual
    assert result == again
    with pytest.raises(ValueError,match="lineage"):
        train_target(rows,[],"difficulty","b"*40,config,42,tmp_path)
    changed = [rows[0].model_copy(update={"content":rows[0].content.model_copy(update={"prompt":"Changed content"})}),*rows[1:]]
    with pytest.raises(ValueError,match="lineage"):
        train_target(changed,[],"difficulty","a"*40,config,42,tmp_path)


def test_optimizer_update_checkpoint_resumes_identically(monkeypatch,tmp_path):
    import grit_ml.finetune as module
    monkeypatch.setattr(module.AutoModel,"from_pretrained",lambda *args,**kwargs:TinyEncoder())
    monkeypatch.setattr(module.AutoTokenizer,"from_pretrained",lambda *args,**kwargs:TinyTokenizer())
    rows = [row(i) for i in range(32)]
    config = {"learning_rate":.01,"weighting":"balanced","epochs":2}
    complete,_,_ = train_target(rows,[],"difficulty","a"*40,config,42,tmp_path/"complete")
    with pytest.raises(TimeoutError,match="checkpoint"):
        train_target(rows,[],"difficulty","a"*40,config,42,tmp_path/"interrupted",max_seconds=0)
    resumed,_,_ = train_target(rows,[],"difficulty","a"*40,config,42,tmp_path/"interrupted")
    for before,after in zip(complete[0].parameters(),resumed[0].parameters()):
        torch.testing.assert_close(before,after,rtol=0,atol=0)
    for before,after in zip(complete[2].parameters(),resumed[2].parameters()):
        torch.testing.assert_close(before,after,rtol=0,atol=0)


def test_checkpoint_cleanup_refuses_root_and_unowned_directories(tmp_path):
    from grit_ml.finetune_experiment import remove_completed_checkpoint
    with pytest.raises(ValueError,match="escaped"):
        remove_completed_checkpoint(tmp_path,tmp_path)
    child = tmp_path/"unowned"
    child.mkdir()
    with pytest.raises(ValueError,match="evidence"):
        remove_completed_checkpoint(child,tmp_path)
    assert child.exists()
