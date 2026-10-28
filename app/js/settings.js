/* ==========================================================================
   settings.js — не-прогрессные настройки (тема, голос, ключ, модель)
   ========================================================================== */

const KEY = "kana.settings.v1";

const DEFAULTS = {
  theme: "auto",      // auto | light | dark
  voice: "auto",      // auto | <voice name> | none
  geminiKey: "",
  geminiModel: "gemini-2.0-flash",
  sync: true,
  newPerDay: 10,
  reviewLimit: 22,
};

let store = { ...DEFAULTS };
try { Object.assign(store, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) {}

export const settings = {
  get all() { return { ...store }; },
  get(k) { return store[k]; },
  set(k, v) {
    store[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) {}
    return v;
  },
  toggle(k) { return this.set(k, !store[k]); },

  /** Apply the theme to <html>. */
  applyTheme() {
    const t = store.theme;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else document.documentElement.removeAttribute("data-theme");
  },
};

export const THEMES = [
  { id: "auto", label: { ru: "Системная", en: "System", ja: "システム" } },
  { id: "light", label: { ru: "Светлая", en: "Light", ja: "ライト" } },
  { id: "dark", label: { ru: "Тёмная", en: "Dark", ja: "ダーク" } },
];
