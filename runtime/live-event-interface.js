const EVENT_TYPES = new Set(["chat_message", "gift", "follow", "like", "system"]);
const PLATFORM_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function normalizeLiveEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("直播事件必须是对象。");
  if (!EVENT_TYPES.has(input.type)) throw new TypeError("直播事件 type 不受支持。");
  if (typeof input.platform !== "string" || !PLATFORM_PATTERN.test(input.platform)) {
    throw new TypeError("直播事件 platform 格式无效。");
  }
  const timestamp = input.timestamp || new Date().toISOString();
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError("直播事件 timestamp 无效。");
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > 2000) throw new TypeError("直播事件文本过长。");
  return Object.freeze({
    id: String(input.id || crypto.randomUUID()),
    type: input.type,
    platform: input.platform,
    timestamp,
    user: Object.freeze({
      id: String(input.user?.id || "anonymous"),
      name: String(input.user?.name || "匿名观众").slice(0, 80),
    }),
    text,
    value: Number.isFinite(input.value) ? Math.max(0, input.value) : 0,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? Object.freeze({ ...input.metadata }) : Object.freeze({}),
  });
}

export class LiveEventInterface {
  constructor({ onEvent = () => {}, onError = () => {} } = {}) {
    this.onEvent = onEvent;
    this.onError = onError;
  }

  receive(input) {
    try {
      const event = normalizeLiveEvent(input);
      this.onEvent(event);
      return event;
    } catch (error) {
      this.onError(error.message);
      return null;
    }
  }
}
