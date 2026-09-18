import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { loadConfig } from "./config";
import { Pipeline } from "./pipeline";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function constantTimeEquals(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function createApp(config: ReturnType<typeof loadConfig>) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const pipeline = new Pipeline(config);

  function requireWorkerAuth(req: express.Request, res: express.Response): boolean {
    const header = req.get("Authorization") ?? "";
    if (!constantTimeEquals(header, `Bearer ${config.workerAuthToken}`)) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, pollIntervalMs: config.pollIntervalMs });
  });

  app.post("/process", async (req, res) => {
    if (!requireWorkerAuth(req, res)) return;
    const { import_id } = req.body ?? {};
    if (typeof import_id !== "string" || !import_id) {
      res.status(422).json({ error: "import_id (uuid string) required" });
      return;
    }
    try {
      const result = await pipeline.processImport(import_id);
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  app.post("/jobs/poll", async (_req, res) => {
    if (!requireWorkerAuth(_req, res)) return;
    try {
      const next = await pipeline.claimNextPending();
      if (!next) {
        res.json({ processed: false });
        return;
      }
      const result = await pipeline.processImport(next);
      res.json({ processed: true, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  return app;
}

function main() {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`[worker] listening on :${config.port}`);
  });
}

if (process.argv[1] && process.argv[1].includes("server")) {
  main();
}
