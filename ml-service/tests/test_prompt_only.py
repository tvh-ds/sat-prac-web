from types import SimpleNamespace

import numpy as np
import pytest
import torch
from test_pipeline import row

from grit_ml.contracts import QuestionInput
from grit_ml.prompt_experiment import audit_prompts, fit_prompt
from grit_ml.prompt_models import PromptEmbedding, PromptOnlyInput, prompt_rows


class Tokenizer:
    def __init__(self):
        self.seen = []
    def encode(self,text,add_special_tokens=False):
        self.seen.append(text)
        return [ord(c) for c in text]
    def num_special_tokens_to_add(self,pair=False):
        return 0
    def prepare_for_model(self,ids,**kwargs):
        return {'input_ids':ids,'attention_mask':[1]*len(ids)}
    def pad(self,pieces,return_tensors):
        return {k:torch.tensor([p[k] for p in pieces]) for k in ['input_ids','attention_mask']}


class Encoder(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.weight = torch.nn.Parameter(torch.ones(1),requires_grad=False)
        self.calls = 0
    def forward(self,input_ids,attention_mask):
        self.calls += 1
        return SimpleNamespace(last_hidden_state=input_ids.float().unsqueeze(-1).expand(-1,-1,768))


def question():
    return QuestionInput(section='reading_writing',question_type='multiple_choice',prompt='Which is NOT 123?',passage='excludedpassage',choices=['excludedchoicea','excludedchoiceb'])


def test_raw_prompt_is_the_only_text_and_vocabulary_feature():
    rows = [row(i) for i in range(10)]
    rows = [r.model_copy(update={'content':question().model_copy(update={'prompt':'first label' if i%2 else 'second label'})}) for i,r in enumerate(rows)]
    projected = prompt_rows(rows)
    assert all(isinstance(r.content,PromptOnlyInput) and r.content.text()==r.content.prompt for r in projected)
    estimator,_ = fit_prompt('tfidf_lr',projected,'skill:reading_writing',1.,'ordinary',42,{})
    words = estimator.named_steps['features'].transformer_list[0][1].vocabulary_
    assert 'excludedpassage' not in words and 'excludedchoicea' not in words
    assert 'section' not in words and 'multiple_choice' not in words


def test_embedding_ignores_every_other_field_and_cache_is_prompt_keyed(tmp_path):
    encoder, tokenizer = Encoder(),Tokenizer()
    reference = SimpleNamespace(config={'text_revision':'frozen','max_length':8},encoder=encoder,tokenizer=tokenizer)
    model = PromptEmbedding.from_reference(reference,tmp_path)
    q = question()
    changed = q.model_copy(update={'passage':'different','choices':['different'], 'section':'math','requires_image':True,'image_base64':'ignored','question_type':'student_produced'})
    before = model.features([q])
    calls = encoder.calls
    np.testing.assert_array_equal(before,model.features([changed]))
    assert encoder.calls==calls and len(list(tmp_path.glob('*.npy')))==1
    assert tokenizer.seen==[q.prompt] and before.shape==(1,768)
    assert not encoder.weight.requires_grad
    model.config['use_cache']=False
    np.testing.assert_array_equal(before,model.features([q]))
    assert encoder.calls>calls


def test_prompt_chunking_rejects_excess_without_truncating(tmp_path):
    reference = SimpleNamespace(config={'text_revision':'frozen','max_length':8},encoder=Encoder(),tokenizer=Tokenizer())
    model = PromptEmbedding.from_reference(reference,tmp_path)
    model.features([question().model_copy(update={'prompt':'a'*256})])
    with pytest.raises(ValueError,match='no silent truncation'):
        model.features([question().model_copy(update={'prompt':'a'*257})])


def test_trainable_encoder_rejected(tmp_path):
    encoder = Encoder()
    encoder.weight.requires_grad_(True)
    with pytest.raises(ValueError,match='frozen'):
        PromptEmbedding.from_reference(SimpleNamespace(config={},encoder=encoder,tokenizer=Tokenizer()),tmp_path)


def test_prompt_overlap_and_conflicting_difficulty_audit():
    a,b,c = [r.model_copy(update={'content':question()}) for r in [row(0),row(1),row(2)]]
    a=a.model_copy(update={'difficulty':1,'difficulty_provenance':'source'})
    b=b.model_copy(update={'difficulty':5,'difficulty_provenance':'source'})
    audit = audit_prompts([a,b],[c])
    assert audit['shared_prompt_strings']==1 and audit['validation_questions_with_seen_prompt']==1
    assert audit['difficulty']['training_prompts_with_conflicting_labels']==1
