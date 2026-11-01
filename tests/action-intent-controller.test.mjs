import assert from "node:assert/strict";
import { ActionIntentController } from "../runtime/action-intent-controller.js";

let currentTime = 1000;
const dispatched = [];
const decisions = [];
const controller = new ActionIntentController({
  isKnownState: (stateId) => ["idle", "happy"].includes(stateId),
  dispatch: (event) => {
    dispatched.push(event);
    return true;
  },
  cooldownMs: 1200,
  now: () => currentTime,
  onDecision: (decision) => decisions.push(decision),
});

const valid = { state: "happy", intensity: 0.7, durationMs: 2500, reason: "test" };
assert.equal(controller.submit(valid).ok, true);
assert.equal(dispatched[0].type, "state_requested");
assert.equal(dispatched[0].payload.stateId, "happy");

assert.equal(controller.submit(valid).ok, false, "重复动作应触发冷却");
currentTime += 1200;
assert.equal(controller.submit(JSON.stringify(valid)).ok, true, "冷却结束后应再次接受");

assert.equal(controller.submit({ ...valid, state: "missing" }).ok, false);
assert.equal(controller.submit({ ...valid, intensity: 2 }).ok, false);
assert.equal(controller.submit({ ...valid, durationMs: 0 }).ok, false);
assert.equal(controller.submit("not json").ok, false);
assert.equal(dispatched.length, 2);
assert.equal(decisions.length, 7);

console.log("action-intent-controller: all tests passed");
