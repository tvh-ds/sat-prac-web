from contextlib import nullcontext

from grit_ml import expanded_experiment as module


def test_tuning_isolated_between_artifact_folders_and_resumes(monkeypatch,tmp_path):
    monkeypatch.setattr(module,'ROOT',tmp_path)
    calls = []

    def evaluate(kind,rows,task,value,weight,folds,folder,features):
        calls.append(folder.name)
        return {'macro_f1_mean':.5,'macro_f1_std':0.,'log_loss_mean':value,
            'seconds':0.,'parameter':value,'classes':[],'oof':[]}

    monkeypatch.setattr(module,'cv_trial',evaluate)
    monkeypatch.setattr(module.mlflow,'start_run',lambda **kwargs:nullcontext())
    monkeypatch.setattr(module.mlflow,'log_params',lambda *args:None)
    monkeypatch.setattr(module.mlflow,'log_metrics',lambda *args:None)
    first,second = tmp_path/'first',tmp_path/'second'
    first.mkdir()
    second.mkdir()
    for folder in [first,second]:
        module.tune('embedding_svm',[],'difficulty','ordinary',{},folder,None)
        assert calls.count(folder.name) == 21  # Twenty new trials plus selected OOF retrieval.
        assert (folder/'optuna.db').exists()
    module.tune('embedding_svm',[],'difficulty','ordinary',{},first,None)
    assert calls.count('first') == 22  # Completed trials are reused within their own folder.
