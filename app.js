import {
  loadCharacterManifest,
  preloadImage,
  resolveRegisteredCharacterManifestUrl,
  resolveStateImageUrl,
} from "./runtime/character-loader.js";
import { CharacterStateManager } from "./runtime/state-manager.js";
import { CharacterEventDispatcher } from "./runtime/event-dispatcher.js";
import { ActionIntentController } from "./runtime/action-intent-controller.js";
import { LiveEventInterface } from "./runtime/live-event-interface.js";
import {
  SceneStore, createScene, createCharacterInstance, validateScene,
  DEFAULT_SCENE_LIMITS, HARD_SCENE_LIMITS, LIMIT_STORAGE_KEY,
} from "./runtime/scene-manager.js";
import {
  buildCharacterManifest, defaultBehaviorForGroup, inferNewCharacterPackage, planAssetImport, SECTION_NAMES,
  validateArchiveTargets,
} from "./runtime/asset-import.js";

const DEFAULT_MANIFEST = "./characters/github-girl/character.json";

const elements = {
  layers: [...document.querySelectorAll(".character-layer")],
  groups: document.querySelector("#state-groups"),
  name: document.querySelector("#character-name"),
  label: document.querySelector("#current-label"),
  id: document.querySelector("#current-id"),
  description: document.querySelector("#current-description"),
  baseState: document.querySelector("#base-state"),
  overrideState: document.querySelector("#override-state"),
  status: document.querySelector("#status-message"),
  clearOverrides: document.querySelector("#clear-overrides"),
  manifestPath: document.querySelector("#manifest-path"),
  transitionType: document.querySelector("#transition-type"),
  transitionDuration: document.querySelector("#transition-duration"),
  transitionDurationValue: document.querySelector("#transition-duration-value"),
  transitionDistance: document.querySelector("#transition-distance"),
  transitionDistanceValue: document.querySelector("#transition-distance-value"),
  transitionDistanceRow: document.querySelector("#transition-distance-row"),
  previewTransition: document.querySelector("#preview-transition"),
  resetTransition: document.querySelector("#reset-transition"),
  lastEvent: document.querySelector("#last-event"),
  eventType: document.querySelector("#event-type"),
  sendEvent: document.querySelector("#send-event"),
  intentInput: document.querySelector("#intent-input"),
  sendIntent: document.querySelector("#send-intent"),
  intentResult: document.querySelector("#intent-result"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  chatSend: document.querySelector("#chat-send"),
  chatReply: document.querySelector("#chat-reply"),
  aiProvider: document.querySelector("#ai-provider"),
  aiModel: document.querySelector("#ai-model"),
  applyModel: document.querySelector("#apply-model"),
  activeModel: document.querySelector("#active-model"),
  characterPicker: document.querySelector("#character-picker"),
  manifestInput: document.querySelector("#manifest-input"),
  loadManifest: document.querySelector("#load-manifest"),
  openLiveMode: document.querySelector("#open-live-mode"),
  exitLiveMode: document.querySelector("#exit-live-mode"),
  shortcutState: document.querySelector("#shortcut-state"),
  addShortcut: document.querySelector("#add-shortcut"),
  shortcutList: document.querySelector("#shortcut-list"),
  scenePicker: document.querySelector("#scene-picker"),
  newScene: document.querySelector("#new-scene"),
  renameScene: document.querySelector("#rename-scene"),
  deleteScene: document.querySelector("#delete-scene"),
  duplicateScene: document.querySelector("#duplicate-scene"),
  addInstance: document.querySelector("#add-instance"),
  editInstanceLimits: document.querySelector("#edit-instance-limits"),
  sceneInstances: document.querySelector("#scene-instances"),
  assetFiles: document.querySelector("#asset-files"),
  newRoleFiles: document.querySelector("#new-role-files"),
  assetDropZone: document.querySelector("#asset-drop-zone"),
  assetImportList: document.querySelector("#asset-import-list"),
  commitAssets: document.querySelector("#commit-assets"),
  assetCharacter: document.querySelector("#asset-character"),
  assetSection: document.querySelector("#asset-section"),
  actionEditorList: document.querySelector("#action-editor-list"),
};

let manifest;
let manifestUrl;
let states;
let stateManager;
let eventDispatcher;
let actionIntentController;
let nextRenderMessage = "";
let activeLayer = 0;
let activeStateId = null;
let transitionToken = 0;
let transitionSettings;
let aiProviders = new Map();
let activeAiConfig = null;
let liveEventInterface;
let sceneStore;
let characterRegistry;
let pendingAssets = [];
let pendingCharacterManifest = null;
let sceneRenderToken = 0;
let selectedInstanceId = null;
const sceneManifestCache = new Map();
const sceneOverrides = new Map();

const DEFAULT_TRANSITION = { type: "crossfade", durationMs: 220, distancePx: 18 };
const TRANSITION_CLASSES = ["transition-bounce", "transition-pop", "transition-none"];

function stateById(id) {
  return states.get(id);
}

function imageUrlFor(state) {
  return resolveStateImageUrl(state, manifestUrl);
}

function setCurrentStateText(state, snapshot) {
  elements.label.textContent = state.label;
  elements.id.textContent = state.id;
  elements.description.textContent = state.description || "";
  elements.baseState.textContent = snapshot.baseState;
  elements.overrideState.textContent = snapshot.overrides[0]?.stateId || "无";
  document.querySelectorAll(".state-button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.stateId === state.id));
  });
}

function displayFor(state) {
  return {
    scale: 1,
    anchorX: 50,
    anchorY: 50,
    offsetX: 0,
    offsetY: 0,
    ...manifest.display,
    ...state.display,
  };
}

function applyDisplay(layer, state) {
  const display = displayFor(state);
  layer.style.objectPosition = `${display.anchorX}% ${display.anchorY}%`;
  layer.style.setProperty("--character-scale", display.scale);
  layer.style.setProperty("--character-offset-x", `${display.offsetX}px`);
  layer.style.setProperty("--character-offset-y", `${display.offsetY}px`);
}

function applyTransitionClass(layer) {
  layer.classList.remove(...TRANSITION_CLASSES);
  if (transitionSettings.type !== "crossfade") {
    layer.classList.add(`transition-${transitionSettings.type}`);
  }
}

