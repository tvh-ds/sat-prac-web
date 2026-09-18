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
  };
}
