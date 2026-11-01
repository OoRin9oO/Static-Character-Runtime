const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

export class CharacterEventDispatcher {
  constructor({
    stateManager,
    eventMap = {},
    resolveStateAction = () => null,
    onEvent = () => {},
    onError = () => {},
  }) {
    this.stateManager = stateManager;
    this.eventMap = eventMap;
    this.resolveStateAction = resolveStateAction;
    this.onEvent = onEvent;
    this.onError = onError;
  }

  dispatch(input) {
    const event = this.#normalize(input);
    if (!event) return false;

    const action = event.type === "state_requested"
      ? this.resolveStateAction(event.payload.stateId)
      : this.eventMap[event.type];
    if (!action) {
      const message = event.type === "state_requested"
        ? `未知状态“${event.payload.stateId ?? "未提供"}”已被忽略。`
        : `未知事件“${event.type}”已被忽略。`;
      this.onError(message);
      this.onEvent({ ...event, handled: false });
      return false;
    }

    const reason = `event:${event.type}`;
    const handled = action.mode === "override"
      ? Boolean(this.stateManager.pushOverride(action.state, {
          priority: action.priority ?? 60,
          durationMs: action.durationMs ?? 2500,
          reason,
        }))
      : this.stateManager.setBaseState(action.state, reason);

    this.onEvent({ ...event, handled, action });
    return handled;
  }

  #normalize(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      this.onError("事件必须是对象。");
      return null;
    }
    if (typeof input.type !== "string" || !EVENT_TYPE_PATTERN.test(input.type)) {
      this.onError("事件 type 必须使用小写字母、数字和下划线。");
      return null;
    }
    const timestamp = input.timestamp || new Date().toISOString();
    if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
      this.onError("事件 timestamp 必须是有效的日期时间文本。");
      return null;
    }
    if (input.payload !== undefined && (
      !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)
    )) {
      this.onError("事件 payload 必须是对象。");
      return null;
    }
    return {
      type: input.type,
      timestamp,
      payload: input.payload || {},
    };
  }
}
