import test from "node:test";
import assert from "node:assert/strict";
import { AnswerSaveQueue } from "../src/lib/answerSaveQueue.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("flush waits for outstanding answer writes", async () => {
  const queue = new AnswerSaveQueue();
  const write = deferred();
  queue.enqueue("q-1", () => write.promise);

  let finished = false;
  const flushing = queue.flush().then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  write.resolve();
  await flushing;
  assert.equal(finished, true);
});

test("failed writes block a barrier until the answer is retried successfully", async () => {
  const queue = new AnswerSaveQueue();
  queue.enqueue("q-2", async () => { throw new Error("offline"); });
  await assert.rejects(queue.flush(), /Retry before continuing/);
  assert.deepEqual(queue.failedQuestionIds, ["q-2"]);

  await queue.enqueue("q-2", async () => undefined);
  await queue.flush();
  assert.deepEqual(queue.failedQuestionIds, []);
});

test("writes for the same question are serialized so stale requests cannot win", async () => {
  const queue = new AnswerSaveQueue();
  const firstWrite = deferred();
  const order = [];
  const first = queue.enqueue("q-3", async () => {
    order.push("first-start");
    await firstWrite.promise;
    order.push("first-finish");
  });
  const second = queue.enqueue("q-3", async () => { order.push("second"); });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  firstWrite.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-finish", "second"]);
  await queue.flush();
});