function applyTransitionSettings(settings) {
  transitionSettings = { ...DEFAULT_TRANSITION, ...settings };
  document.documentElement.style.setProperty("--transition-ms", `${transitionSettings.durationMs}ms`);
  document.documentElement.style.setProperty("--transition-distance", `${transitionSettings.distancePx}px`);
  document.documentElement.style.setProperty("--transition-rebound", `${transitionSettings.distancePx * -0.35}px`);
  elements.transitionType.value = transitionSettings.type;
  elements.transitionDuration.value = transitionSettings.durationMs;
  elements.transitionDurationValue.value = `${transitionSettings.durationMs} ms`;
  elements.transitionDistance.value = transitionSettings.distancePx;
  elements.transitionDistanceValue.value = `${transitionSettings.distancePx} px`;
  elements.transitionDistanceRow.hidden = transitionSettings.type !== "bounce";
  elements.layers.forEach(applyTransitionClass);
}

function previewTransition() {
  const layer = elements.layers[activeLayer];
  if (!layer || activeStateId === null) return;
  layer.classList.remove("is-visible");
  void layer.offsetWidth;
  requestAnimationFrame(() => layer.classList.add("is-visible"));
}

function bindTransitionEditor() {
  elements.transitionType.addEventListener("change", () => {
    applyTransitionSettings({ ...transitionSettings, type: elements.transitionType.value });
  });
  elements.transitionDuration.addEventListener("input", () => {
    applyTransitionSettings({ ...transitionSettings, durationMs: Number(elements.transitionDuration.value) });
  });
  elements.transitionDistance.addEventListener("input", () => {
    applyTransitionSettings({ ...transitionSettings, distancePx: Number(elements.transitionDistance.value) });
  });
  elements.previewTransition.addEventListener("click", previewTransition);
  elements.resetTransition.addEventListener("click", () => applyTransitionSettings(manifest.transition));
}

async function renderSnapshot(snapshot, allowFallback = true, fallbackMessage = "") {
  const requestedId = snapshot.effectiveState;
  const state = stateById(requestedId);
  if (!state) {
    const message = `未知状态“${requestedId}”，已回退到待机。`;
    elements.status.textContent = message;
    if (allowFallback) {
      nextRenderMessage = message;
      stateManager.reset("unknown_state_fallback");
    }
    return;
  }

  if (state.id === activeStateId) {
    elements.status.textContent = fallbackMessage;
    setCurrentStateText(state, snapshot);
    return;
  }

  const token = ++transitionToken;
  try {
    const url = await preloadImage(imageUrlFor(state));
    if (token !== transitionToken) return;

    const nextLayer = activeStateId === null ? activeLayer : 1 - activeLayer;
    const current = elements.layers[activeLayer];
    const next = elements.layers[nextLayer];
    next.src = url;
    next.alt = `${manifest.name}：${state.label}`;
    applyDisplay(next, state);
    applyTransitionClass(next);

    requestAnimationFrame(() => {
      next.classList.add("is-visible");
      if (next !== current) current.classList.remove("is-visible");
    });

    activeLayer = nextLayer;
    activeStateId = state.id;
    elements.status.textContent = fallbackMessage;
    setCurrentStateText(state, snapshot);
  } catch (error) {
    const message = `${error.message} 已尝试回退到待机。`;
    elements.status.textContent = message;
    if (allowFallback && state.id !== manifest.defaultState) {
      nextRenderMessage = message;
      const failedOverride = snapshot.overrides.find((entry) => entry.stateId === state.id);
      if (failedOverride) {
        stateManager.clearOverride(failedOverride.id, "image_error_fallback");
      } else {
        stateManager.reset("image_error_fallback");
      }
    } else {
      elements.label.textContent = "图片不可用";
      elements.id.textContent = "resource_error";
      elements.description.textContent = error.message;
    }
  }
}

function activateState(state) {
  eventDispatcher.dispatch({
    type: "state_requested",
    payload: { stateId: state.id, source: "control_panel" },
  });
}

function renderControls() {
  const labels = manifest.groups || {};
  const grouped = new Map();
  for (const state of manifest.states) {
    const rawGroupId = state.group || "other";
    const groupId = Object.keys(labels).find((key) => key.toLowerCase() === rawGroupId.toLowerCase()) || rawGroupId;
    if (!grouped.has(groupId)) grouped.set(groupId, []);
    grouped.get(groupId).push(state);
  }

  elements.groups.replaceChildren();
  for (const [groupId, states] of grouped) {
    const section = document.createElement("section");
    section.className = "state-group";
    const title = document.createElement("h2");
    title.textContent = labels[groupId] || groupId;
    const buttons = document.createElement("div");
    buttons.className = "state-buttons";

    for (const state of states) {
      const button = document.createElement("button");
      button.className = "state-button";
      button.type = "button";
      button.dataset.stateId = state.id;
      button.setAttribute("aria-pressed", "false");
      const label = document.createElement("span");
      label.textContent = state.label;
      const id = document.createElement("small");
      id.textContent = state.id;
      button.append(label, id);
      button.addEventListener("click", () => activateState(state));
      buttons.append(button);
    }

    section.append(title, buttons);
    elements.groups.append(section);
  }
}

