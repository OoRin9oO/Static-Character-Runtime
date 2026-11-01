export const DEFAULT_SCENE_LIMITS = Object.freeze({ maxInstances: 6, maxPerCharacter: 1 });
export const HARD_SCENE_LIMITS = Object.freeze({ maxInstances: 30, maxPerCharacter: 1 });
export const SCENE_STORAGE_KEY = "static-character-runtime.scenes.v1";
export const LIMIT_STORAGE_KEY = "static-character-runtime.scene-limits.v1";

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "scene";
}

export function readSceneLimits(storage = localStorage) {
  let saved = {};
  try { saved = JSON.parse(storage.getItem(LIMIT_STORAGE_KEY) || "{}"); } catch { /* use defaults */ }
  return {
    maxInstances: clamp(saved.maxInstances, 1, HARD_SCENE_LIMITS.maxInstances, DEFAULT_SCENE_LIMITS.maxInstances),
    maxPerCharacter: clamp(saved.maxPerCharacter, 1, HARD_SCENE_LIMITS.maxPerCharacter, DEFAULT_SCENE_LIMITS.maxPerCharacter),
  };
}

function clamp(value, min, max, fallback) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function createScene(name, characters = []) {
  const safeName = String(name || "新场景").trim() || "新场景";
  return {
    schemaVersion: 1,
    id: `${slug(safeName)}-${crypto.randomUUID().slice(0, 8)}`,
    name: safeName,
    characters: characters.map((character) => structuredClone(character)),
    interaction: { mode: "manual", turnOrder: [], maxParticipantsPerTurn: 1, minReplyIntervalMs: 1500 },
    events: [],
    metadata: { notes: "背景与输出画布由 OBS 管理。" },
  };
}

export function readActiveSceneId(storage = localStorage) {
  return storage.getItem("static-character-runtime.active-scene.v1") || "";
}

export function validateScene(scene, { limits = readSceneLimits(), characterIds = null } = {}) {
  const errors = [];
  if (!scene || scene.schemaVersion !== 1 || typeof scene.id !== "string" || typeof scene.name !== "string") {
    return ["场景配置缺少有效的 schemaVersion、id 或 name。"];
  }
  if (!Array.isArray(scene.characters)) return ["场景 characters 必须是数组。"];
  const instanceIds = new Set();
  const displayNames = new Set();
  const counts = new Map();
  for (const instance of scene.characters) {
    if (!instance || typeof instance !== "object") { errors.push("场景包含无效的角色实例。"); continue; }
    if (!instance.instanceId || instanceIds.has(instance.instanceId)) errors.push(`实例 ID 重复或缺失：${instance.instanceId || "(空)"}`);
    instanceIds.add(instance.instanceId);
    if (!instance.displayName || displayNames.has(instance.displayName)) errors.push(`显示名称重复或缺失：${instance.displayName || "(空)"}`);
    displayNames.add(instance.displayName);
    counts.set(instance.characterId, (counts.get(instance.characterId) || 0) + 1);
    if (typeof instance.characterId !== "string" || !instance.characterId) errors.push("角色实例缺少 characterId。");
    if (characterIds && !characterIds.has(instance.characterId)) errors.push(`未登记角色包：${instance.characterId}`);
    if (!instance.transform || [instance.transform.x, instance.transform.y].some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
      errors.push(`实例 ${instance.displayName || instance.instanceId} 的 x/y 必须在 0 到 1 之间。`);
    }
    if (!Number.isFinite(instance.transform?.scale) || instance.transform.scale < 0.1 || instance.transform.scale > 3) {
      errors.push(`实例 ${instance.displayName || instance.instanceId} 的 scale 必须在 0.1 到 3 之间。`);
    }
  }
  const activeCount = scene.characters.filter((item) => item?.enabled !== false).length;
  if (activeCount > limits.maxInstances) errors.push(`场景启用实例数 ${activeCount} 超过上限 ${limits.maxInstances}。`);
  for (const [characterId, count] of counts) {
    const enabledCount = scene.characters.filter((item) => item.characterId === characterId && item.enabled !== false).length;
    if (count > 1) errors.push(`角色 ${characterId} 在一个场景中只能添加一个实例。`);
    if (enabledCount > limits.maxPerCharacter) errors.push(`角色 ${characterId} 的启用实例数 ${enabledCount} 超过上限 ${limits.maxPerCharacter}。`);
  }
  return errors;
}

