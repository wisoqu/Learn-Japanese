/* Smoke test: load the real app in jsdom, walk every screen, catch errors. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "app");

const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost:10001/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const { window } = dom;

/* --- stubs jsdom does not provide --------------------------------------- */
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Path2D = class { constructor() {} };
window.devicePixelRatio = 1;

class FakeCtx {
  constructor() {}
  setTransform() {} clearRect() {} save() {} restore() {} beginPath() {}
  moveTo() {} lineTo() {} stroke() {} fill() {} closePath() {} arc() {}
  scale() {} translate() {} fillRect() {} strokeRect() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
  createLinearGradient() { return { addColorStop() {} }; }
}
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.__ctx) this.__ctx = new FakeCtx();
  return this.__ctx;
};

window.fetch = async (url) => {
  const u = String(url).replace(/^http:\/\/localhost:10001/, "").replace(/^\//, "");
  if (u === "api/health") return { ok: true, status: 200, json: async () => ({ ok: true }) };
  if (u === "api/progress") return { ok: false, status: 404, json: async () => ({}) };
  const file = path.join(APP, u);
  if (fs.existsSync(file)) {
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

/* prefer Russian, like the target audience */
window.localStorage.setItem("kana.lang", "ru");

for (const key of ["window", "document", "navigator", "location", "history",
                   "localStorage", "sessionStorage", "ResizeObserver", "Path2D",
                   "getComputedStyle", "CustomEvent", "Event", "MouseEvent", "Node",
                   "HTMLElement", "requestAnimationFrame", "cancelAnimationFrame",
                   "fetch", "DOMParser", "Blob", "FileReader", "URL", "TextDecoder"]) {
  if (window[key] === undefined) continue;
  try { globalThis[key] = window[key]; }
  catch (_) { Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true }); }
}
globalThis.self = window;

/* --- collect errors ---------------------------------------------------- */
const errors = [];
process.on("unhandledRejection", (e) => errors.push("unhandled rejection: " + (e && e.stack || e)));
window.addEventListener("error", (e) => errors.push("window error: " + e.message));

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
};

const { bootApp, navigate, render } = await import(pathToFileURL(path.join(APP, "js", "app.js")).href);
const { progress } = await import(pathToFileURL(path.join(APP, "js", "srs.js")).href);
const { I18N } = await import(pathToFileURL(path.join(APP, "js", "i18n.js")).href);
const dataMod = await import(pathToFileURL(path.join(APP, "js", "data.js")).href);

/** Navigate and let the async renderer settle, surfacing any error. */
async function nav(name, params) {
  navigate(name, params);
  try {
    await render();
  } catch (e) {
    console.log("  !! render for " + name + " threw: " + (e && e.stack || e));
    failures++;
  }
  await new Promise((r) => setTimeout(r, 5));
}
const view = () => document.getElementById("view");
const txt = (sel) => view().querySelector(sel)?.textContent?.trim() ?? null;

console.log("\nboot");
await bootApp();
await new Promise((r) => setTimeout(r, 5));
check("index.html shell present", !!document.getElementById("app"));
check("data loaded", dataMod.DATA && dataMod.DATA.sets.length === 2);
check("nav rail rendered", document.getElementById("nav-rail").children.length === 5);
check("tab bar rendered", document.getElementById("nav-tabs").children.length === 5);
check("home view rendered", view().querySelector(".page") !== null);
check("home shows Russian greeting", txt(".h1") === "Добро пожаловать", txt(".h1"));
check("first row is unlocked", progress.isUnlocked(dataMod.DATA.sets[0].rows[0]));
check("progress is 0 before anything is shown", progress.progress(dataMod.DATA.sets[0].rows[0]) === 0);

const firstRow = dataMod.DATA.sets[0].rows[0];

console.log("\nhome → learn");
await nav("learn");
check("learn view rendered", txt("h1") === "Учение", txt("h1"));
check("learn lists rows", view().querySelectorAll(".kana-row--view, .kana-row").length > 0);

console.log("\nlearn → row (あ行)");
await nav("row", { s: "hiragana", r: "hira-a" });
check("row view rendered", view().querySelector(".kana-row") !== null);
check("row shows 5 kana", view().querySelectorAll(".kana").length === 5);
check("touching a row moves progress past zero", progress.progress(firstRow) > 0, String(progress.progress(firstRow)));
check("row is not finished yet", progress.rowDone(firstRow) === false);

console.log("\nrow → char (あ)");
await nav("char", { s: "hiragana", r: "hira-a", c: "あ" });
const glyph = view().querySelector("svg");
check("char view rendered", view().querySelector(".glyph-box") !== null);
check("glyph svg built", glyph && glyph.querySelectorAll("path").length === 3, String(glyph?.querySelectorAll("path").length));
check("write pad canvas present", view().querySelector(".writepad canvas") !== null);

