import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ref = "wgkggknyndgaoyazdhdf";
assert.ok(process.argv.includes(`--project-ref=${ref}`), "Explicit staging reference required");
const phase = process.argv.includes("--after") ? "after" : "before";
const env = path => Object.fromEntries(readFileSync(new URL(path, import.meta.url), "utf8").split(/\r?\n/).flatMap(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  return m ? [[m[1], m[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
}));
const frontend = env("../../frontend/.env.local"), accounts = env(".env");
assert.equal(new URL(frontend.VITE_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const api = createClient(frontend.VITE_SUPABASE_URL, frontend.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = result => { assert.equal(result.error, null, result.error?.message); return result.data; };
const baselinePath = new URL("../../tmp/loading-api-before.json", import.meta.url);
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "stimulus_image_url").map(([key, item]) => [key, normalize(item)])) : value;
try {
  console.log(`Verified staging API target: ${ref}`);
  const session = must(await api.auth.signInWithPassword({ email: accounts.APP_ADMIN_EMAIL, password: accounts.APP_ADMIN_PASSWORD })).session;
  const results = {};
  for (const endpoint of ["admin-students?progress=1", "admin-questions?limit=20&offset=0", "admin-pdf-imports"]) {
    const started = performance.now();
    const response = await fetch(`${frontend.VITE_SUPABASE_URL}/functions/v1/${endpoint}`, {
      headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(60000),
    });
    assert.equal(response.status, 200, endpoint);
    const body = await response.json();
    results[endpoint] = { ms: Math.round(performance.now() - started), body: normalize(body) };
    console.log(`${endpoint}: ${results[endpoint].ms} ms`);
    if (phase === "after") {
      const expected = JSON.parse(readFileSync(baselinePath, "utf8"))[endpoint].body;
      assert.deepEqual(results[endpoint].body, expected, `${endpoint}: response parity`);
      console.log(`PASS response parity: ${endpoint}`);
    }
    const anonymous = await fetch(`${frontend.VITE_SUPABASE_URL}/functions/v1/${endpoint}`, { headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(20000) });
    assert.equal(anonymous.status, 401, `${endpoint}: reject unauthenticated requests`);
  }
  writeFileSync(new URL(`../../tmp/loading-api-${phase}.json`, import.meta.url), JSON.stringify(results, null, 2));
} finally {
  await api.auth.signOut();
}
