import assert from "node:assert/strict";
import { LiveEventInterface, normalizeLiveEvent } from "../runtime/live-event-interface.js";

const normalized = normalizeLiveEvent({
  id: "message-1", type: "chat_message", platform: "bilibili",
  user: { id: "viewer-1", name: "测试观众" }, text: "你好",
});
assert.equal(normalized.platform, "bilibili");
assert.equal(normalized.text, "你好");
assert.throws(() => normalizeLiveEvent({ type: "unknown", platform: "bilibili" }));
assert.throws(() => normalizeLiveEvent({ type: "chat_message", platform: "Bilibili" }));

let received;
const errors = [];
const liveEvents = new LiveEventInterface({
  onEvent: (event) => { received = event; },
  onError: (message) => errors.push(message),
});
assert.ok(liveEvents.receive({ type: "follow", platform: "bilibili" }));
assert.equal(received.type, "follow");
assert.equal(liveEvents.receive(null), null);
assert.equal(errors.length, 1);
console.log("live-event-interface: all tests passed");
