import assert from "node:assert/strict";
import {
  buildCharacterManifest, defaultBehaviorForGroup, inferNewCharacterPackage, planAssetImport,
  validateArchiveTargets,
} from "../runtime/asset-import.js";

const characters = [
  { id: "github-girl", name: "GitHub娘" },
  { id: "deepdeep", name: "DeepDeep" },
];

assert.doesNotThrow(() => validateArchiveTargets([
  { archivePath: "DeepDeep/Basic/idle.png" },
], { characters, targetCharacterId: "deepdeep" }));

assert.throws(() => validateArchiveTargets([
  { archivePath: "DeepDeep/Basic/idle.png" },
], { characters, targetCharacterId: "github-girl" }), /当前目标是“GitHub娘”/);

assert.throws(() => validateArchiveTargets([
  { archivePath: "unknown-role/Basic/idle.png" },
], { characters, targetCharacterId: "github-girl" }), /未登记角色目录“unknown-role”/);

assert.throws(() => validateArchiveTargets([
  { archivePath: "unknown-role/idle.png" },
], { characters, targetCharacterId: "github-girl" }), /未登记角色目录“unknown-role”/);

assert.doesNotThrow(() => validateArchiveTargets([
  { archivePath: "Basic/idle.png" },
], { characters, targetCharacterId: "github-girl" }));
assert.throws(() => planAssetImport([], { characterId: "github-girl" }), /没有找到可导入的图片/);
assert.throws(() => planAssetImport([
  { name: "notes.txt" },
], { characterId: "github-girl" }), /没有找到支持的图片/);

for (const [folder, group] of [
  ["Basic", "Basic"], ["emotion", "Emotion"], ["EMO", "Emotion"],
  ["Interact", "Interact"], ["inter", "Interact"], ["Special", "Special"], ["Spec", "Special"],
]) {
  const [asset] = planAssetImport([
    { name: "pose.png", archivePath: `NewRole/${folder}/pose.png` },
  ], { characterId: "new-role" });
  assert.equal(asset.section, group);
}

const roleFiles = [
  { name: "待机.png", archivePath: "deepdeep/Basic/待机.png" },
  { name: "claudeep.png", archivePath: "deepdeep/Special/claudeep.png" },
];
const role = inferNewCharacterPackage(roleFiles, [characters[0]]);
assert.deepEqual(role, { id: "deepdeep", name: "deepdeep" });
assert.throws(() => inferNewCharacterPackage([
  { name: "idle.png", archivePath: "Deep-Deep/Basic/idle.png" },
], [...characters, { id: "deep-deep", name: "Other Role" }]), /生成的 ID“deep-deep”已被占用/);
const planned = planAssetImport(roleFiles, { characterId: role.id });
const manifest = buildCharacterManifest({ ...role, assets: planned });
assert.equal(manifest.defaultState, manifest.states[0].id);
assert.deepEqual(manifest.states.map((state) => state.group), ["Basic", "Special"]);
assert.ok(manifest.states.every((state) => /^[a-z][a-z0-9_-]*$/i.test(state.id)));
assert.equal(manifest.states[0].behavior.mode, "base");
assert.deepEqual(manifest.states[1].behavior, { mode: "override", priority: 60, durationMs: 2500 });
assert.deepEqual(defaultBehaviorForGroup("Emo"), { mode: "override", priority: 60, durationMs: 2500 });
assert.deepEqual(defaultBehaviorForGroup("Emotion"), { mode: "override", priority: 60, durationMs: 2500 });
assert.deepEqual(defaultBehaviorForGroup("inter"), { mode: "override", priority: 60, durationMs: 2500 });
assert.deepEqual(defaultBehaviorForGroup("Spec"), { mode: "override", priority: 60, durationMs: 2500 });
assert.deepEqual(defaultBehaviorForGroup("custom"), { mode: "base" });

console.log("asset-import: ZIP role routing checks passed");
