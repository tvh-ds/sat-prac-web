"""Measured prompt-only comparisons, refreshed after each completed method."""
import json
from pathlib import Path

from scipy.stats import binomtest

from .expanded_report import paired_macro_f1
from .experiment_report import table

ROOT = Path("ml-service/artifacts/prompt-only-v1")
REFERENCE = Path("ml-service/artifacts/cpu-comparison-v1")
NAMES = {"tfidf_lr":"TF-IDF + logistic regression","tfidf_svm":"TF-IDF + Linear SVM", "tfidf_nb":"TF-IDF + Complement NB",
         "embedding_xgb":"Frozen ModernBERT + XGBoost","embedding_lr":"Frozen ModernBERT + logistic regression",
         "embedding_svm":"Frozen ModernBERT + Linear SVM"}
OLD = {"tfidf_lr":REFERENCE/"baseline", "embedding_xgb":REFERENCE/"xgboost",
       **{k:Path("ml-service/artifacts/cpu-expanded-v1")/k for k in ["tfidf_svm","tfidf_nb","embedding_lr","embedding_svm"]}}

def f(x):
    return "—" if x is None else f"{x:.4f}"

def render():
    ROOT.mkdir(parents=True,exist_ok=True)
    completed = {k:json.loads((ROOT/k/"results.json").read_text()) for k in NAMES if (ROOT/k/"results.json").exists()}
    report = "# Prompt-only classification comparison\n\n"
    report += "The sole model input is raw question prompt text. No passage, answer choices, section/type tokens, field markers, image indicators, or structural numerical features enter the estimators. TF-IDF uses word 1–2 grams and character 2–5 grams; frozen original ModernBERT produces 768-dimensional masked-mean embeddings with bounded complete-prompt chunking. No fine-tuning, paid compute, promotion, deployment, or cloud changes.\n\n"
    report += "Dataset 0d78eb3734e065ed; original immutable seed-42 grouped multi-target 80/20 split and five training-only CV folds. Skill: 1,369 train / 341 validation. Verified categorical difficulty: 1,363 train / 328 validation. The known section selects the valid target/route but is not a model feature. Domain is derived from skill probabilities. The six methods train independent skill and difficulty estimators and compare ordinary versus fitting-partition class-balanced loss. Natural validation distributions remain unchanged. Outer validation has been viewed in prior experiments and is exploratory, not an independent test.\n\n"
    report += "Five classical methods use 20 completed Optuna TPE trials per target/weight, C/alpha 0.001–100, initial 0.1/1/10; XGBoost uses the previous depth {3,4} × lambda {1,5} grid, learning rate 0.05, max 500 trees, patience 25, final median best tree count. This expands the original TF-IDF logistic-regression three-C search, so that comparison changes both features and tuning budget. Other previous classical alternatives already used the same Optuna bounds. Selection uses CV mean macro-F1, then log loss and simpler configuration. OOF temperature/90%-precision thresholds stay inside training. Final seeds 42/43/44.\n\n"
    if (ROOT/"prompt-audit.json").exists():
        audit = json.loads((ROOT/"prompt-audit.json").read_text())
        report += "## Prompt-template overlap and ambiguity\n\n"
        report += f"There are {audit['unique_training_prompts']} distinct training prompts and {audit['unique_validation_prompts']} distinct validation prompts. {audit['shared_prompt_strings']} exact prompt strings occur in both sets, covering {audit['validation_questions_with_seen_prompt']} validation questions. The frozen original groups are based on full question content; they do not make this ablation prompt-disjoint. These results measure classification of new bank questions under repeated templates, not generalization to unseen prompt templates.\n\n"
        for task in ["skill:reading_writing","difficulty"]:
            a = audit[task]
            report += f"{task}: {a['training_prompts_with_conflicting_labels']} training prompt strings have conflicting labels, covering {a['training_questions_in_conflicting_prompts']} eligible training rows. Questions with an identical prompt but different difficulty cannot be individually distinguished from this feature alone.\n\n"
    report += "## Current completed results\n\n"
    report += table(["Method","Skill macro-F1","Difficulty macro-F1","Domain macro-F1","Joint correct","HTTP p95 ms","Serial questions/s"],
        [[NAMES[k],*[f(d['selected_metrics'][t]['macro_f1']) for t in ["skill:reading_writing","difficulty","domain:reading_writing"]],
          f(d['selected_metrics']['joint']['both_correct']),f"{d['benchmark']['api_serial']['p95_ms']:.2f}",f"{d['benchmark']['api_serial']['questions_per_second']:.2f}"] for k,d in completed.items()])
    report += "Not completed: " + (", ".join(NAMES[k] for k in NAMES if k not in completed) or "none") + ".\n\n"
    groups = json.loads((REFERENCE/"dataset/groups.json").read_text())
    differences = {}
    report += "## Paired comparison with previous full-input methods\n\n"
    comparison = []
    for k,d in completed.items():
        prior = json.loads((OLD[k]/"results.json").read_text())
        differences[k] = {}
        for t in ["skill:reading_writing","difficulty"]:
            ids = set(d["selected_predictions"][t])
            assert ids == set(prior["selected_predictions"][t])
            delta = {"prompt_minus_previous":d['selected_metrics'][t]['macro_f1']-prior['selected_metrics'][t]['macro_f1'],
                     "ci95":paired_macro_f1(prior['selected_predictions'][t],d['selected_predictions'][t],groups)}
            differences[k][t] = delta
            comparison.append([NAMES[k],t,f(prior['selected_metrics'][t]['macro_f1']),f(d['selected_metrics'][t]['macro_f1']),json.dumps(delta)])
    report += table(["Method","Target","Previous macro-F1","Prompt macro-F1","Paired difference / 95% CI"],comparison)
    report += "Paired intervals use 1,000 original-group bootstrap resamples, seed42. Repeated prompt templates are not resampling groups, so these CIs can understate template-level dependence; they also exclude source shift and repeated model-development uncertainty.\n\n"
    for k,d in completed.items():
        report += f"## {NAMES[k]}\n\n"
        report += f"CV-selected weighting: {json.dumps(d['selected_weights'])}. Feature version prompt-only-v1.\n\n"
        report += table(["Target","Weight","Configuration","CV macro-F1","CV SD","CV log loss"],
             [[t,w,json.dumps(r.get('config',{'C/alpha':r.get('parameter')})),f(r['macro_f1_mean']),f(r['macro_f1_std']),f(r['log_loss_mean'])] for t,variants in d['configurations'].items() for w,r in variants.items()])
        report += table(["Weight","Seed","Skill F1","Difficulty F1","Domain F1"],[[r['weighting'],r['seed'],*[f(r['metrics'][t]['macro_f1']) for t in ['skill:reading_writing','difficulty','domain:reading_writing']]] for r in d['final']])
        for task in ['skill:reading_writing','difficulty','domain:reading_writing']:
            m = d['selected_metrics'][task]
            report += f"### {task}\n\n"
            report += table(["Accuracy","Balanced accuracy","Macro F1","95% CI","Weighted F1","Log loss","Brier","ECE"],[[*[f(m[x]) for x in ['accuracy','balanced_accuracy','macro_f1']],json.dumps(m['macro_f1_ci95']),*[f(m[x]) for x in ['weighted_f1','log_loss','brier','ece']]]])
            report += table(["Class","Precision","Recall","F1","Support","Recall 95% CI"],[[{'1':'Easy','3':'Medium','5':'Hard'}.get(c,c),f(r['precision']),f(r['recall']),f(r['f1']),r['support'],json.dumps(r['recall_ci95'])] for c,r in m['per_class'].items()])
            report += "Confusion labels: " + json.dumps(m['confusion_labels']) + ". Rows=true; columns=predicted.\n\n```json\n" + json.dumps(m['confusion_matrix']) + "\n```\n\n"
            retained = round(m['coverage']*m['count'])
            correct = round(m['suggestion_precision']*retained) if retained else 0
            interval = binomtest(correct,retained).proportion_ci() if retained else None
            report += f"Policy {json.dumps(m['policy'])}; coverage {f(m['coverage'])}; abstention {f(1-m['coverage'])}; retained {retained}; precision {f(m['suggestion_precision'])}; exact retained-precision CI {([interval.low,interval.high] if interval else 'unavailable')}. Small retained samples cannot establish the precision target.\n\n"
            report += table(['Threshold','Coverage','Precision'],[[f(r['threshold']),f(r['coverage']),f(r['precision'])] for r in m['reliability']])
            report += f"Rare classes: {m.get('rare_classes')}; long-prompt slice: {json.dumps(m.get('long_input'))}.\n\n"
            if task == 'difficulty':
                report += f"Ordinal step error {f(m['ordinal_error'])}; Easy↔Hard error {f(m['extreme_error_rate'])}.\n\n"
        report += "### Operational measurements\n\n"
        b = d['benchmark']
        report += f"Hardware: {json.dumps(d['hardware'])}. CPU ≤8 threads, one experiment at a time. Main-process peak memory {d['peak_memory_mb']:.2f} MiB; HTTP subprocess peak memory is not instrumented. Feature preparation/cache-read time {d['feature_preparation_seconds']:.2f}s; total recorded method wall time {d['elapsed_seconds']:.2f}s; artifact size {b['artifact_bytes']/1024**2:.2f} MiB; load {b['load_seconds']:.3f}s.\n\n"
        report += table(['Path','p50 ms','p95 ms','p99 ms','questions/s'],[[path,*[f(b[path][key]) for key in ['p50_ms','p95_ms','p99_ms','questions_per_second']]] for path in ['direct','api_serial']])
        report += f"100 direct questions {b['direct_100_questions_seconds']:.3f}s; 100 HTTP questions {b['api_100_questions_seconds']:.3f}s. Ten warm-ups, three validation passes, fresh prompt encoding with cache reads disabled during both direct/API benchmarks. Classifier-only cached-feature measurements: {json.dumps(b.get('tree_only'))}.\n\n"
        report += "Four-client burst load (429 is intentional busy rejection, not an unexpected error): " + json.dumps(b['four_client_load']) + ".\n\n"
        folder = (ROOT/k).resolve()
        report += f"Machine metrics [{k}/results.json](<{folder.as_posix()}/results.json>); [experiment manifest](<{folder.as_posix()}/experiment-manifest.json>); [verification](<{folder.as_posix()}/verification.json>); [configuration freeze](<{folder.as_posix()}/configuration-freeze.json>). Each immutable artifact manifest includes configurations, dependencies, code hashes, and encoder revision.\n\n"
    report += "## Interpretation and limitations\n\n"
    report += "Prompt-only removes the actual passage and answer-option evidence, so difficulty predictions may collapse toward prompt-template class proportions. Shared templates with conflicting difficulty labels are irreducible ambiguity for this input. Per-class support/recall, confidence/coverage, and paired differences matter more than raw accuracy. Cross-Text Connections has only 12 validation rows; zero-error bootstrap intervals do not establish population perfection. No independent full-length holdout, image evidence, or unseen-template test has been evaluated. No automatic promotion.\n"
    output = Path('ml-service/reports/classification-prompt-only-comparison.md')
    output.write_text(report,encoding='utf-8')
    (ROOT/'paired-comparison.json').write_text(json.dumps(differences,indent=2),encoding='utf-8')

if __name__ == '__main__':
    render()
