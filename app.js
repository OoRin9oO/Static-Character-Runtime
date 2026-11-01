import {
  loadCharacterManifest,
  preloadImage,
  resolveStateImageUrl,
} from "./runtime/character-loader.js";

const DEFAULT_MANIFEST = "./characters/github-girl/character.json";

const elements = {
  layers: [...document.querySelectorAll(".character-layer")],
  groups: document.querySelector("#state-groups"),
  name: document.querySelector("#character-name"),
  label: document.querySelector("#current-label"),
  id: document.querySelector("#current-id"),
  description: document.querySelector("#current-description"),
  status: document.querySelector("#status-message"),
  manifestPath: document.querySelector("#manifest-path"),
};

let manifest;
let manifestUrl;
let states;
let activeLayer = 0;
let activeStateId = null;
let transitionToken = 0;

function stateById(id) {
  return states.get(id);
}

function imageUrlFor(state) {
  return resolveStateImageUrl(state, manifestUrl);
}

function setCurrentStateText(state) {
  elements.label.textContent = state.label;
  elements.id.textContent = state.id;
  elements.description.textContent = state.description || "";
  document.querySelectorAll(".state-button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.stateId === state.id));
  });
}

async function switchState(requestedId, allowFallback = true, fallbackMessage = "") {
  const state = stateById(requestedId);
  if (!state) {
    const message = `未知状态“${requestedId}”，已回退到待机。`;
    elements.status.textContent = message;
    if (allowFallback) return switchState(manifest.defaultState, false, message);
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

    requestAnimationFrame(() => {
      next.classList.add("is-visible");
      if (next !== current) current.classList.remove("is-visible");
    });

    activeLayer = nextLayer;
    activeStateId = state.id;
    elements.status.textContent = fallbackMessage;
    setCurrentStateText(state);
  } catch (error) {
    const message = `${error.message} 已尝试回退到待机。`;
    elements.status.textContent = message;
    if (allowFallback && state.id !== manifest.defaultState) {
      await switchState(manifest.defaultState, false, message);
    } else {
      elements.label.textContent = "图片不可用";
      elements.id.textContent = "resource_error";
      elements.description.textContent = error.message;
    }
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
      button.addEventListener("click", () => switchState(state.id));
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
    renderControls();
    await switchState(manifest.defaultState);
  } catch (error) {
    elements.label.textContent = "加载失败";
    elements.id.textContent = "error";
    elements.description.textContent = error.message;
    elements.status.textContent = "请确认本地服务器已启动，并检查 character.json。";
  }
}

start();
