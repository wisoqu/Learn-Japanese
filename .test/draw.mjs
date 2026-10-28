/* Real-canvas test for the drawing scorer: trace a character, score it. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { createCanvas, Path2D as NPath2D } from "@napi-rs/canvas";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "app");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:10001/", pretendToBeVisual: true, runScripts: "outside-only",
});
const { window } = dom;

window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.devicePixelRatio = 1;

/* --- real canvas behind every <canvas> --------------------------------- */
window.HTMLCanvasElement.prototype.getContext = function () {
  const wantW = this.width || 300;
  const wantH = this.height || 150;
  if (this.__ctx && this.__real && this.__real.width === wantW && this.__real.height === wantH) {
    return this.__ctx;
  }
  const real = createCanvas(wantW, wantH);
  this.__real = real;
  this.__ctx = real.getContext("2d");
  return this.__ctx;
};

for (const key of ["window", "document", "navigator", "location", "history",
                   "localStorage", "sessionStorage", "ResizeObserver",
                   "getComputedStyle", "Event", "Node", "HTMLElement",
                   "requestAnimationFrame", "cancelAnimationFrame", "fetch", "DOMParser", "TextDecoder"]) {
  if (window[key] === undefined) continue;
  try { globalThis[key] = window[key]; }
  catch (_) { Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true }); }
}
globalThis.Path2D = NPath2D;
globalThis.self = window;

/* --- load the dictionary ------------------------------------------------ */
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => JSON.parse(fs.readFileSync(path.join(APP, "data", "kana.json"), "utf8")),
});

const strokesMod = await import(pathToFileURL(path.join(APP, "js", "strokes.js")).href);
const dataMod = await import(pathToFileURL(path.join(APP, "js", "data.js")).href);
await dataMod.loadData();

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
};

/* --- fake pointer helpers ---------------------------------------------- */
function makePad(charData) {
  const host = document.createElement("div");
  host.style.width = "300px"; host.style.height = "300px";
  const rect = () => ({ width: 300, height: 300, left: 0, top: 0, right: 300, bottom: 300 });
  host.getBoundingClientRect = rect;
  document.body.append(host);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = rect;
  host.append(canvas);
  const pad = new strokesMod.WritePad(canvas, charData, { mode: "trace", box: strokesMod.fitBox(charData) });
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  return { host, canvas, pad };
}

function pointer(canvas, type, x, y) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1, buttons: 1, pointerType: "mouse" });
  canvas.dispatchEvent(ev);
}

/** Client coords that map onto SVG user coordinates (mirrors WritePad._addPoint). */
function toClient(svgX, svgY, pad) {
  const box = pad.box;
  const scale = Math.max(box.w, box.h) / pad.size;
  return [(svgX - box.x) / scale, (svgY - box.y) / scale];
}

/** Trace every stroke of a character faithfully, as a good learner would. */
function traceAll(pad) {
  for (const stroke of pad.char.strokes) {
    const pts = strokesMod.samplePath(stroke.d, 60);
    for (const [x, y] of pts) {
      const [cx, cy] = toClient(x, y, pad);
      if (pad.currentPts.length === 0) pointer(pad.canvas, "pointerdown", cx, cy);
      else pointer(pad.canvas, "pointermove", cx, cy);
    }
    pointer(pad.canvas, "pointerup", 0, 0);
  }
}

/** Deterministic scribble — keeps the test reproducible. */
function scribble(pad) {
  const box = pad.box;
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 30; i++) {
    const x = box.x + rand() * box.w;
    const y = box.y + rand() * box.h;
    if (pad.currentPts.length === 0) pointer(pad.canvas, "pointerdown", x, y);
    else pointer(pad.canvas, "pointermove", x, y);
  }
  pointer(pad.canvas, "pointerup", 0, 0);
}

/** A drawing that follows the right path but with the strokes in the wrong order. */
function traceWrongOrder(pad) {
  const strokes = [...pad.char.strokes].reverse();
  for (const stroke of strokes) {
    const pts = strokesMod.samplePath(stroke.d, 40);
    for (const [x, y] of pts) {
      const [cx, cy] = toClient(x, y, pad);
      if (pad.currentPts.length === 0) pointer(pad.canvas, "pointerdown", cx, cy);
      else pointer(pad.canvas, "pointermove", cx, cy);
    }
    pointer(pad.canvas, "pointerup", 0, 0);
  }
}

/** A drawing that covers the character but zig-zags everywhere. */
function zigzag(pad) {
  const box = pad.box;
  let x = box.x + box.w / 2, y = box.y;
  pointer(pad.canvas, "pointerdown", x, y);
  for (let i = 0; i < 120; i++) {
    x = box.x + box.w / 2 + Math.sin(i / 3) * box.w * 0.4;
    y = box.y + (i / 120) * box.h;
    pointer(pad.canvas, "pointermove", x, y);
  }
  pointer(pad.canvas, "pointerup", 0, 0);
}

console.log("\nwriting practice — scoring");

for (const [setId, ch] of [["hiragana", "あ"], ["hiragana", "さ"], ["katakana", "タ"], ["hiragana", "と"]]) {
  const c = dataMod.charData(setId, ch);
  const built = makePad(c);
  const pad = built.pad;

  check(`${ch}: pad starts empty`, pad.strokesDrawn === 0);
  traceAll(pad);
  check(`${ch}: tracing every stroke registers ${c.strokes.length} strokes`, pad.strokesDrawn === c.strokes.length, String(pad.strokesDrawn));

  const good = pad.measure();
  check(`${ch}: faithful tracing scores high (${(good.score * 100).toFixed(1)}%)`, good.score > 0.78, String(good.score));
  check(`${ch}: coverage is high`, good.coverage > 0.75, String(good.coverage));
  check(`${ch}: direction is recognised (${(good.dir * 100).toFixed(0)}%)`, good.dir > 0.6, String(good.dir));
  check(`${ch}: per-stroke scores all look sane`, good.perStroke.every((v) => v >= 0 && v <= 1));
  pad.destroy();
  built.host.remove();
}

const c = dataMod.charData("hiragana", "あ");
const scr = makePad(c);
scribble(scr.pad);
const bad = scr.pad.measure();
check("random scribble scores low (" + (bad.score * 100).toFixed(1) + "%)", bad.score < 0.35, String(bad.score));
check("scribble precision is low", bad.precision < 0.35, String(bad.precision));
scr.pad.destroy(); scr.host.remove();

const zz = makePad(c);
zigzag(zz.pad);
const mid = zz.pad.measure();
check("zig-zag scores middling (" + (mid.score * 100).toFixed(1) + "%)", mid.score < 0.7, String(mid.score));
zz.pad.destroy(); zz.host.remove();

const wo = makePad(c);
traceWrongOrder(wo.pad);
const wrong = wo.pad.measure();
check("reversed stroke order still overlaps well but direction suffers",
  wrong.score > 0.6 && wrong.dir < 0.6,
  `score=${wrong.score.toFixed(3)} dir=${wrong.dir.toFixed(3)}`);
wo.pad.destroy(); wo.host.remove();

const empty = makePad(c);
check("empty drawing scores 0", empty.pad.measure().score === 0);
empty.pad.destroy(); empty.host.remove();

console.log("\n" + (failures === 0 ? "ALL DRAW CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
