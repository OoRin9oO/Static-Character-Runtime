export class ActionIntentController {
  constructor({
    isKnownState,
    dispatch,
    cooldownMs = 1200,
    onDecision = () => {},
    now = () => Date.now(),
  }) {
    this.isKnownState = isKnownState;
    this.dispatch = dispatch;
    this.cooldownMs = cooldownMs;
    this.onDecision = onDecision;
    this.now = now;
    this.lastAccepted = new Map();
  }

  submit(input) {
    const result = this.#validate(input);
    if (!result.ok) {
      this.onDecision(result);
      return result;
    }

    const lastTime = this.lastAccepted.get(result.intent.state) ?? -Infinity;
    const currentTime = this.now();
    if (currentTime - lastTime < this.cooldownMs) {
      const rejected = { ok: false, error: `状态“${result.intent.state}”仍在冷却中。` };
      this.onDecision(rejected);
      return rejected;
    }

    const handled = this.dispatch({
      type: "state_requested",
      payload: {
        stateId: result.intent.state,
        source: "ai",
        durationMs: result.intent.durationMs,
      },
    });
    if (!handled) {
      const rejected = { ok: false, error: "动作建议未被状态系统接受。" };
      this.onDecision(rejected);
      return rejected;
    }

    this.lastAccepted.set(result.intent.state, currentTime);
    this.onDecision(result);
    return result;
  }

  #validate(input) {
    let value = input;
    if (typeof input === "string") {
      try {
        value = JSON.parse(input);
      } catch {
        return { ok: false, error: "动作建议不是有效的 JSON。" };
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "动作建议必须是对象。" };
    }
    if (typeof value.state !== "string" || !this.isKnownState(value.state)) {
      return { ok: false, error: `状态“${value.state ?? "未提供"}”不在角色白名单中。` };
    }
    if (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 1) {
      return { ok: false, error: "intensity 必须是 0 到 1 之间的数字。" };
    }
    if (!Number.isInteger(value.durationMs) || value.durationMs < 250 || value.durationMs > 10000) {
      return { ok: false, error: "durationMs 必须是 250 到 10000 之间的整数。" };
    }
    if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 200)) {
      return { ok: false, error: "reason 必须是不超过 200 字的文本。" };
    }

    return {
      ok: true,
      intent: {
        state: value.state,
        intensity: value.intensity,
        durationMs: value.durationMs,
        reason: value.reason || "",
      },
    };
  }
}
