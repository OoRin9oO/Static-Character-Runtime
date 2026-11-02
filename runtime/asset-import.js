const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const SECTION_NAMES = ["Basic", "Emotion", "Interact", "Special"];
const SECTION_ALIASES = new Map([
  ["basic", "Basic"],
  ["emotion", "Emotion"], ["emo", "Emotion"],
  ["interact", "Interact"], ["inter", "Interact"],
  ["special", "Special"], ["spec", "Special"],
]);

export function defaultBehaviorForGroup(group) {
  const canonical = SECTION_ALIASES.get(String(group || "").toLowerCase());
  if (["Emotion", "Interact", "Special"].includes(canonical)) {
    return { mode: "override", priority: 60, durationMs: 2500 };
  }
  return { mode: "base" };
}

function safePath(path) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").some((part) => part === "..")) {
    throw new Error(`素材包包含不安全路径：${path}`);
  }
  return normalized.split("/").filter((part) => part && part !== ".");
}

export function classifyAssetPath(path) {
  const parts = safePath(path);
  const section = parts.slice(0, -1).map((part) => SECTION_ALIASES.get(part.toLowerCase())).find(Boolean) || "Basic";
  const filename = parts.at(-1) || "image";
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) return null;
  return { path: parts.join("/"), section, filename, label: filename.slice(0, -extension.length) };
}

export function planAssetImport(files, { characterId, section = "Basic" } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("没有找到可导入的图片。");
  if (!characterId || !/^[a-z0-9_-]+$/i.test(characterId)) throw new Error("请先选择有效的角色目录。");
  const canonicalSection = SECTION_ALIASES.get(String(section).toLowerCase());
  if (!canonicalSection) throw new Error("素材分区必须是 Basic、Emotion、Interact 或 Special。");
  const planned = files.filter((file) => IMAGE_EXTENSIONS.has(`.${file.name.split(".").at(-1).toLowerCase()}`)).map((file, index) => {
    const label = file.name.replace(/\.[^.]+$/, "").trim();
    const archiveAsset = file.archivePath ? classifyAssetPath(file.archivePath) : null;
    return { file, characterId, section: archiveAsset?.section || canonicalSection, filename: file.name, label, stateId: null, importOrder: index };
  });
  if (planned.length === 0) throw new Error("没有找到支持的图片；请选取 PNG、JPG、WebP、GIF 或 AVIF 图片。");
  const targets = new Set();
  for (const item of planned) {
    const target = `${item.section.toLowerCase()}/${item.filename.toLowerCase()}`;
    if (targets.has(target)) throw new Error(`素材包中存在重名文件：${item.section}/${item.filename}`);
    targets.add(target);
  }
  return planned;
}

function characterIdFromName(name) {
  let id = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) id = `character-${Array.from(String(name), (char) => char.codePointAt(0).toString(16)).join("-")}`;
  if (!/^[a-z]/.test(id)) id = `character-${id}`;
  return id.slice(0, 64).replace(/[-_]+$/g, "") || "character";
}

export function inferNewCharacterPackage(files, characters = []) {
  const nested = files.filter((file) => file.archivePath).map((file) => ({ file, parts: safePath(file.archivePath) }));
  if (!nested.length) return null;
  const roots = new Set(nested.filter(({ parts }) => parts.length > 1 && !SECTION_ALIASES.has(parts[0].toLowerCase())).map(({ parts }) => parts[0]));
  if (!roots.size) return null;
  if (roots.size !== 1 || nested.some(({ parts }) => parts.length > 1 && parts[0] !== [...roots][0])) {
    throw new Error("一次只能导入一个角色文件夹；已取消混合角色导入。");
  }
  const name = [...roots][0];
  if (characters.some((item) => item.name.toLowerCase() === name.toLowerCase())) return null;
  const id = characterIdFromName(name);
  if (characters.some((item) => item.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`角色文件夹“${name}”生成的 ID“${id}”已被占用，请先重命名文件夹。`);
  }
  return { id, name };
}

export function buildCharacterManifest({ id, name, assets }) {
  if (!id || !/^[a-z][a-z0-9_-]{0,63}$/i.test(id)) throw new Error("角色文件夹名称无法生成有效的角色 ID。");
  if (!name?.trim() || name.length > 120) throw new Error("角色名称不能为空，且最多 120 个字符。");
  if (!assets.length || assets.length > 250) throw new Error("角色素材必须包含 1 到 250 张图片。");
  const used = new Set();
  const states = assets.map((asset, index) => {
    const base = asset.label.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/[_-]+$/g, "");
    const safeBase = /^[a-z]/.test(base) ? base : `state_${index + 1}`;
    let stateId = safeBase.slice(0, 64);
    let suffix = 2;
    while (used.has(stateId.toLowerCase())) {
      const tail = `_${suffix++}`;
      stateId = `${safeBase.slice(0, 64 - tail.length)}${tail}`;
    }
    used.add(stateId.toLowerCase());
    return {
      id: stateId,
      label: asset.label,
      group: asset.section,
      image: `${asset.section}/${asset.filename}`,
      behavior: defaultBehaviorForGroup(asset.section),
    };
  });
  const defaultState = states.find((state) => state.group === "Basic" && /^(idle|default|待机|默认)/i.test(state.label))
    || states.find((state) => state.group === "Basic")
    || states[0];
  const groups = Object.fromEntries([...new Set(states.map((state) => state.group))].map((group) => [group, group]));
  return {
    schemaVersion: 1, id, name: name.trim(), version: "0.1.0", defaultState: defaultState.id,
    canvas: { width: 1024, height: 1536 },
    display: { scale: 1, anchorX: 50, anchorY: 50, offsetX: 0, offsetY: 0 },
    transition: { type: "crossfade", durationMs: 220, distancePx: 18 },
    groups, events: {}, states, metadata: { packageImportSource: "folder-or-zip" },
  };
}

export function validateArchiveTargets(files, { characters = [], targetCharacterId } = {}) {
  const known = new Map();
  for (const character of characters) {
    known.set(String(character.id).toLowerCase(), character);
    known.set(String(character.name).toLowerCase(), character);
  }
  for (const file of files) {
    if (!file.archivePath) continue;
    const parts = safePath(file.archivePath);
    const sectionIndex = parts.findIndex((part) => SECTION_ALIASES.has(part.toLowerCase()));
    if (sectionIndex === 0 || parts.length < 2) continue;
    const roleFolder = parts[0];
    const character = known.get(roleFolder.toLowerCase());
    if (!character) {
      throw new Error(`ZIP 包含未登记角色目录“${roleFolder}”，已取消导入，避免素材进入错误角色。请先为该角色创建并登记独立的 character.json。`);
    }
    if (character.id !== targetCharacterId) {
      throw new Error(`ZIP 角色目录为“${character.name}”，但当前目标是“${known.get(String(targetCharacterId).toLowerCase())?.name || targetCharacterId}”。请切换目标角色后再导入。`);
    }
  }
}

export { SECTION_NAMES, IMAGE_EXTENSIONS };