export function createCharacterInstance(character, scene, manifest, instanceId = crypto.randomUUID()) {
  const count = scene.characters.filter((item) => item.characterId === character.id).length;
  if (count > 0) throw new Error(`角色 ${character.name} 在一个场景中只能添加一个实例。`);
  const baseName = `${character.name}-1`;
  return {
    instanceId,
    characterId: character.id,
    displayName: uniqueDisplayName(baseName, scene.characters),
    enabled: true,
    transform: { x: .5, y: .92, scale: 1, zIndex: scene.characters.length + 1 },
    initialState: manifest.defaultState,
    currentState: manifest.defaultState,
    model: null,
  };
}

export function uniqueDisplayName(baseName, instances) {
  const used = new Set(instances.map((item) => item.displayName));
  if (!used.has(baseName)) return baseName;
  let suffix = 1;
  while (used.has(`${baseName}-${suffix}`)) suffix += 1;
  return `${baseName}-${suffix}`;
}

export class SceneStore {
  constructor({ storage = localStorage, limits = readSceneLimits(storage), characterIds = null } = {}) {
    this.storage = storage;
    this.limits = limits;
    this.characterIds = characterIds;
    this.scenes = this.#read();
    const savedId = readActiveSceneId(storage);
    this.activeId = this.scenes.some((scene) => scene.id === savedId) ? savedId : this.scenes[0].id;
  }

  #read() {
    try {
      const parsed = JSON.parse(this.storage.getItem(SCENE_STORAGE_KEY) || "null");
      if (Array.isArray(parsed) && parsed.length) {
        let migrated = false;
        const scenes = parsed.map((scene) => {
          const seen = new Set();
          const characters = (scene.characters || []).filter((instance) => {
            if (seen.has(instance.characterId)) { migrated = true; return false; }
            seen.add(instance.characterId);
            return true;
          });
          return { ...scene, characters };
        });
        if (scenes.every((scene) => validateScene(scene, { limits: { ...HARD_SCENE_LIMITS }, characterIds: this.characterIds }).length === 0)) {
          if (migrated) this.storage.setItem(SCENE_STORAGE_KEY, JSON.stringify(scenes));
          return scenes;
        }
      }
    } catch { /* recover with a new scene */ }
    return [createScene("默认场景")];
  }

  get active() { return this.scenes.find((scene) => scene.id === this.activeId) || this.scenes[0]; }
  save() {
    const errors = this.scenes.flatMap((scene) => validateScene(scene, { limits: { ...HARD_SCENE_LIMITS }, characterIds: this.characterIds }));
    if (errors.length) throw new Error(errors[0]);
    this.storage.setItem(SCENE_STORAGE_KEY, JSON.stringify(this.scenes));
    this.storage.setItem("static-character-runtime.active-scene.v1", this.activeId);
  }
  select(id) { if (this.scenes.some((scene) => scene.id === id)) { this.activeId = id; this.storage.setItem("static-character-runtime.active-scene.v1", id); } }
  add(scene) { this.scenes.push(scene); this.activeId = scene.id; this.save(); }
  update(scene) { this.scenes = this.scenes.map((item) => item.id === scene.id ? scene : item); this.save(); }
  remove(id) {
    if (this.scenes.length < 2) throw new Error("至少保留一个场景。");
    this.scenes = this.scenes.filter((scene) => scene.id !== id);
    if (this.activeId === id) this.activeId = this.scenes[0].id;
    this.save();
  }
}
