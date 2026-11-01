import assert from "node:assert/strict";
import {
  buildCharacterManifest, inferNewCharacterPackage, planAssetImport,
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

const roleFiles = [
  { name: "待机.png", archivePath: "deepdeep/Basic/待机.png" },
  { name: "claudeep.png", archivePath: "deepdeep/Special/claudeep.png" },
];
const role = inferNewCharacterPackage(roleFiles, [characters[0]]);
assert.deepEqual(role, { id: "deepdeep", name: "deepdeep" });
const planned = planAssetImport(roleFiles, { characterId: role.id });
const manifest = buildCharacterManifest({ ...role, assets: planned });
assert.equal(manifest.defaultState, manifest.states[0].id);
assert.deepEqual(manifest.states.map((state) => state.group), ["Basic", "Special"]);
assert.ok(manifest.states.every((state) => /^[a-z][a-z0-9_-]*$/i.test(state.id)));

console.log("asset-import: ZIP role routing checks passed");
