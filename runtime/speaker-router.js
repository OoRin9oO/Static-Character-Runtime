const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().trim();
const word = (value) => /[a-z0-9_]/i.test(value || "");

export function mentionedSpeakers(text, cast, { explicitOnly = false } = {}) {
  const content = normalize(text);
  const aliases = new Map();
  for (const role of cast.filter((item) => item.enabled)) {
    for (const name of new Set([normalize(role.displayName), normalize(role.characterName), normalize(role.characterId)])) {
      if (!name) continue;
      if (!aliases.has(name)) aliases.set(name, new Set());
      aliases.get(name).add(role.instanceId);
    }
  }
  const matches = [], occupied = [];
  for (const [name, ids] of [...aliases].sort((a, b) => b[0].length - a[0].length)) {
    if (ids.size !== 1) continue;
    for (let index = content.indexOf(name); index >= 0; index = content.indexOf(name, index + 1)) {
      const end = index + name.length;
      if (explicitOnly && content[index - 1] !== "@") continue;
      if ((word(name[0]) && word(content[index - 1])) || (word(name.at(-1)) && word(content[end]))) continue;
      if (occupied.some(([a, b]) => index < b && end > a)) continue;
      occupied.push([index, end]);
      matches.push({ id: [...ids][0], index });
    }
  }
  return [...new Set(matches.sort((a, b) => a.index - b.index).map((item) => item.id))];
}

export class SpeakerRouter {
  constructor({ random = Math.random } = {}) { this.random = random; this.clear(); }
  clear() { this.sceneId = null; this.lastSpoken = new Map(); this.lastOpened = new Map(); this.turn = 0; }
  choose(sceneId, cast, { question = "", previousReply = "", spoken = new Set(), automatic = true, opening = false } = {}) {
    if (this.sceneId !== sceneId) { this.clear(); this.sceneId = sceneId; }
    const available = cast.filter((item) => item.enabled && !spoken.has(item.instanceId));
    if (!available.length) return null;
    const explicit = mentionedSpeakers(question, cast, { explicitOnly: true }).map((id) => available.find((item) => item.instanceId === id)).find(Boolean);
    if (explicit) return { target: explicit, reason: "明确 @ 点名" };
    if (automatic) {
      for (const [text, reason] of [[question, "观众点名"], [previousReply, "接续角色点名"]]) {
        const ids = mentionedSpeakers(text, cast);
        const target = ids.map((id) => available.find((item) => item.instanceId === id)).find(Boolean);
        if (target) return { target, reason };
      }
    }
    if (opening) {
      // Completing a full speaking cycle must not reset the same role as opener.
      const earliest = Math.min(...available.map((item) => this.lastOpened.get(item.instanceId) || 0));
      const candidates = available.filter((item) => (this.lastOpened.get(item.instanceId) || 0) === earliest);
      const target = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
      return { target, reason: "开场轮换" };
    }
    const target = available.reduce((best, item) =>
      (this.lastSpoken.get(item.instanceId) || 0) < (this.lastSpoken.get(best.instanceId) || 0) ? item : best);
    return { target, reason: "轮流分配" };
  }
  record(instanceId, { opening = false } = {}) {
    this.lastSpoken.set(instanceId, ++this.turn);
    if (opening) this.lastOpened.set(instanceId, this.turn);
  }
}
