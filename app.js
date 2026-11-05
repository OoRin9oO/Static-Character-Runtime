import { DialogueContext } from "./runtime/dialogue-context.js";
import { SpeakerRouter } from "./runtime/speaker-router.js";
import { inferMessageMode } from "./runtime/message-routing.js";
import { parseScript, matchScriptSpeaker, ScriptPlayer } from "./runtime/script-player.js";
import { createReplyMotion, replyFrame, playbackInterval, boundedCount, updateReplyPlayback } from "./runtime/reply-motion.js";
import { discussionPlan } from "./runtime/discussion-plan.js";
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
import { LiveDirector } from "./runtime/live-director.js";
import { buildLiveSnapshot, mergeChatBroadcast } from "./runtime/live-snapshot.js";
import { reconcileAssets } from "./runtime/asset-catalog.js";
import {
  SceneStore, createScene, createCharacterInstance, validateScene,
  DEFAULT_SCENE_LIMITS, HARD_SCENE_LIMITS, LIMIT_STORAGE_KEY,
} from "./runtime/scene-manager.js";
import {
  buildCharacterManifest, classifyCharacterDesignPath, defaultBehaviorForGroup, inferNewCharacterPackage, planAssetImport, SECTION_NAMES,
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
let liveDirector;
const scriptPlayer = new ScriptPlayer();
let scriptPreparing = false;
let sceneStore;
let characterRegistry;
let pendingAssets = [];
let pendingCharacterManifest = null;
let pendingDesignFiles = [];
const designDrafts = new Map();
let sceneRenderToken = 0;
let selectedInstanceId = null;
const sceneManifestCache = new Map();
const assetScanState = new Map();
let lastLiveScene = null;
let liveSingleToken = 0;
const sceneOverrides = new Map();
const replyMotions = new Map();
const visualEffects = new Map();
const visualAnimations = new WeakMap();
const speakingAnimations = new WeakMap();
let motionSignature = "";
let livePending = null;
let liveSending = false;
let liveSendPromise = null;
let lastPublished = "";
let liveRevision = -1;
let lastObservedScene = "";

const DEFAULT_TRANSITION = { type: "crossfade", durationMs: 220, distancePx: 18 };
const TRANSITION_CLASSES = ["transition-bounce", "transition-pop", "transition-none"];

function stateById(id) {
  return states.get(id);
}

function imageUrlFor(state) {
  const url = new URL(resolveStateImageUrl(state, manifestUrl));
  if (state.assetVersion) url.searchParams.set("v", state.assetVersion);
  return url.href;
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
  if (selectedInstanceId) {
    const image = [...document.querySelectorAll(".scene-instance")].find((item) => item.dataset.instanceId === selectedInstanceId);
    if (image) animateSceneImage(image, transitionSettings);
    return;
  }
  const layer = elements.layers[activeLayer];
  if (!layer || activeStateId === null) return;
  layer.classList.remove("is-visible");
  void layer.offsetWidth;
  requestAnimationFrame(() => layer.classList.add("is-visible"));
}

function bindTransitionEditor() {
  const update = (settings) => {
    applyTransitionSettings(settings);
    const instance = sceneStore?.active.characters.find((item) => item.instanceId === selectedInstanceId);
    if (instance) {
      instance.transition = { ...transitionSettings };
      sceneStore.update(sceneStore.active);
      publishLiveScene(sceneStore.active);
    } else if (sceneStore && manifest) {
      sceneStore.active.characterTransitions ||= {};
      sceneStore.active.characterTransitions[manifest.id] = { ...transitionSettings };
      sceneStore.update(sceneStore.active);
      publishLiveScene(sceneStore.active);
    }
  };
  elements.transitionType.addEventListener("change", () => {
    update({ ...transitionSettings, type: elements.transitionType.value });
  });
  elements.transitionDuration.addEventListener("input", () => {
    update({ ...transitionSettings, durationMs: Number(elements.transitionDuration.value) });
  });
  elements.transitionDistance.addEventListener("input", () => {
    update({ ...transitionSettings, distancePx: Number(elements.transitionDistance.value) });
  });
  elements.previewTransition.addEventListener("click", previewTransition);
  elements.resetTransition.addEventListener("click", async () => {
    const instance = sceneStore?.active.characters.find((item) => item.instanceId === selectedInstanceId);
    if (!instance) {
      if (sceneStore.active.characterTransitions) delete sceneStore.active.characterTransitions[manifest.id];
      sceneStore.update(sceneStore.active);
      applyTransitionSettings(manifest.transition);
      publishLiveScene(sceneStore.active);
      return;
    }
    try {
      const character = await loadSceneManifest(characterEntry(instance.characterId));
      delete instance.transition;
      sceneStore.update(sceneStore.active);
      applyTransitionSettings(character.transition);
      publishLiveScene(sceneStore.active);
    } catch (error) { elements.status.textContent = error.message; }
  });
}

async function renderSnapshot(snapshot, allowFallback = true, fallbackMessage = "") {
  const entry = replyMotions.get(`single:${manifest.id}`);
  const sceneId = document.body.classList.contains("live-mode") ? lastLiveScene?.id : sceneStore?.active.id;
  const motion = entry?.sceneId === sceneId ? replyFrame(entry.motion) : null;
  if (motion && states.has(motion.state)) snapshot = { ...snapshot, effectiveState: motion.state };
  if (!states.size) {
    elements.layers.forEach((layer) => layer.classList.remove("is-visible"));
    elements.label.textContent = "没有可用图片";
    elements.description.textContent = "请向角色目录添加图片。";
    return;
  }
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
    syncSpeakingAnimation(elements.layers[activeLayer], `single:${manifest.id}`);
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
      syncSpeakingAnimation(next, `single:${manifest.id}`);
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
  replyMotions.delete(`single:${manifest.id}`);
  const instance = sceneStore?.active.characters.find((item) => item.instanceId === selectedInstanceId);
  if (instance) {
    const behavior = { ...defaultBehaviorForGroup(state.group), ...state.behavior };
    if (behavior.mode === "override") playSceneOverride(instance, state);
    else updateSceneInstance(instance, { currentState: state.id });
    return;
  }
  eventDispatcher.dispatch({
    type: "state_requested",
    payload: { stateId: state.id, source: "control_panel" },
  });
}

function renderControls(sourceManifest = manifest) {
  const labels = sourceManifest.groups || {};
  const grouped = new Map();
  for (const state of sourceManifest.states) {
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
  replyMotions.delete(instanceId);
  const active = sceneOverrides.get(instanceId);
  if (active?.timer) clearTimeout(active.timer);
  sceneOverrides.delete(instanceId);
}

function playSceneOverride(instance, state, options = {}) {
  const behavior = { ...defaultBehaviorForGroup(state.group), ...state.behavior };
  if (behavior.mode !== "override" && !options.force) return;
  clearSceneOverride(instance.instanceId);
  const active = { stateId: state.id, timer: null };
  const durationMs = options.durationMs ?? behavior.durationMs ?? 2500;
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

const DEFAULT_ANCHORS = { head: { x: 50, y: 20 }, body: { x: 50, y: 50 }, feet: { x: 50, y: 90 } };
function resolveAnchors(character, stateId) {
  const state = character.states.find((item) => item.id === stateId);
  const result = {};
  for (const key of ["head", "body", "feet"]) {
    const point = state?.anchors?.[key] || character.anchors?.[key] || DEFAULT_ANCHORS[key];
    result[key] = { x: Number(point.x), y: Number(point.y) };
  }
  return result;
}

function createAnchorEditor(instance, character, entry) {
  const section = document.createElement("details"); section.className = "character-design-editor anchor-editor";
  const title = document.createElement("summary"); title.textContent = "动效锚点设置";
  const note = document.createElement("p"); note.textContent = "选择共用锚点或指定姿态，选中锚点后点击图片定位；坐标为图片百分比。";
  const scope = document.createElement("select"); scope.setAttribute("aria-label", "锚点设置范围");
  scope.add(new Option("角色共用", ""));
  for (const state of character.states) scope.add(new Option(`姿态：${state.label}`, state.id));
  const pointPicker = document.createElement("select"); pointPicker.setAttribute("aria-label", "选择锚点");
  for (const [key, label] of [["head", "头部"], ["body", "身体"], ["feet", "脚部"]]) pointPicker.add(new Option(label, key));
  const picture = document.createElement("div"); picture.className = "anchor-picture";
  const img = document.createElement("img"); img.alt = "点击图片设置锚点";
  const dot = document.createElement("span"); dot.className = "anchor-dot";
  picture.append(img, dot);
  const values = document.createElement("div"); values.className = "transform-controls";
  const inputs = {};
  for (const axis of ["x", "y"]) {
    const label = document.createElement("label"); label.textContent = `${axis.toUpperCase()}（%）`;
    const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "100"; input.step = "0.1";
    label.append(input); values.append(label); inputs[axis] = input;
  }
  const save = document.createElement("button"); save.type = "button"; save.textContent = "保存锚点";
  const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "恢复共用锚点";
  const message = document.createElement("p"); message.setAttribute("role", "status");
  const effect = document.createElement("select"); effect.setAttribute("aria-label", "预览动效");
  for (const [value, label] of [["left", "向左移动"], ["right", "向右移动"], ["up", "向上浮动"], ["zoom", "靠近镜头"]]) effect.add(new Option(label, value));
  const preview = document.createElement("button"); preview.type = "button"; preview.textContent = "预览动效";
  let draft;
  const showPoint = () => {
    const point = draft[pointPicker.value]; inputs.x.value = point.x; inputs.y.value = point.y;
    dot.style.left = `${point.x}%`; dot.style.top = `${point.y}%`;
  };
  const reload = () => {
    draft = resolveAnchors(character, scope.value);
    const state = character.states.find((item) => item.id === scope.value) || character.states.find((item) => item.id === (instance.currentState || instance.initialState)) || character.states[0];
    img.src = resolveStateImageUrl(state, resolveRegisteredCharacterManifestUrl(entry, location.href));
    reset.textContent = scope.value ? "恢复共用锚点" : "恢复默认锚点";
    message.textContent = scope.value && state.anchors ? "此姿态使用单独设置。" : "当前使用共用或默认值。";
    showPoint();
  };
  scope.addEventListener("change", reload); pointPicker.addEventListener("change", showPoint);
  for (const axis of ["x", "y"]) inputs[axis].addEventListener("change", () => {
    const value = Number(inputs[axis].value);
    if (inputs[axis].value === "" || !Number.isFinite(value) || value < 0 || value > 100) { message.textContent = "坐标需在 0 到 100 之间。"; showPoint(); return; }
    draft[pointPicker.value][axis] = value; showPoint();
  });
  picture.addEventListener("click", (event) => {
    const rect = img.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    draft[pointPicker.value] = { x: Math.max(0, Math.min(100, +((event.clientX - rect.left) / rect.width * 100).toFixed(1))), y: Math.max(0, Math.min(100, +((event.clientY - rect.top) / rect.height * 100).toFixed(1))) };
    showPoint();
  });
  const write = async (resetValue) => {
    save.disabled = reset.disabled = scope.disabled = true;
    try {
      const response = await fetch("./api/characters/anchors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId: instance.characterId, stateId: scope.value, anchors: draft, reset: resetValue }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存失败");
      const target = scope.value ? character.states.find((state) => state.id === scope.value) : character;
      if (resetValue) delete target.anchors; else target.anchors = structuredClone(draft);
      reload(); message.textContent = "锚点已保存。";
    } catch (error) { message.textContent = `保存失败：${error.message}`; }
    finally { save.disabled = reset.disabled = scope.disabled = false; }
  };
  save.addEventListener("click", () => write(false)); reset.addEventListener("click", () => write(true));
  preview.addEventListener("click", () => {
    const image = [...document.querySelectorAll(".scene-instance[data-instance-id]")].find((item) => item.dataset.instanceId === instance.instanceId);
    if (!image || !instance.enabled) { message.textContent = "请先显示场景中的角色。"; return; }
    const points = resolveAnchors(character, image.dataset.stateId);
    visualEffects.set(instance.instanceId, { id: crypto.randomUUID(), sceneId: sceneStore.active.id, type: effect.value, anchor: points[pointPicker.value], startedAt: Date.now() + 600, durationMs: 3000 });
    renderSceneStage(sceneStore.active);
    message.textContent = "正在预览动效，结束后恢复原位。";
  });
  section.append(title, note, scope, pointPicker, picture, values, save, reset, message, effect, preview);
  reload(); return section;
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
  elements.sendEvent.onclick = () => {
    eventDispatcher.dispatch({ type: elements.eventType.value, payload: { source: "simulator" } });
  };
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
    window.open(url.href, "_blank", "noopener");
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
  renderBroadcast(active);
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
    playOverride.textContent = "执行下一动作";
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
    overrideLabel.append(document.createTextNode("预输入动作（临时）"), overridePicker);
    actionTools.append(baseLabel, overrideLabel, playOverride, clearOverride);
    loadSceneManifest(entry).then((characterManifest) => {
        if (!basePicker.isConnected) return;
        loadedCharacterManifest = characterManifest;
        actionTools.after(createAnchorEditor(instance, characterManifest, entry));
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
    const modelLabel = document.createElement("label");
    modelLabel.className = "field-label";
    modelLabel.textContent = "角色模型";
    const modelSelect = document.createElement("select");
    modelSelect.setAttribute("aria-label", `${instance.displayName} 的模型`);
    const defaultOption = document.createElement("option");
    defaultOption.value = ""; defaultOption.textContent = "跟随全局模型"; modelSelect.append(defaultOption);
    for (const provider of aiProviders.values()) {
      for (const modelId of provider.models) {
        const option = document.createElement("option");
        option.value = `${provider.id}::${modelId}`; option.textContent = `${provider.name} / ${modelId}`;
        modelSelect.append(option);
      }
    }
    modelSelect.value = instance.model ? `${instance.model.provider}::${instance.model.modelId}` : "";
    modelSelect.addEventListener("change", () => {
      const [provider, modelId] = modelSelect.value.split("::");
      instance.model = provider && modelId ? { provider, modelId } : null;
      sceneStore.update(active);
    });
    modelLabel.append(modelSelect);
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
    card.append(summary, controls, modelLabel, createDesignEditor(instance.characterId), actionTools, transform, move);
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

function createDesignEditor(characterId) {
  const section = document.createElement("details");
  section.className = "character-design-editor";
  const heading = document.createElement("summary"); heading.textContent = "角色设定";
  const note = document.createElement("p"); note.textContent = "设定会随对话发送给所选模型服务；请勿填写密钥或不希望发送的私密信息。";
  const input = document.createElement("textarea"); input.rows = 6; input.maxLength = 12000; input.placeholder = "填写角色身份、性格和说话方式……";
  const message = document.createElement("p"); message.setAttribute("role", "status"); message.textContent = "展开后读取设定。";
  const save = document.createElement("button"); save.type = "button"; save.className = "secondary-button"; save.textContent = "保存角色设定"; save.disabled = true;
  input.addEventListener("input", () => { const draft = designDrafts.get(characterId); if (draft) draft.content = input.value; });
  section.addEventListener("toggle", async () => {
    if (!section.open) return;
    try {
      let draft = designDrafts.get(characterId);
      if (!draft) {
        const response = await fetch(`./api/characters/design/${encodeURIComponent(characterId)}`, { cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "读取失败");
        draft = { content: data.content, version: data.version, path: data.path }; designDrafts.set(characterId, draft);
      }
      if (!section.isConnected) return;
      input.value = draft.content; message.textContent = `文件：${draft.path}`; save.disabled = false;
    } catch (error) { message.textContent = `读取失败：${error.message}`; }
  });
  save.addEventListener("click", async () => {
    const draft = designDrafts.get(characterId); if (!draft) return;
    save.disabled = true;
    try {
      const response = await fetch(`./api/characters/design/${encodeURIComponent(characterId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: input.value, version: draft.version }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存失败");
      designDrafts.set(characterId, { content: data.content, version: data.version, path: data.path });
      message.textContent = `已保存：${data.path}`;
    } catch (error) { message.textContent = `保存失败：${error.message}`; }
    finally { save.disabled = false; }
  });
  section.append(heading, note, input, save, message);
  return section;
}

function selectSceneInstance(instanceId) {
  selectedInstanceId = instanceId;
  elements.groups.replaceChildren();
  updateSelectionDisplay();
  const instance = sceneStore.active.characters.find((item) => item.instanceId === instanceId);
  if (instance) loadSceneManifest(characterEntry(instance.characterId)).then((data) => {
    if (selectedInstanceId === instanceId) {
      renderControls(data);
      applyTransitionSettings(instance.transition || data.transition);
      document.querySelector("#transition-target").textContent = `设置对象：${instance.displayName}（保存到当前场景）`;
    }
  }).catch((error) => { elements.status.textContent = error.message; });
}

function updateSelectionDisplay() {
  const selected = sceneStore?.active.characters.find((item) => item.instanceId === selectedInstanceId);
  const needsSelection = !selected && sceneStore?.active.characters.some((item) => item.enabled);
  for (const control of [elements.transitionType, elements.transitionDuration, elements.transitionDistance, elements.previewTransition, elements.resetTransition]) control.disabled = Boolean(needsSelection);
  if (!selected) {
    document.querySelector("#transition-target").textContent = needsSelection ? "请先选中场景中的角色。" : "设置对象：当前角色（页面预览）";
    if (!needsSelection) applyTransitionSettings(sceneStore?.active.characterTransitions?.[manifest.id] || manifest.transition);
  }
  document.body.classList.toggle("has-selected-instance", Boolean(selected));
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
  publishLiveScene(scene);
  const renderToken = ++sceneRenderToken;
  const stage = document.querySelector(".stage");
  const visibleInstances = [...scene.characters]
    .filter((item) => item.enabled)
    .sort((a, b) => a.transform.zIndex - b.transform.zIndex);
  const previous = new Map();
  stage.querySelectorAll(".scene-instance").forEach((node) => {
    if (node.dataset.instanceId && visibleInstances.some((item) => item.instanceId === node.dataset.instanceId)) {
      previous.set(node.dataset.instanceId, { node, state: node.dataset.stateId, src: node.src });
    } else {
      speakingAnimations.get(node)?.animation.cancel();
      node.remove();
    }
  });
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
    const motion = replyMotions.get(instance.instanceId);
    const frame = motion?.sceneId === scene.id ? replyFrame(motion.motion) : null;
    const stateId = frame?.state || sceneOverrides.get(instance.instanceId)?.stateId || instance.currentState || instance.initialState;
    const stateUrl = resolveRegisteredCharacterManifestUrl(entry, location.href);
    const image = document.createElement("img");
    image.className = "scene-instance";
    image.classList.toggle("is-selected", instance.instanceId === selectedInstanceId);
    image.alt = instance.displayName;
    image.dataset.instanceId = instance.instanceId;
    image.dataset.stateId = stateId;
    image.style.left = `${instance.transform.x * 100}%`;
    image.style.top = `${(1 - instance.transform.y) * 100}%`;
    image.style.transform = `translate(-50%, -50%) scale(${instance.transform.scale})`;
    image.style.zIndex = String(10 + instance.transform.zIndex);
    image.style.display = "block";
    image.style.visibility = "visible";
    image.style.opacity = "1";
    image.title = instance.displayName;
    // Keep the displayed image until its replacement is ready.
    if (!document.body.classList.contains("live-mode")) bindSceneImageDrag(image, instance, scene, stage);
    loadSceneManifest(entry).then((characterManifest) => {
      if (renderToken !== sceneRenderToken) return;
      const state = characterManifest.states.find((item) => item.id === stateId) || characterManifest.states.find((item) => item.id === characterManifest.defaultState);
      if (!state) return;
      const prior = previous.get(instance.instanceId);
      const settings = { ...DEFAULT_TRANSITION, ...characterManifest.transition, ...instance.transition };
      const url = new URL(state.image, new URL("./", stateUrl));
      if (state.assetVersion) url.searchParams.set("v", state.assetVersion);
      if (prior?.node.isConnected && prior.src === url.href && prior.state === stateId) {
        // Dialogue/setting updates must not replace a node mid-animation.
        prior.node.className = image.className;
        prior.node.style.cssText = image.style.cssText;
        prior.node.alt = image.alt;
        prior.node.title = image.title;
        syncSpeakingAnimation(prior.node, instance.instanceId);
        syncVisualEffect(prior.node, instance.instanceId, scene.id);
        return;
      }
      image.src = url.href;
      const show = () => {
        if (renderToken !== sceneRenderToken) return;
        if (prior?.node.isConnected) {
          speakingAnimations.get(prior.node)?.animation.cancel();
          prior.node.replaceWith(image);
        }
        else stage.append(image);
        if (prior?.state && prior.state !== stateId) animateSceneImage(image, settings, prior.src);
        syncSpeakingAnimation(image, instance.instanceId);
        syncVisualEffect(image, instance.instanceId, scene.id);
      };
      // Decode off-screen: failed or stale requests must not blank the current pose.
      return image.decode().then(show).catch(() => {
        if (renderToken === sceneRenderToken) elements.status.textContent = `实例 ${instance.displayName} 的图片无法加载：${state.image}`;
      });
    }).catch((error) => { if (renderToken === sceneRenderToken) elements.status.textContent = error.message; });
  }
}

function syncVisualEffect(image, instanceId, sceneId) {
  const effect = visualEffects.get(instanceId);
  if (!effect || effect.sceneId !== sceneId) return;
  const elapsed = Date.now() - effect.startedAt;
  if (elapsed >= effect.durationMs || !["left", "right", "up", "zoom"].includes(effect.type)) return;
  const prior = visualAnimations.get(image);
  if (prior?.id === effect.id) return;
  prior?.animation.cancel();
  const base = image.style.transform;
  const point = effect.anchor || { x: 50, y: 50 };
  const x = Math.max(0, Math.min(100, Number(point.x) || 0));
  const y = Math.max(0, Math.min(100, Number(point.y) || 0));
  const delta = { left: "translateX(-20%)", right: "translateX(20%)", up: "translateY(-15%)", zoom: `translate(${(50 - x) * .5}%, ${(50 - y) * .5}%) scale(1.5)` }[effect.type];
  const animation = image.animate([{ transform: base }, { transform: `${base} ${delta}`, offset: .5 }, { transform: base }], { duration: effect.durationMs, easing: "ease-in-out" });
  animation.currentTime = Math.max(0, elapsed);
  if (elapsed < 0) { animation.pause(); setTimeout(() => { if (visualAnimations.get(image)?.id === effect.id) animation.play(); }, -elapsed); }
  visualAnimations.set(image, { id: effect.id, animation });
}

function animateSceneImage(image, settings, previousSrc = "") {
  const duration = Math.max(0, Math.min(5000, Number(settings.durationMs) || 0));
  if (settings.type === "none" || !duration) return;
  const transform = image.style.transform;
  const distance = Math.max(0, Math.min(200, Number(settings.distancePx) || 0));
  let frames = [{ opacity: 0 }, { opacity: 1 }];
  if (settings.type === "bounce") frames = [{ opacity: 0, transform: `${transform} translateY(${distance}px)` }, { opacity: 1, transform: `${transform} translateY(${-distance * .35}px)`, offset: .55 }, { opacity: 1, transform }];
  if (settings.type === "pop") frames = [{ opacity: 0, transform: `${transform} scale(.86)` }, { opacity: 1, transform }];
  if (previousSrc && settings.type === "crossfade") {
    const old = image.cloneNode();
    old.removeAttribute("data-instance-id");
    old.classList.remove("is-selected");
    old.style.pointerEvents = "none";
    old.src = previousSrc;
    image.before(old);
    old.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: "ease" }).finished.then(() => old.remove(), () => old.remove());
  }
  image.animate(frames, { duration, easing: "ease" });
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
  bindBroadcastFields();
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
    if (source.broadcast) copy.broadcast = structuredClone(source.broadcast);
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

function bindBroadcastFields() {
  for (const key of ["current", "next", "speaker", "answer"]) {
    document.querySelector(`#broadcast-${key}`).addEventListener("input", (event) => {
      const scene = sceneStore.active;
      scene.broadcast = { ...scene.broadcast, [key]: event.target.value };
      sceneStore.update(scene);
      renderBroadcast(scene);
    });
  }
  for (const box of ["question", "reply"]) {
    for (const field of ["x", "y", "width"]) {
      document.querySelector(`#broadcast-${box}-${field}`).addEventListener("change", (event) => {
        const input = event.target;
        const value = Math.max(field === "width" ? 10 : 0, Math.min(100, Number(input.value) || 0));
        const scene = sceneStore.active;
        const broadcast = scene.broadcast || {};
        const layout = broadcast.layout || {};
        scene.broadcast = { ...broadcast, layout: { ...layout, [box]: { ...layout[box], [field]: value } } };
        sceneStore.update(scene);
        renderBroadcast(scene);
      });
    }
  }
  window.addEventListener("storage", (event) => {
    if (document.body.classList.contains("live-mode")) return;
    if (event.key !== "static-character-runtime.scenes.v1" && event.key !== "static-character-runtime.active-scene.v1") return;
    sceneStore = new SceneStore({ characterIds: new Set(characterRegistry.characters.map((item) => item.id)) });
    renderSceneEditor();
  });
}

function renderBroadcast(scene) {
  publishLiveScene(scene);
  const data = scene.broadcast || {};
  for (const key of ["current", "next", "speaker", "answer"]) {
    const input = document.querySelector(`#broadcast-${key}`);
    if (document.activeElement !== input) input.value = data[key] || "";
  }
  const question = document.querySelector("#broadcast-question");
  const reply = document.querySelector("#broadcast-reply");
  for (const [box, element, defaults] of [["question", question, { x: 10, y: 3, width: 80 }], ["reply", reply, { x: 10, y: 78, width: 80 }]]) {
    const layout = { ...defaults, ...data.layout?.[box] };
    for (const field of ["x", "y", "width"]) document.querySelector(`#broadcast-${box}-${field}`).value = layout[field];
    element.style.left = `${layout.x}%`;
    element.style.top = `${layout.y}%`;
    element.style.width = `${layout.width}%`;
    element.style.bottom = "auto";
  }
  question.textContent = [data.current && `正在回答：${data.current}`, data.next && `下一个问题：${data.next}`].filter(Boolean).join("\n");
  reply.textContent = [data.speaker && `${data.speaker}：`, data.answer].filter(Boolean).join("\n");
  question.hidden = !question.textContent;
  reply.hidden = !reply.textContent;
}

function publishLiveScene(scene) {
  if (!scene || document.body.classList.contains("live-mode")) return;
  const single = stateManager && manifest ? { characterId: manifest.id, stateId: stateManager.getSnapshot().effectiveState, transition: { ...transitionSettings } } : null;
  const snapshot = buildLiveSnapshot(scene, sceneOverrides, single);
  snapshot.replyMotions = [...replyMotions].filter(([, item]) => item.sceneId === scene.id);
  snapshot.visualEffects = [...visualEffects].filter(([, item]) => item.sceneId === scene.id && Date.now() < item.startedAt + item.durationMs);
  const body = JSON.stringify(snapshot);
  if (!liveSending && !livePending && body === lastPublished) return;
  livePending = body;
  if (!liveSending) liveSendPromise = sendLiveScene();
}

function updateChatBroadcast(sceneId, updates) {
  const scene = sceneStore.scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  mergeChatBroadcast(scene, updates);
  sceneStore.update(scene);
  if (sceneStore.active.id === sceneId) renderBroadcast(scene);
}

async function renderLiveSingle(scene) {
  const token = ++liveSingleToken;
  if (!scene.singleCharacter || scene.characters.some((item) => item.enabled)) return;
  const entry = characterEntry(scene.singleCharacter.characterId);
  if (!entry) return;
  try {
    const character = await loadSceneManifest(entry);
    if (token !== liveSingleToken) return;
    const changedCharacter = manifest.id !== character.id;
    manifest = character;
    manifestUrl = resolveRegisteredCharacterManifestUrl(entry, location.href);
    states = new Map(character.states.map((state) => [state.id, state]));
    stateManager.defaultState = character.defaultState;
    applyTransitionSettings(scene.singleCharacter.transition || character.transition);
    if (changedCharacter) activeStateId = null;
    const next = states.has(scene.singleCharacter.stateId) ? scene.singleCharacter.stateId : character.defaultState;
    if (next) stateManager.setBaseState(next, "live_sync");
  } catch (error) { elements.status.textContent = error.message; }
}

async function sendLiveScene() {
  liveSending = true;
  while (livePending) {
    const body = livePending;
    livePending = null;
    try {
      const response = await fetch("./api/live-state", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastPublished = body;
    } catch {
      elements.status.textContent = "直播画面同步失败，请确认本地服务正在运行。";
      break;
    }
  }
  liveSending = false;
}

async function pollLiveScene() {
  try {
    const response = await fetch("./api/live-state", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.scene && (data.revision !== liveRevision || JSON.stringify(data.scene) !== lastObservedScene)) {
      liveRevision = data.revision;
      lastObservedScene = JSON.stringify(data.scene);
      lastLiveScene = data.scene;
      replyMotions.clear();
      for (const [id, item] of data.scene.replyMotions || []) replyMotions.set(id, item);
      visualEffects.clear();
      for (const [id, item] of data.scene.visualEffects || []) visualEffects.set(id, item);
      renderBroadcast(data.scene);
      renderSceneStage(data.scene);
      renderLiveSingle(data.scene);
    }
  } catch { /* The next poll retries when the server returns. */ }
  setTimeout(pollLiveScene, 500);
}

async function syncAssetCatalog() {
  if (!characterRegistry || pendingAssets.length) return;
  let sceneChanged = false;
  for (const entry of characterRegistry.characters || []) {
    try {
      const url = resolveRegisteredCharacterManifestUrl(entry, location.href);
      const [manifestResponse, catalogResponse] = await Promise.all([
        fetch(url, { cache: "no-store" }),
        fetch(`./api/assets/catalog/${encodeURIComponent(entry.id)}`, { cache: "no-store" }),
      ]);
      if (!manifestResponse.ok || !catalogResponse.ok) continue;
      const raw = await manifestResponse.json();
      const catalog = await catalogResponse.json();
      const signature = JSON.stringify([raw, catalog.files]);
      const previous = assetScanState.get(entry.id) || {};
      if (previous.seen !== signature) { assetScanState.set(entry.id, { ...previous, seen: signature }); continue; }
      if (previous.applied === signature) continue;
      let result = reconcileAssets(raw, catalog.files);
      if (result.added.length && !document.body.classList.contains("live-mode")) {
        const response = await fetch("./api/assets/register-discovered", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: entry.id, states: result.added }),
        });
        if (!response.ok) throw new Error((await response.json()).error || "登记新增动作失败。");
        // The server merged the additions into the latest manifest; rescan before applying.
        assetScanState.set(entry.id, {});
        continue;
      }
      assetScanState.set(entry.id, { seen: signature, applied: signature });
      sceneManifestCache.set(url.href, Promise.resolve(result.manifest));
      sceneChanged = true;
      if (entry.id === manifest.id) {
        manifest = result.manifest;
        states = new Map(manifest.states.map((state) => [state.id, state]));
        eventDispatcher.eventMap = manifest.events || {};
        stateManager.defaultState = manifest.defaultState;
        if (!states.has(stateManager.baseState) && manifest.defaultState) stateManager.baseState = manifest.defaultState;
        for (const override of stateManager.getSnapshot().overrides) {
          if (!states.has(override.stateId)) stateManager.clearOverride(override.id, "asset_removed");
        }
        if (!states.has(stateManager.baseState) && manifest.defaultState) stateManager.setBaseState(manifest.defaultState, "asset_removed");
        activeStateId = null;
        if (manifest.defaultState) renderSnapshot(stateManager.getSnapshot("asset_sync"));
        else {
          elements.layers.forEach((layer) => layer.classList.remove("is-visible"));
          elements.label.textContent = "没有可用图片";
        }
        renderEventControls(); renderActionEditor(); renderShortcuts();
      }
      if (result.missing.length) elements.status.textContent = `${entry.name} 有 ${result.missing.length} 个动作的图片缺失，已暂时隐藏。`;
    } catch (error) { elements.status.textContent = `素材同步失败：${error.message}`; }
  }
  if (sceneChanged) {
    if (document.body.classList.contains("live-mode")) {
      if (lastLiveScene) renderSceneStage(lastLiveScene);
    } else {
      renderSceneEditor();
      if (selectedInstanceId) selectSceneInstance(selectedInstanceId);
      else renderControls();
    }
  }
}

async function pollAssetCatalog() {
  try { await syncAssetCatalog(); } finally { setTimeout(pollAssetCatalog, 2500); }
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
  if (!pendingAssets.length) pendingDesignFiles = [];
  const row = document.querySelector("#asset-design-row");
  const select = document.querySelector("#asset-design-select");
  row.hidden = pendingDesignFiles.length === 0;
  const hadOptions = select.options.length > 0;
  const previous = select.value;
  select.replaceChildren();
  const none = document.createElement("option"); none.value = ""; none.textContent = "不导入设定"; select.append(none);
  pendingDesignFiles.forEach((file, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = file.archivePath; select.append(option); });
  select.value = hadOptions && (previous === "" || Number(previous) < pendingDesignFiles.length) ? previous : (pendingDesignFiles.length ? "0" : "");
}

async function filesFromInput(files) {
  const result = [];
  const designs = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      if (!globalThis.JSZip) throw new Error("ZIP 解压组件未加载；请检查网络或直接拖入图片。 ");
      const zip = await globalThis.JSZip.loadAsync(file, { checkCRC32: true });
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
        const originalPath = entry.unsafeOriginalName || path;
        const design = classifyCharacterDesignPath(originalPath);
        if (!design && !new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]).has(extension)) continue;
        const blob = await entry.async("blob");
        const safeName = path.split(/[\\/]/).at(-1);
        const imageFile = new File([blob], safeName, { type: blob.type });
        imageFile.archivePath = originalPath;
        if (design) designs.push(imageFile); else result.push(imageFile);
      }
    } else if (file.webkitRelativePath && classifyCharacterDesignPath(file.webkitRelativePath)) {
      file.archivePath = file.webkitRelativePath;
      designs.push(file);
    } else if (/\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) {
      if (file.webkitRelativePath) file.archivePath = file.webkitRelativePath;
      result.push(file);
    }
  }
  if (result.length === 0) throw new Error("没有找到支持的图片；请选取 PNG、JPG、WebP、GIF 或 AVIF 图片。 ");
  return { images: result, designs };
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
    const { images, designs } = await filesFromInput(files);
    await validateImportImages(images);
    const defaultSection = elements.assetSection.value || "Basic";
    const selectedCharacterId = forcedCharacterId || elements.assetCharacter.value;
    const newCharacter = forcedCharacterId ? null : inferNewCharacterPackage(images, characterRegistry.characters);
    const imageRoots = new Set(images.map((file) => (file.archivePath || "").replace(/\\/g, "/").split("/")).filter((parts) => parts.length >= 3).map((parts) => parts[0].toLowerCase()));
    for (const file of designs) {
      const info = classifyCharacterDesignPath(file.archivePath);
      if (info.root && !imageRoots.has(info.root.toLowerCase())) throw new Error(`角色设定“${file.archivePath}”与图片角色目录不一致。`);
      if (file.size > 65536) throw new Error(`角色设定“${file.archivePath}”超过 64 KB。`);
    }
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
    pendingDesignFiles.push(...designs);
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
      const selectedDesign = document.querySelector("#asset-design-select").value;
      const designFile = selectedDesign === "" ? null : pendingDesignFiles[Number(selectedDesign)];
      let designContent = null;
      if (designFile) {
        designContent = new TextDecoder("utf-8", { fatal: true }).decode(await designFile.arrayBuffer()).replace(/^\uFEFF/, "");
        if (designContent.length > 12000) throw new Error("角色设定不能超过 12000 个字符。");
        if (!newCharacterId) {
          const check = await fetch(`./api/characters/design/${encodeURIComponent(pendingAssets[0].characterId)}`, { cache: "no-store" });
          const existing = await check.json();
          if (!check.ok) throw new Error(existing.error || "无法检查角色设定。");
          if (existing.exists) throw new Error("目标角色已有设定。请选择“不导入设定”，或在角色卡中编辑现有设定。");
        }
      }
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
      if (designFile) {
        const characterId = newCharacterId || pendingAssets[0].characterId;
        const response = await fetch(`./api/characters/design/${encodeURIComponent(characterId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: designContent, version: "" }) });
        const saved = await response.json();
        if (!response.ok) throw new Error(saved.error || "角色设定保存失败。");
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

function syncSpeakingAnimation(image, id) {
  const entry = replyMotions.get(id);
  const sceneId = document.body.classList.contains("live-mode") ? lastLiveScene?.id : sceneStore?.active.id;
  const frame = entry?.sceneId === sceneId ? replyFrame(entry.motion) : null;
  const prior = speakingAnimations.get(image);
  if (!frame?.bounce || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    prior?.animation.cancel();
    speakingAnimations.delete(image);
    return;
  }
  if (prior?.startedAt === entry.motion.startedAt) {
    if (Math.abs(prior.animation.currentTime - frame.elapsed) > 120) prior.animation.currentTime = frame.elapsed;
    return;
  }
  prior?.animation.cancel();
  // Individual scale composes with the existing transition/position transform.
  const animation = image.animate([{ scale: "1 1" }, { scale: "1.018 .982" }, { scale: "1 1" }], {
    duration: 480, iterations: Infinity, easing: "ease-in-out",
  });
  animation.currentTime = frame.elapsed;
  speakingAnimations.set(image, { animation, startedAt: entry.motion.startedAt });
}

function startReplyMotion(sceneId, target, role, result) {
  const motion = createReplyMotion(result, role.states.map((state) => state.id), {
    bounce: document.querySelector("#reply-bounce").checked,
    sequence: document.querySelector("#reply-sequence").checked,
    maxActions: document.querySelector("#reply-action-limit").value,
    charactersPerSecond: document.querySelector("#reply-speed").value,
  });
  if (!motion || sceneStore.active.id !== sceneId) return;
  const id = target?.instanceId || `single:${role.id}`;
  motion.id = crypto.randomUUID();
  const speak = document.querySelector("#tts-enabled")?.checked && sceneStore.active.characters.filter((item) => item.enabled).length <= 1;
  if (speak) motion.pendingAudio = true;
  replyMotions.set(id, { sceneId, motion });
  renderSceneStage(sceneStore.active);
  if (!target) renderSnapshot(stateManager.getSnapshot("reply_motion"));
  window.dispatchEvent(new CustomEvent("scr:reply-ready", { detail: { id: motion.id, sceneId, instanceId: id, text: result.reply, estimatedDurationMs: motion.durationMs, speak } }));
  return motion.id;
}

function setReplyAudioState(id, state) {
  const entry = [...replyMotions.values()].find((item) => item.motion.id === id);
  if (!entry) return;
  entry.motion.pendingAudio = false;
  if (state === "fallback") {
    delete entry.motion.playback;
    entry.motion.startedAt = Date.now();
  } else if (state === "stop") {
    entry.motion.playback = { positionMs: 0, durationMs: 1000, paused: true, ended: true, updatedAt: Date.now() };
  }
  renderSceneStage(sceneStore.active);
}

function reportReplyPlayback(report) {
  if (document.body.classList.contains("live-mode") || !report || typeof report.id !== "string") return false;
  const entry = [...replyMotions.values()].find((item) => item.sceneId === sceneStore.active.id && item.motion.id === report.id);
  if (!entry || !updateReplyPlayback(entry.motion, report)) return false;
  publishLiveScene(sceneStore.active);
  return true;
}

async function waitForReplyPlayback(id, context, sceneId) {
  if (!id) return;
  while (context.isCurrent() && sceneStore.active.id === sceneId) {
    const entry = [...replyMotions.values()].find((item) => item.motion.id === id);
    if (!entry || !replyFrame(entry.motion)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function stopReplyMotions() {
  const ids = [...replyMotions.values()].map((entry) => entry.motion.id);
  replyMotions.clear();
  window.dispatchEvent(new CustomEvent("scr:reply-stop", { detail: { ids } }));
  if (sceneStore) {
    renderSceneStage(sceneStore.active);
    renderSnapshot(stateManager.getSnapshot("reply_motion_stop"));
  }
}

function bindTts() {
  if (document.body.classList.contains("live-mode")) return;
  const enabled = document.querySelector("#tts-enabled");
  const voice = document.querySelector("#tts-voice");
  const status = document.querySelector("#tts-status");
  try {
    enabled.checked = localStorage.getItem("scr.tts.enabled") === "true";
    const saved = localStorage.getItem("scr.tts.voice");
    if (saved) voice.value = saved;
  } catch { /* use defaults */ }
  enabled.addEventListener("change", () => {
    try { localStorage.setItem("scr.tts.enabled", String(enabled.checked)); } catch { /* session only */ }
    if (!enabled.checked) player.stop();
  });
  voice.addEventListener("change", () => {
    try { localStorage.setItem("scr.tts.voice", voice.value); } catch { /* session only */ }
  });
  fetch("./api/tts/voices").then((response) => response.ok ? response.json() : Promise.reject()).then((data) => {
    const names = [...new Set(data.voices || [])].filter((name) => typeof name === "string");
    voice.replaceChildren(...names.map((name) => new Option(name, name)));
    const saved = localStorage.getItem("scr.tts.voice");
    if (names.includes(saved)) voice.value = saved;
    status.textContent = names.length ? "Breeze 已连接。" : "Breeze 没有可用语音。";
  }).catch(() => { status.textContent = "Breeze 未启动。请运行其 start-server.bat，端口 8080。"; });

  const player = {
    active: null,
    stop() {
      const current = this.active;
      if (!current) return;
      this.active = null;
      current.controller.abort();
      clearInterval(current.timer);
      if (current.audio) { current.audio.pause(); current.audio.removeAttribute("src"); }
      if (current.url) URL.revokeObjectURL(current.url);
      setReplyAudioState(current.id, "stop");
    },
    async speak(detail) {
      this.stop();
      if (!detail.speak || !enabled.checked) return;
      const current = { id: detail.id, controller: new AbortController(), audio: null, url: null, timer: null };
      this.active = current;
      status.textContent = "正在合成语音，角色保持基础动作……";
      try {
        const response = await fetch("./api/tts/speech", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: detail.text, voice: voice.value }), signal: current.controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        const blob = await response.blob();
        if (this.active !== current) return;
        current.url = URL.createObjectURL(blob);
        const audio = new Audio(current.url);
        current.audio = audio;
        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve;
          audio.onerror = () => reject(new Error("浏览器无法解码 Breeze 音频。"));
          audio.load();
        });
        if (this.active !== current) return;
        const durationMs = Math.round(audio.duration * 1000);
        if (!Number.isFinite(durationMs) || durationMs < 250 || durationMs > 120000) throw new Error("语音时长无效或超过 120 秒。");
        const progress = (ended = false) => reportReplyPlayback({ id: current.id, positionMs: Math.min(durationMs, Math.round(audio.currentTime * 1000)), durationMs, paused: audio.paused, ended });
        audio.onplaying = () => { setReplyAudioState(current.id, "play"); progress(); status.textContent = "正在播放 Breeze 语音。"; };
        audio.ontimeupdate = () => progress();
        audio.onended = () => { progress(true); status.textContent = "语音播放完成。"; this.stop(); };
        current.timer = setInterval(() => { if (!progress()) this.stop(); }, 250);
        await audio.play();
      } catch (error) {
        if (this.active !== current) return;
        this.active = null;
        clearInterval(current.timer);
        if (current.audio) current.audio.pause();
        if (current.url) URL.revokeObjectURL(current.url);
        setReplyAudioState(current.id, "fallback");
        status.textContent = `语音失败，已改用文字动效：${error.message}`;
      }
    },
  };
  window.addEventListener("scr:reply-ready", (event) => { if (event.detail.speak) player.speak(event.detail); else player.stop(); });
  window.addEventListener("scr:reply-stop", () => player.stop());
}

function bindReplyPlayback() {
  const fields = ["reply-bounce", "reply-sequence", "rehearsal-interval", "rehearsal-rounds", "reply-action-limit", "reply-speed"];
  const normalize = (id, value) => id === "rehearsal-interval" ? playbackInterval(value) / 1000
    : id === "reply-speed" ? Math.max(2, Math.min(12, Number(value) || 6)) : boundedCount(value);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("scr.reply-playback.v1") || "{}"); } catch { /* use defaults */ }
  for (const id of fields) {
    const input = document.getElementById(id);
    if (input.type === "checkbox" && typeof saved[id] === "boolean") input.checked = saved[id];
    if (input.type === "number" && saved[id] !== undefined) input.value = normalize(id, saved[id]);
    input.addEventListener("change", () => {
      const settings = Object.fromEntries(fields.map((key) => {
        const element = document.getElementById(key);
        if (element.type === "number") element.value = normalize(key, element.value);
        return [key, element.type === "checkbox" ? element.checked : Number(element.value)];
      }));
      try { localStorage.setItem("scr.reply-playback.v1", JSON.stringify(settings)); } catch { /* session still usable */ }
      if (liveDirector) liveDirector.intervalMs = playbackInterval(settings["rehearsal-interval"]);
      if (id === "reply-bounce" && !input.checked) {
        for (const entry of replyMotions.values()) entry.motion.bounce = false;
        renderSceneStage(sceneStore.active);
      }
    });
  }
  document.querySelector("#reply-stop").addEventListener("click", stopReplyMotions);
  setInterval(() => {
    const scene = document.body.classList.contains("live-mode") ? lastLiveScene : sceneStore?.active;
    if (!scene) return;
    if (!document.body.classList.contains("live-mode")) {
      for (const [id, entry] of replyMotions) {
        if (entry.sceneId !== scene.id || !replyFrame(entry.motion)) replyMotions.delete(id);
      }
    }
    document.querySelectorAll(".scene-instance[data-instance-id]").forEach((image) => syncSpeakingAnimation(image, image.dataset.instanceId));
    if (manifest) elements.layers.forEach((image) => {
      if (image.classList.contains("is-visible")) syncSpeakingAnimation(image, `single:${manifest.id}`);
      else { speakingAnimations.get(image)?.animation.cancel(); speakingAnimations.delete(image); }
    });
    const signature = JSON.stringify([scene.id, [...replyMotions].map(([id, entry]) => {
      const frame = entry.sceneId === scene.id ? replyFrame(entry.motion) : null;
      return [id, frame?.state, frame?.bounce];
    })]);
    if (signature === motionSignature) return;
    motionSignature = signature;
    renderSceneStage(scene);
    if (!scene.characters.some((item) => item.enabled)) renderSnapshot(stateManager.getSnapshot("reply_motion_tick"));
  }, 100);
}

async function requestCharacterReply(payload, signal) {
  const output = document.querySelector("#request-timing");
  const started = performance.now();
  output.textContent = "模型请求中……";
  try {
    const response = await fetch("./api/chat", {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, includeActions: document.querySelector("#reply-sequence").checked, actionLimit: boundedCount(document.querySelector("#reply-action-limit").value, 3) }),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = result.retryAfterMs || 0;
      throw error;
    }
    return result;
  } finally {
    output.textContent = `最近请求耗时：${((performance.now() - started) / 1000).toFixed(2)} 秒（含网络、服务处理和完整回复；不含接话间隔）`;
  }
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
    let cooldownMs = 0;
    const sceneId = sceneStore.active.id;
    let chatStarted = false;
    let target = null;
    try {
      target = sceneStore.active.characters.find((item) => item.instanceId === selectedInstanceId && item.enabled);
      if (sceneStore.active.characters.some((item) => item.enabled) && !target) {
        throw new Error("请先在画布中选择要对话的角色。");
      }
      const targetManifest = target ? await loadSceneManifest(characterEntry(target.characterId)) : manifest;
      if (sceneStore.active.id !== sceneId) throw new Error("场景已切换，请重新发送。");
      chatStarted = true;
      stopReplyMotions();
      updateChatBroadcast(sceneId, { current: message, speaker: target?.displayName || manifest.name, answer: "" });
      if (target) {
        clearSceneOverride(target.instanceId);
        renderSceneStage(sceneStore.active);
      } else {
        replyMotions.delete(`single:${manifest.id}`);
        stateManager.clearOverrides("chat_waiting");
      }
      // Publish the question and base pose before the server starts the AI request.
      if (liveSendPromise) await liveSendPromise;
      const result = await requestCharacterReply({
          message,
          characterId: target?.characterId || (characterEntry(manifest.id) ? manifest.id : ""),
          provider: target?.model?.provider || activeAiConfig.provider,
          model: target?.model?.modelId || activeAiConfig.model,
          states: targetManifest.states.map((state) => ({
            id: state.id,
            description: state.description || state.label,
          })),
      });

      elements.chatReply.textContent = result.allowed
        ? result.reply
        : "抱歉，这个请求我不能协助。我们可以换一个安全、合适的话题。";
      if (target) {
        const activeTarget = sceneStore.active.id === sceneId ? sceneStore.active.characters.find((item) => item.instanceId === target.instanceId) : null;
        if (activeTarget?.enabled) startReplyMotion(sceneId, activeTarget, targetManifest, result);
      } else {
        startReplyMotion(sceneId, null, targetManifest, result);
      }
      updateChatBroadcast(sceneId, { answer: elements.chatReply.textContent });
      elements.chatInput.value = "";
    } catch (error) {
      if (error.status === 429) {
        cooldownMs = Math.max(1000, error.retryAfterMs || 10000);
        elements.chatReply.textContent = `请求过于频繁，请约 ${Math.ceil(cooldownMs / 1000)} 秒后重试。`;
      } else {
        elements.chatReply.textContent = error.message;
      }
      if (chatStarted) updateChatBroadcast(sceneId, { answer: "暂时无法回复，请稍后再试。" });
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

function bindRehearsal() {
  const status = document.querySelector("#rehearsal-status");
  const mode = document.querySelector("#rehearsal-mode");
  const input = document.querySelector("#rehearsal-comment");
  const dialogue = new DialogueContext();
  const router = new SpeakerRouter();
  const currentCast = () => sceneStore.active.characters.filter((item) => item.enabled).map((item) => ({
    ...item, characterName: characterEntry(item.characterId)?.name || item.displayName,
  }));
  liveDirector = new LiveDirector({
    intervalMs: playbackInterval(document.querySelector("#rehearsal-interval").value),
    onStatus: (message) => { status.textContent = message; },
    reply: async (event, context) => {
      while (elements.chatSend.disabled && context.isCurrent()) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!context.isCurrent()) return;
      if (event.metadata?.sceneId !== sceneStore.active.id) { status.textContent = "已跳过其他场景的待处理消息。"; return; }
      elements.chatSend.disabled = true;
      let displayed = Promise.resolve();
      try {
        const scene = sceneStore.active;
        const sceneId = scene.id;
        const cast = currentCast();
        if (!cast.length) throw new Error("请先向当前场景添加角色。");
        const useAi = mode.value === "ai";
        const automatic = document.querySelector("#rehearsal-routing").value === "auto";
        const requestedMode = event.metadata?.discussion ? "discussion" : event.metadata?.messageMode || "auto";
        let messageMode = requestedMode;
        let source = "手动指定";
        if (requestedMode === "auto") {
          messageMode = inferMessageMode(event.text);
          source = "本地规则";
          if (useAi) {
            try {
              if (!activeAiConfig) throw new Error("模型尚未就绪");
              const decision = await requestCharacterReply({ purpose: "live_route", message: event.text, provider: activeAiConfig.provider, model: activeAiConfig.model }, context.signal);
              if (!decision.allowed || !["solo", "discussion"].includes(decision.intent?.state)) throw new Error("分流结果无效");
              messageMode = decision.intent.state;
              source = "AI 判断";
            } catch (error) {
              if (!context.isCurrent()) return;
              source = `AI 分流失败，已回退本地规则（${error.message}）`;
            }
          }
        }
        if (!context.isCurrent() || sceneStore.active.id !== sceneId) return;
        const discussion = messageMode === "discussion" && cast.length > 1;
        const count = discussion ? Math.min(cast.length, Math.max(2, boundedCount(event.metadata?.participants || document.querySelector("#rehearsal-turns").value)), 3) : 1;
        const decisionLabel = document.querySelector("#rehearsal-decision");
        decisionLabel.textContent = `${discussion ? "共同讨论" : "个人回复"} · ${source}`;
        const plan = discussionPlan({ discussion, rounds: event.metadata?.rounds, participants: count });
        const spoken = new Set();
        let previousReply = "";
        let previousSpeakerId = null;
        for (const { round, turn, rounds, closing } of plan) {
        if (turn === 0) spoken.clear();
        if (!context.isCurrent() || sceneStore.active.id !== sceneId) return;
        const liveCast = currentCast();
        const excluded = new Set(spoken);
        if (turn === 0 && round > 0 && liveCast.length > 1) excluded.add(previousSpeakerId);
        const choice = router.choose(sceneId, liveCast, { question: round === 0 ? event.text : "", previousReply, spoken: excluded, automatic, opening: round === 0 && turn === 0 });
        if (!choice) continue;
        const { target, reason } = choice;
        if (round === 0 && turn === 0) decisionLabel.textContent += ` · 首位：${target.displayName}（${reason}）`;
        spoken.add(target.instanceId);
        status.textContent = `${target.displayName} 准备发言（第 ${round + 1}/${rounds} 轮，${turn + 1}/${count} 位，${reason}）。`;
        const role = await loadSceneManifest(characterEntry(target.characterId));
        if (!context.isCurrent() || sceneStore.active.id !== sceneId) return;
        if (!previousSpeakerId) {
          clearSceneOverride(target.instanceId);
          updateChatBroadcast(sceneId, { current: event.text, speaker: target.displayName, answer: "" });
          renderSceneStage(sceneStore.active);
          if (liveSendPromise) await liveSendPromise;
        }
        if (!context.isCurrent()) return;
        let result;
        if (useAi) {
          if (!activeAiConfig) throw new Error("模型配置未就绪。");
          result = await requestCharacterReply({ message: dialogue.prompt(sceneId, target.displayName, event.text, { cast: liveCast, target, discussion, turn, round, rounds, closing }), characterId: target.characterId, provider: target.model?.provider || activeAiConfig.provider, model: target.model?.modelId || activeAiConfig.model, states: role.states.map((state) => ({ id: state.id, description: state.description || state.label })) }, context.signal);
        } else {
          const state = role.states.find((item) => item.id === "happy") || role.states.find((item) => item.id === role.defaultState);
          const peer = liveCast.find((item) => !spoken.has(item.instanceId));
          const previousName = dialogue.turns.at(-1)?.speaker;
          const text = round === 0 && turn === 0 ? `我是${target.displayName}，收到${discussion ? "讨论主题" : "这条评论"}了。` : `第${round + 1}轮，我接着${previousName || "上一位角色"}的话补充一句。`;
          result = { allowed: true, reply: text + (closing ? "本次模拟讨论到这里。" : peer ? `${peer.displayName}，你怎么看？` : "接下来继续聊。"), intent: { state: state?.id, durationMs: 2500 } };
          result.actions = [state, role.states.find((item) => item.id === "talking"), state].filter(Boolean).map((item) => ({ state: item.id, durationMs: 1500 }));
          document.querySelector("#request-timing").textContent = "当前为模拟回复，没有调用模型。";
        }
        if (!context.isCurrent() || sceneStore.active.id !== sceneId) return;
        await displayed;
        if (!context.isCurrent() || sceneStore.active.id !== sceneId) return;
        const activeTarget = sceneStore.active.characters.find((item) => item.instanceId === target.instanceId && item.enabled);
        if (!activeTarget) return;
        const answer = result.allowed && typeof result.reply === "string" ? result.reply : "抱歉，这个请求我不能协助。";
        const replyId = startReplyMotion(sceneId, activeTarget, role, result);
        updateChatBroadcast(sceneId, { speaker: target.displayName, answer });
        dialogue.add(sceneId, target.displayName, answer, target.instanceId);
        router.record(target.instanceId, { opening: round === 0 && turn === 0 });
        previousReply = answer;
        previousSpeakerId = target.instanceId;
        status.textContent = `${target.displayName} 展示回复中（第 ${round + 1}/${rounds} 轮，${turn + 1}/${count} 位，${reason}）。`;
        displayed = (async () => {
          await waitForReplyPlayback(replyId, context, sceneId);
          if (!context.isCurrent() || sceneStore.active.id !== sceneId || closing || !result.allowed) return;
          await new Promise((resolve) => {
            const done = () => { clearTimeout(timer); context.signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, playbackInterval(document.querySelector("#rehearsal-interval").value));
            context.signal.addEventListener("abort", done, { once: true });
            if (context.signal.aborted) done();
          });
        })();
        if (!useAi || !result.allowed || closing) await displayed;
        if (!result.allowed) break;
        }
        await displayed;
        if (context.isCurrent()) status.textContent = discussion ? "主题讨论已结束，等待下一条消息。" : "本条评论已回复，等待下一条消息。";
      } finally {
        try { await displayed; } finally { elements.chatSend.disabled = false; }
      }
    },
  });
  document.querySelector("#rehearsal-start").addEventListener("click", () => {
    if (scriptPlayer.running || scriptPreparing) { status.textContent = "请先停止剧本播放。"; return; }
    liveDirector.start();
  });
  const pause = () => { liveDirector.pause(); dialogue.clear(); stopReplyMotions(); };
  document.querySelector("#rehearsal-stop").addEventListener("click", pause);
  elements.scenePicker.addEventListener("change", pause);
  const send = (discussion = false) => {
    if (!liveDirector.running) { status.textContent = "请先开启模拟。"; return; }
    const text = input.value.trim();
    if (!text) { status.textContent = "请输入评论或讨论主题。"; return; }
    if (discussion && (currentCast().length < 2 || Number(document.querySelector("#rehearsal-turns").value) < 2)) {
      status.textContent = "主题讨论需要至少两位启用角色，并将参与人数设为 2 或 3。"; return;
    }
    liveEventInterface.receive({ type: "chat_message", platform: "mock", user: { id: discussion ? "topic-host" : "mock-viewer", name: discussion ? "主持人" : "模拟观众" }, text, metadata: { discussion, messageMode: document.querySelector("#rehearsal-message-mode").value, rounds: boundedCount(document.querySelector("#rehearsal-rounds").value), participants: boundedCount(document.querySelector("#rehearsal-turns").value) } });
    input.value = "";
  };
  document.querySelector("#rehearsal-send").addEventListener("click", () => send());
  document.querySelector("#rehearsal-topic").addEventListener("click", () => send(true));
}

function bindScriptPlayer() {
  const fileInput = document.querySelector("#script-file");
  const preview = document.querySelector("#script-preview");
  const mappings = document.querySelector("#script-mappings");
  const play = document.querySelector("#script-play");
  const status = document.querySelector("#script-status");
  let script = null, cancelled = false, ownsChat = false;
  const cast = () => sceneStore.active.characters.filter((item) => item.enabled).map((item) => ({ ...item, characterName: characterEntry(item.characterId)?.name }));
  const render = () => {
    mappings.replaceChildren(); preview.replaceChildren();
    if (!script) { play.disabled = true; return; }
    const roles = cast();
    for (const name of new Set(script.lines.map((line) => line.speaker))) {
      const label = document.createElement("label"); label.className = "field-label"; label.textContent = `${name} → `;
      const select = document.createElement("select"); select.dataset.speaker = name;
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = "请选择场景角色"; select.append(empty);
      for (const role of roles) { const option = document.createElement("option"); option.value = role.instanceId; option.textContent = role.displayName; select.append(option); }
      select.value = matchScriptSpeaker(name, roles);
      label.append(select); mappings.append(label);
    }
    for (const line of script.lines) {
      const item = document.createElement("li"); item.textContent = `${line.speaker}：${line.text}${line.state ? `（动作：${line.state}）` : ""}`; preview.append(item);
    }
    play.disabled = false;
    status.textContent = `${script.title} · ${script.lines.length} 条。请检查角色映射与台词后确认播放。`;
  };
  fileInput.addEventListener("change", async () => {
    script = null; render();
    const file = fileInput.files[0]; if (!file) return;
    try {
      if (file.size > 400000) throw new Error("文件过大，请拆分剧本。");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      script = parseScript(text, file.name); render();
    } catch (error) { status.textContent = error.message; }
  });
  const stop = () => {
    cancelled = true; scriptPlayer.stop();
    if (ownsChat) stopReplyMotions();
    status.textContent = "已请求停止；下一次播放从第一条开始。";
  };
  document.querySelector("#script-stop").addEventListener("click", stop);
  elements.scenePicker.addEventListener("change", () => { stop(); render(); });
  play.addEventListener("click", async () => {
    if (!script || scriptPlayer.running || scriptPreparing) return;
    const sceneId = sceneStore.active.id;
    const selected = new Map([...mappings.querySelectorAll("select")].map((select) => [select.dataset.speaker, select.value]));
    cancelled = false; scriptPreparing = true; play.disabled = true; fileInput.disabled = true;
    liveDirector?.pause();
    try {
      status.textContent = "等待当前请求结束并校验剧本……";
      while ((liveDirector?.busy || elements.chatSend.disabled) && !cancelled) await new Promise((resolve) => setTimeout(resolve, 100));
      if (cancelled || sceneStore.active.id !== sceneId) return;
      elements.chatSend.disabled = true; ownsChat = true;
      const roles = cast();
      const manifests = new Map();
      const resolved = [];
      for (const line of script.lines) {
        const target = roles.find((role) => role.instanceId === selected.get(line.speaker));
        if (!target) throw new Error(`请为“${line.speaker}”匹配启用的场景角色。`);
        if (!manifests.has(target.characterId)) manifests.set(target.characterId, await loadSceneManifest(characterEntry(target.characterId)));
        if (cancelled || sceneStore.active.id !== sceneId) return;
        const role = manifests.get(target.characterId);
        const state = role.states.find((state) => state.id === (line.state || role.defaultState));
        if (!state) throw new Error(`${target.displayName} 不存在动作“${line.state || role.defaultState}”。`);
        resolved.push({ ...line, target, role, state });
      }
      scriptPreparing = false;
      const completed = await scriptPlayer.play(resolved, async (line, index, context) => {
        if (!context.isCurrent() || sceneStore.active.id !== sceneId) { scriptPlayer.stop(); return; }
        const target = sceneStore.active.characters.find((item) => item.instanceId === line.target.instanceId && item.enabled);
        if (!target) throw new Error("剧本角色已被移除或停用，播放已停止。");
        clearSceneOverride(target.instanceId);
        const result = { allowed: true, reply: line.text, intent: { state: line.state.id, durationMs: 2500 } };
        updateChatBroadcast(sceneId, { current: `剧本：${script.title}`, next: "", speaker: target.displayName, answer: line.text });
        const id = startReplyMotion(sceneId, target, line.role, result);
        status.textContent = `正在播放 ${index + 1}/${resolved.length}：${target.displayName}`;
        await waitForReplyPlayback(id, context, sceneId);
      });
      status.textContent = completed === resolved.length ? "剧本播放完成。" : "剧本已停止；再次播放从第一条开始。";
    } catch (error) { stopReplyMotions(); status.textContent = error.message; }
    finally {
      scriptPreparing = false; fileInput.disabled = false; play.disabled = !script;
      if (ownsChat) { elements.chatSend.disabled = false; ownsChat = false; }
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
        if (sceneStore && !sceneStore.active.characters.some((item) => item.enabled)) publishLiveScene(sceneStore.active);
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
        if (payload.source === "ai") {
          action.mode = "override";
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
      onEvent: (event) => {
        elements.lastEvent.textContent = `${event.platform}:${event.type}`;
        if (event.platform === "mock" && liveDirector) {
          const result = liveDirector.enqueue({ ...event, metadata: { ...event.metadata, sceneId: sceneStore.active.id } });
          if (!result.ok) document.querySelector("#rehearsal-status").textContent = result.error;
        }
      },
      onError: (message) => { elements.status.textContent = message; },
    });
    window.staticCharacterRuntime = Object.freeze({
      dispatch: (event) => eventDispatcher.dispatch(event),
      suggestAction: (intent) => actionIntentController.submit(intent),
      receiveLiveEvent: (event) => liveEventInterface.receive(event),
      reportReplyPlayback,
    });
    elements.clearOverrides.addEventListener("click", () => {
      stopReplyMotions();
      stateManager.clearOverrides("control_panel");
    });
    applyTransitionSettings(manifest.transition);
    bindTransitionEditor();
    renderEventControls();
    bindIntentSimulator();
    await bindCharacterTools();
    bindSceneEditor();
    if (isLiveMode) pollLiveScene();
    bindShortcutEditor();
    await loadModelOptions();
    renderSceneEditor();
    bindReplyPlayback();
    bindTts();
    bindRehearsal();
    bindScriptPlayer();
    bindChat();
    renderControls();
    renderActionEditor();
    await renderSnapshot(stateManager.getSnapshot("initial"));
    pollAssetCatalog();
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
