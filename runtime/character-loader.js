const SUPPORTED_SCHEMA_VERSION = 1;

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`角色清单字段“${field}”必须是非空文本。`);
  }
}

function validateImagePath(imagePath, manifestUrl, stateId) {
  requireText(imagePath, `states.${stateId}.image`);

  if (imagePath.includes("\\") || imagePath.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(imagePath)) {
    throw new Error(`状态“${stateId}”的图片必须使用角色目录内的相对路径。`);
  }

  const manifestDirectory = new URL("./", manifestUrl);
  const imageUrl = new URL(imagePath, manifestDirectory);
  if (
    imageUrl.origin !== manifestDirectory.origin ||
    !imageUrl.pathname.startsWith(manifestDirectory.pathname)
  ) {
    throw new Error(`状态“${stateId}”的图片路径超出了角色目录。`);
  }
}

function validateDisplay(display, field) {
  if (display === undefined) return;
  if (!display || typeof display !== "object" || Array.isArray(display)) {
    throw new Error(`${field} 必须是对象。`);
  }

  const limits = {
    scale: [0.1, 3],
    anchorX: [0, 100],
    anchorY: [0, 100],
    offsetX: [-2000, 2000],
    offsetY: [-2000, 2000],
  };
  for (const [name, [min, max]] of Object.entries(limits)) {
    if (display[name] === undefined) continue;
    const value = display[name];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${field}.${name} 必须是 ${min} 到 ${max} 之间的数字。`);
    }
  }
}

function validateBehavior(behavior, stateId) {
  if (behavior === undefined) return;
  if (!behavior || typeof behavior !== "object" || Array.isArray(behavior)) {
    throw new Error(`states.${stateId}.behavior 必须是对象。`);
  }
  if (behavior.mode !== "base" && behavior.mode !== "override") {
    throw new Error(`states.${stateId}.behavior.mode 必须是 base 或 override。`);
  }
  if (behavior.priority !== undefined && (!Number.isFinite(behavior.priority) || behavior.priority < 0)) {
    throw new Error(`states.${stateId}.behavior.priority 必须是非负数字。`);
  }
  if (
    behavior.durationMs !== undefined &&
    (!Number.isFinite(behavior.durationMs) || behavior.durationMs < 0 || behavior.durationMs > 60000)
  ) {
    throw new Error(`states.${stateId}.behavior.durationMs 必须是 0 到 60000 之间的数字。`);
  }
}

function validateEvents(events, stateIds) {
  if (events === undefined) return;
  if (!events || typeof events !== "object" || Array.isArray(events)) {
    throw new Error("events 必须是对象。");
  }
  for (const [eventType, action] of Object.entries(events)) {
    if (!/^[a-z][a-z0-9_]*$/.test(eventType)) {
      throw new Error(`事件名称“${eventType}”格式不正确。`);
    }
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new Error(`events.${eventType} 必须是对象。`);
    }
    requireText(action.state, `events.${eventType}.state`);
    if (!stateIds.has(action.state)) {
      throw new Error(`事件“${eventType}”引用了不存在的状态“${action.state}”。`);
    }
    validateBehavior(action, `event:${eventType}`);
  }
}

function validateOptionalSettings(manifest) {
  if (manifest.canvas !== undefined) {
    const { width, height } = manifest.canvas || {};
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error("canvas.width 和 canvas.height 必须是正整数。");
    }
  }

  if (manifest.transition !== undefined) {
    const { type, durationMs, distancePx } = manifest.transition || {};
    requireText(type, "transition.type");
    if (!["crossfade", "bounce", "pop", "none"].includes(type)) {
      throw new Error("transition.type 必须是 crossfade、bounce、pop 或 none。");
    }
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 5000) {
      throw new Error("transition.durationMs 必须是 0 到 5000 之间的数字。");
    }
    if (distancePx !== undefined && (!Number.isFinite(distancePx) || distancePx < 0 || distancePx > 200)) {
      throw new Error("transition.distancePx 必须是 0 到 200 之间的数字。");
    }
  }

  if (manifest.groups !== undefined) {
    if (!manifest.groups || typeof manifest.groups !== "object" || Array.isArray(manifest.groups)) {
      throw new Error("groups 必须是对象。");
    }
    for (const [groupId, label] of Object.entries(manifest.groups)) {
      requireText(groupId, "groups 的分组 ID");
      requireText(label, `groups.${groupId}`);
    }
  }

  validateDisplay(manifest.display, "display");
}

export function validateCharacterManifest(manifest, manifestUrl) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("角色清单必须是 JSON 对象。");
  }
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `不支持的角色清单版本：${manifest.schemaVersion ?? "未提供"}，当前仅支持 ${SUPPORTED_SCHEMA_VERSION}。`,
    );
  }

  requireText(manifest.id, "id");
  requireText(manifest.name, "name");
  requireText(manifest.version, "version");
  requireText(manifest.defaultState, "defaultState");
  validateOptionalSettings(manifest);

  if (!Array.isArray(manifest.states) || manifest.states.length === 0) {
    throw new Error("角色清单必须至少包含一个状态。");
  }

  const stateIds = new Set();
  for (const [index, state] of manifest.states.entries()) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error(`states[${index}] 必须是对象。`);
    }
    requireText(state.id, `states[${index}].id`);
    requireText(state.label, `states.${state.id}.label`);
    if (state.group !== undefined) requireText(state.group, `states.${state.id}.group`);
    if (state.description !== undefined && typeof state.description !== "string") {
      throw new Error(`states.${state.id}.description 必须是文本。`);
    }
    validateDisplay(state.display, `states.${state.id}.display`);
    validateBehavior(state.behavior, state.id);
    if (!/^[a-z][a-z0-9_-]*$/i.test(state.id)) {
      throw new Error(`状态 ID“${state.id}”只能包含英文字母、数字、下划线和连字符。`);
    }
    if (stateIds.has(state.id)) {
      throw new Error(`角色清单包含重复状态 ID：“${state.id}”。`);
    }
    stateIds.add(state.id);
    validateImagePath(state.image, manifestUrl, state.id);
  }

  if (!stateIds.has(manifest.defaultState)) {
    throw new Error(`默认状态“${manifest.defaultState}”不存在。`);
  }
  validateEvents(manifest.events, stateIds);

  return new Map(manifest.states.map((state) => [state.id, state]));
}

export async function loadCharacterManifest(requestedUrl) {
  const url = new URL(requestedUrl, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error("角色清单必须来自当前本地项目。");
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`角色清单读取失败：HTTP ${response.status}`);
  }

  let manifest;
  try {
    manifest = await response.json();
  } catch {
    throw new Error("角色清单不是有效的 JSON。");
  }

  const states = validateCharacterManifest(manifest, url);
  return { manifest, url, states };
}

export function resolveRegisteredCharacterManifestUrl(character, pageUrl = window.location.href) {
  if (!character || typeof character.manifest !== "string") {
    throw new Error("角色目录项缺少 manifest 路径。");
  }
  const registryUrl = new URL("./characters/index.json", pageUrl);
  return new URL(character.manifest, registryUrl);
}

export function resolveStateImageUrl(state, manifestUrl) {
  return new URL(state.image, new URL("./", manifestUrl)).href;
}

export function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(url);
    image.onerror = () => reject(new Error(`无法加载图片：${url}`));
    image.src = url;
  });
}
