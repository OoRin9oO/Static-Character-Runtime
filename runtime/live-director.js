// A small, opt-in rehearsal queue. Live platform adapters are not enabled yet.
export class LiveDirector {
  constructor({ reply, onStatus = () => {}, intervalMs = 5000, maxQueue = 10, now = () => Date.now() }) {
    this.reply = reply;
    this.onStatus = onStatus;
    this.intervalMs = intervalMs;
    this.maxQueue = maxQueue;
    this.now = now;
    this.queue = [];
    this.seen = new Map();
    this.running = false;
    this.busy = false;
    this.generation = 0;
    this.timer = null;
    this.nextAt = 0;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.onStatus("模拟自动回复已开启。");
    this.pump();
  }
  pause() {
    this.running = false;
    this.generation++;
    this.queue.length = 0;
    clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.onStatus("已暂停，等待中的模拟评论已清空。");
  }
  enqueue(event) {
    if (!this.running) return { ok: false, error: "请先开启模拟自动回复。" };
    if (event.platform !== "mock" || event.type !== "chat_message") return { ok: false, error: "目前只接受模拟评论。" };
    const text = String(event.text || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 200) return { ok: false, error: "评论需为 1 至 200 字。" };
    const now = this.now();
    for (const [key, at] of this.seen) if (now - at >= 15000) this.seen.delete(key);
    const key = `${event.user.id}:${text.toLowerCase()}`;
    if (this.seen.has(key)) return { ok: false, error: "短时间内重复的评论已忽略。" };
    if (this.queue.length >= this.maxQueue) return { ok: false, error: "评论队列已满。" };
    this.seen.set(key, now);
    this.queue.push({ ...event, text });
    this.onStatus(`已排队：${this.queue.length} 条。`);
    this.pump();
    return { ok: true };
  }
  async pump() {
    if (!this.running || this.busy || !this.queue.length || this.timer) return;
    const delay = Math.max(0, this.nextAt - this.now());
    if (delay) {
      this.timer = setTimeout(() => { this.timer = null; this.pump(); }, delay);
      return;
    }
    const event = this.queue.shift();
    const generation = this.generation;
    this.busy = true;
    this.abort = new AbortController();
    try {
      await this.reply(event, { signal: this.abort.signal, isCurrent: () => this.running && this.generation === generation });
    } catch (error) {
      if (this.running && this.generation === generation) this.onStatus(`模拟回复失败：${error.message}`);
    } finally {
      this.busy = false;
      this.abort = null;
      this.nextAt = this.now() + this.intervalMs;
      this.pump();
    }
  }
}
