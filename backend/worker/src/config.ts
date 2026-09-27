import "dotenv/config";

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  port: number;
  pollIntervalMs: number;
  workerAuthToken: string;
  cohereApiKey?: string;
  /** All configured Cohere keys in rotation order (primary first). */
  cohereApiKeys: string[];
  /** Billed Parse pages after which a key is retired for the run. */
  cohereKeyPageCap: number;
  ocrModel?: string;
  ocrProvider: string;
  ocrMode: "auto" | "all" | "none";
  aiIngestionReviewEnabled: boolean;
  aiReviewApiKey?: string;
  aiReviewModel: string;
  aiReviewMaxDrafts: number;
  aiReviewTimeoutMs: number;
  aiReviewConcurrency: number;
  aiReviewCostCeilingUsd: number;
  aiReviewInputPricePerMillion: number;
  aiReviewOutputPricePerMillion: number;
}

/**
 * Collect Cohere API keys in rotation order:
 * 1. COHERE_API_KEYS (comma-separated),
 * 2. COHERE_API_KEY, COHERE_API_KEY_2, ... COHERE_API_KEY_32,
 * deduped, blanks dropped.
 */
export function collectCohereKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys: string[] = [];
  const push = (k: string | undefined) => {
    const v = (k ?? "").trim();
    if (v && !keys.includes(v)) keys.push(v);
  };
  for (const part of (env.COHERE_API_KEYS ?? "").split(",")) push(part);
  push(env.COHERE_API_KEY);
  for (let i = 2; i <= 32; i++) push(env[`COHERE_API_KEY_${i}`]);
  return keys;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const workerAuthToken = env.WORKER_AUTH_TOKEN;
  if (!supabaseUrl || !supabaseServiceKey || !workerAuthToken) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and WORKER_AUTH_TOKEN are required");
  }
  const cohereApiKeys = collectCohereKeys(env);
  const aiReviewApiKey = env.COHERE_REVIEW_API_KEY?.trim() || undefined;
  return {
    supabaseUrl,
    supabaseServiceKey,
    port: Number(env.PORT ?? 8000),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 15000),
    workerAuthToken,
    cohereApiKey: cohereApiKeys[0],
    cohereApiKeys,
    cohereKeyPageCap: Number(env.COHERE_KEY_PAGE_CAP ?? 1000),
    ocrModel: env.COHERE_OCR_MODEL || undefined,
    ocrProvider: env.OCR_PROVIDER || "cohere_parse",
    ocrMode: (env.OCR_MODE as WorkerConfig["ocrMode"]) || "auto",
    aiIngestionReviewEnabled: Boolean(aiReviewApiKey) && env.AI_INGESTION_REVIEW_ENABLED !== "false",
    aiReviewApiKey,
    aiReviewModel: env.COHERE_REVIEW_MODEL || "command-a-plus-05-2026",
    aiReviewMaxDrafts: Math.max(1, Number(env.AI_REVIEW_MAX_DRAFTS ?? 120)),
    aiReviewTimeoutMs: Math.max(5000, Number(env.AI_REVIEW_TIMEOUT_MS ?? 45000)),
    aiReviewConcurrency: Math.max(1, Math.min(8, Number(env.AI_REVIEW_CONCURRENCY ?? 2))),
    aiReviewCostCeilingUsd: Math.max(0, Number(env.AI_REVIEW_COST_CEILING_USD ?? 5)),
    aiReviewInputPricePerMillion: Math.max(0, Number(env.AI_REVIEW_INPUT_USD_PER_MILLION ?? 0)),
    aiReviewOutputPricePerMillion: Math.max(0, Number(env.AI_REVIEW_OUTPUT_USD_PER_MILLION ?? 0)),
  };
}
