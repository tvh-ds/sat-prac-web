#!/usr/bin/env tsx
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluateIngestion, type EvaluationRun, type GoldQuestion, type IngestionEvaluationResult, type RateMetric } from "../src/aiReviewEval";

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name} <path>`);
  return path.resolve(value);
}

function percent(metric: RateMetric): string {
  return metric.value == null ? "Not measured" : `${(metric.value * 100).toFixed(2)}% (${metric.numerator}/${metric.denominator})`;
}

function markdown(result: IngestionEvaluationResult): string {
  const lines = [
    `# AI ingestion evaluation: ${result.run.runId}`,
    "",
    `- Git commit: \`${result.run.gitCommit}\``,
    `- Created: ${result.run.createdAt}`,
    `- Model: \`${result.run.model}\``,
    `- Prompt/policy: \`${result.run.promptVersion}\` / \`${result.run.riskPolicyVersion}\``,
    `- Sample: ${result.sample.goldQuestions} gold, ${result.sample.predictedQuestions} extracted, ${result.sample.matchedQuestions} matched`,
    "",
    "## Extraction",
    "",
    "| Metric | Result | 95% Wilson CI |",
    "| --- | ---: | --- |",
    ...Object.entries(result.extraction).map(([name, metric]) => `| ${name} | ${percent(metric)} | ${metric.ci95 ? metric.ci95.map((value) => (value * 100).toFixed(2) + "%").join("–") : "Not measured"} |`),
    "",
    "## Review safety",
    "",
    "| Metric | Result | 95% Wilson CI |",
    "| --- | ---: | --- |",
    ...Object.entries(result.review).map(([name, metric]) => `| ${name} | ${percent(metric)} | ${metric.ci95 ? metric.ci95.map((value) => (value * 100).toFixed(2) + "%").join("–") : "Not measured"} |`),
    "",
    "## Effort and operations",
    "",
    `- Median review time: ${result.effort.medianReviewMs == null ? "Not measured" : result.effort.medianReviewMs + " ms"}`,
    `- p95 review time: ${result.effort.p95ReviewMs == null ? "Not measured" : result.effort.p95ReviewMs + " ms"}`,
    `- Total cost: ${result.operations.totalCostUsd == null ? "Not measured" : "$" + result.operations.totalCostUsd.toFixed(4)}`,
    `- Cost per approved question: ${result.operations.costPerApprovedQuestionUsd == null ? "Not measured" : "$" + result.operations.costPerApprovedQuestionUsd.toFixed(4)}`,
    "",
    "Machine-readable results are authoritative; this summary is generated from the same artifact.",
    "",
  ];
  return lines.join("\n");
}

const goldPath = arg("--gold");
const runPath = arg("--run");
const outPath = arg("--out");
const goldDocument = JSON.parse(readFileSync(goldPath, "utf8")) as { questions?: GoldQuestion[] } | GoldQuestion[];
const gold = Array.isArray(goldDocument) ? goldDocument : goldDocument.questions;
if (!Array.isArray(gold)) throw new Error("Gold file must be an array or { questions: [...] }");
const run = JSON.parse(readFileSync(runPath, "utf8")) as EvaluationRun;
if (!Array.isArray(run.questions) || !run.runId || !run.gitCommit) throw new Error("Run file is missing required identity or questions");
const result = evaluateIngestion(gold, run);
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
const markdownPath = outPath.replace(/\.json$/i, "") + ".md";
writeFileSync(markdownPath, markdown(result), "utf8");
console.log(JSON.stringify({ json: outPath, markdown: markdownPath, runId: result.run.runId }, null, 2));
