import assert from "node:assert/strict";
import { test } from "node:test";
import { InflightRequests } from "../src/lib/inflightRequests";

test("overlapping reads share work, but completed reads are fresh", async () => {
  const reads = new InflightRequests();
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([reads.read("a", load), reads.read("a", load)]), [1, 1]);
  assert.equal(await reads.read("a", load), 2);
});

test("account and query keys never share results", async () => {
  const reads = new InflightRequests();
  assert.deepEqual(await Promise.all([
    reads.read('["scores","token-a"]', async () => "student-a"),
    reads.read('["scores","token-b"]', async () => "student-b"),
    reads.read('["tests","token-a"]', async () => "tests-a"),
  ]), ["student-a", "student-b", "tests-a"]);
});

test("failures are evicted so retry can succeed", async () => {
  const reads = new InflightRequests();
  let calls = 0;
  const fail = async () => { calls++; throw new Error("offline"); };
  const results = await Promise.allSettled([reads.read("a", fail), reads.read("a", fail)]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(await reads.read("a", async () => "online"), "online");
});

test("mutations isolate subsequent reads even while older reads are pending", async () => {
  const reads = new InflightRequests();
  let finishOld!: (value: string) => void;
  let finishNew!: (value: string) => void;
  const old = reads.read("a", () => new Promise<string>(resolve => { finishOld = resolve; }));
  await Promise.resolve();
  reads.invalidate();
  const fresh = reads.read("a", () => new Promise<string>(resolve => { finishNew = resolve; }));
  await Promise.resolve();
  finishOld("before mutation");
  assert.equal(await old, "before mutation");
  const joined = reads.read("a", async () => "must not run");
  finishNew("after mutation");
  assert.deepEqual(await Promise.all([fresh, joined]), ["after mutation", "after mutation"]);
});
