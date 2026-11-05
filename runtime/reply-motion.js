// Reply effects are transient and never change saved scene transforms or poses.
export const MAX_REPLY_DURATION_MS = 120000;
export function boundedCount(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(6, Math.floor(number))) : fallback;
}

export function estimateReplyDuration(text, charactersPerSecond = 6) {
  const speed = Math.max(2, Math.min(12, Number(charactersPerSecond) || 6));
  return Math.min(60000, Math.max(2500, Math.round(String(text || "").replace(/\s/g, "").length / speed * 1000 + 600)));
}

export function createReplyMotion(result, stateIds, { bounce = true, sequence = true, now = Date.now(), maxActions = 3, charactersPerSecond } = {}) {
  const allowed = new Set(stateIds);
  const candidates = sequence && Array.isArray(result.actions) && result.actions.length ? result.actions : [result.intent];
  const steps = candidates.slice(0, boundedCount(maxActions, 3)).filter((step) => step && allowed.has(step.state)).map((step) => ({
    state: step.state,
    durationMs: Number.isInteger(step.durationMs) ? Math.max(250, Math.min(5000, step.durationMs)) : 2500,
  }));
  if (!steps.length) return null;
  const motion = { startedAt: now, bounce: Boolean(bounce), steps };
  if (charactersPerSecond !== undefined) motion.durationMs = estimateReplyDuration(result.reply, charactersPerSecond);
  return motion;
}

// Future audio owners report real playback time; stale reply IDs are checked by the caller.
export function updateReplyPlayback(motion, report, now = Date.now()) {
  const { positionMs, durationMs, paused = false, ended = false } = report;
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs < 250 || durationMs > MAX_REPLY_DURATION_MS || positionMs < 0 || positionMs > durationMs || typeof paused !== "boolean" || typeof ended !== "boolean") return false;
  motion.playback = { positionMs, durationMs, paused, ended, updatedAt: now };
  return true;
}

export function replyFrame(motion, now = Date.now()) {
  if (!motion || !Array.isArray(motion.steps) || !Number.isFinite(motion.startedAt)) return null;
  // Keep the reply alive during synthesis, while the character stays in its base pose.
  if (motion.pendingAudio) return { state: null, bounce: false, elapsed: 0 };
  const steps = motion.steps.slice(0, 6);
  if (steps.some((step) => !Number.isFinite(step.durationMs) || step.durationMs < 250 || step.durationMs > 5000)) return null;
  const total = steps.reduce((sum, step) => sum + step.durationMs, 0);
  const playback = motion.playback;
  if (playback?.ended) return null;
  const duration = playback?.durationMs || motion.durationMs || total;
  if (!(duration > 0 && duration <= MAX_REPLY_DURATION_MS)) return null;
  // Limit a stalled audio owner so a rehearsal cannot wait forever.
  if (playback && now - playback.updatedAt > 15000) return null;
  const position = playback ? playback.positionMs + (playback.paused ? 0 : Math.max(0, now - playback.updatedAt)) : now - motion.startedAt;
  if (position < 0 || position >= duration) return null;
  let elapsed = position / duration * total;
  if (elapsed < 0) return null;
  for (const step of steps) {
    if (!Number.isFinite(step.durationMs) || step.durationMs < 250 || step.durationMs > 5000) return null;
    if (elapsed < step.durationMs) return { state: step.state, bounce: Boolean(motion.bounce) && !playback?.paused, elapsed: position };
    elapsed -= step.durationMs;
  }
  return null;
}

export function playbackInterval(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(Math.max(0, Math.min(15, seconds)) * 1000) : 2000;
}
