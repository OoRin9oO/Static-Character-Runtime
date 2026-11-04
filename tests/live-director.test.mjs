import assert from "node:assert/strict";
import { LiveDirector } from "../runtime/live-director.js";

const event = (text, platform = "mock") => ({ type: "chat_message", platform, text, user: { id: "viewer" } });
const started = [], applied = [];
let release;
const director = new LiveDirector({ intervalMs: 0, maxQueue: 1, reply: async (item, context) => {
  started.push(item.text);
  if (item.text === "first") await new Promise((resolve) => { release = resolve; });
  if (context.isCurrent()) applied.push(item.text);
} });
assert.equal(director.enqueue(event("first")).ok, false);
director.start();
assert.equal(director.enqueue(event("first")).ok, true);
assert.equal(director.enqueue(event("second")).ok, true);
assert.equal(director.enqueue(event("third")).ok, false);
assert.equal(director.enqueue(event("first")).ok, false);
assert.equal(director.enqueue(event("x", "bilibili")).ok, false);
assert.deepEqual(started, ["first"]);
release();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.deepEqual(applied, ["first", "second"]);
director.pause();
let finish;
const cancelled = [];
const stopping = new LiveDirector({ intervalMs: 0, reply: async (_, context) => {
  await new Promise((resolve) => { finish = resolve; });
  if (context.isCurrent()) cancelled.push("published");
} });
stopping.start();
stopping.enqueue(event("pending"));
stopping.pause();
finish();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(cancelled, []);
console.log("live-director: queue, deduplication, mock-only and pause checks passed");
