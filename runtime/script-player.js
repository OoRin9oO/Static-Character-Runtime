export function parseScript(text, filename = "script.json") {
  if (text.length > 100000) throw new Error("剧本超过 100000 字符。请拆分后导入。");
  let data;
  if (/\.json$/i.test(filename)) {
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("剧本 JSON 格式错误。"); }
  } else if (/\.(txt|md)$/i.test(filename)) {
    data = { title: filename, lines: text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line, index) => {
      const match = line.match(/^\s*([^:：]{1,80})[:：]\s*(.+)$/);
      if (!match) throw new Error(`第 ${index + 1} 条应为“角色名：台词”。`);
      return { speaker: match[1].trim(), text: match[2].trim() };
    }) };
  } else throw new Error("剧本仅支持 JSON、UTF-8 TXT 或 Markdown。");
  if (!data || !Array.isArray(data.lines) || !data.lines.length || data.lines.length > 200) throw new Error("剧本需要 1–200 条台词。");
  const lines = data.lines.map((line, index) => {
    if (!line || typeof line.speaker !== "string" || !line.speaker.trim() || line.speaker.length > 80 || typeof line.text !== "string" || !line.text.trim() || line.text.length > 500) throw new Error(`第 ${index + 1} 条角色名或台词无效（台词最多 500 字）。`);
    if (line.state !== undefined && (typeof line.state !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/i.test(line.state))) throw new Error(`第 ${index + 1} 条动作 ID 无效。`);
    return { speaker: line.speaker.trim(), text: line.text.trim(), ...(line.state ? { state: line.state } : {}) };
  });
  return { title: String(data.title || filename).slice(0, 120), lines };
}

export function matchScriptSpeaker(name, cast) {
  const key = name.normalize("NFKC").trim().toLowerCase();
  const matches = cast.filter((role) => role.enabled && [role.displayName, role.characterName, role.characterId].some((value) => String(value || "").normalize("NFKC").trim().toLowerCase() === key));
  return matches.length === 1 ? matches[0].instanceId : "";
}

export class ScriptPlayer {
  constructor() { this.running = false; this.generation = 0; }
  stop() { this.generation++; this.controller?.abort(); }
  async play(lines, perform) {
    if (this.running) throw new Error("剧本正在播放或停止中。");
    this.running = true;
    const generation = ++this.generation;
    this.controller = new AbortController();
    const context = { signal: this.controller.signal, isCurrent: () => generation === this.generation };
    let completed = 0;
    try {
      for (const line of lines) {
        if (!context.isCurrent()) break;
        await perform(line, completed, context);
        if (!context.isCurrent()) break;
        completed++;
      }
      return completed;
    } finally { this.running = false; this.controller = null; }
  }
}
