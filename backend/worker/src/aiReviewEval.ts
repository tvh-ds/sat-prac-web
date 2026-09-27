export interface GoldIssue {
  issueType: string;
  severity: "major" | "minor";
  field: string;
  sourcePage: number;
}

export interface GoldQuestion {
  id: string;
  documentId: string;
  section: "reading_writing" | "math";
  visual: boolean;
  scanType: "scanned" | "selectable_text";
  prompt: string;
  passage: string | null;
  choices: string[];
  answer: string;
  issues: GoldIssue[];
}

export interface EvaluatedFinding {
  issueType: string;
  severity: "major" | "minor";
  field: string;
  sourcePage: number;
}

export interface EvaluatedQuestion {
  id: string;
  prompt: string;
  passage: string | null;
  choices: string[];
  answer: string | null;
  visualAssociationCorrect?: boolean;
  reviewState: "complete" | "review" | "failed" | null;
  findings: EvaluatedFinding[];
  reviewTimeMs?: number;
}

export interface EvaluationRun {
  runId: string;
  gitCommit: string;
  createdAt: string;
  model: string;
  promptVersion: string;
  riskPolicyVersion: string;
  questions: EvaluatedQuestion[];
  operations?: {
    ingestionLatenciesMs?: number[];
    reviewLatenciesMs?: number[];
    ocrPagesAttempted?: number;
    ocrPagesSucceeded?: number;
    ocrFallbackPages?: number;
    reviewRequests?: number;
    reviewSuccesses?: number;
    reviewRetries?: number;
    inputTokens?: number;
    outputTokens?: number;
    billedOcrPages?: number;
    totalCostUsd?: number;
    approvedQuestions?: number;
  };
}

export interface RateMetric {
  value: number | null;
  numerator: number;
  denominator: number;
  ci95: [number, number] | null;
}

export interface IngestionEvaluationResult {
  run: Omit<EvaluationRun, "questions" | "operations">;
  sample: { goldQuestions: number; predictedQuestions: number; matchedQuestions: number };
  extraction: Record<string, RateMetric>;
  review: Record<string, RateMetric>;
  effort: { medianReviewMs: number | null; p95ReviewMs: number | null };
  operations: Record<string, number | null>;
  slices: Record<string, { n: number; questionRecall: RateMetric; answerAccuracy: RateMetric; seriousDefectCompleteRate: RateMetric; seriousIssueRecall: RateMetric }>;
}

const normalized = (value: string | null | undefined) => (value ?? "")
  .normalize("NFKC")
  .replace(/[“”«»„‟]/g, '"')
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[—–―]/g, "-")
  .replace(/\s+/g, " ")
  .trim();

