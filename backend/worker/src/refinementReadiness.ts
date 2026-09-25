import type { ImportReadiness, ImportReadinessMetric, ImportReadinessStatus } from "../../supabase/functions/_shared/importReadiness.ts";

const STATUS_RANK: Record<ImportReadinessStatus, number> = {
  processing: 0,
  failed: 1,
  partial: 2,
  complete: 3,
};

function metricImproved(before: ImportReadinessMetric, after: ImportReadinessMetric, verifiedDuplicateRemoval = 0): { regression: string | null; improved: boolean } {
  if (STATUS_RANK[after.status] < STATUS_RANK[before.status]) {
    return { regression: `status regressed from ${before.status} to ${after.status}`, improved: false };
  }
  if (after.actual < before.actual && !(verifiedDuplicateRemoval >= before.actual - after.actual &&
      STATUS_RANK[after.status] > STATUS_RANK[before.status])) {
    return { regression: `actual count fell from ${before.actual} to ${after.actual}`, improved: false };
  }
  if ((after.matchedQuestions ?? 0) < (before.matchedQuestions ?? 0) &&
      !(verifiedDuplicateRemoval >= (before.matchedQuestions ?? 0) - (after.matchedQuestions ?? 0) &&
        STATUS_RANK[after.status] > STATUS_RANK[before.status])) {
    return { regression: `matched-question count fell from ${before.matchedQuestions ?? 0} to ${after.matchedQuestions ?? 0}`, improved: false };
  }
  if (after.expected !== before.expected) return { regression: `expected total changed from ${before.expected} to ${after.expected}`, improved: false };

  const oldModules = new Map(before.modules.map((module) => [module.name, module]));
  const newModules = new Map(after.modules.map((module) => [module.name, module]));
  for (const [name, oldModule] of oldModules) {
    const newModule = newModules.get(name);
    if (!newModule) {
      // "More than two ... modules" is a computed overflow bucket, not a
      // source module. It correctly disappears when exact source boundaries
      // move those same questions into the four canonical modules.
      if (oldModule.expected === 0 && name.startsWith("More than two ") &&
          after.actual >= before.actual && after.modules.every((module) => module.expected > 0)) continue;
      return { regression: `module ${name} disappeared`, improved: false };
    }
    if (newModule.actual < oldModule.actual && !(verifiedDuplicateRemoval >= oldModule.actual - newModule.actual &&
        oldModule.actual > oldModule.expected && newModule.actual === newModule.expected &&
        STATUS_RANK[after.status] > STATUS_RANK[before.status])) {
      return { regression: `module ${name} fell from ${oldModule.actual} to ${newModule.actual}`, improved: false };
    }
    if (newModule.expected !== oldModule.expected) {
      return { regression: `module ${name} expected count changed`, improved: false };
    }
  }

  const moduleImproved = after.modules.some((module) => module.actual > (oldModules.get(module.name)?.actual ?? 0));
  const improved = STATUS_RANK[after.status] > STATUS_RANK[before.status] ||
    after.actual > before.actual ||
    (after.matchedQuestions ?? 0) > (before.matchedQuestions ?? 0) ||
    moduleImproved ||
    [...newModules.keys()].some((name) => !oldModules.has(name) && (newModules.get(name)?.actual ?? 0) > 0);
  return { regression: null, improved };
}

/**
 * Promotion must be monotonic in both readiness dimensions and improve at
 * least one measurable dimension. Status-only completeness gains count even
 * if raw row totals are unchanged (e.g. keys become correctly module-mapped).
 */
export function readinessPromotionDecision(before: ImportReadiness, after: ImportReadiness,
  verifiedDuplicateRemoval = 0): { allowed: boolean; reason: string } {
  for (const name of ["questions", "answer_key"] as const) {
    const result = metricImproved(before[name], after[name], name === "questions" ? verifiedDuplicateRemoval : 0);
    if (result.regression) return { allowed: false, reason: `${name}: ${result.regression}` };
    if (result.improved) continue;
  }
  const question = metricImproved(before.questions, after.questions, verifiedDuplicateRemoval);
  const answerKey = metricImproved(before.answer_key, after.answer_key);
  if (!question.improved && !answerKey.improved) return { allowed: false, reason: "no measured readiness improvement" };
  return { allowed: true, reason: "readiness improved without a count or status regression" };
}