function renderActionEditor() {
  if (!elements.actionEditorList) return;
  elements.actionEditorList.replaceChildren();
  for (const state of manifest.states) {
    const row = document.createElement("div"); row.className = "asset-import-row";
    const image = document.createElement("span"); image.textContent = state.image;
    const label = document.createElement("input"); label.value = state.label; label.setAttribute("aria-label", `动作名称 ${state.id}`);
    const save = document.createElement("button"); save.type = "button"; save.textContent = "保存名称";
    save.addEventListener("click", async () => {
      const response = await fetch("./api/assets/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId: manifest.id, stateId: state.id, label: label.value.trim() }) });
      const result = await response.json();
      if (!response.ok) { elements.status.textContent = result.error || "名称保存失败。"; return; }
      state.label = result.label;
      elements.status.textContent = `已更新动作名称：${result.label}`;
      renderControls(); renderShortcuts();
    });
    row.append(image, label, save); elements.actionEditorList.append(row);
  }
}

function updateSceneInstance(instance, updates) {
  const scene = sceneStore.active;
  const target = scene.characters.find((item) => item.instanceId === instance.instanceId);
  if (!target) return;
  if (updates.currentState) {
    target.currentState = updates.currentState;
    clearSceneOverride(target.instanceId);
  }
  if (updates.displayName) target.displayName = updates.displayName;
  if (updates.transform) target.transform = { ...target.transform, ...updates.transform };
  sceneStore.update(scene);
  renderSceneStage(scene);
}

function clearSceneOverride(instanceId) {
  const active = sceneOverrides.get(instanceId);
  if (active?.timer) clearTimeout(active.timer);
  sceneOverrides.delete(instanceId);
}

function playSceneOverride(instance, state) {
  const behavior = { ...defaultBehaviorForGroup(state.group), ...state.behavior };
  if (behavior.mode !== "override") return;
  clearSceneOverride(instance.instanceId);
  const active = { stateId: state.id, timer: null };
  const durationMs = behavior.durationMs ?? 2500;
  if (durationMs > 0) {
    active.timer = setTimeout(() => {
      if (sceneOverrides.get(instance.instanceId) !== active) return;
      sceneOverrides.delete(instance.instanceId);
      if (sceneStore.active.characters.some((item) => item.instanceId === instance.instanceId)) {
        renderSceneStage(sceneStore.active);
      }
    }, durationMs);
  }
  sceneOverrides.set(instance.instanceId, active);
  elements.status.textContent = durationMs > 0
    ? `${instance.displayName}：临时动作“${state.label}”，${(durationMs / 1000).toFixed(1)} 秒后恢复常驻动作。`
    : `${instance.displayName}：临时动作“${state.label}”；可用“恢复常驻”结束。`;
  renderSceneStage(sceneStore.active);
}

async function loadSceneManifest(entry) {
  if (!entry) throw new Error("角色未登记到角色目录。");
  const url = resolveRegisteredCharacterManifestUrl(entry, location.href);
  const key = url.href;
  if (!sceneManifestCache.has(key)) {
    sceneManifestCache.set(key, fetch(`${url.pathname}?v=${Date.now()}`, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`角色清单读取失败：HTTP ${response.status}`);
      return response.json();
    }));
  }
  return sceneManifestCache.get(key);
}

function renderEventControls() {
  elements.eventType.replaceChildren();
  for (const eventType of Object.keys(manifest.events || {})) {
    const option = document.createElement("option");
    option.value = eventType;
    option.textContent = eventType;
    elements.eventType.append(option);
  }
  elements.sendEvent.disabled = elements.eventType.options.length === 0;
  elements.sendEvent.addEventListener("click", () => {
    eventDispatcher.dispatch({ type: elements.eventType.value, payload: { source: "simulator" } });
  });
}

function bindIntentSimulator() {
  elements.sendIntent.addEventListener("click", () => {
    actionIntentController.submit(elements.intentInput.value);
  });
}

function navigateToManifest(path) {
  const url = new URL(location.href);
  url.searchParams.set("manifest", path);
  url.searchParams.delete("mode");
  location.assign(url);
}

