/* ==========================================================================
   data.js — подхват словаря каны и короткие утилиты над ним
   ========================================================================== */

export let DATA = null;

export async function loadData() {
  const res = await fetch("data/kana.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("cannot load data/kana.json: " + res.status);
  DATA = await res.json();
  return DATA;
}

export function setData(d) { DATA = d; }

/** rows by dataset id: { hiragana: [...], katakana: [...] } */
export function rowsBySet() {
  const out = {};
  for (const s of DATA.sets) out[s.id] = s.rows;
  return out;
}

export function sets() { return DATA.sets; }

export function setById(id) { return DATA.sets.find((s) => s.id === id); }

export function rowById(setId, rowId) {
  return setById(setId).rows.find((r) => r.id === rowId);
}

/** char record from kana.json for a given char (across sets). */
export function charData(setId, ch) {
  const s = setById(setId);
  return s.chars.find((c) => c.char === ch);
}

export function setName(setId) {
  const s = setById(setId);
  return s ? s.name : setId;
}

export function setLabel(setId) {
  const s = setById(setId);
  if (!s) return setId;
  if (s.id === "hiragana") return { ru: "Хирагана", en: "Hiragana", ja: "ひらがな" };
  return { ru: "Катакана", en: "Katakana", ja: "カタカナ" };
}

/** romanisation variants for a character (основное + варианты). */
export function readings(romaji) {
  const alt = {
    shi: ["si", "shi"], chi: ["ti", "chi"], tsu: ["tu", "tsu"],
    fu: ["hu", "fu"], ji: ["zi", "ji", "di"], zu: ["du", "zu"],
    vu: ["vu", "bu", "w"], wo: ["o", "wo"],
  }[romaji];
  return alt || [romaji];
}

export function isAccentClash(a, b) { return a.romaji === b.romaji; }

/** pick distractors for a multiple-choice question */
export function distractors(romaji, count, pool) {
  const used = new Set([romaji]);
  const out = [];
  for (const item of pool) {
    if (out.length >= count) break;
    if (used.has(item.romaji)) continue;
    used.add(item.romaji);
    out.push(item.romaji);
  }
  return out;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}
