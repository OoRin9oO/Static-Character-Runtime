import assert from "node:assert/strict";
import {
  createScene, createCharacterInstance, validateScene, DEFAULT_SCENE_LIMITS,
  HARD_SCENE_LIMITS, readSceneLimits, SCENE_STORAGE_KEY, LIMIT_STORAGE_KEY,
} from "../runtime/scene-manager.js";

const storageData = new Map();
const storage = {
  getItem: (key) => storageData.get(key) ?? null,
  setItem: (key, value) => storageData.set(key, value),
};
assert.deepEqual(readSceneLimits(storage), DEFAULT_SCENE_LIMITS);
storage.setItem(LIMIT_STORAGE_KEY, JSON.stringify({ maxInstances: 99, maxPerCharacter: 99 }));
assert.deepEqual(readSceneLimits(storage), HARD_SCENE_LIMITS);

const scene = createScene("测试");
const character = { id: "demo", name: "测试角色" };
const manifest = { defaultState: "idle" };
scene.characters.push(createCharacterInstance(character, scene, manifest, "one"));
assert.equal(scene.characters[0].displayName, "测试角色-1");
assert.throws(() => createCharacterInstance(character, scene, manifest, "two"), /只能添加一个实例/);
scene.characters.push(createCharacterInstance({ id: "second", name: "另一个角色" }, scene, manifest, "two"));
assert.equal(scene.characters[1].displayName, "另一个角色-1");
scene.characters[1].characterId = "demo";
assert.ok(validateScene(scene, { limits: DEFAULT_SCENE_LIMITS }).some((error) => error.includes("只能添加一个实例")));
scene.characters[1].displayName = scene.characters[0].displayName;
assert.ok(validateScene(scene, { limits: DEFAULT_SCENE_LIMITS }).some((error) => error.includes("显示名称重复")));

storage.setItem(SCENE_STORAGE_KEY, JSON.stringify([scene]));
const recoveredStore = new (await import("../runtime/scene-manager.js")).SceneStore({ storage });
assert.equal(recoveredStore.active.characters.length, 1);
assert.equal(JSON.parse(storage.getItem(SCENE_STORAGE_KEY))[0].characters.length, 1);
console.log("scene-manager: all tests passed");