async function bindCharacterTools() {
  const response = await fetch(`./characters/index.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`角色目录读取失败：HTTP ${response.status}`);
  const registry = await response.json();
  characterRegistry = registry;
  elements.assetCharacter.replaceChildren();
  for (const character of registry.characters || []) {
    const assetOption = document.createElement("option");
    assetOption.value = character.id;
    assetOption.textContent = character.name;
    assetOption.selected = character.id === manifest.id;
    elements.assetCharacter.append(assetOption);
  }
  elements.characterPicker.replaceChildren();
  for (const character of registry.characters || []) {
    const option = document.createElement("option");
    option.value = new URL(character.manifest, response.url).pathname;
    option.textContent = character.name;
    option.selected = character.id === manifest.id;
    elements.characterPicker.append(option);
  }
  elements.characterPicker.addEventListener("change", () => navigateToManifest(elements.characterPicker.value));
  elements.manifestInput.value = manifestUrl.pathname;
  elements.loadManifest.addEventListener("click", () => {
    const path = elements.manifestInput.value.trim();
    if (path) navigateToManifest(path);
  });
  elements.openLiveMode.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("mode", "live");
    location.assign(url);
  });
  elements.exitLiveMode.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.delete("mode");
    location.assign(url);
  });
}

function shortcutStorageKey() {
  return `static-character-runtime.shortcuts.${manifest.id}`;
}

function readShortcuts() {
  try {
    const value = JSON.parse(localStorage.getItem(shortcutStorageKey()) || "[]");
    return Array.isArray(value) ? value.filter((id) => states.has(id)) : [];
  } catch {
    return [];
  }
}

function renderShortcuts() {
  const shortcuts = readShortcuts();
  elements.shortcutList.replaceChildren();
  elements.shortcutState.replaceChildren();
  for (const state of manifest.states) {
    const option = document.createElement("option");
    option.value = state.id;
    option.textContent = `${state.label} (${state.id})`;
    elements.shortcutState.append(option);
  }
  for (const stateId of shortcuts) {
    const state = states.get(stateId);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = state.label;
    button.title = "单击执行；双击移除";
    button.addEventListener("click", () => activateState(state));
    button.addEventListener("dblclick", () => {
      localStorage.setItem(shortcutStorageKey(), JSON.stringify(shortcuts.filter((id) => id !== stateId)));
      renderShortcuts();
    });
    elements.shortcutList.append(button);
  }
}

function bindShortcutEditor() {
  elements.addShortcut.addEventListener("click", () => {
    const shortcuts = readShortcuts();
    const stateId = elements.shortcutState.value;
    if (!shortcuts.includes(stateId)) shortcuts.push(stateId);
    localStorage.setItem(shortcutStorageKey(), JSON.stringify(shortcuts));
    renderShortcuts();
  });
  renderShortcuts();
}

function characterEntry(id) {
  return characterRegistry?.characters?.find((item) => item.id === id);
}

function renderSceneEditor() {
  const active = sceneStore.active;
  if (!active.characters.some((item) => item.instanceId === selectedInstanceId)) selectedInstanceId = null;
  elements.scenePicker.replaceChildren();
  for (const scene of sceneStore.scenes) {
    const option = document.createElement("option");
    option.value = scene.id;
    option.textContent = scene.name;
    option.selected = scene.id === active.id;
    elements.scenePicker.append(option);
  }
  elements.sceneInstances.replaceChildren();
  document.querySelector("#selected-controls").replaceChildren();
  for (const instance of active.characters) {
    const card = document.createElement("details");
    card.className = "instance-card";
    card.dataset.instanceId = instance.instanceId;
    card.open = instance.instanceId === selectedInstanceId;
    const summary = document.createElement("summary");
    summary.textContent = `${instance.displayName}${instance.enabled ? "" : "（隐藏）"}`;
    summary.addEventListener("click", (event) => { event.preventDefault(); selectSceneInstance(instance.instanceId); });
    const controls = document.createElement("div");
    controls.className = "instance-controls";
    const name = document.createElement("input");
    name.value = instance.displayName;
    name.setAttribute("aria-label", "角色实例显示名称");
    name.addEventListener("change", () => {
      const candidate = name.value.trim();
      if (!candidate || active.characters.some((other) => other !== instance && other.displayName === candidate)) {
        elements.status.textContent = "实例显示名称不能为空，且必须在当前场景唯一。";
        name.value = instance.displayName;
        return;
      }
      instance.displayName = candidate;
      sceneStore.update(active);
      renderSceneEditor();
    });
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = instance.enabled;
    enabled.setAttribute("aria-label", "启用角色实例");
    enabled.addEventListener("change", () => {
      instance.enabled = enabled.checked;
      const errors = validateScene(active, { limits: sceneStore.limits, characterIds: new Set(characterRegistry.characters.map((item) => item.id)) });
      if (errors.length) { instance.enabled = !enabled.checked; enabled.checked = instance.enabled; elements.status.textContent = errors[0]; return; }
      sceneStore.update(active); renderSceneEditor();
    });
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "移除";
    remove.addEventListener("click", () => { active.characters = active.characters.filter((item) => item !== instance); sceneStore.update(active); renderSceneEditor(); });
    const entry = characterEntry(instance.characterId);
    let loadedCharacterManifest = null;
    const basePicker = document.createElement("select");
    basePicker.setAttribute("aria-label", `${instance.displayName} 的常驻动作`);
    basePicker.disabled = true;
    const overridePicker = document.createElement("select");
    overridePicker.setAttribute("aria-label", `${instance.displayName} 的临时动作`);
    overridePicker.disabled = true;
    const playOverride = document.createElement("button");
    playOverride.type = "button";
    playOverride.className = "secondary-button";
    playOverride.textContent = "播放";
    playOverride.disabled = true;
    const clearOverride = document.createElement("button");
    clearOverride.type = "button";
    clearOverride.className = "secondary-button";
    clearOverride.textContent = "恢复常驻";
    clearOverride.addEventListener("click", () => {
      clearSceneOverride(instance.instanceId);
      renderSceneStage(sceneStore.active);
    });
    const actionTools = document.createElement("div");
    actionTools.className = "instance-action-tools";
    const baseLabel = document.createElement("label");
    baseLabel.append(document.createTextNode("常驻动作"), basePicker);
    const overrideLabel = document.createElement("label");
    overrideLabel.append(document.createTextNode("临时动作"), overridePicker);
    actionTools.append(baseLabel, overrideLabel, playOverride, clearOverride);
    loadSceneManifest(entry).then((characterManifest) => {
        if (!basePicker.isConnected) return;
        loadedCharacterManifest = characterManifest;
        const characterStates = characterManifest.states || [];
        const currentState = characterStates.some((state) => state.id === (instance.currentState || instance.initialState))
          ? instance.currentState || instance.initialState
          : characterManifest.defaultState;
        for (const state of characterStates) {
          const option = document.createElement("option");
          option.value = state.id; option.textContent = state.label;
          basePicker.append(option);
          const behavior = { ...defaultBehaviorForGroup(state.group), ...state.behavior };
          if (behavior.mode === "override") {
            const temporaryOption = document.createElement("option");
            temporaryOption.value = state.id; temporaryOption.textContent = state.label;
            overridePicker.append(temporaryOption);
          }
        }
        basePicker.value = currentState;
        if (!overridePicker.options.length) {
          const empty = document.createElement("option"); empty.textContent = "没有临时动作"; empty.value = ""; overridePicker.append(empty);
        } else {
          const placeholder = document.createElement("option"); placeholder.textContent = "选择要播放的动作"; placeholder.value = ""; placeholder.selected = true; overridePicker.prepend(placeholder);
        }
        basePicker.disabled = false;
        overridePicker.disabled = false;
        playOverride.disabled = overridePicker.options.length <= 1;
      }).catch((error) => { if (basePicker.isConnected) elements.status.textContent = error.message; });
    basePicker.addEventListener("change", () => updateSceneInstance(instance, { currentState: basePicker.value }));
    playOverride.addEventListener("click", () => {
      const state = loadedCharacterManifest?.states.find((item) => item.id === overridePicker.value);
      if (state) playSceneOverride(instance, state);
    });
    controls.append(name, enabled, remove);
    const transform = document.createElement("div");
    transform.className = "transform-controls";
    for (const [key, label, min, max, step] of [["x", "X", 0, 1, .01], ["y", "Y", 0, 1, .01], ["scale", "缩放", .1, 3, .05]]) {
      const wrapper = document.createElement("label"); wrapper.textContent = label;
      const input = document.createElement("input"); input.type = "number"; input.min = min; input.max = max; input.step = step; input.value = instance.transform[key];
      input.addEventListener("change", () => { const previous = instance.transform[key]; instance.transform[key] = Number(input.value); const errors = validateScene(active, { limits: sceneStore.limits }); if (errors.length) { instance.transform[key] = previous; input.value = previous; elements.status.textContent = errors[0]; } else { sceneStore.update(active); renderSceneStage(active); } });
      wrapper.append(input); transform.append(wrapper);
    }
    const move = document.createElement("div"); move.className = "instance-move";
    const left = document.createElement("button"); left.type = "button"; left.textContent = "←"; left.title = "左移微调";
    const right = document.createElement("button"); right.type = "button"; right.textContent = "→"; right.title = "右移微调";
    const up = document.createElement("button"); up.type = "button"; up.textContent = "↑"; up.title = "上移微调";
    const down = document.createElement("button"); down.type = "button"; down.textContent = "↓"; down.title = "下移微调";
    const front = document.createElement("button"); front.type = "button"; front.textContent = "置前";
    const back = document.createElement("button"); back.type = "button"; back.textContent = "置后";
    left.addEventListener("click", () => { instance.transform.x = Math.max(0, +(instance.transform.x - .01).toFixed(2)); sceneStore.update(active); renderSceneEditor(); });
    right.addEventListener("click", () => { instance.transform.x = Math.min(1, +(instance.transform.x + .01).toFixed(2)); sceneStore.update(active); renderSceneEditor(); });
    up.addEventListener("click", () => { instance.transform.y = Math.min(1, +(instance.transform.y + .01).toFixed(2)); sceneStore.update(active); renderSceneEditor(); });
    down.addEventListener("click", () => { instance.transform.y = Math.max(0, +(instance.transform.y - .01).toFixed(2)); sceneStore.update(active); renderSceneEditor(); });
    front.addEventListener("click", () => { instance.transform.zIndex = Math.max(...active.characters.map((item) => item.transform.zIndex || 0)) + 1; sceneStore.update(active); renderSceneEditor(); });
    back.addEventListener("click", () => { instance.transform.zIndex = Math.min(...active.characters.map((item) => item.transform.zIndex || 0)) - 1; sceneStore.update(active); renderSceneEditor(); });
    move.append(left, right, up, down, front, back);
    card.append(summary, controls, actionTools, transform, move);
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      handleAssetFiles(event.dataTransfer.files, instance.characterId);
    });
    elements.sceneInstances.append(card);
  }
  renderSceneStage(active);
  updateSelectionDisplay();
}

function selectSceneInstance(instanceId) {
  selectedInstanceId = instanceId;
  updateSelectionDisplay();
}

function updateSelectionDisplay() {
  const selected = sceneStore?.active.characters.find((item) => item.instanceId === selectedInstanceId);
  const summary = document.querySelector("#selection-summary");
  summary.textContent = selected ? `${selected.displayName} · 当前基础动作：${selected.currentState || selected.initialState}` : "未选中角色：请单击画布中的角色，或展开下方角色卡。";
  document.querySelectorAll(".instance-card").forEach((card) => {
    const active = card.dataset.instanceId === selectedInstanceId;
    card.classList.toggle("is-selected", active);
    if (active) card.open = true;
    else card.open = false;
    (active ? document.querySelector("#selected-controls") : elements.sceneInstances).append(card);
  });
  document.querySelectorAll(".scene-instance").forEach((image) => image.classList.toggle("is-selected", image.dataset.instanceId === selectedInstanceId));
}

function renderSceneStage(scene) {
  const renderToken = ++sceneRenderToken;
  const stage = document.querySelector(".stage");
  const visibleInstances = [...scene.characters]
    .filter((item) => item.enabled)
    .sort((a, b) => a.transform.zIndex - b.transform.zIndex);
  stage.querySelectorAll(".scene-instance").forEach((node) => node.remove());
  if (visibleInstances.length === 0) {
    document.body.classList.remove("scene-editor-mode");
    stage.querySelectorAll(".character-layer, .stage-glow").forEach((node) => node.hidden = false);
    return;
  }
  stage.querySelectorAll(".character-layer, .stage-glow").forEach((node) => node.hidden = true);
  document.body.classList.add("scene-editor-mode");
  for (const instance of visibleInstances) {
    const entry = characterEntry(instance.characterId);
    if (!entry) continue;
    const stateId = sceneOverrides.get(instance.instanceId)?.stateId || instance.currentState || instance.initialState;
    const stateUrl = resolveRegisteredCharacterManifestUrl(entry, location.href);
    const image = document.createElement("img");
    image.className = "scene-instance";
    image.classList.toggle("is-selected", instance.instanceId === selectedInstanceId);
    image.alt = instance.displayName;
    image.dataset.instanceId = instance.instanceId;
    image.style.left = `${instance.transform.x * 100}%`;
    image.style.top = `${(1 - instance.transform.y) * 100}%`;
    image.style.transform = `translate(-50%, -50%) scale(${instance.transform.scale})`;
    image.style.zIndex = String(10 + instance.transform.zIndex);
    image.style.display = "block";
    image.style.visibility = "visible";
    image.style.opacity = "1";
    image.title = instance.displayName;
    stage.append(image);
    if (!document.body.classList.contains("live-mode")) bindSceneImageDrag(image, instance, scene, stage);
    loadSceneManifest(entry).then((characterManifest) => {
      if (renderToken !== sceneRenderToken) return;
      const state = characterManifest.states.find((item) => item.id === stateId) || characterManifest.states.find((item) => item.id === characterManifest.defaultState);
      if (!state) return;
      image.onerror = () => { elements.status.textContent = `实例 ${instance.displayName} 的图片无法加载：${state.image}`; };
      image.src = new URL(state.image, new URL("./", stateUrl)).href + `?v=${Date.now()}`;
    }).catch((error) => { if (renderToken === sceneRenderToken) elements.status.textContent = error.message; });
  }
}

function bindSceneImageDrag(image, instance, scene, stage) {
  image.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    selectSceneInstance(instance.instanceId);
    image.setPointerCapture(event.pointerId);
    image.style.cursor = "grabbing";
    const rect = stage.getBoundingClientRect();
    const originX = event.clientX;
    const originY = event.clientY;
    const startX = instance.transform.x;
    const startY = instance.transform.y;
    const move = (pointerEvent) => {
      instance.transform.x = Math.max(0, Math.min(1, startX + (pointerEvent.clientX - originX) / rect.width));
      instance.transform.y = Math.max(0, Math.min(1, startY - (pointerEvent.clientY - originY) / rect.height));
      image.style.left = `${instance.transform.x * 100}%`;
      image.style.top = `${(1 - instance.transform.y) * 100}%`;
    };
    const finish = () => {
      image.removeEventListener("pointermove", move);
      image.removeEventListener("pointerup", finish);
      image.removeEventListener("pointercancel", finish);
      image.style.cursor = "grab";
      sceneStore.update(scene);
      renderSceneEditor();
    };
    image.addEventListener("pointermove", move);
    image.addEventListener("pointerup", finish, { once: true });
    image.addEventListener("pointercancel", finish, { once: true });
  });
}

function addCharacterInstance() {
  const active = sceneStore.active;
  const selectedManifest = elements.characterPicker.selectedOptions[0]?.value;
  const entry = characterRegistry.characters.find((item) => new URL(item.manifest, location.href).pathname === selectedManifest) || characterEntry(manifest.id);
  if (!entry) { elements.status.textContent = "请先将角色包登记到角色目录。"; return; }
  const limits = sceneStore.limits;
  if (active.characters.filter((item) => item.enabled).length >= limits.maxInstances) { elements.status.textContent = `已达到场景启用实例上限 ${limits.maxInstances}。可在“实例数量限制”中调整。`; return; }
  if (active.characters.some((item) => item.characterId === entry.id)) { elements.status.textContent = `角色 ${entry.name} 已在当前场景中；每个角色只保留一个实例。`; return; }
  loadSceneManifest(entry).then((characterManifest) => {
    const instance = createCharacterInstance(entry, active, characterManifest);
    active.characters.push(instance);
    const errors = validateScene(active, { limits, characterIds: new Set(characterRegistry.characters.map((item) => item.id)) });
    if (errors.length) { active.characters.pop(); elements.status.textContent = errors[0]; return; }
    sceneStore.update(active); renderSceneEditor();
  }).catch((error) => { elements.status.textContent = error.message; });
}

function bindSceneEditor() {
  sceneStore = new SceneStore({ characterIds: new Set(characterRegistry.characters.map((item) => item.id)) });
  const refresh = () => renderSceneEditor();
  elements.scenePicker.addEventListener("change", () => { sceneStore.select(elements.scenePicker.value); refresh(); });
  elements.newScene.addEventListener("click", () => {
    const name = prompt("新场景名称", "新场景");
    if (name?.trim()) sceneStore.add(createScene(name));
    refresh();
  });
  elements.renameScene.addEventListener("click", () => {
    const name = prompt("场景名称", sceneStore.active.name);
    if (name?.trim()) { sceneStore.active.name = name.trim(); sceneStore.update(sceneStore.active); refresh(); }
  });
  elements.duplicateScene.addEventListener("click", () => {
    const source = sceneStore.active;
    const copy = createScene(`${source.name} 副本`, source.characters);
    copy.interaction = structuredClone(source.interaction);
    copy.events = structuredClone(source.events);
    copy.characters.forEach((item) => { item.instanceId = crypto.randomUUID(); });
    sceneStore.add(copy); refresh();
  });
  elements.deleteScene.addEventListener("click", () => {
    try { sceneStore.remove(sceneStore.active.id); refresh(); }
    catch (error) { elements.status.textContent = error.message; }
  });
  elements.addInstance.addEventListener("click", addCharacterInstance);
  elements.editInstanceLimits.addEventListener("click", () => {
    const current = sceneStore.limits;
    const total = Number(prompt(`每場景启用实例上限（1–${HARD_SCENE_LIMITS.maxInstances}）`, current.maxInstances));
    if (!Number.isFinite(total)) return;
    const next = { maxInstances: Math.max(1, Math.min(HARD_SCENE_LIMITS.maxInstances, Math.floor(total))), maxPerCharacter: 1 };
    localStorage.setItem(LIMIT_STORAGE_KEY, JSON.stringify(next));
    sceneStore.limits = next; refresh();
    const errors = validateScene(sceneStore.active, { limits: next });
    elements.status.textContent = errors[0] || `实例限制已保存：每场景 ${next.maxInstances}；每个角色仅一个实例。`;
  });
  for (const name of SECTION_NAMES) { const option = document.createElement("option"); option.value = name; option.textContent = name; elements.assetSection.append(option); }
  elements.assetFiles.addEventListener("change", () => handleAssetFiles(elements.assetFiles.files));
  elements.newRoleFiles.addEventListener("change", () => handleAssetFiles(elements.newRoleFiles.files));
  elements.assetDropZone.addEventListener("dragover", (event) => { event.preventDefault(); elements.assetDropZone.classList.add("is-dragging"); });
  elements.assetDropZone.addEventListener("dragleave", () => elements.assetDropZone.classList.remove("is-dragging"));
  elements.assetDropZone.addEventListener("drop", (event) => { event.preventDefault(); elements.assetDropZone.classList.remove("is-dragging"); handleAssetFiles(event.dataTransfer.files); });
  elements.commitAssets.addEventListener("click", commitAssetImport);
  elements.assetImportList.addEventListener("change", (event) => {
    if (!event.target.matches("[data-asset-section]")) return;
    const item = pendingAssets[Number(event.target.dataset.assetIndex)];
    if (item) { item.section = event.target.value; refreshPendingCharacterManifest(); }
  });
  elements.assetImportList.addEventListener("click", (event) => {
    if (!event.target.matches("[data-remove-asset]")) return;
    pendingAssets.splice(Number(event.target.dataset.assetIndex), 1);
    refreshPendingCharacterManifest();
    renderAssetQueue();
  });
  elements.assetImportList.addEventListener("change", (event) => {
    if (!event.target.matches("[data-asset-label]")) return;
    const item = pendingAssets[Number(event.target.dataset.assetIndex)];
    if (item) { item.label = event.target.value.trim() || item.file.name.replace(/\.[^.]+$/, ""); refreshPendingCharacterManifest(); }
  });
  refresh();
}

function renderAssetQueue() {
  elements.assetImportList.replaceChildren();
  for (const [index, item] of pendingAssets.entries()) {
    const row = document.createElement("div"); row.className = "asset-import-row";
    const targetName = pendingCharacterManifest?.name || characterRegistry.characters.find((character) => character.id === item.characterId)?.name || item.characterId;
    const filename = document.createElement("span"); filename.textContent = `${targetName} · ${item.section}/${item.file.name}`;
    const section = document.createElement("select"); section.setAttribute("aria-label", `为 ${item.file.name} 选择分区`);
    for (const name of SECTION_NAMES) {
      const option = document.createElement("option"); option.value = name; option.textContent = name; option.selected = item.section === name; section.append(option);
    }
    section.dataset.assetSection = "true"; section.dataset.assetIndex = String(index);
    const label = document.createElement("input"); label.value = item.label; label.setAttribute("aria-label", `为 ${item.file.name} 设置动作名称`);
    label.dataset.assetLabel = "true"; label.dataset.assetIndex = String(index);
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "移除";
    remove.dataset.removeAsset = "true"; remove.dataset.assetIndex = String(index);
    row.append(filename, section, label, remove); elements.assetImportList.append(row);
  }
  elements.commitAssets.disabled = pendingAssets.length === 0;
}

async function filesFromInput(files) {
  const result = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      if (!globalThis.JSZip) throw new Error("ZIP 解压组件未加载；请检查网络或直接拖入图片。 ");
      const zip = await globalThis.JSZip.loadAsync(file, { checkCRC32: true });
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
        if (!new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]).has(extension)) continue;
        const blob = await entry.async("blob");
        const safeName = path.split(/[\\/]/).at(-1);
        const imageFile = new File([blob], safeName, { type: blob.type });
        imageFile.archivePath = path;
        result.push(imageFile);
      }
    } else if (/\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) {
      if (file.webkitRelativePath) file.archivePath = file.webkitRelativePath;
      result.push(file);
    }
  }
  if (result.length === 0) throw new Error("没有找到支持的图片；请选取 PNG、JPG、WebP、GIF 或 AVIF 图片。 ");
  return result;
}

async function validateImportImages(files) {
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) {
      throw new Error(`图片“${file.archivePath || file.name}”超过 15 MB 限制。`);
    }
    const url = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`图片“${file.archivePath || file.name}”无法解码，已取消导入。`));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function handleAssetFiles(files, forcedCharacterId = "") {
  try {
    const images = await filesFromInput(files);
    await validateImportImages(images);
    const defaultSection = elements.assetSection.value || "Basic";
    const selectedCharacterId = forcedCharacterId || elements.assetCharacter.value;
    const newCharacter = forcedCharacterId ? null : inferNewCharacterPackage(images, characterRegistry.characters);
    let planned;
    if (newCharacter) {
      if (characterRegistry.characters.some((character) => character.id.toLowerCase() === newCharacter.id.toLowerCase())) {
        throw new Error(`角色文件夹“${newCharacter.name}”生成的 ID 已被占用，请先重命名文件夹。`);
      }
      planned = planAssetImport(images, { characterId: newCharacter.id, section: defaultSection });
      if (pendingAssets.some((item) => item.characterId !== newCharacter.id)) throw new Error("请先完成当前素材队列，再导入另一个角色。");
      pendingAssets.push(...planned);
      pendingCharacterManifest = buildCharacterManifest({ ...newCharacter, assets: pendingAssets });
      pendingAssets.forEach((item, index) => { item.stateId = pendingCharacterManifest.states[index].id; });
      elements.status.textContent = `已识别新角色“${newCharacter.name}”，确认导入后会创建独立角色包。`;
    } else {
      validateArchiveTargets(images, { characters: characterRegistry.characters, targetCharacterId: selectedCharacterId });
      planned = planAssetImport(images, { characterId: selectedCharacterId, section: defaultSection });
      if (pendingAssets.some((item) => item.characterId !== selectedCharacterId)) throw new Error("请先完成当前素材队列，再导入另一个角色。");
      pendingAssets.push(...planned);
      if (pendingCharacterManifest) refreshPendingCharacterManifest();
    }
    renderAssetQueue();
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

function refreshPendingCharacterManifest() {
  if (!pendingCharacterManifest) return;
  if (pendingAssets.length === 0) { pendingCharacterManifest = null; return; }
  const { id, name } = pendingCharacterManifest;
  pendingCharacterManifest = buildCharacterManifest({ id, name, assets: pendingAssets });
  pendingAssets.forEach((item, index) => { item.stateId = pendingCharacterManifest.states[index].id; });
}

async function commitAssetImport() {
    elements.commitAssets.disabled = true;
    try {
      const newCharacterId = pendingCharacterManifest?.id || "";
      if (pendingCharacterManifest) {
        const createResponse = await fetch("./api/characters/create", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: pendingCharacterManifest }),
        });
        const createResult = await createResponse.json();
        if (!createResponse.ok) throw new Error(createResult.error || "新角色包创建失败。");
      }
      for (const item of pendingAssets) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(item.file);
        });
        const response = await fetch("./api/assets/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: item.characterId, stateId: item.stateId, section: item.section, label: item.label, fileName: item.file.name, data: dataUrl.split(",")[1] }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "素材保存失败。");
      }
      await syncCharacterRegistry();
      if (newCharacterId) navigateToManifest(`./characters/${newCharacterId}/character.json`);
      else location.reload();
    } catch (error) {
      elements.status.textContent = error.message;
      elements.commitAssets.disabled = pendingAssets.length === 0;
    }
}

async function syncCharacterRegistry() {
  const response = await fetch(`./api/characters/sync?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`角色目录同步失败：HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "角色目录同步失败。");
}

function renderModelOptions(providerId) {
  const provider = aiProviders.get(providerId);
  elements.aiModel.replaceChildren();
  if (!provider) return;
  for (const modelId of provider.models) {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    option.selected = modelId === provider.defaultModel;
    elements.aiModel.append(option);
  }
}

function thinkingLabel(modelId) {
  return modelId.startsWith("glm-5.3") ? "最低思考（无法关闭）" : "思考已关闭";
}

async function loadModelOptions() {
  const response = await fetch("./api/models");
  if (!response.ok) throw new Error(`模型配置读取失败：HTTP ${response.status}`);
  const config = await response.json();
  aiProviders = new Map(config.providers.map((provider) => [provider.id, provider]));
  elements.aiProvider.replaceChildren();
  for (const provider of config.providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    option.selected = provider.id === config.defaultProvider;
    elements.aiProvider.append(option);
  }
  renderModelOptions(elements.aiProvider.value);
  const provider = aiProviders.get(elements.aiProvider.value);
  activeAiConfig = { provider: provider.id, model: provider.defaultModel };
  elements.activeModel.textContent = `当前：${provider.name} / ${provider.defaultModel} / ${thinkingLabel(provider.defaultModel)}`;

  elements.aiProvider.addEventListener("change", () => renderModelOptions(elements.aiProvider.value));
  elements.applyModel.addEventListener("click", () => {
    const selectedProvider = aiProviders.get(elements.aiProvider.value);
    activeAiConfig = { provider: selectedProvider.id, model: elements.aiModel.value };
    elements.activeModel.textContent = `当前：${selectedProvider.name} / ${elements.aiModel.value} / ${thinkingLabel(elements.aiModel.value)}`;
  });
}

function bindChat() {
  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.chatInput.value.trim();
    if (!message || elements.chatSend.disabled) return;
    if (!activeAiConfig) {
      elements.chatReply.textContent = "模型配置尚未加载完成。";
      return;
    }

    elements.chatSend.disabled = true;
    elements.chatReply.textContent = "正在思考……";
    eventDispatcher.dispatch({ type: "user_message_received", payload: { source: "chat" } });
    eventDispatcher.dispatch({ type: "assistant_thinking", payload: { source: "chat" } });

    let cooldownMs = 0;
    try {
      const response = await fetch("./api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          provider: activeAiConfig.provider,
          model: activeAiConfig.model,
          states: manifest.states.map((state) => ({
            id: state.id,
            description: state.description || state.label,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || `AI 请求失败：HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfterMs = result.retryAfterMs || 0;
        throw error;
      }

      eventDispatcher.dispatch({ type: "assistant_response_finished", payload: { source: "chat" } });
      elements.chatReply.textContent = result.allowed
        ? result.reply
        : "抱歉，这个请求我不能协助。我们可以换一个安全、合适的话题。";
      actionIntentController.submit(result.intent);
      elements.chatInput.value = "";
    } catch (error) {
      eventDispatcher.dispatch({ type: "assistant_response_finished", payload: { source: "chat" } });
      if (error.status === 429) {
        cooldownMs = Math.max(1000, error.retryAfterMs || 10000);
        elements.chatReply.textContent = `请求过于频繁，请约 ${Math.ceil(cooldownMs / 1000)} 秒后重试。`;
      } else {
        elements.chatReply.textContent = error.message;
      }
    } finally {
      if (cooldownMs > 0) {
        setTimeout(() => {
          elements.chatSend.disabled = false;
          elements.chatInput.focus();
        }, cooldownMs);
      } else {
        elements.chatSend.disabled = false;
        elements.chatInput.focus();
      }
    }
  });
}

