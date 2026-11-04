// Deterministic rehearsal/fallback only. AI mode uses the server classifier first.
export function inferMessageMode(text) {
  if (/只(?:让|问|要)|单独|一个人|仅.{0,12}回答/.test(text)) return "solo";
  return /讨论|辩论|你们|大家|各位|一起聊|轮流|分别.{0,8}(?:说|答|谈)/.test(text) ? "discussion" : "solo";
}
