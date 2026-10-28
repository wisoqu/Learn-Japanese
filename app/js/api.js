/* ==========================================================================
   api.js — клиент к FastAPI-бэкенду
   --------------------------------------------------------------------------
   Бэкенд нужен для двух вещей: хранения прогресса и прокси-вызовы Gemini
   (чтобы ключ не лежал в браузере и не попадал в консоль). Без него
   приложение полнофункционально — прогресс лежит в localStorage.
   ========================================================================== */

const BASE = "";

export const api = {
  online: null, // null = неизвестно, true/false = проверено
  chatKey: null,

  async _fetch(path, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetch(BASE + path, { ...opts, signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
      return r;
    } finally {
      clearTimeout(timer);
    }
  },

  async health() {
    try {
      const r = await this._fetch("/api/health");
      if (!r.ok) return false;
      const j = await r.json().catch(() => ({}));
      return !!j.ok;
    } catch (_) { return false; }
  },

  async check() {
    const ok = await this.health();
    this.online = ok;
    return ok;
  },

  async pullProgress() {
    const r = await this._fetch("/api/progress");
    if (!r.ok) throw new Error("progress pull failed: " + r.status);
    return r.json();
  },

  async pushProgress(payload) {
    const r = await this._fetch("/api/progress", { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) throw new Error("progress push failed: " + r.status);
    return true;
  },

  /** Streaming Gemini call through the server proxy. Returns a ReadableStream. */
  async chatStream(messages, { onDelta, signal } = {}) {
    const r = await this._fetch("/api/chat", {
      method: "POST",
      signal,
      body: JSON.stringify({ messages, model: this.model }),
      headers: { "X-Gemini-Key": this.chatKey || "" },
    });
    if (r.status === 401 || r.status === 403) {
      throw new Error("bad-key");
    }
    if (r.status === 404) {
      throw new Error("chat-disabled");
    }
    if (!r.ok) throw new Error("chat failed: " + r.status);

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (!data) continue;
        let j;
        try { j = JSON.parse(data); } catch (_) { continue; }
        if (j.error) throw new Error(j.error);
        if (j.text) onDelta && onDelta(j.text);
      }
    }
  },
};

export function setChatKey(k) { api.chatKey = k; }
export function getChatKey() { return api.chatKey; }
