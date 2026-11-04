// Build a usable view without deleting the user's saved action metadata.
const SECTIONS = new Map([["basic", "Basic"], ["emotion", "Emotion"], ["emo", "Emotion"], ["interact", "Interact"], ["inter", "Interact"], ["special", "Special"], ["spec", "Special"]]);
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

function pathKey(path) { return String(path).replace(/\\/g, "/").toLowerCase(); }

function pathId(path) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(pathKey(path))) hash = Math.imul(hash ^ byte, 16777619);
  return `asset_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Files are supplied by the local server; paths are relative to one character.
export function reconcileAssets(manifest, files) {
  const available = new Map();
  for (const file of files) {
    const path = String(file.path || "").replace(/\\/g, "/");
    const parts = path.split("/");
    const group = parts.length === 2 && SECTIONS.get(parts[0].toLowerCase());
    if (!group || !parts[1] || parts[1] === "." || parts[1] === ".." || !IMAGE.test(parts[1])) continue;
    available.set(pathKey(path), { path, group, version: String(file.version || "") });
  }
  const states = [];
  const missing = [];
  const usedIds = new Set(manifest.states.map((state) => state.id.toLowerCase()));
  const referenced = new Set();
  for (const state of manifest.states) {
    const key = pathKey(state.image);
    const parts = key.split("/");
    // Legacy layouts outside the managed folders retain their original behavior.
    if (parts.length !== 2 || !SECTIONS.has(parts[0])) { states.push(state); continue; }
    referenced.add(key);
    const file = available.get(key);
    if (file) states.push({ ...state, image: file.path, assetVersion: file.version });
    else missing.push(state);
  }
  const added = [];
  for (const [key, file] of [...available.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (referenced.has(key)) continue;
    const base = pathId(file.path);
    let id = base;
    for (let n = 2; usedIds.has(id.toLowerCase()); n++) id = `${base}_${n}`;
    usedIds.add(id.toLowerCase());
    const state = { id, label: file.path.split("/").pop().replace(IMAGE, ""), group: file.group, image: file.path, assetVersion: file.version };
    states.push(state);
    added.push(state);
  }
  const ids = new Set(states.map((state) => state.id));
  const events = Object.fromEntries(Object.entries(manifest.events || {}).filter(([, event]) => ids.has(event.state)));
  const fallback = states.find((state) => state.group?.toLowerCase() === "basic") || states[0];
  return { manifest: { ...manifest, states, events, defaultState: ids.has(manifest.defaultState) ? manifest.defaultState : fallback?.id }, missing, added };
}
