/* ==========================================================================
   app.js — маршрутизация и экраны
   ========================================================================== */

import { t, I18N, LANGS, SUPPORTED } from "./i18n.js";
import { settings, THEMES } from "./settings.js";
import { progress, DAY } from "./srs.js";
import {
  DATA, loadData, rowsBySet, sets, setById, rowById, charData, setLabel,
  readings, distractors, escapeHtml, el,
} from "./data.js";
import {
  glyphSVG, fitBox, animateStrokes, setStrokesVisible, pathLength,
  WritePad, scoreDrawing,
} from "./strokes.js";
import { speak, speakRomaji, stopSpeaking, voiceList, hasJapaneseVoice } from "./audio.js";
import * as API from "./api.js";
import { chatEnabled, sendMessage, testKey } from "./chat.js";

/* ------------------------------------------------------------------- icons */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  learn: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8.5h8M8 12.5h8M8 16.5h4.5"/>',
  practice: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.2h-4.2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.8A8 8 0 1 1 21 12Z"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.2M12 19v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.8 12h2.2M19 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

/* ------------------------------------------------------------------ router */

const ROUTES = ["home", "learn", "row", "char", "review", "chat", "settings"];
let route = { name: "home", params: {} };

function navigate(name, params = {}) {
  if (!ROUTES.includes(name)) return;
  route = { name, params };
  history.pushState({}, "", `#/${name}${params.s ? `/${params.s}` : ""}${params.r ? `/${params.r}` : ""}${params.c ? `/${params.c}` : ""}`);
  render();
  const view = document.getElementById("view");
  if (view) view.scrollTop = 0;
}

window.addEventListener("popstate", () => render());
window.addEventListener("hashchange", () => render());

function currentNav() {
  if (route.name === "learn" || route.name === "row" || route.name === "char") return "learn";
  return route.name;
}

/* ------------------------------------------------------------------ toasts */

export function toast(msg, kind = "") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = el("div", { class: `toast toast--${kind}` }, [msg]);
  host.append(node);
  setTimeout(() => {
    node.style.transition = "opacity .3s, transform .3s";
    node.style.opacity = "0";
    node.style.transform = "translateY(10px)";
    setTimeout(() => node.remove(), 320);
  }, 2600);
}

export function modal(title, body, actions = []) {
  const host = document.getElementById("modal");
  host.innerHTML = "";
  host.append(el("div", { class: "modal__box" }, [
    el("h3", { class: "modal__h", text: title }),
    el("p", { class: "modal__b", html: body }),
    el("div", { class: "modal__f" }, actions.map((a) =>
      el("button", { class: `btn ${a.primary ? "btn--primary" : a.danger ? "btn--danger" : ""}`, onclick: () => { a.fn(); host.hidden = true; } }, [a.label]))),
  ]));
  host.hidden = false;
}
export function closeModal() { document.getElementById("modal").hidden = true; }

/* -------------------------------------------------------------- data wiring */

let ROWS_BY_SET = {};

export async function bootApp() {
  settings.applyTheme();
  progress.load();
  await loadData();
  ROWS_BY_SET = rowsBySet();
  progress.bindRows(ROWS_BY_SET);
  progress.syncRows();
  buildNav();
  render();
}

function buildNav() {
  const items = [
    { id: "home", icon: "home", key: "nav__home" },
    { id: "learn", icon: "learn", key: "nav__learn" },
    { id: "review", icon: "practice", key: "nav__practice", badge: () => dueCount() },
    { id: "chat", icon: "chat", key: "nav__chat", badge: () => (chatEnabled() ? 0 : 0) },
    { id: "settings", icon: "settings", key: "nav__settings" },
  ];
  const build = (host, cls) => {
    host.innerHTML = "";
    for (const it of items) {
      const b = el("button", {
        class: `nav-item ${cls === "tabbar__item" ? "" : ""} ${currentNav() === it.id ? "active" : ""}`,
        onclick: () => navigate(it.id),
      }, [
        el("span", { class: `nav-item__icon ${cls === "tabbar__item" ? "" : ""}`, html: icon(it.icon) }),
        el("span", { text: t(it.key) }),
        ...(it.badge && it.badge() ? [el("span", { class: "nav-item__badge", text: String(it.badge()) })] : []),
      ]);
      host.append(b);
    }
  };
  build(document.getElementById("nav-rail"), "rail");
  build(document.getElementById("nav-tabs"), "tabbar");

  const lt = document.getElementById("lang-toggle");
  lt.textContent = (LANGS_SHORT[I18N.lang] || "RU") + " · " + t("settings__lang");
  lt.onclick = () => { I18N.cycle(); settings.applyTheme(); buildNav(); render(); toast(I18N.dict[I18N.lang] ? `Язык: ${LANGS_SHORT[I18N.lang]}` : ""); };
}

const LANGS_SHORT = { ru: "RU", en: "EN", ja: "JA" };

/* -------------------------------------------------------------- stats helpers */

function dueCount() {
  const queue = progress.buildQueue(ROWS_BY_SET, Date.now(), { limit: 9999, newPerDay: 0 });
  return queue.length;
}

function studyContext() {
  const sets = Object.keys(ROWS_BY_SET);
  const rows = sets.map((s) => ROWS_BY_SET[s]).flat();
  let cur = null;
  for (const s of sets) { const r = progress.currentRow(ROWS_BY_SET[s]); if (r) { cur = r; break; } }
  return {
    setName: cur ? setLabel(cur.set)[I18N.lang] : "",
    rowLabel: cur ? cur.label : "",
    progress: { rows: progress.doneRows(ROWS_BY_SET), total: progress.totalRows(ROWS_BY_SET) },
    learned: progress.learnedChars(),
    accuracy: progress.accuracy(),
    due: dueCount(),
    lang: { ru: "Russian", en: "English", ja: "Japanese" }[I18N.lang],
  };
}

