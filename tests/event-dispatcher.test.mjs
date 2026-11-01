import assert from "node:assert/strict";
import { CharacterEventDispatcher } from "../runtime/event-dispatcher.js";
import { CharacterStateManager } from "../runtime/state-manager.js";

const knownStates = new Set(["idle", "thinking", "happy"]);
const snapshots = [];
const errors = [];
const events = [];

const stateManager = new CharacterStateManager({
  defaultState: "idle",
  isKnownState: (stateId) => knownStates.has(stateId),
  onChange: (snapshot) => snapshots.push(snapshot),
  onError: (message) => errors.push(message),
});

const dispatcher = new CharacterEventDispatcher({
  stateManager,
  eventMap: {
    assistant_thinking: { state: "thinking", mode: "base" },
  },
  resolveStateAction: (stateId) => stateId === "happy"
    ? { state: "happy", mode: "override", priority: 60, durationMs: 15 }
    : null,
  onEvent: (event) => events.push(event),
  onError: (message) => errors.push(message),
});

assert.equal(dispatcher.dispatch({ type: "assistant_thinking" }), true);
assert.equal(stateManager.getSnapshot().effectiveState, "thinking");

assert.equal(dispatcher.dispatch({ type: "state_requested", payload: { stateId: "happy" } }), true);
assert.equal(stateManager.getSnapshot().effectiveState, "happy");
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(stateManager.getSnapshot().effectiveState, "thinking");

assert.equal(dispatcher.dispatch({ type: "unknown_event" }), false);
assert.equal(dispatcher.dispatch({ type: "Bad Event" }), false);
assert.equal(dispatcher.dispatch({ type: "assistant_thinking", timestamp: "not-a-date" }), false);
assert.equal(dispatcher.dispatch({ type: "assistant_thinking", payload: [] }), false);
assert.equal(events.at(-1).handled, false);
assert.equal(errors.length, 4);
assert.deepEqual(snapshots.map((snapshot) => snapshot.effectiveState), ["thinking", "happy", "thinking"]);

console.log("event-dispatcher: all tests passed");
