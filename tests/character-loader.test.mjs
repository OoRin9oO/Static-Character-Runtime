import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  resolveRegisteredCharacterManifestUrl,
  validateCharacterManifest,
} from "../runtime/character-loader.js";

const manifestUrl = new URL("../characters/github-girl/character.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const states = validateCharacterManifest(manifest, manifestUrl);

assert.equal(states.size, manifest.states.length);
assert.deepEqual(Object.keys(manifest.groups).sort(), ["Basic", "Emotion", "Interact", "Special"]);
assert.equal(
  resolveRegisteredCharacterManifestUrl(
    { id: "github-girl", manifest: "./github-girl/character.json" },
    "http://127.0.0.1:4175/?manifest=./characters/github-girl/character.json",
  ).pathname,
  "/characters/github-girl/character.json",
);

for (const state of manifest.states) {
  assert.match(state.id, /^[a-z][a-z0-9_-]{0,63}$/i);
  const imagePath = fileURLToPath(new URL(state.image, new URL("./", manifestUrl)));
  await readFile(imagePath);
}

const invalidManifest = structuredClone(manifest);
invalidManifest.states[0].id = "哈哈-动作";
assert.throws(
  () => validateCharacterManifest(invalidManifest, manifestUrl),
  /状态 ID.*只能包含英文字母/,
);

console.log(`character-loader: ${states.size} states and image paths passed`);
