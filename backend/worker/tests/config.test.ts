import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const base = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  WORKER_AUTH_TOKEN: "worker-token",
};

describe("AI review configuration", () => {
  it("stays off when only OCR keys are configured", () => {
    const config = loadConfig({ ...base, COHERE_API_KEY: "ocr-key" });
    expect(config.aiIngestionReviewEnabled).toBe(false);
    expect(config.aiReviewApiKey).toBeUndefined();
  });

  it("turns on automatically when a dedicated review key exists", () => {
    const config = loadConfig({ ...base, COHERE_REVIEW_API_KEY: "review-key" });
    expect(config.aiIngestionReviewEnabled).toBe(true);
    expect(config.aiReviewApiKey).toBe("review-key");
  });

  it("honors the explicit kill switch even when a review key exists", () => {
    const config = loadConfig({ ...base, COHERE_REVIEW_API_KEY: "review-key", AI_INGESTION_REVIEW_ENABLED: "false" });
    expect(config.aiIngestionReviewEnabled).toBe(false);
  });
});
