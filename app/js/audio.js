/* ==========================================================================
   audio.js — произношение через Web Speech API
   --------------------------------------------------------------------------
   Без ключей и without сети. Если в системе нет японского голоса — говорим
   romaji через латинский голос, это лучше, чем тишина.
   ========================================================================== */

const ROMAN = {
  a: "а", i: "и", u: "у", e: "э", o: "о",
  ka: "ка", ki: "ки", ku: "ку", ke: "ке", ko: "ко",
  sa: "са", shi: "си", su: "су", se: "се", so: "со",
  ta: "та", te: "те", to: "то", chi: "чи", tsu: "цу",
  na: "на", ni: "ни", nu: "ну", ne: "не", no: "но",
  ha: "ха", hi: "хи", fu: "фу", he: "хе", ho: "хо",
  ma: "ма", mi: "ми", mu: "му", me: "ме", mo: "мо",
  ya: "я", yu: "ю", yo: "ё",
  ra: "ра", ri: "ри", ru: "ру", re: "ре", ro: "ро",
  wa: "ва", wo: "во", vu: "ву",
  ga: "га", gi: "ги", gu: "гу", ge: "ге", go: "го",
  za: "за", ji: "дзи", zu: "дзу", ze: "дзе", zo: "зо",
  da: "да", de: "де", do: "до",
  ba: "ба", bi: "би", bu: "бу", be: "бе", bo: "бо",
  pa: "па", pi: "пи", pu: "пу", pe: "пе", po: "по",
  va: "ва", vi: "ви", ve: "ве", vo: "во",
  tsu: "цу",
};

let cachedVoices = [];

function loadVoices() {
  if (!("speechSynthesis" in window)) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
  return v;
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function pickVoice(pref = "auto") {
  if (pref !== "auto" && pref && pref !== "none") {
    return cachedVoices.find((v) => v.name === pref) || null;
  }
  const ja = cachedVoices.filter((v) => /ja(-|_)?JP/i.test(v.lang));
  if (!ja.length) return null;
  // prefer a voice that actually sounds Japanese rather than a translated one
  return ja.find((v) => /kana|jp|japan/i.test(v.name)) || ja[0];
}

/** Speak a kana character (or a whole string) in Japanese. */
export function speak(text, opts = {}) {
  if (!("speechSynthesis" in window)) return false;
  const pref = opts.voice || "auto";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  const v = pickVoice(pref);
  if (v) { u.voice = v; }
  else {
    // no Japanese voice: fall back to a Latin one so the learner still hears something
    const latin = cachedVoices.find((x) => /^en(-|_)?/i.test(x.lang)) || cachedVoices[0];
    if (latin) { u.voice = latin; u.lang = latin.lang; }
    u.text = text;
  }
  u.rate = opts.rate || 0.9;
  u.pitch = opts.pitch || 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}

/** Say the romaji of a kana, for learners who cannot yet read it. */
export function speakRomaji(romaji, opts = {}) {
  const text = ROMAN[romaji] || romaji;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  const v = cachedVoices.find((x) => /^ru(-|_)?/i.test(x.lang));
  if (v) u.voice = v;
  u.rate = opts.rate || 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function voices() { return cachedVoices; }
export function hasJapaneseVoice() { return pickVoice() !== null; }
export function voiceList() {
  const ja = cachedVoices.filter((v) => /ja(-|_)?JP/i.test(v.lang));
  return ja.map((v) => ({ name: v.name, label: v.name }));
}
