import { createClient } from "@supabase/supabase-js";
import { InflightRequests } from "./inflightRequests";

const reads = new InflightRequests();

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required");
}

export const supabase = createClient(url, anonKey);

export const FUNCTIONS_URL = `${url}/functions/v1`;

export async function fn(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  const { method = "GET", body, token } = options;
  if (method !== "GET") reads.invalidate();
  const headers: Record<string, string> = { apikey: anonKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const request = fetch(`${FUNCTIONS_URL}/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: method === "GET" ? "no-store" : "default",
  });
  // Reads issued while a write is pending must not satisfy the refresh after
  // that write commits (or fails).
  return method === "GET" ? request : request.finally(() => reads.invalidate());
}

export async function fnJson<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  if ((options.method ?? "GET") === "GET" && options.body === undefined) {
    // Keep accounts and tokens isolated; never share a raw Response body.
    return reads.read(JSON.stringify(["function", path, options.token]), () => readFnJson<T>(path, options));
  }
  return readFnJson<T>(path, options);
}

async function readFnJson<T>(path: string, options: { method?: string; body?: unknown; token?: string }): Promise<T> {
  const res = await fn(path, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data?.error ??
      (data?.message ?? `Request failed (${res.status})`);
    throw new Error(message);
  }
  return data as T;
}

export async function rest<T>(
  table: string,
  query: string,
  token: string,
): Promise<T> {
  return reads.read(JSON.stringify(["rest", table, query, token]), () => readRest<T>(table, query, token));
}

async function readRest<T>(table: string, query: string, token: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`REST ${table}: ${res.status}`);
  return (await res.json()) as T;
}

export async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}
