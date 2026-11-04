import assert from "node:assert/strict";
import { SpeakerRouter, mentionedSpeakers } from "../runtime/speaker-router.js";
import { DialogueContext } from "../runtime/dialogue-context.js";
const cast = [
  { instanceId: "a", displayName: "GitHub娘-1", characterName: "GitHub娘", enabled: true },
  { instanceId: "b", displayName: "deepdeep-1", characterName: "deepdeep", enabled: true },
  { instanceId: "c", displayName: "小明", characterName: "小明", enabled: true },
];
assert.deepEqual(mentionedSpeakers("@DEEPDEEP 你怎么看？GitHub娘也说说", cast), ["b", "a"]);
assert.deepEqual(mentionedSpeakers("deepdeeper", cast), []);
assert.deepEqual(mentionedSpeakers("小明娘你好", [...cast, { instanceId: "d", displayName: "小明娘", enabled: true }]), ["d"]);
assert.deepEqual(mentionedSpeakers("deepdeep", cast.map((role) => ({ ...role, enabled: role.instanceId !== "b" }))), []);
const router = new SpeakerRouter();
const spoken = new Set();
let choice = router.choose("scene", cast, { question: "deepdeep，你先聊聊", spoken });
assert.equal(choice.target.instanceId, "b");
router.record("b"); spoken.add("b");
choice = router.choose("scene", cast, { question: "deepdeep，你先聊聊", previousReply: "小明，你怎么看？", spoken });
assert.equal(choice.target.instanceId, "c");
router.record("c"); spoken.add("c");
choice = router.choose("scene", cast, { previousReply: "deepdeep？", spoken });
assert.equal(choice.target.instanceId, "a");
spoken.add("a"); router.record("a");
assert.equal(router.choose("scene", cast, { spoken }), null, "no duplicate speaker within one round");
assert.equal(router.choose("scene", cast).target.instanceId, "b", "longest-waiting speaker leads next round");
assert.equal(router.choose("other-scene", cast).target.instanceId, "a", "rotation must reset between scenes");
assert.equal(router.choose("other-scene", cast, { question: "deepdeep", automatic: false }).target.instanceId, "a");
assert.equal(router.choose("other-scene", []), null);
const named = new SpeakerRouter({ random: () => 0 });
assert.equal(named.choose("scene", cast, { question: "小明和GitHub娘，请讨论一下", opening: true }).target.instanceId, "c");
assert.equal(named.choose("scene", cast, { question: "@deepdeep 先说", automatic: false, opening: true }).target.instanceId, "b");
assert.equal(mentionedSpeakers("@github-girl，请回答", [{ ...cast[0], characterId: "github-girl" }])[0], "a");
// Full rounds used to return to the first-added role at every new topic.
const openers = new SpeakerRouter({ random: () => 0.99 });
const first = [];
for (let topic = 0; topic < 6; topic++) {
  const used = new Set();
  for (let turn = 0; turn < cast.length; turn++) {
    const choice = openers.choose("scene", cast, { spoken: used, opening: turn === 0, automatic: false });
    if (turn === 0) first.push(choice.target.instanceId);
    used.add(choice.target.instanceId);
    openers.record(choice.target.instanceId, { opening: turn === 0 });
  }
}
assert.deepEqual(first, ["c", "b", "a", "c", "b", "a"]);
assert.equal(openers.choose("scene", cast, { opening: true, question: "GitHub娘请回答" }).target.instanceId, "a", "explicit mention still wins");
assert.equal(openers.choose("scene", [cast[1]], { opening: true }).target.instanceId, "b");
assert.equal(openers.choose("scene", cast.map((item) => ({ ...item, enabled: false })), { opening: true }), null);
const dialogue = new DialogueContext();
dialogue.add("scene", "deepdeep-1", "小明，你怎么看？", "b");
let prompt = dialogue.prompt("scene", "小明", "讨论技术", { cast, target: cast[2], discussion: true, turn: 1 });
let data = JSON.parse(prompt.split("\n").at(-1));
assert.equal(data.speaker, "小明");
assert.deepEqual(data.participants, cast.map((role) => role.displayName));
assert.equal(data.recent[0].speaker, "deepdeep-1");
assert.ok(data.task.includes("主题"));
prompt = dialogue.prompt("scene", "小明", "继续", { cast: cast.filter((role) => role.instanceId !== "b") });
assert.ok(!prompt.includes("deepdeep-1"), "departed roles are removed from active context");
const largeCast = Array.from({ length: 30 }, (_, n) => ({ instanceId: String(n), displayName: '"'.repeat(60), enabled: true }));
prompt = dialogue.prompt("scene", '"'.repeat(100), "\u0000".repeat(200), { cast: largeCast, target: { characterName: '"'.repeat(100) } });
assert.ok(prompt.length <= 2000, "roster must fit the existing API request limit");
console.log("speaker-router: mentions, fairness, turn bounds, roster identity and scene isolation passed");
