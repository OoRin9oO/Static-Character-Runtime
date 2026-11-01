const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

export class CharacterEventDispatcher {
  constructor({ stateManager, eventMap = {}, onEvent = () => {}, onError = () => {} }) {
    this.stateManager = stateManager;
    this.eventMap = eventMap;
    this.onEvent = onEvent;
    this.onError = onError;
  }

  dispatch(input) {
    const event = this.#normalize(input);
    if (!event) return false;

    const action = this.eventMap[event.type];
    if (!action) {
      this.onError(`未知事件“${event.type}”已被忽略。`);
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
    return {
      type: input.type,
      timestamp: input.timestamp || new Date().toISOString(),
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    };
  }
}