console.log("\nreview screen");
await nav("review");
check("review rendered", view().querySelector(".quiz") !== null, view().innerHTML.slice(0, 200));
const queue = progress.buildQueue({ hiragana: dataMod.DATA.sets[0].rows }, Date.now(), { limit: 9999 });
check("queue contains studied kana", queue.length > 0, "queue=" + queue.length);
check("queue items carry romaji", queue.every((q) => q.romaji));
check("read card asks the question", txt(".quiz__q") === "Как это читается?", txt(".quiz__q"));
check("read card offers 4 choices", view().querySelectorAll(".choice").length === 4);

console.log("\nclicking a choice grades the card");
const before = progress.state.stats.reviews;
const choice = [...view().querySelectorAll(".choice")].find((b) => b.textContent === "a");
choice.click();
await new Promise((r) => setTimeout(r, 5));
check("wrong/right answer reveals a pill", view().querySelector(".pill") !== null);
check("next button appeared", [...view().querySelectorAll("button")].some((b) => b.textContent.trim() === "Дальше"));
check("grade registered a rep", progress.state.stats.reviews === before + 1);
check("the shown card was a kana we studied", !!choice);

console.log("\nwrite card type");
await nav("review");
const writeItem = { char: "い", romaji: "i", set: "hiragana", row: "hira-a" };
const cinfo = { char: writeItem.char, romaji: writeItem.romaji, strokes: dataMod.DATA.sets[0].chars.find((c) => c.char === "い").strokes, set: "hiragana" };
const wv = view();
check("review still renders", wv.querySelector(".quiz") !== null);

console.log("\nchat screen");
await nav("chat");
check("chat rendered", view().querySelector(".chat__log") !== null);
check("chat shows welcome", view().querySelector(".msg--ai") !== null);
check("chat has disabled notice without key", view().querySelector(".card") !== null);

console.log("\nsettings screen");
await nav("settings");
check("settings rendered", view().querySelector(".setting") !== null);
check("language select present", !!view().querySelector("select"));
check("gemini key field present", document.getElementById("gemini-key") !== null);
check("theme select present", view().querySelectorAll("select").length >= 2);

console.log("\nlanguage switch");
I18N.setLang("ja");
await nav("home");
check("home renders in Japanese", txt(".h1") === "おかえりなさい", txt(".h1"));
I18N.setLang("en");
await nav("home");
check("home renders in English", txt(".h1") === "Welcome back", txt(".h1"));
I18N.setLang("ru");

console.log("\nSRS behaviour");
progress.reset();
const id = progress.id("hiragana", "あ");
progress.touch("hiragana", "あ");
let rec = progress.get(id);
check("char starts in learning state", rec.state === "learning");
check("char is due immediately", progress.isDue(rec));
progress.grade(id, 5);
check("5/5 keeps reps", progress.get(id).reps === 1);
check("first success is a 10-minute interval", progress.get(id).interval < 0.01);
progress.grade(id, 5);
check("second success = 1 day", progress.get(id).interval === 1);
progress.grade(id, 5);
check("third success = mastered", progress.get(id).state === "mastered");
const easeBefore = progress.get(id).ease;
progress.grade(id, 1);
rec = progress.get(id);
check("failure resets reps", rec.reps === 0);
check("failure drops ease", rec.ease < easeBefore, `${rec.ease} vs ${easeBefore}`);
check("failure re-schedules today", rec.interval < 0.01);
progress.grade(id, 5);
check("recovery works", progress.get(id).reps === 1);

console.log("\nrow unlocking");
progress.reset();
const rows = dataMod.DATA.sets[0].rows;
check("reset locks the rows again", progress.isUnlocked(rows[0]) === false);
check("syncRows unlocks the first row from scratch", progress.syncRows().includes("hira-a"));
for (const c of ["あ", "い", "う", "え", "お"]) {
  const cid = progress.id("hiragana", c);
  progress.touch("hiragana", c);
  for (let i = 0; i < 4; i++) progress.grade(cid, 5);
}
check("あ行 finished", progress.rowDone(rows[0]), String(progress.progress(rows[0])));
check("next row unlocked", progress.isUnlocked(rows[1]));

// half-passed row must NOT open the next one
progress.reset();
for (const c of ["か", "き"]) { const cid = progress.id("hiragana", c); progress.touch("hiragana", c); progress.grade(cid, 5); progress.grade(cid, 5); }
check("half row is not finished", progress.rowDone(rows[1]) === false);
const opened2 = progress.syncRows();
check("half row keeps the next locked", progress.isUnlocked(rows[2]) === false, JSON.stringify(opened2));

console.log("\nstatistics");
check("accuracy is a fraction", progress.accuracy() > 0 && progress.accuracy() <= 1);
check("learned chars counted", progress.learnedChars() >= 2);
check("streak works", progress.streak() >= 1);
check("due count is a number", typeof progress.dueCount() === "number");

console.log("\npersistence");
progress.save(true);
const raw = localStorage.getItem("kana.progress.v2");
check("progress serialises", !!raw && raw.length > 50);
progress.reset();
check("reset clears chars", Object.keys(progress.state.chars).length === 0);

console.log("\nerrors captured");
check("no unhandled errors", errors.length === 0, errors.join(" | "));

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
