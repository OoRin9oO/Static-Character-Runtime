import assert from "node:assert/strict";
import { reconcileAssets } from "../runtime/asset-catalog.js";

const original = { id: "example", defaultState: "idle", events: { hello: { state: "idle" }, joy: { state: "happy" } }, states: [
  { id: "idle", label: "定制待机", group: "Basic", image: "Basic/idle.png" },
  { id: "happy", label: "开心", group: "Emotion", image: "Emotion/happy.png" },
] };
const files = [{ path: "basic/idle.png", version: "1-20" }, { path: "inter/挥手.webp", version: "2-30" }];
const view = reconcileAssets(original, files);
assert.equal(view.manifest.states[0].label, "定制待机");
assert.equal(view.manifest.states[0].assetVersion, "1-20");
assert.deepEqual(view.missing.map((state) => state.id), ["happy"]);
assert.equal(view.manifest.events.joy, undefined);
assert.equal(view.added[0].group, "Interact");
assert.equal(view.added[0].label, "挥手");
assert.equal(reconcileAssets(original, [...files].reverse()).added[0].id, view.added[0].id);
assert.equal(reconcileAssets(original, files.slice(1)).manifest.defaultState, view.added[0].id);
assert.equal(reconcileAssets(original, []).manifest.defaultState, undefined);
assert.equal(original.states.length, 2);
assert.equal(original.events.joy.state, "happy");
console.log("asset-catalog: reconciliation checks passed");