async function start() {
  try {
    bindDockTabs();
    const query = new URLSearchParams(location.search);
    const isLiveMode = query.get("mode") === "live";
    document.documentElement.classList.toggle("live-mode", isLiveMode);
    document.body.classList.toggle("live-mode", isLiveMode);
    const requested = query.get("manifest") || DEFAULT_MANIFEST;
    const loaded = await loadCharacterManifest(requested);
    manifest = loaded.manifest;
    manifestUrl = loaded.url;
    states = loaded.states;

    elements.name.textContent = manifest.name;
    elements.manifestPath.textContent = `Manifest: ${manifestUrl.pathname}`;
    stateManager = new CharacterStateManager({
      defaultState: manifest.defaultState,
      isKnownState: (stateId) => states.has(stateId),
      onChange: (snapshot) => {
        const message = nextRenderMessage;
        nextRenderMessage = "";
        renderSnapshot(snapshot, true, message);
      },
      onError: (message) => { elements.status.textContent = message; },
    });
    eventDispatcher = new CharacterEventDispatcher({
      stateManager,
      eventMap: manifest.events || {},
      resolveStateAction: (stateId, payload) => {
        const state = states.get(stateId);
        if (!state) return null;
        const action = { state: state.id, ...defaultBehaviorForGroup(state.group), ...state.behavior };
        if (payload.source === "ai" && action.mode === "override") {
          action.durationMs = payload.durationMs;
        }
        return action;
      },
      onEvent: (event) => {
        elements.lastEvent.textContent = event.type;
      },
      onError: (message) => { elements.status.textContent = message; },
    });
    actionIntentController = new ActionIntentController({
      isKnownState: (stateId) => states.has(stateId),
      dispatch: (event) => eventDispatcher.dispatch(event),
      onDecision: (result) => {
        elements.intentResult.textContent = result.ok
          ? `已接受：${result.intent.state}`
          : `已拒绝：${result.error}`;
      },
    });
    liveEventInterface = new LiveEventInterface({
      onEvent: (event) => { elements.lastEvent.textContent = `${event.platform}:${event.type}`; },
      onError: (message) => { elements.status.textContent = message; },
    });
    window.staticCharacterRuntime = Object.freeze({
      dispatch: (event) => eventDispatcher.dispatch(event),
      suggestAction: (intent) => actionIntentController.submit(intent),
      receiveLiveEvent: (event) => liveEventInterface.receive(event),
    });
    elements.clearOverrides.addEventListener("click", () => {
      stateManager.clearOverrides("control_panel");
    });
    applyTransitionSettings(manifest.transition);
    bindTransitionEditor();
    renderEventControls();
    bindIntentSimulator();
    await bindCharacterTools();
    bindSceneEditor();
    bindShortcutEditor();
    await loadModelOptions();
    bindChat();
    renderControls();
    renderActionEditor();
    await renderSnapshot(stateManager.getSnapshot("initial"));
  } catch (error) {
    elements.label.textContent = "加载失败";
    elements.id.textContent = "error";
    elements.description.textContent = error.message;
    elements.status.textContent = "请确认本地服务器已启动，并检查 character.json。";
  }
}

function bindDockTabs() {
  const tabs = [...document.querySelectorAll(".dock-tab")];
  const panels = [...document.querySelectorAll(".dock-panel")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const selected = tab.dataset.tab;
      for (const item of tabs) {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      }
      for (const panel of panels) {
        const active = panel.dataset.panel === selected;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
      }
    });
  }
}

start();
