import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { discussionPlan } from "../runtime/discussion-plan.js";
import { boundedCount, playbackInterval } from "../runtime/reply-motion.js";
import { DialogueContext } from "../runtime/dialogue-context.js";
import { SpeakerRouter } from "../runtime/speaker-router.js";

assert.equal(discussionPlan({ discussion: true, rounds: 999, participants: 999 }).length, 18);
assert.equal(discussionPlan({ discussion: false, rounds: 6, participants: 2 }).length, 2);
assert.equal(discussionPlan({ discussion: true, rounds: -1, participants: 2 }).length, 2);
assert.equal(discussionPlan({ discussion: true, rounds: "invalid", participants: 2 }).length, 2);
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const binding = source.slice(source.indexOf("function bindRehearsal()"), source.indexOf("async function start()"));
async function run(stopAfter = Infinity) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: id === "#rehearsal-mode" ? "mock" : id === "#rehearsal-routing" ? "auto" : "0", addEventListener() {} });
    return nodes.get(id);
  };
  const replies = [];
  let current = true;
  const scene = { id: "scene", characters: ["a", "b", "c"].map((id) => ({ instanceId: id, characterId: id, displayName: id, enabled: true })) };
  const sandbox = {
    DialogueContext, SpeakerRouter, discussionPlan, boundedCount, playbackInterval, setTimeout, clearTimeout,
    document: { querySelector: node }, sceneStore: { active: scene }, liveDirector: null,
    LiveDirector: class { constructor(options) { this.options = options; } },
    elements: { chatSend: { disabled: false }, scenePicker: node("picker") },
    characterEntry: (id) => ({ id, name: id }), loadSceneManifest: async ({ id }) => ({ id, defaultState: "idle", states: [{ id: "idle" }] }),
    clearSceneOverride() {}, updateChatBroadcast() {}, renderSceneStage() {}, liveSendPromise: null,
    startReplyMotion: (_, target) => { replies.push(target.instanceId); return target.instanceId; },
    waitForReplyPlayback: async () => { if (replies.length >= stopAfter) current = false; },
  };
  vm.createContext(sandbox);
  vm.runInContext(binding + "\nbindRehearsal();", sandbox);
  await sandbox.liveDirector.options.reply({ text: "a 先聊聊", metadata: { sceneId: "scene", discussion: true, rounds: 99, participants: 3 } }, {
    isCurrent: () => current, signal: new AbortController().signal,
  });
  assert.equal(sandbox.elements.chatSend.disabled, false);
  return replies;
}
const replies = await run();
assert.equal(replies.length, 18, "actual rehearsal stops at six rounds");
for (let n = 0; n < 6; n++) assert.equal(new Set(replies.slice(n * 3, n * 3 + 3)).size, 3);
for (let n = 1; n < 6; n++) assert.notEqual(replies[n * 3], replies[n * 3 - 1]);
assert.equal((await run(4)).length, 4, "pause during playback prevents later replies");
console.log("discussion-plan: six-round cap, unique speakers, boundary handoff and pause integration passed");