export function rate(numerator: number, denominator: number): RateMetric {
  if (denominator === 0) return { value: null, numerator, denominator, ci95: null };
  const value = numerator / denominator;
  const z = 1.959963984540054;
  const z2 = z * z;
  const center = (value + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const half = z * Math.sqrt((value * (1 - value) + z2 / (4 * denominator)) / denominator) / (1 + z2 / denominator);
  return { value, numerator, denominator, ci95: [Math.max(0, center - half), Math.min(1, center + half)] };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function issueKey(issue: GoldIssue | EvaluatedFinding): string {
  return `${issue.issueType}|${issue.field}|${issue.sourcePage}`;
}

function scoreSubset(gold: GoldQuestion[], predictedById: Map<string, EvaluatedQuestion>) {
  const matched = gold.filter((question) => predictedById.has(question.id));
  const answerRows = matched.filter((question) => predictedById.get(question.id)?.answer != null);
  const answerCorrect = answerRows.filter((question) => normalized(predictedById.get(question.id)?.answer) === normalized(question.answer)).length;
  const serious = gold.flatMap((question) => question.issues
    .filter((issue) => issue.severity === "major")
    .map((issue) => ({ question, issue })));
  let seriousMatched = 0;
  for (const { question, issue } of serious) {
    if ((predictedById.get(question.id)?.findings ?? []).some((finding) => issueKey(finding) === issueKey(issue))) seriousMatched += 1;
  }
  const complete = gold.filter((question) => predictedById.get(question.id)?.reviewState === "complete");
  const defectiveComplete = complete.filter((question) => question.issues.some((issue) => issue.severity === "major")).length;
  return {
    n: gold.length,
    questionRecall: rate(matched.length, gold.length),
    answerAccuracy: rate(answerCorrect, answerRows.length),
    seriousDefectCompleteRate: rate(defectiveComplete, complete.length),
    seriousIssueRecall: rate(seriousMatched, serious.length),
  };
}

export function evaluateIngestion(gold: GoldQuestion[], run: EvaluationRun): IngestionEvaluationResult {
  const goldById = new Map(gold.map((question) => [question.id, question]));
  const predictedById = new Map(run.questions.map((question) => [question.id, question]));
  const matched = run.questions.filter((question) => goldById.has(question.id));
  const matchedGold = gold.filter((question) => predictedById.has(question.id));
  const promptExact = matchedGold.filter((question) => normalized(predictedById.get(question.id)?.prompt) === normalized(question.prompt)).length;
  const passageRows = matchedGold.filter((question) => question.passage != null);
  const passageExact = passageRows.filter((question) => normalized(predictedById.get(question.id)?.passage) === normalized(question.passage)).length;
  const choiceRows = matchedGold.filter((question) => question.choices.length > 0);
  const exactChoices = choiceRows.filter((question) => {
    const predicted = predictedById.get(question.id)?.choices ?? [];
    return predicted.length === question.choices.length && predicted.every((choice, index) => normalized(choice) === normalized(question.choices[index]));
  }).length;
  const answers = matchedGold.filter((question) => predictedById.get(question.id)?.answer != null);
  const correctAnswers = answers.filter((question) => normalized(predictedById.get(question.id)?.answer) === normalized(question.answer)).length;
  const visuals = matchedGold.filter((question) => question.visual);
  const correctVisuals = visuals.filter((question) => predictedById.get(question.id)?.visualAssociationCorrect === true).length;

  const goldIssues = gold.flatMap((question) => question.issues.map((issue) => ({ questionId: question.id, issue })));
  const predictedFindings = run.questions.flatMap((question) => question.findings.map((finding) => ({ questionId: question.id, finding })));
  const matchedFindingKeys = new Set<string>();
  let matchedFindings = 0;
  for (const predicted of predictedFindings) {
    const key = `${predicted.questionId}|${issueKey(predicted.finding)}`;
    if (!matchedFindingKeys.has(key) && goldIssues.some((goldIssue) => `${goldIssue.questionId}|${issueKey(goldIssue.issue)}` === key)) {
      matchedFindingKeys.add(key);
      matchedFindings += 1;
    }
  }
  const seriousIssues = goldIssues.filter(({ issue }) => issue.severity === "major");
  const matchedSerious = seriousIssues.filter(({ questionId, issue }) => matchedFindingKeys.has(`${questionId}|${issueKey(issue)}`)).length;
  const clean = gold.filter((question) => question.issues.length === 0);
  const cleanWithoutFindings = clean.filter((question) => (predictedById.get(question.id)?.findings.length ?? 0) === 0).length;
  const states = (state: EvaluatedQuestion["reviewState"]) => matchedGold.filter((question) => predictedById.get(question.id)?.reviewState === state).length;
  const overall = scoreSubset(gold, predictedById);
  const operation = run.operations ?? {};
  const reviewTimes = run.questions.map((question) => question.reviewTimeMs).filter((value): value is number => typeof value === "number" && value >= 0);
  const approved = operation.approvedQuestions ?? 0;

  const sliceEntries: Array<[string, GoldQuestion[]]> = [
    ["reading_writing", gold.filter((question) => question.section === "reading_writing")],
    ["math", gold.filter((question) => question.section === "math")],
    ["text_only", gold.filter((question) => !question.visual)],
    ["visual", gold.filter((question) => question.visual)],
    ["scanned", gold.filter((question) => question.scanType === "scanned")],
    ["selectable_text", gold.filter((question) => question.scanType === "selectable_text")],
  ];

  return {
    run: { runId: run.runId, gitCommit: run.gitCommit, createdAt: run.createdAt, model: run.model, promptVersion: run.promptVersion, riskPolicyVersion: run.riskPolicyVersion },
    sample: { goldQuestions: gold.length, predictedQuestions: run.questions.length, matchedQuestions: matched.length },
    extraction: {
      questionPrecision: rate(matched.length, run.questions.length),
      questionRecall: rate(matchedGold.length, gold.length),
      promptExactCorrectness: rate(promptExact, matchedGold.length),
      passageExactCorrectness: rate(passageExact, passageRows.length),
      choiceExactCorrectness: rate(exactChoices, choiceRows.length),
      answerKeyCoverage: rate(answers.length, matchedGold.length),
      answerKeyAccuracy: rate(correctAnswers, answers.length),
      visualAssociationCorrectness: rate(correctVisuals, visuals.length),
    },
    review: {
      findingPrecision: rate(matchedFindings, predictedFindings.length),
      findingRecall: rate(matchedFindings, goldIssues.length),
      seriousIssueRecall: rate(matchedSerious, seriousIssues.length),
      cleanQuestionSpecificity: rate(cleanWithoutFindings, clean.length),
      seriousDefectCompleteRate: overall.seriousDefectCompleteRate,
      completeCoverage: rate(states("complete"), matchedGold.length),
      humanReviewRate: rate(states("review"), matchedGold.length),
      failedRate: rate(states("failed"), matchedGold.length),
    },
    effort: { medianReviewMs: percentile(reviewTimes, 0.5), p95ReviewMs: percentile(reviewTimes, 0.95) },
    operations: {
      ingestionLatencyP50Ms: percentile(operation.ingestionLatenciesMs ?? [], 0.5),
      ingestionLatencyP95Ms: percentile(operation.ingestionLatenciesMs ?? [], 0.95),
      reviewLatencyP50Ms: percentile(operation.reviewLatenciesMs ?? [], 0.5),
      reviewLatencyP95Ms: percentile(operation.reviewLatenciesMs ?? [], 0.95),
      ocrPageSuccessRate: operation.ocrPagesAttempted ? (operation.ocrPagesSucceeded ?? 0) / operation.ocrPagesAttempted : null,
      ocrFallbackRate: operation.ocrPagesAttempted ? (operation.ocrFallbackPages ?? 0) / operation.ocrPagesAttempted : null,
      reviewRequestSuccessRate: operation.reviewRequests ? (operation.reviewSuccesses ?? 0) / operation.reviewRequests : null,
      reviewRetryRate: operation.reviewRequests ? (operation.reviewRetries ?? 0) / operation.reviewRequests : null,
      inputTokens: operation.inputTokens ?? null,
      outputTokens: operation.outputTokens ?? null,
      billedOcrPages: operation.billedOcrPages ?? null,
      totalCostUsd: operation.totalCostUsd ?? null,
      costPerApprovedQuestionUsd: approved > 0 && operation.totalCostUsd != null ? operation.totalCostUsd / approved : null,
    },
    slices: Object.fromEntries(sliceEntries.map(([name, questions]) => [name, scoreSubset(questions, predictedById)])),
  };
}