/* --------------------------------------------------------------- RENDERING */

const view = () => document.getElementById("view");

async function render() {
  const v = view();
  v.innerHTML = "";
  buildNav();
  const r = route;
  if (r.name === "home") renderHome(v);
  else if (r.name === "learn") renderLearn(v);
  else if (r.name === "row") renderRow(v, r.params.s, r.params.r);
  else if (r.name === "char") renderChar(v, r.params.s, r.params.c);
  else if (r.name === "review") renderReview(v);
  else if (r.name === "chat") renderChat(v);
  else if (r.name === "settings") renderSettings(v);
  v.focus({ preventScroll: true });
}

/* -------------------------------------------------------------------- home */

function renderHome(v) {
  const rowsAll = Object.values(ROWS_BY_SET).flat();
  const curSetId = Object.keys(ROWS_BY_SET).find((s) => progress.currentRow(ROWS_BY_SET[s]));
  const curRow = curSetId ? progress.currentRow(ROWS_BY_SET[curSetId]) : null;
  const due = dueCount();
  const pg = curRow ? Math.round(progress.progress(curRow) * 100) : 0;

  const page = el("div", { class: "page" }, [
    el("header", { class: "stack", style: { gap: "6px" } }, [
      el("div", { class: "row", style: { gap: "14px" } }, [
        el("div", { class: "glyph-box", style: { width: "52px", height: "52px", flex: "none", background: "var(--accent-soft)", borderColor: "transparent" } }, [
          (() => { const s = glyphSVG(charData(curSetId || "hiragana", "あ"), { width: 6 }); s.style.color = "var(--accent)"; return s; })(),
        ]),
        el("div", {}, [
          el("h1", { class: "h1", text: t("home__greet") }),
          el("p", { class: "muted small", text: t("home__greetSub") }),
        ]),
      ]),
    ]),
  ]);

  // continue card
  if (curRow) {
    const chars = curRow.chars;
    page.append(el("section", { class: "card card--click", style: { marginTop: "20px" }, onclick: () => navigate("row", { s: curRow.set, r: curRow.id }) }, [
      el("div", { class: "between", style: { marginBottom: "14px" } }, [
        el("div", {}, [
          el("div", { class: "small muted", text: t("home__continueSub", { row: curRow.label, n: Math.round(progress.progress(curRow) * 100), total: 100 }) }),
          el("h2", { class: "h2", text: t("home__continue") }),
        ]),
        el("span", { class: "pill pill--accent", text: "→" }),
      ]),
      el("div", { class: "kana-row", style: { marginBottom: "14px" } }, chars.map((c) => kanaChip(c, curRow.set, "sm"))),
      el("div", { class: "row", style: { gap: "10px" } }, [
        el("div", { class: "bar bar--slim", style: { flex: "1" } }, [el("div", { class: "bar__i", style: { width: `${pg}%` } })]),
        el("span", { class: "small muted", text: `${pg}%` }),
      ]),
    ]));
  } else {
    page.append(el("section", { class: "card card--click", style: { marginTop: "20px" }, onclick: () => navigate("learn") }, [
      el("h2", { class: "h2", text: t("home__start") }),
      el("p", { class: "muted small", text: t("learn__sub") }),
    ]));
  }

  // today
  const planCard = el("section", { class: "card", style: { marginTop: "18px" } }, [
    el("div", { class: "between" }, [
      el("div", {}, [
        el("h2", { class: "h2", text: t("home__plan") }),
        el("p", { class: "muted small", text: t("home__planSub", { n: due }) }),
      ]),
      el("button", { class: "btn btn--primary", onclick: () => navigate("review") }, [t("nav__practice")]),
    ]),
  ]);
  if (due === 0) {
    planCard.append(el("div", { class: "pill pill--good", style: { marginTop: "12px" } }, ["✓ " + t("home__allCaught")]));
    planCard.append(el("p", { class: "muted small", style: { marginTop: "6px" } }, [t("home__allCaughtSub")]));
  }
  page.append(planCard);

  // stats
  const st = el("section", { class: "card", style: { marginTop: "18px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "14px" } }, [t("home__stats")]),
    el("div", { class: "stat-grid" }, [
      stat(progress.doneRows(ROWS_BY_SET), t("home__statRows")),
      stat(progress.learnedChars(), t("home__statChars")),
      stat(due, t("home__statDue")),
      stat(Math.round(progress.accuracy() * 100) + "%", t("home__statAcc")),
    ]),
  ]);
  page.append(st);

  // alphabets
  page.append(el("section", { style: { marginTop: "18px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "2px" } }, [t("home__sets")]),
    el("p", { class: "muted small", style: { marginBottom: "12px" } }, [t("home__setsSub")]),
    el("div", { class: "glyph-sheet" }, sets().map((s) => {
      const rows = ROWS_BY_SET[s.id];
      const overall = rows.length ? rows.reduce((a, r) => a + progress.progress(r), 0) / rows.length : 0;
      return el("div", { class: "card card--click glyph-cell", style: { aspectRatio: "auto", padding: "16px", gap: "10px", display: "flex", flexDirection: "column", alignItems: "center" }, onclick: () => navigate("learn") }, [
        el("div", { class: "row", style: { gap: "8px" } }, [
          el("div", { class: "glyph-box", style: { width: "46px", height: "46px", background: "var(--accent-soft)", borderColor: "transparent" } },
            glyphSVG(s.chars[0], { width: 6 })),
          el("div", {}, [
            el("div", { class: "h3", text: s.name }),
            el("div", { class: "small muted", text: `${Math.round(overall * 100)}%` }),
          ]),
        ]),
        el("div", { class: "bar bar--slim", style: { width: "100%" } }, [el("div", { class: "bar__i", style: { width: `${Math.round(overall * 100)}%` } })]),
      ]);
    })),
  ]));

  v.append(page);
}

function stat(n, label) {
  return el("div", { class: "stat" }, [el("div", { class: "stat__n", text: String(n) }), el("div", { class: "stat__l", text: label })]);
}

function kanaChip(c, setId, size = "") {
  const rec = progress.get(progress.id(setId, c.char));
  const lvl = progress.levelOf(rec);
  return el("div", {
    class: `kana kana--${size || "sm"} kana--click ${lvl >= 3 ? "kana--done" : ""}`,
    title: `${c.char} — ${c.romaji}`,
    onclick: () => navigate("char", { s: setId, c: c.char }),
  }, [
    el("div", { class: "kana__ch", text: c.char }),
    el("div", { class: "kana__romaji", text: c.romaji }),
  ]);
}

/* -------------------------------------------------------------------- learn */

function renderLearn(v) {
  const page = el("div", { class: "page" }, [
    el("h1", { class: "h1", text: t("learn__title") }),
    el("p", { class: "muted small", text: t("learn__sub") }),
  ]);

  for (const s of sets()) {
    const rows = ROWS_BY_SET[s.id];
    const overall = rows.reduce((a, r) => a + progress.progress(r), 0) / Math.max(1, rows.length);
    const card = el("section", { class: "card", style: { marginTop: "20px" } }, [
      el("div", { class: "between", style: { marginBottom: "12px" } }, [
        el("div", { class: "row", style: { gap: "10px" } }, [
          el("div", { class: "glyph-box", style: { width: "44px", height: "44px", background: "var(--accent-soft)", borderColor: "transparent" } }, [glyphSVG(s.chars[0], { width: 6 })]),
          el("div", {}, [el("h2", { class: "h2", text: s.name }), el("div", { class: "small muted", text: t("learn__kanaCount", { n: s.chars.length }) })]),
        ]),
        el("div", { class: "row", style: { gap: "8px" } }, [
          el("div", { class: "bar bar--slim", style: { width: "90px" } }, [el("div", { class: "bar__i", style: { width: `${Math.round(overall * 100)}%` } })]),
          el("span", { class: "small muted", text: `${Math.round(overall * 100)}%` }),
        ]),
      ]),
    ]);
    const list = el("div", { class: "stack", style: { gap: "10px" } });
    rows.forEach((row, i) => {
      const unlocked = progress.isUnlocked(row);
      const done = progress.rowDone(row);
      const p = Math.round(progress.progress(row) * 100);
      list.append(el("div", {
        class: `card card--click ${unlocked ? "" : "kana--locked"}`,
        style: { padding: "14px 16px", opacity: unlocked ? "1" : ".6" },
        onclick: () => { if (!unlocked) { toast(t("learn__unlock", { pct: 50 }), "warn"); return; } navigate("row", { s: s.id, r: row.id }); },
      }, [
        el("div", { class: "between", style: { marginBottom: "8px" } }, [
          el("div", { class: "row", style: { gap: "10px" } }, [
            el("span", { class: "jp", style: { fontSize: "19px", fontWeight: "600" } }, [row.label]),
            ...(done ? [el("span", { class: "pill pill--good", text: "✓ " + t("learn__done") })] : []),
            ...(!unlocked ? [el("span", { class: "pill", text: "🔒 " + t("learn__locked") })] : []),
          ]),
          el("span", { class: "small muted", text: `${p}%` }),
        ]),
        el("div", { class: "kana-row", style: { gap: "6px" } }, row.chars.slice(0, 12).map((c) => kanaChip(c, s.id, "sm"))),
        el("div", { class: "bar bar--slim", style: { marginTop: "10px" } }, [el("div", { class: `bar__i ${done ? "" : ""}`, style: { width: `${p}%` } })]),
      ]));
    });
    card.append(list);
    page.append(card);
  }
  v.append(page);
}

/* --------------------------------------------------------------- row screen */

function renderRow(v, setId, rowId) {
  const row = rowById(setId, rowId);
  if (!row) { navigate("learn"); return; }
  // opening a row = showing the line, so the learner has "seen" it
  for (const c of row.chars) progress.touch(row.set, c.char);
  progress.syncRows();

  const unlocked = progress.isUnlocked(row);
  if (!unlocked) {
    v.append(el("div", { class: "page" }, [
      el("div", { class: "row", style: { marginBottom: "18px" } }, [
        el("button", { class: "btn btn--icon", onclick: () => navigate("learn"), html: "←" }),
      ]),
      el("div", { class: "card center" }, [
        el("div", { class: "empty__icon", text: "🔒" }),
        el("h2", { class: "h2", style: { marginBottom: "6px" } }, [row.label]),
        el("p", { class: "muted small" }, [t("learn__unlock", { pct: 50 })]),
      ]),
    ]));
    return;
  }

  const p = Math.round(progress.progress(row) * 100);
  const done = progress.rowDone(row);

  v.append(el("div", { class: "page" }, [
    el("div", { class: "row", style: { marginBottom: "16px", gap: "10px" } }, [
      el("button", { class: "btn btn--icon", onclick: () => navigate("learn"), html: "←", title: t("detail__back") }),
      el("div", {}, [
        el("h1", { class: "h1", text: row.label }),
        el("p", { class: "muted small", text: `${setLabel(setId)[I18N.lang]} · ${t("learn__kanaCount", { n: row.chars.length })}` }),
      ]),
    ]),
    el("section", { class: "card" }, [
      el("div", { class: "between", style: { marginBottom: "8px" } }, [
        el("span", { class: "small muted", text: t("learn__rowProgress") }),
        el("span", { class: "small", text: `${p}%` }),
      ]),
      el("div", { class: "bar" }, [el("div", { class: `bar__i ${p >= 85 ? "bar--good" : ""}`, style: { width: `${p}%` } })]),
      ...(done ? [el("div", { class: "pill pill--good", style: { marginTop: "12px" } }, ["✓ " + t("learn__done") ])]
               : [el("p", { class: "small muted", style: { marginTop: "12px" } }, [t("learn__unlock", { pct: 50 })])]),
    ]),
    el("section", { class: "card", style: { marginTop: "16px" } }, [
      el("div", { class: "kana-row kana-row--view", style: { gap: "12px" } }, row.chars.map((c) => kanaChip(c, setId))),
    ]),
    el("div", { class: "row", style: { marginTop: "16px", gap: "10px", flexWrap: "wrap" } }, [
      el("button", { class: "btn btn--primary", onclick: () => navigate("review") }, [t("learn__startReview")]),
      el("button", { class: "btn", onclick: () => navigate("review") }, [t("learn__reviewAll")]),
    ]),
  ]));
}

/* -------------------------------------------------------------- char screen */

let charAnimToken = 0;
let writePadInstance = null;

function renderChar(v, setId, ch) {
  const c = charData(setId, ch);
  if (!c) { navigate("learn"); return; }
  const row = rowById(setId, route.params.r);
  const index = row ? row.chars.findIndex((x) => x.char === ch) : -1;
  const rec = progress.get(progress.id(setId, ch));
  progress.touch(setId, ch);
  progress.syncRows();

  let mode = writePadInstance && writePadInstance.char === c && writePadInstance._setId === setId
    ? writePadInstance.mode : "trace";
  if (writePadInstance && writePadInstance.char !== c) mode = "trace";

  const page = el("div", { class: "page" });
  page.append(el("div", { class: "row", style: { marginBottom: "16px", gap: "10px" } }, [
    el("button", { class: "btn btn--icon", onclick: () => navigate("row", { s: setId, r: row.id }), html: "←", title: t("detail__back") }),
    el("div", {}, [
      el("h1", { class: "h1", text: ch }),
      el("p", { class: "muted small" }, [
        `${setLabel(setId)[I18N.lang]} · ${row ? row.label : ""}`,
        index >= 0 ? ` · ${index + 1} ${t("common__of")} ${row.chars.length}` : "",
      ]),
    ]),
  ]));

  const glyphBox = el("div", { class: "glyph-box", style: { aspectRatio: "1", maxHeight: "300px", margin: "0 auto", width: "min(78vw, 300px)" } });
  page.append(glyphBox);
  const svg = glyphSVG(c, { width: Math.max(2.6, Math.min(fitBox(c).w, fitBox(c).h) * 0.03) });
  svg.style.color = "var(--ink)";
  glyphBox.append(svg);
  page.append(el("div", { class: "center", style: { marginTop: "-8px" } }, [
    el("div", { class: "row", style: { gap: "8px", justifyContent: "center" } }, [
      el("span", { class: "pill pill--accent jp", style: { fontSize: "15px", padding: "4px 14px" } }, [c.romaji]),
      el("button", { class: "btn btn--sm", onclick: () => speak(ch) }, [
        `🔊 ${t("detail__listen")}`,
      ]),
    ]),
  ]));

  // stroke counter + replay
  const counter = el("span", { class: "small muted", text: `${c.strokes.length} ${t("detail__strokes")}` });
  const replayBtn = el("button", { class: "btn btn--sm", onclick: () => playStrokes(svg, counter, replayBtn, c) }, [t("detail__replay")]);
  page.append(el("div", { class: "row", style: { marginTop: "16px", gap: "10px", justifyContent: "center" } }, [counter, replayBtn]));

  playStrokes(svg, counter, replayBtn, c);

  // toggles: show/hide all + practice mode
  let allVisible = false;
  const modeBox = el("div", { class: "row", style: { gap: "8px", justifyContent: "center", marginTop: "14px", flexWrap: "wrap" } });
  const tLabel = t("detail__showAll");
  const tLabelOff = t("detail__hideAll");
  const tBtn = el("button", { class: "btn btn--sm", onclick: () => { allVisible = !allVisible; setStrokesVisible(svg, allVisible ? null : new Set()); tBtn.textContent = allVisible ? tLabelOff : tLabel; } }, [tLabel]);
  modeBox.append(tBtn,
    el("button", { class: `btn btn--sm ${mode === "trace" ? "btn--primary" : ""}`, onclick: () => { mode = "trace"; rebuildPad(); } }, [t("detail__trace")]),
    el("button", { class: `btn btn--sm ${mode === "free" ? "btn--primary" : ""}`, onclick: () => { mode = "free"; rebuildPad(); } }, [t("detail__free")]),
  );
  page.append(modeBox);

  const padHost = el("div", { class: "writepad", style: { marginTop: "16px" } });
  page.append(padHost);
  page.append(el("p", { class: "center small muted", style: { marginTop: "10px" } }, [mode === "trace" ? t("detail__traceHint") : t("detail__freeHint")]));
  const toolbar = el("div", { class: "writepad__toolbar" }, [
    el("button", { class: "btn btn--sm", onclick: () => { if (writePadInstance) { writePadInstance.clear(); scoreHost.innerHTML = ""; } } }, [t("practice__cancelDraw")]),
    el("button", { class: "btn btn--sm btn--primary", onclick: checkDraw }, [t("practice__check")]),
  ]);
  page.append(toolbar);
  const scoreHost = el("div", { style: { marginTop: "12px" } });
  page.append(scoreHost);

  if (index >= 0 && index < row.chars.length - 1) {
    page.append(el("div", { class: "row", style: { marginTop: "18px", justifyContent: "center" } }, [
      el("button", { class: "btn btn--primary", onclick: () => navigate("char", { s: setId, r: row.id, c: row.chars[index + 1].char }) }, [t("detail__nextChar")]),
    ]));
  }

  v.append(page);

  function rebuildPad() {
    if (writePadInstance) { writePadInstance.destroy(); writePadInstance = null; }
    padHost.innerHTML = "";
    scoreHost.innerHTML = "";
    const canvas = document.createElement("canvas");
    padHost.append(canvas);
    writePadInstance = new WritePad(canvas, c, { mode, box: fitBox(c) });
    writePadInstance._setId = setId;
  }

  function checkDraw() {
    if (!writePadInstance || !writePadInstance.strokesDrawn) return;
    const m = writePadInstance.measure();
    const pct = Math.round(m.score * 100);
    scoreHost.innerHTML = "";
    scoreHost.append(el("div", { class: `pill ${pct >= 85 ? "pill--good" : pct >= 65 ? "pill--warn" : "pill--bad"}` }, [
      `${pct}% · ${m.dir >= 0.6 ? "✓" : "↕"}`,
    ]));
    const rev = pct >= 85 ? 5 : pct >= 65 ? 3 : (pct >= 40 ? 1 : 0);
    progress.grade(progress.id(setId, ch), rev);
    toast(pct >= 85 ? t("practice__great") : pct >= 65 ? t("practice__good") : t("practice__tryAgain"),
      pct >= 85 ? "good" : pct >= 65 ? "" : "bad");
    if (pct < 65) {
      scoreHost.append(el("div", { class: "small muted center", style: { marginTop: "8px" } }, [t("practice__tryAgain")]));
    } else {
      scoreHost.append(el("div", { class: "small muted center", style: { marginTop: "8px" } }, [t("practice__great") + " " + t("practice__next")]));
    }
  }

  rebuildPad();
}

function playStrokes(svg, counterEl, btn, c) {
  const token = ++charAnimToken;
  const paths = [...svg.querySelectorAll("path.g")];
  paths.forEach((p) => { p.style.transition = "none"; p.style.strokeDasharray = "none"; p.style.strokeDashoffset = "0"; });
  if (btn) btn.disabled = true;
  counterEl.textContent = `${t("detail__stroke", { n: 1, total: paths.length })}`;
  animateStrokes(svg, {
    duration: 460, gap: 90,
    onStroke: (n, total) => { if (token === charAnimToken) counterEl.textContent = t("detail__stroke", { n, total }); },
  }).then(() => {
    if (token === charAnimToken && btn) btn.disabled = false;
  });
}

/* -------------------------------------------------------------------- review */

let session = null;

function ensureSession() {
  if (!session || session.done) {
    const queue = progress.buildQueue(ROWS_BY_SET, Date.now(),
      { limit: settings.get("reviewLimit") || 22, newPerDay: settings.get("newPerDay") || 10 });
    session = {
      items: queue.map((q, i) => ({ ...q, type: pickType(q, i) })),
      index: 0, correct: 0, answered: false, results: [],
    };
    if (!session.items.length) session.done = true;
  }
  return session;
}

function pickType(q, i) {
  const rec = progress.get(q.id);
  const a = (rec && rec.attempts) || 0;
  if (a === 0) return "read";
  if (a === 1) return "write";
  return ["read", "write", "type"][(a + i) % 3];
}

function renderReview(v) {
  const hasAny = Object.keys(progress.state.chars).length > 0;
  if (!hasAny) {
    v.append(emptyReview());
    return;
  }
  const s = ensureSession();
  if (s.done || s.index >= s.items.length) { renderSessionDone(v); return; }
  renderCard(v, s);
}

function emptyReview() {
  return el("div", { class: "page" }, [
    el("h1", { class: "h1", text: t("practice__title") }),
    el("p", { class: "muted small", text: t("practice__sub") }),
    el("section", { class: "card center", style: { marginTop: "24px" } }, [
      el("div", { class: "empty__icon", text: "🗂️" }),
      el("h2", { class: "h2", style: { marginBottom: "6px" } }, [t("practice__empty")]),
      el("p", { class: "muted small", style: { marginBottom: "16px" } }, [t("practice__emptySub")]),
      el("button", { class: "btn btn--primary", onclick: () => navigate("learn") }, [t("practice__emptyBtn")]),
    ]),
  ]);
}

function renderSessionDone(v) {
  const s = session || { items: [], correct: 0, results: [] };
  const acc = s.results.length ? Math.round((s.results.filter((r) => r.ok).length / s.results.length) * 100) : 0;
  v.append(el("div", { class: "page" }, [
    el("section", { class: "card center", style: { marginTop: "20px" } }, [
      el("div", { class: "empty__icon", text: "🎉" }),
      el("h1", { class: "h1", style: { marginBottom: "4px" } }, [t("practice__sessionDone")]),
      el("p", { class: "muted small", style: { marginBottom: "20px" } }, [t("practice__sessionDoneSub", { n: s.results.length, acc })]),
      el("div", { class: "row", style: { gap: "10px", justifyContent: "center", flexWrap: "wrap" } }, [
        el("button", { class: "btn btn--primary", onclick: () => { session = null; navigate("review"); } }, [t("practice__again")]),
        el("button", { class: "btn", onclick: () => { session = null; navigate("home"); } }, [t("practice__backHome")]),
      ]),
    ]),
    el("section", { class: "card", style: { marginTop: "18px" } }, [
      el("h2", { class: "h2", style: { marginBottom: "12px" } }, [t("home__planSub", { n: dueCount() })]),
      el("div", { class: "row", style: { gap: "8px" } }, [
        el("button", { class: "btn btn--sm btn--primary", onclick: () => { session = null; navigate("learn"); } }, [t("home__start")]),
        el("button", { class: "btn btn--sm", onclick: () => navigate("chat") }, [t("nav__chat")]),
      ]),
    ]),
  ]));
}

function renderCard(v, s) {
  const item = s.items[s.index];
  const c = { char: item.char, romaji: item.romaji, strokes: charData(item.set, item.char).strokes, set: item.set };
  const card = el("div", { class: "quiz page" });

  // progress dots
  const dots = el("div", { class: "progress-dots" });
  for (let i = 0; i < s.items.length; i++) {
    dots.append(el("i", { class: i < s.index ? "done" : i === s.index ? "on" : "" }));
  }
  card.append(dots);

  const body = el("div", { class: "card card--pad" });
  card.append(body);
  body.append(el("div", { class: "quiz__q", text: qText(item.type) }));

  const answerArea = el("div", { style: { marginTop: "16px" } });
  body.append(answerArea);

  const finish = () => {
    if (s.answered) return;
    s.answered = true;
    s.results.push({ ok: s.lastOk, type: item.type });
    const nxt = () => { s.index++; s.answered = false; s.lastOk = null; render(); };
    const fin = el("div", { class: "row", style: { gap: "10px", justifyContent: "center", marginTop: "18px" } }, [
      el("button", { class: "btn btn--primary", onclick: nxt }, [t("practice__next")]),
    ]);
    answerArea.append(fin);
  };

  const reveal = (text, kind) => {
    answerArea.append(el("div", { class: `pill ${kind}`, style: { marginBottom: "12px" } }, [text]));
  };

  // ---- card types
  if (item.type === "read") {
    const gbox = el("div", { class: "quiz__glyph" });
    gbox.append(glyphSVG(c, { width: Math.max(2.6, Math.min(fitBox(c).w, fitBox(c).h) * 0.03) }));
    body.append(gbox);
    const pool = DATA.sets.flatMap((set) => set.chars.filter((x) => x.note === "" || x.note === "voiced" || x.note === "p"))
      .concat(DATA.sets.flatMap((set) => set.chars));
    const opts = [item.romaji, ...distractors(item.romaji, 3, pool)].slice(0, 4);
    const grid = el("div", { class: "choices" });
    for (const o of opts) {
      grid.append(el("button", {
        class: "choice",
        onclick: (e) => {
          if (s.answered) return;
          const ok = o === item.romaji;
          s.lastOk = ok;
          s.correct += ok ? 1 : 0;
          progress.grade(item.id, ok ? 5 : 1);
          [...grid.children].forEach((b) => {
            b.classList.add("choice--disabled");
            b.classList.remove("choice--ok", "choice--no");
            if (b.textContent === item.romaji) b.classList.add("choice--ok");
            else if (b === e.target) b.classList.add("choice--no");
          });
          reveal(ok ? t("practice__correct") : t("practice__answer") + ": " + item.romaji, ok ? "pill--good" : "pill--bad");
          speak(item.char);
          finish();
        },
      }, [o]));
    }
    answerArea.append(grid);
  } else if (item.type === "type") {
    const gbox = el("div", { class: "quiz__glyph" });
    gbox.append(glyphSVG(c, { width: Math.max(2.6, Math.min(fitBox(c).w, fitBox(c).h) * 0.03) }));
    body.append(gbox);
    const input = el("input", { class: "input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: t("practice__typeHint") });
    answerArea.append(input);
    const checkBtn = el("button", { class: "btn btn--primary btn--block", style: { marginTop: "12px" }, onclick: () => {
      const ok = normalizeRomaji(input.value) && readings(item.romaji).includes(normalizeRomaji(input.value));
      s.lastOk = ok; s.correct += ok ? 1 : 0;
      progress.grade(item.id, ok ? 5 : 1);
      checkBtn.disabled = true;
      input.disabled = true;
      reveal(ok ? t("practice__correct") + " · " + item.char : t("practice__wrong") + " — " + item.char + " (" + item.romaji + ")", ok ? "pill--good" : "pill--bad");
      if (ok) speak(item.char);
      finish();
    } }, [t("practice__check")]);
    answerArea.append(checkBtn);
    setTimeout(() => input.focus(), 40);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") checkBtn.click(); });
  } else {
    // write
    answerArea.append(el("div", { class: "quiz__romaji", text: item.romaji }));
    const padHost = el("div", { class: "writepad", style: { marginTop: "18px" } });
    answerArea.append(padHost);
    answerArea.append(el("p", { class: "center small muted", style: { marginTop: "10px" } }, [t("detail__traceHint")]));
    const tb = el("div", { class: "writepad__toolbar" }, [
      el("button", { class: "btn btn--sm", onclick: () => { pad.clear(); res.innerHTML = ""; } }, [t("practice__cancelDraw")]),
      el("button", { class: "btn btn--sm btn--primary", onclick: () => {
        if (!pad.strokesDrawn) return;
        const m = pad.measure();
        const pct = Math.round(m.score * 100);
        const ok = pct >= 65;
        s.lastOk = ok; s.correct += ok ? 1 : 0;
        const q = pct >= 88 ? 5 : pct >= 70 ? 4 : pct >= 55 ? 3 : pct >= 35 ? 1 : 0;
        progress.grade(item.id, q);
        res.innerHTML = "";
        res.append(el("div", { class: `pill ${ok ? "pill--good" : "pill--bad"}` }, [`${pct}%`]));
        if (!ok) res.append(el("div", { class: "small muted center", style: { marginTop: "8px" } }, [t("practice__tryAgain")]));
        tb.querySelectorAll("button").forEach((b) => (b.disabled = true));
        reveal(ok ? t("practice__great") : t("practice__answer") + ": " + item.char, ok ? "pill--good" : "pill--bad");
        finish();
      } }, [t("practice__check")]),
    ]);
    answerArea.append(tb);
    const res = el("div", { style: { marginTop: "12px", textAlign: "center" } });
    answerArea.append(res);

    const canvas = document.createElement("canvas");
    padHost.append(canvas);
    const rec = progress.get(item.id);
    const pad = new WritePad(canvas, c, { mode: (rec && rec.seen > 1) ? "free" : "trace", box: fitBox(c) });
  }

  v.append(card);
  setTimeout(() => { if (!s.answered) { /* no auto-focus for read cards */ } }, 0);
}

function qText(type) {
  if (type === "read") return t("practice__readQ");
  if (type === "write") return t("practice__writeQ");
  return t("practice__typeHint");
}

function normalizeRomaji(s) {
  return String(s || "").trim().toLowerCase().replace(/[\s.,!?-]/g, "");
}

/* --------------------------------------------------------------------- chat */

function renderChat(v) {
  const enabled = chatEnabled();
  const page = el("div", { class: "page" }, [
    el("h1", { class: "h1", text: t("chat__title") }),
    el("p", { class: "muted small", text: t("chat__sub") }),
  ]);

  const log = el("div", { class: "chat__log", style: { marginTop: "16px", maxHeight: "min(60vh, 560px)" } });
  page.append(el("div", { class: "chat" }, [
    log,
    el("div", { class: "chat__compose" }, [
      el("input", { class: "input", type: "text", id: "chat-input", placeholder: t("chat__placeholder"), autocomplete: "off" }),
      el("button", { class: "btn btn--primary", id: "chat-send", onclick: sendChat }, [t("chat__send")]),
    ]),
  ]));

  const history = progress.state.chat;
  if (!history.length) {
    addMsg(log, "ai", t("chat__welcome"));
  }
  for (const m of history) addMsg(log, m.role, m.text);
  scrollChat(log);

  if (!enabled) {
    page.append(el("section", { class: "card", style: { marginTop: "16px" } }, [
      el("h2", { class: "h2", style: { marginBottom: "6px" } }, [t("chat__disabledTitle")]),
      el("p", { class: "muted small", style: { marginBottom: "14px" } }, [t("chat__disabledBody")]),
      el("button", { class: "btn btn--primary", onclick: () => navigate("settings") }, [t("chat__enable")]),
      el("p", { class: "small muted", style: { marginTop: "12px" } }, [t("chat__noKey")]),
    ]));
  }

  v.append(page);
  const input = document.getElementById("chat-input");
  if (input) {
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
    setTimeout(() => { if (!enabled) input.disabled = true; }, 0);
  }
}

function scrollChat(log) { requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; }); }

function addMsg(log, role, text) {
  const who = role === "user" ? "あ" : "あ";
  const av = el("div", { class: "msg__avatar jp", text: who });
  const bubble = el("div", { class: "msg__bubble", html: formatMsg(text) });
  log.append(el("div", { class: `msg msg--${role}` }, [av, bubble]));
  scrollChat(log);
}

function formatMsg(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, '<span class="kbd">$1</span>');
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  if (!input || !sendBtn) return;
  const log = document.querySelector(".chat__log");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  if (!chatEnabled()) { navigate("settings"); return; }

  addMsg(log, "user", text);
  progress.addChat({ role: "user", text });

  const avatar = el("div", { class: "msg__avatar jp", text: "あ" });
  const bubble = el("div", { class: "msg__bubble" });
  const row = el("div", { class: "msg msg--ai", "data-streaming": "1" }, [avatar, bubble]);
  log.append(row);
  scrollChat(log);

  sendBtn.disabled = true;
  let acc = "";
  try {
    await sendMessage(text, progress.state.chat, studyContext(), {
      onDelta: (_d, full) => {
        acc = full;
        bubble.innerHTML = formatMsg(full);
        scrollChat(log);
      },
    });
    bubble.innerHTML = formatMsg(acc);
    progress.addChat({ role: "ai", text: acc });
  } catch (e) {
    row.remove();
    if (e.message === "no-key") { toast(t("chat__noKey"), "bad"); navigate("settings"); return; }
    const msg = e.message === "bad-key" ? t("settings__geminiBad")
      : e.message === "chat-disabled" ? t("chat__disabledTitle")
      : "Ошибка: " + e.message;
    addMsg(log, "ai", "⚠️ " + msg);
    progress.addChat({ role: "ai", text: "⚠️ " + msg });
  } finally {
    sendBtn.disabled = false;
    const inp = document.getElementById("chat-input");
    if (inp) inp.focus();
  }
}

/* ---------------------------------------------------------------- settings */

function renderSettings(v) {
  const page = el("div", { class: "page" }, [
    el("h1", { class: "h1", text: t("settings__title") }),
  ]);

  // appearance
  const langSel = el("select", { class: "select", onchange: (e) => {
    I18N.setLang(e.target.value); settings.applyTheme(); buildNav(); render();
  } }, SUPPORTED.map((l) => el("option", { value: l, text: LANGS[l].label, selected: l === I18N.lang })));
  const themeSel = el("select", { class: "select", onchange: (e) => { settings.set("theme", e.target.value); settings.applyTheme(); } },
    THEMES.map((t) => el("option", { value: t.id, text: t.label[I18N.lang], selected: t.id === settings.get("theme") })));

  page.append(el("section", { class: "card", style: { marginTop: "16px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "10px" } }, [t("settings__appearance")]),
    settingRow(t("settings__lang"), "", langSel),
    settingRow(t("settings__theme"), "", themeSel),
  ]));

  // speech
  const voices = voiceList();
  const voiceSel = el("select", { class: "select", onchange: (e) => settings.set("voice", e.target.value) },
    [el("option", { value: "auto", text: t("settings__voiceAuto"), selected: settings.get("voice") === "auto" }),
     el("option", { value: "none", text: t("settings__voiceNone"), selected: settings.get("voice") === "none" }),
     ...voices.map((x) => el("option", { value: x.name, text: x.label, selected: settings.get("voice") === x.name }))]);
  page.append(el("section", { class: "card", style: { marginTop: "16px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "4px" } }, [t("settings__speech")]),
    el("p", { class: "small muted", style: { marginBottom: "6px" } }, [t("settings__speechSub")]),
    settingRow("", t("settings__voiceAuto"), voiceSel),
    el("div", { class: "row", style: { marginTop: "12px" } }, [
      el("button", { class: "btn btn--sm", onclick: () => speak("あいうえお") }, ["🔊 あいうえお"]),
      el("button", { class: "btn btn--sm", onclick: () => speakRomaji("shi") }, ["🔊 shi"]),
    ]),
  ]));

  // gemini
  const keyInput = el("input", { class: "input", type: "password", id: "gemini-key", placeholder: t("settings__geminiKeyPh"),
    value: settings.get("geminiKey"), autocomplete: "off", spellcheck: "false" });
  const modelInput = el("input", { class: "input", type: "text", id: "gemini-model", placeholder: "gemini-2.0-flash",
    value: settings.get("geminiModel") });
  const testBtn = el("button", { class: "btn btn--sm", onclick: async () => {
    const key = document.getElementById("gemini-key").value.trim();
    testBtn.disabled = true;
    testBtn.textContent = "…";
    const ok = await testKey(key);
    testBtn.disabled = false;
    testBtn.textContent = t("settings__geminiTest");
    toast(ok ? t("settings__geminiOk") : t("settings__geminiBad"), ok ? "good" : "bad");
  } }, [t("settings__geminiTest")]);

  page.append(el("section", { class: "card", style: { marginTop: "16px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "4px" } }, [t("settings__gemini")]),
    el("p", { class: "small muted", style: { marginBottom: "6px" } }, [t("settings__geminiSub")]),
    settingRow(t("settings__geminiKey"), "", keyInput),
    settingRow(t("settings__geminiModel"), t("settings__geminiModelSub"), modelInput),
    el("div", { class: "row", style: { marginTop: "14px" } }, [
      testBtn,
      el("span", { class: "small muted", id: "gemini-state", text: settings.get("geminiKey") ? "🔑" : "—" }),
    ]),
    el("p", { class: "small muted", style: { marginTop: "12px" } }, [t("chat__keyHint")]),
    (() => {
      keyInput.addEventListener("input", () => {
        settings.set("geminiKey", keyInput.value.trim());
        API.chatKey = settings.get("geminiKey");
        const st = document.getElementById("gemini-state");
        if (st) st.textContent = keyInput.value.trim() ? "🔑" : "—";
      });
      modelInput.addEventListener("change", () => settings.set("geminiModel", modelInput.value.trim()));
      return null;
    })(),
  ]));

  // data
  page.append(el("section", { class: "card", style: { marginTop: "16px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "4px" } }, [t("settings__data")]),
    el("p", { class: "small muted", style: { marginBottom: "6px" } }, [t("settings__dataSub")]),
    el("div", { class: "row", style: { gap: "8px", flexWrap: "wrap" } }, [
      el("button", { class: "btn btn--sm", onclick: exportProgress }, [t("settings__export")]),
      el("button", { class: "btn btn--sm", onclick: importProgress }, [t("settings__import")]),
      el("button", { class: "btn btn--sm btn--danger", onclick: () => {
        modal(t("settings__reset"), t("settings__resetWarn"), [
          { label: t("settings__cancel") },
          { label: t("settings__resetBtn"), danger: true, fn: () => { progress.reset(); session = null; toast(t("settings__saved")); navigate("home"); } },
        ]);
      } }, [t("settings__reset")]),
    ]),
    el("div", { class: "divider", style: { margin: "14px 0" } }),
    el("div", { class: "setting" }, [
      el("div", { class: "setting__t" }, [
        el("b", { text: t("settings__server") }),
        el("span", { text: API.online ? t("settings__serverOn") : t("settings__serverOff") }),
      ]),
      el("div", { class: "setting__v" }, [el("span", { class: `pill ${API.online ? "pill--good" : ""}`, text: API.online ? "●" : "○" })]),
    ]),
  ]));

  // about
  page.append(el("section", { class: "card", style: { marginTop: "16px" } }, [
    el("h2", { class: "h2", style: { marginBottom: "6px" } }, [t("settings__about")]),
    el("p", { class: "small muted", style: { marginBottom: "12px" } }, [t("settings__aboutSub")]),
    el("a", { class: "small", href: "https://github.com/wisoqu/Learn-Japanese", target: "_blank", rel: "noopener", text: t("settings__source") }),
    el("p", { class: "small muted", style: { marginTop: "10px" } }, [t("settings__credits")]),
  ]));

  v.append(page);
}

function settingRow(title, sub, control) {
  return el("div", { class: "setting" }, [
    el("div", { class: "setting__t" }, [
      el("b", { text: title }),
      sub ? el("span", { text: sub }) : null,
    ]),
    el("div", { class: "setting__v" }, [control]),
  ]);
}

function exportProgress() {
  const data = progress.serialize();
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `kana-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t("settings__saved"), "good");
}

function importProgress() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        progress.replace(fr.result);
        session = null;
        toast(t("settings__saved"), "good");
        render();
      } catch (e) { toast("Файл не подходит", "bad"); }
    };
    fr.readAsText(f);
  };
  input.click();
}

/* --------------------------------------------------------------- sync loop */

let syncing = false;
async function syncLoop() {
  if (!settings.get("sync")) { API.online = false; return; }
  if (!(await API.check())) { return; }
  if (API.online === false) { toast("Сервер найден — включена синхронизация", "good"); }
  if (syncing) return;
  syncing = true;
  try {
    const remote = await API.pullProgress();
    if (remote && remote.stats && remote.stats.lastSync && remote.stats.lastSync > (progress.state.stats.lastSync || 0)) {
      progress.state = Object.assign(progress.state, remote);
      progress.save(true);
    }
    await API.pushProgress(progress.state);
  } catch (_) {}
  syncing = false;
}

/* ------------------------------------------------------------------- export */

export { render, navigate, syncLoop };
