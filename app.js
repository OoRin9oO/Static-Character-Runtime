import {
  loadCharacterManifest,
  preloadImage,
  resolveStateImageUrl,
} from "./runtime/character-loader.js";
import { CharacterStateManager } from "./runtime/state-manager.js";

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
};

let manifest;
let manifestUrl;
let states;
let stateManager;
let nextRenderMessage = "";
let activeLayer = 0;
let activeStateId = null;
let transitionToken = 0;

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
  const behavior = state.behavior || { mode: "base" };
  if (behavior.mode === "override") {
    stateManager.pushOverride(state.id, {
      priority: behavior.priority ?? 60,
      durationMs: behavior.durationMs ?? 2500,
      reason: "control_panel",
    });
  } else {
    stateManager.setBaseState(state.id, "control_panel");
  }
}

function renderControls() {
  const labels = manifest.groups || {};
  const grouped = new Map();
  for (const state of manifest.states) {
    const groupId = state.group || "other";
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

async function start() {
  try {
    const requested = new URLSearchParams(location.search).get("manifest") || DEFAULT_MANIFEST;
    const loaded = await loadCharacterManifest(requested);
    manifest = loaded.manifest;
    manifestUrl = loaded.url;
    states = loaded.states;

    document.documentElement.style.setProperty(
      "--transition-ms",
      `${manifest.transition?.durationMs || 220}ms`,
    );
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
    elements.clearOverrides.addEventListener("click", () => {
      stateManager.clearOverrides("control_panel");
    });
    renderControls();
    await renderSnapshot(stateManager.getSnapshot("initial"));
  } catch (error) {
    elements.label.textContent = "加载失败";
    elements.id.textContent = "error";
    elements.description.textContent = error.message;
    elements.status.textContent = "请确认本地服务器已启动，并检查 character.json。";
  }
}

start();
