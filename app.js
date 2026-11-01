import {
  loadCharacterManifest,
  preloadImage,
  resolveStateImageUrl,
} from "./runtime/character-loader.js";
import { CharacterStateManager } from "./runtime/state-manager.js";
import { CharacterEventDispatcher } from "./runtime/event-dispatcher.js";
import { ActionIntentController } from "./runtime/action-intent-controller.js";

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
    const requested = new URLSearchParams(location.search).get("manifest") || DEFAULT_MANIFEST;
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
        const action = { state: state.id, mode: "base", ...state.behavior };
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
    window.staticCharacterRuntime = Object.freeze({
      dispatch: (event) => eventDispatcher.dispatch(event),
      suggestAction: (intent) => actionIntentController.submit(intent),
    });
    elements.clearOverrides.addEventListener("click", () => {
      stateManager.clearOverrides("control_panel");
    });
    applyTransitionSettings(manifest.transition);
    bindTransitionEditor();
    renderEventControls();
    bindIntentSimulator();
    await loadModelOptions();
    bindChat();
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
