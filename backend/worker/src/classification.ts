import type { WorkerConfig } from "./config";
import { createSupabase } from "./supabase";
import taxonomy from "../../supabase/functions/_shared/sat-taxonomy.json";

type Row = Record<string, any>;
const sections = taxonomy as Record<string, Record<string, string[]>>;

export function validatePrediction(value: unknown, section: string, modelVersion: string): Row {
  if (!value || typeof value !== "object") throw new Error("invalid_prediction");
  const result = value as Row;
  if (result.model_version !== modelVersion || !sections[section] || typeof result.taxonomy_version !== "string" ||
      typeof result.preprocessing_version !== "string" || typeof result.input_hash !== "string" ||
      !Number.isFinite(result.latency_ms) || result.latency_ms < 0) throw new Error("invalid_prediction_contract");
    const domains = sections[section]!;
  const skills = Object.values(domains).flat();
  for (const [field, allowed] of [["domain", Object.keys(domains)], ["skill", skills], ["difficulty", [1, 3, 5]]] as const) {
    const prediction = result[field];
    if (!prediction || typeof prediction !== "object" || !prediction.probabilities || typeof prediction.probabilities !== "object") throw new Error("invalid_prediction_field");
    if (prediction.value !== null && !(allowed as readonly unknown[]).includes(prediction.value)) throw new Error("invalid_prediction_label");
    if (prediction.confidence !== null && (!Number.isFinite(prediction.confidence) || prediction.confidence < 0 || prediction.confidence > 1)) throw new Error("invalid_confidence");
    if (prediction.value !== null && (prediction.confidence === null || prediction.abstention_reason !== null)) throw new Error("invalid_prediction_acceptance");
    for (const [label, score] of Object.entries(prediction.probabilities)) {
      if (!(allowed as readonly unknown[]).map(String).includes(label) || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) throw new Error("invalid_probabilities");
    }
    const scores = Object.values(prediction.probabilities) as number[];
    if (scores.length && Math.abs(scores.reduce((a, b) => a + b, 0) - 1) > .001) throw new Error("invalid_probability_sum");
  }
  if (result.skill.value && result.domain.value && !domains[result.domain.value]?.includes(result.skill.value)) throw new Error("invalid_taxonomy_pair");
  return result;
}

export class ClassificationService {
  private svc;
  private busy = false;
  constructor(private config: WorkerConfig) { this.svc = createSupabase(config); }

  private async request(path: string, body?: unknown): Promise<Row> {
    if (!this.config.classifierUrl || !this.config.classifierToken) throw new Error("classification_not_configured");
    const target = new URL(this.config.classifierUrl);
    if (target.protocol !== "https:" && !(target.protocol === "http:" && ["127.0.0.1", "localhost", "ml-service"].includes(target.hostname))) throw new Error("insecure_classifier_url");
    const response = await fetch(new URL(path, target), {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.config.classifierToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: "error",
    });
    if (!response.ok) throw new Error(`classifier_http_${response.status}`);
    const text = await response.text();
    if (text.length > 100000) throw new Error("classifier_response_too_large");
    return JSON.parse(text);
  }

  async enqueue(importId: string, actorId: string, draftIds?: string[]): Promise<Row> {
    const health = await this.request("/health");
    if (typeof health.model_version !== "string" || health.model_version.length > 200) throw new Error("invalid_model_version");
    const { data, error } = await this.svc.rpc("enqueue_classification", {
      p_import_id: importId, p_actor_id: actorId, p_model_version: health.model_version, p_draft_ids: draftIds ?? null,
    });
    if (error) throw new Error(error.message);
    return { id: data, model_version: health.model_version };
  }

  async poll(): Promise<Row | null> {
    if (this.busy || !this.config.classifierUrl) return null;
    this.busy = true;
    try {
      const { data, error } = await this.svc.rpc("claim_classification_job");
      if (error) throw new Error(error.message);
      const job = data?.[0] as Row | undefined;
      if (!job) return null;
      return await this.process(job);
    } finally { this.busy = false; }
  }

  private async process(job: Row): Promise<Row> {
    let processed = 0, failed = 0;
    try {
      const { data, error } = await this.svc.from("classification_suggestions").select("*").eq("job_id", job.id).eq("status", "queued").order("created_at");
      if (error) throw new Error(error.message);
      for (const suggestion of data ?? []) {
        try {
          const { data: live, error: snapshotError } = await this.svc.rpc("classification_snapshot", { p_draft_id: suggestion.draft_question_id });
          if (snapshotError) throw new Error("snapshot_unavailable");
          // JSONB serialization order is stable for both snapshots returned by PostgREST.
          if (JSON.stringify(live) !== JSON.stringify(suggestion.input_snapshot)) {
            await this.svc.from("classification_suggestions").update({ status: "stale", error_category: "content_changed" }).eq("id", suggestion.id);
            failed++; processed++; continue;
          }
          const input: Row = { ...suggestion.input_snapshot.content };
          if (input.requires_image) {
            const { data: image, error: imageError } = await this.svc.storage.from("question-assets").download(suggestion.input_snapshot.image_path);
            if (imageError || !image || image.size > 10 * 1024 * 1024) throw new Error("image_unavailable");
            input.image_base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
          }
          let prediction: Row | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            try { prediction = validatePrediction(await this.request("/v1/classify", input), input.section, job.model_version); break; }
            catch (e) {
              if (attempt === 2 || !/classifier_http_(429|502|503|504)|Timeout|fetch failed/.test(String(e))) throw e;
              await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
            }
          }
          const { error: saveError } = await this.svc.from("classification_suggestions").update({ status: "ready", prediction }).eq("id", suggestion.id).eq("status", "queued");
          if (saveError) throw new Error("prediction_storage_failed");
        } catch (e) {
          failed++;
          const category = /image|invalid_|classifier_http_|not_configured/.test(String(e)) ? String(e).replace(/^Error: /, "").slice(0, 100) : "classification_failed";
          await this.svc.from("classification_suggestions").update({ status: "failed", error_category: category }).eq("id", suggestion.id).eq("status", "queued");
        }
        processed++;
        await this.svc.from("classification_jobs").update({ processed, failed }).eq("id", job.id).eq("status", "running");
      }
      await this.svc.from("classification_jobs").update({ status: "completed", processed, failed, finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
    } catch {
      await this.svc.from("classification_jobs").update({ status: "failed", error_category: "worker_failed", finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
    }
    return { job_id: job.id, processed, failed };
  }
}
