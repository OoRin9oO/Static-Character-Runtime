export class CharacterStateManager {
  constructor({ defaultState, isKnownState, onChange = () => {}, onError = () => {} }) {
    this.defaultState = defaultState;
    this.baseState = defaultState;
    this.isKnownState = isKnownState;
    this.onChange = onChange;
    this.onError = onError;
    this.overrides = new Map();
    this.nextOverrideId = 1;
    this.sequence = 1;
  }

  setBaseState(stateId, reason = "manual") {
    if (!this.#accepts(stateId)) return false;
    this.baseState = stateId;
    this.#emit(reason);
    return true;
  }

  pushOverride(stateId, { priority = 60, durationMs = 0, reason = "manual" } = {}) {
    if (!this.#accepts(stateId)) return null;

    const id = `override-${this.nextOverrideId++}`;
    const entry = {
      id,
      stateId,
      priority,
      durationMs,
      reason,
      sequence: this.sequence++,
      timer: null,
    };

    if (durationMs > 0) {
      entry.timer = setTimeout(() => this.clearOverride(id, "duration_finished"), durationMs);
    }

    this.overrides.set(id, entry);
    this.#emit(reason);
    return id;
  }

  clearOverride(overrideId, reason = "manual_clear") {
    const entry = this.overrides.get(overrideId);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.overrides.delete(overrideId);
    this.#emit(reason);
    return true;
  }

  clearOverrides(reason = "clear_all") {
    for (const entry of this.overrides.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.overrides.clear();
    this.#emit(reason);
  }

  reset(reason = "reset") {
    this.baseState = this.defaultState;
    this.clearOverrides(reason);
  }

  getSnapshot(reason = "snapshot") {
    const overrides = [...this.overrides.values()]
      .sort((a, b) => b.priority - a.priority || b.sequence - a.sequence)
      .map(({ timer, ...entry }) => entry);

    return {
      baseState: this.baseState,
      overrides,
      effectiveState: overrides[0]?.stateId || this.baseState,
      reason,
    };
  }

  #accepts(stateId) {
    if (this.isKnownState(stateId)) return true;
    this.onError(`未知状态“${stateId}”已被状态管理器拒绝。`);
    return false;
  }

  #emit(reason) {
    this.onChange(this.getSnapshot(reason));
  }
}
