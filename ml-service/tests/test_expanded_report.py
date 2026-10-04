import numpy as np
from sklearn.metrics import f1_score

from grit_ml.expanded_report import paired_macro_f1


def test_group_bootstrap_matches_sklearn_macro_f1():
    truth = ['a','a','b','b','c','c']
    first = ['a','b','b','a','c','c']
    second = ['a','a','b','b','c','a']
    a = {str(i):{'true':t,'predicted':p} for i,(t,p) in enumerate(zip(truth,first))}
    b = {str(i):{'true':t,'predicted':p} for i,(t,p) in enumerate(zip(truth,second))}
    groups = {str(i):str(i//2) for i in range(6)}
    rng = np.random.default_rng(42)
    differences = []
    for _ in range(80):
        members = [i for group in rng.choice(3,3,replace=True) for i in range(group*2,group*2+2)]
        scores = [f1_score([truth[i] for i in members],[values[i] for i in members],
            labels=['a','b','c'],average='macro',zero_division=0) for values in [first,second]]
        differences.append(scores[1]-scores[0])
    np.testing.assert_allclose(paired_macro_f1(a,b,groups,resamples=80),
        np.quantile(differences,[.025,.975]),rtol=0,atol=1e-12)
