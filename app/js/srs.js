/* ==========================================================================
   srs.js — прогресс и система повторения
   --------------------------------------------------------------------------
   Пошедшая схема: символ считается «усвоенным» (mastered), когда прошёл
   ≥3 удачных повторения с интервалом ≥2 дня. Строка (линия азбуки) открывает
   следующую, когда общий уровень строки ≥50% — то есть «больше на половину».
   Сам алгоритм — адаптированный SM-2: оценка 0..5 → новый интервал + ease.
   ========================================================================== */

import { I18N } from "./i18n.js";
import * as API from "./api.js";

const STORE_KEY = "kana.progress.v2";
const DAY = 86400000;
const MIN = 60000;

/** 0=не встречен, 1=учил, 2=учится, 3=усвоил */
const LEVEL = { NEW: 0, SEEN: 1, LEARNING: 2, MASTERED: 3 };

function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const defaultState = () => ({
  version: 2,
  chars: {},          // id -> srs record
  rows: {},           // rowId -> { unlocked }
  chat: [],
  stats: { reviews: 0, correct: 0, days: {}, firstSeen: Date.now(), lastSync: 0 },
});

class Progress {
  constructor() {
    this.state = defaultState();
    this._dirty = false;
    this._saveTimer = 0;
  }

  /* ------------------------------------------------------------- load/save */

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 2) this.state = Object.assign(defaultState(), parsed);
      }
    } catch (_) {}
    return this;
  }

  save(immediate = false) {
    this._dirty = true;
    const write = () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch (_) {}
      this.state.stats.lastSync = Date.now();
      this._dirty = false;
    };
    if (immediate) { clearTimeout(this._saveTimer); write(); return; }
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(write, 400);
  }

  serialize() {
    return JSON.stringify(this.state);
  }

  replace(json) {
    const parsed = JSON.parse(json);
    if (!parsed || parsed.version !== 2) throw new Error("bad format");
    this.state = Object.assign(defaultState(), parsed);
    this.save(true);
    return this.state;
  }

  reset() {
    this.state = defaultState();
    this.save(true);
  }

  /* ----------------------------------------------------------- char records */

  id(setId, ch) { return `${setId}:${ch}`; }

  get(id) { return this.state.chars[id]; }

  /** Mark a symbol as introduced (seen in the learn screen). */
  touch(setId, ch) {
    const id = this.id(setId, ch);
    const rec = this.state.chars[id];
    const now = Date.now();
    if (!rec) {
      this.state.chars[id] = {
        id, set: setId, char: ch,
        state: "learning", reps: 0, lapses: 0, ease: 2.5,
        interval: 10 / 1440, due: now + 10 * MIN,
        lastQ: 0, bestQ: 0, attempts: 0, correct: 0, seen: 1, reviews: 0,
        lastTouch: now,
      };
      this.state.stats.days[todayKey(now)] = (this.state.stats.days[todayKey(now)] || 0) + 1;
    } else {
      rec.seen = (rec.seen || 0) + 1;
      rec.lastTouch = now;
    }
    this.save();
    return this.state.chars[id];
  }

  /** SM-2-ish update after a graded answer. q in 0..5. */
  grade(id, q) {
    const rec = this.state.chars[id];
    if (!rec) return null;
    const now = Date.now();
    rec.attempts++;
    rec.lastQ = q;
    if (q > rec.bestQ) rec.bestQ = q;

    if (q >= 3) {
      rec.correct++;
      rec.reps++;
      rec.lapses = 0;
      let interval;
      if (rec.reps === 1) interval = 10 / 1440;         // 10 минут — еще в сессии
      else if (rec.reps === 2) interval = 1;            // день
      else if (rec.reps === 3) interval = 3;
      else interval = Math.round(rec.interval * rec.ease * 4) / 4;
      rec.interval = interval;
      rec.ease = clamp(rec.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02), 1.3, 3.2);
      rec.state = rec.reps >= 3 && rec.interval >= 2 ? "mastered" : (rec.reps >= 2 ? "review" : "learning");
    } else {
      rec.reps = 0;
      rec.lapses++;
      rec.interval = 10 / 1440;
      rec.ease = clamp(rec.ease - 0.2, 1.3, 3.2);
      rec.state = "learning";
    }
    rec.due = now + rec.interval * DAY;
    rec.reviews++;
    rec.lastTouch = now;

    this.state.stats.reviews++;
    if (q >= 3) this.state.stats.correct++;
    const dk = todayKey(now);
    this.state.stats.days[dk] = (this.state.stats.days[dk] || 0) + 1;

    this.syncRows();
    this.save();
    return rec;
  }

  /* ------------------------------------------------------------ rows/lines */

  /** numeric level 0..3 for a char record */
  levelOf(rec) {
    if (!rec) return LEVEL.NEW;
    if (rec.state === "mastered") return LEVEL.MASTERED;
    if (rec.state === "review") return LEVEL.LEARNING;
    if (rec.seen > 0) return LEVEL.SEEN;
    return LEVEL.NEW;
  }

  /** 0..1 — how far the row is passed. */
  progress(row) {
    if (!row || !row.chars.length) return 0;
    let sum = 0;
    for (const c of row.chars) sum += this.levelOf(this.state.chars[this.id(row.set, c.char)]);
    return sum / (row.chars.length * 3);
  }

  rowDone(row) { return this.progress(row) >= 0.85; }

  isUnlocked(row) { return !!this.state.rows[row.id]?.unlocked; }

  unlock(rowId, v = true) {
    if (v) this.state.rows[rowId] = { unlocked: true };
    else delete this.state.rows[rowId];
    this.save();
  }

  /** Open the next line when the previous one is more than half passed. */
  syncRows() {
    const CHANGED = [];
    const check = (rows) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // the very first line of an alphabet is always open
        const want = (i === 0) || (this.progress(rows[i - 1]) >= 0.5);
        if (want && !this.isUnlocked(row)) { this.unlock(row.id, true); CHANGED.push(row.id); }
      }
    };
    // datasets are supplied by the caller through bindRows()
    if (this._rowsBySet) for (const s of Object.keys(this._rowsBySet)) check(this._rowsBySet[s]);
    return CHANGED;
  }

  /** Wire the dataset rows so syncRows() can reason about them. */
  bindRows(rowsBySet) { this._rowsBySet = rowsBySet; }

  currentRow(setRows) {
    for (const row of setRows) {
      if (this.isUnlocked(row) && !this.rowDone(row)) return row;
    }
    return null;
  }

  /** All rows that are unlocked and not finished — the "learning frontier". */
  frontier(setRows) { return setRows.filter((r) => this.isUnlocked(r) && !this.rowDone(r)); }

  /* ------------------------------------------------------------------ queue */

  isDue(rec, now = Date.now()) { return rec && (rec.due <= now || rec.state === "learning"); }

  dueCount(now = Date.now()) {
    let n = 0;
    for (const id in this.state.chars) if (this.isDue(this.state.chars[id], now)) n++;
    return n;
  }

  accuracy() {
    const s = this.state.stats;
    if (!s.reviews) return 0;
    return s.correct / s.reviews;
  }

  /**
   * Build the review queue: due cards from all unlocked rows, plus new cards
   * from the front row. Cumulative — earlier lines come back automatically.
   */
  buildQueue(rowsBySet, now = Date.now(), opts = {}) {
    const limit = opts.limit || 22;
    const newPerDay = opts.newPerDay || 10;
    const queue = [];

    // Which alphabet is the learner actually on right now? Its cards go first,
    // and only it feeds brand-new cards — otherwise hiragana beginners would
    // meet katakana on their very first review.
    let curSetId = null;
    for (const setId of Object.keys(rowsBySet)) {
      const cur = this.currentRow(rowsBySet[setId]);
      if (cur && !curSetId) curSetId = setId;
    }

    // every unlocked row contributes due cards
    for (const setId of Object.keys(rowsBySet)) {
      for (const row of rowsBySet[setId]) {
        if (!this.isUnlocked(row)) continue;
        for (const c of row.chars) {
          const rec = this.state.chars[this.id(setId, c.char)];
          if (!rec) continue;
          if (rec.state === "new") continue;
          if (this.isDue(rec, now)) {
            queue.push({
              id: this.id(setId, c.char), char: c.char, set: setId, row: row.id,
              romaji: c.romaji,
              _w: 1 + (0.6 - Math.min(0.5, (rec.attempts || 1) / 12))
                  + (rec.state === "learning" ? 0.5 : 0)
                  + (setId === curSetId ? 1.5 : 0),
              _t: rec.due,
            });
          }
        }
      }
    }

    // brand-new cards, only from the alphabet we are currently on
    if (curSetId) {
      const frontierRows = rowsBySet[curSetId].filter((r) => this.isUnlocked(r) && !this.rowDone(r));
      let newBudget = newPerDay;
      for (const row of frontierRows) {
        for (const c of row.chars) {
          const rec = this.state.chars[this.id(curSetId, c.char)];
          if (!rec && newBudget > 0) {
            newBudget--;
            queue.push({
              id: this.id(curSetId, c.char), char: c.char, set: curSetId, row: row.id,
              romaji: c.romaji, _w: 4, _t: now, _new: true,
            });
          }
        }
      }
    }

    queue.sort((a, b) => (b._w - a._w) || (a._t - b._t));
    return queue.slice(0, limit);
  }

  /* --------------------------------------------------------------- chat log */

  addChat(msg) {
    this.state.chat.push(msg);
    if (this.state.chat.length > 200) this.state.chat.splice(0, this.state.chat.length - 200);
    this.save();
  }

  clearChat() { this.state.chat = []; this.save(true); }

  /* -------------------------------------------------------------------- stats */

  learnedChars() {
    let n = 0;
    for (const id in this.state.chars) if (this.state.chars[id].seen > 0) n++;
    return n;
  }

  doneRows(rowsBySet) {
    let n = 0;
    for (const setId of Object.keys(rowsBySet)) for (const r of rowsBySet[setId]) if (this.rowDone(r)) n++;
    return n;
  }

  totalRows(rowsBySet) {
    let n = 0;
    for (const setId of Object.keys(rowsBySet)) n += rowsBySet[setId].length;
    return n;
  }

  streak() {
    const days = Object.keys(this.state.stats.days);
    if (!days.length) return 0;
    const set = new Set(days);
    let streak = 0;
    let d = new Date();
    if (!set.has(todayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    for (;;) {
      const k = todayKey(d.getTime());
      if (!set.has(k)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export const progress = new Progress();
export { DAY, MIN, LEVEL, todayKey };
