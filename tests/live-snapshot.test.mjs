import assert from "node:assert/strict";
import { buildLiveSnapshot, mergeChatBroadcast } from "../runtime/live-snapshot.js";

const scene = { id: "multi", broadcast: { next: "下一个", layout: { reply: { x: 20 } } }, characters: [
  { instanceId: "a", enabled: true, currentState: "idle", initialState: "idle" },
  { instanceId: "b", enabled: true, currentState: "listen", initialState: "idle" },
] };
mergeChatBroadcast(scene, { current: "问题", speaker: "角色 B", answer: "回答" });
const snapshot = buildLiveSnapshot(scene, new Map([["b", { stateId: "happy" }]]), { characterId: "legacy", stateId: "talking" });
assert.deepEqual(snapshot.characters.map((item) => item.currentState), ["idle", "happy"]);
assert.equal(scene.characters[1].currentState, "listen");
assert.equal(snapshot.singleCharacter, undefined);
assert.deepEqual(snapshot.broadcast, { next: "下一个", layout: { reply: { x: 20 } }, current: "问题", speaker: "角色 B", answer: "回答" });
const restored = buildLiveSnapshot(scene, new Map(), null);
assert.equal(restored.characters[1].currentState, "listen");
const single = buildLiveSnapshot({ id: "single", characters: [] }, new Map(), { characterId: "legacy", stateId: "talking" });
assert.deepEqual(single.singleCharacter, { characterId: "legacy", stateId: "talking" });
console.log("live-snapshot: per-role action and dialogue checks passed");
