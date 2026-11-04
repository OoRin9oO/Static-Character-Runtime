import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createReplyMotion, replyFrame, playbackInterval, estimateReplyDuration, updateReplyPlayback } from "../runtime/reply-motion.js";

const result = { intent: { state: "idle", durationMs: 2500 }, actions: [
  { state: "happy", durationMs: 1000 }, { state: "talking", durationMs: 2000 },
  { state: "idle", durationMs: 500 }, { state: "happy", durationMs: 1000 },
] };
const plan = createReplyMotion(result, ["idle", "happy", "talking"], { now: 100 });
assert.equal(plan.steps.length, 3);
assert.equal(replyFrame(plan, 99), null);
assert.equal(replyFrame(plan, 100).state, "happy");
assert.equal(replyFrame(plan, 1100).state, "talking");
assert.equal(replyFrame(plan, 3100).state, "idle");
assert.equal(replyFrame(plan, 3600), null);
// A newly opened OBS page joins the current action rather than restarting it.
assert.deepEqual(replyFrame(JSON.parse(JSON.stringify(plan)), 2000), replyFrame(plan, 2000));
assert.equal(createReplyMotion({ intent: { state: "unknown" } }, ["idle"]), null);
assert.deepEqual(createReplyMotion(result, ["idle"], { sequence: false, bounce: false, now: 0 }), {
  startedAt: 0, bounce: false, steps: [{ state: "idle", durationMs: 2500 }],
});
assert.equal(playbackInterval("0"), 0);
assert.equal(playbackInterval("1.5"), 1500);
assert.equal(playbackInterval("invalid"), 2000);
assert.equal(playbackInterval("999"), 15000);
assert.equal(estimateReplyDuration("短句"), 2500);
assert.equal(estimateReplyDuration("长".repeat(1000), 2), 60000);
const longPlan = createReplyMotion({ ...result, reply: "长".repeat(60) }, ["idle", "happy", "talking"], { now: 0, charactersPerSecond: 6, maxActions: 6 });
assert.equal(longPlan.steps.length, 4);
assert.equal(longPlan.durationMs, 10600);
assert.ok(replyFrame(longPlan, 10000), "long reply does not end at the original action duration");
assert.equal(replyFrame(longPlan, 10600), null);
assert.equal(updateReplyPlayback(longPlan, { positionMs: 2000, durationMs: 20000, paused: true }, 2000), true);
assert.equal(replyFrame(longPlan, 5000).elapsed, 2000);
assert.equal(replyFrame(longPlan, 5000).bounce, false);
assert.equal(updateReplyPlayback(longPlan, { positionMs: 2000, durationMs: 20000 }, 5000), true);
assert.equal(replyFrame(longPlan, 6000).elapsed, 3000);
assert.deepEqual(replyFrame(JSON.parse(JSON.stringify(longPlan)), 6000), replyFrame(longPlan, 6000));
assert.equal(updateReplyPlayback(longPlan, { positionMs: -1, durationMs: 20000 }, 6000), false);
assert.equal(replyFrame(longPlan, 21000), null, "lost playback owner cannot block forever");
assert.equal(updateReplyPlayback(longPlan, { positionMs: 3000, durationMs: 20000, ended: true }, 6000), true);
assert.equal(replyFrame(longPlan, 6000), null);

// Exercise the browser animation adapter with a small DOM/animation stand-in.
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const adapter = source.slice(source.indexOf("function syncSpeakingAnimation("), source.indexOf("function startReplyMotion("));
let at = 1100, animations = 0, cancelled = 0;
const image = { animate: () => { animations++; return { cancel: () => cancelled++ }; } };
const entries = new Map([["role", { sceneId: "scene", motion: plan }]]);
const sandbox = { replyMotions: entries, speakingAnimations: new WeakMap(),
  replyFrame: (motion) => replyFrame(motion, at), document: { body: { classList: { contains: () => false } } },
  sceneStore: { active: { id: "scene" } }, matchMedia: () => ({ matches: false }), image,
};
vm.createContext(sandbox);
vm.runInContext(adapter + '\nsyncSpeakingAnimation(image, "role");', sandbox);
assert.equal(animations, 1);
assert.equal(sandbox.speakingAnimations.get(image).animation.currentTime, 1000);
vm.runInContext('syncSpeakingAnimation(image, "role");', sandbox);
assert.equal(animations, 1, "unrelated rendering must not restart the bounce");
at = 4000;
vm.runInContext('syncSpeakingAnimation(image, "role");', sandbox);
assert.equal(cancelled, 1);
assert.equal(sandbox.speakingAnimations.has(image), false);
console.log("reply-motion: sequence, bounds, restoration, shared timeline and animation lifecycle passed");
