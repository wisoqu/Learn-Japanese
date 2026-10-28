/* ==========================================================================
   strokes.js — работа со следами кисти
   --------------------------------------------------------------------------
   - glyphSVG()        — персонаж-SVG из данного символа
   - animateStrokes()  — проигрывает strokes по порядку (笔顺)
   - fitBox()          — bounding box символа в координатах KanjiVG (109x109)
   - WritePad          — практика письма: контур, направление, оценка
   ========================================================================== */

const NS = "http://www.w3.org/2000/svg";

/* ------------------------------------------------------------------ helpers */

/** Bounding box of a character, in KanjiVG user units, with a little padding. */
export function fitBox(charData, pad = 4) {
  const pts = [];
  for (const s of charData.strokes || []) pts.push(...samplePath(s.d));
  if (!pts.length) return { x: 0, y: 0, w: 109, h: 109 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(109, x1 + pad); y1 = Math.min(109, y1 + pad);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/* ------------------------------------------------------------- path sampling
   Здесь используется собственный парсер SVG path, а не getTotalLength()
   из браузера: KanjiVG использует только M/L/C/Q/S/Z, плоские кривые
   Беззие де Комбери дают точную длину и положение вдоль кривой.
   Плюс — это работает в любом окружении, включая Node/jsdom.
*/

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

const _geom = new Map();

export function parsePathData(d) {
  const toks = String(d).match(TOKEN) || [];
  const segs = [];
  let cur = [0, 0], start = [0, 0];
  let i = 0;
  let cmd = null;
  let lastC2 = null;   // mirrored control point for a following S
  let lastQ = null;    // mirrored control point for a following T

  const isCmd = (t) => /^[A-Za-z]$/.test(t);
  const line = (p) => { segs.push({ t: 0, p0: cur, p1: p }); cur = [...p]; };
  const bez3 = (c1, c2, p) => {
    segs.push({ t: 1, p0: cur, c1, c2, p1: p });
    cur = [...p]; lastC2 = c2; lastQ = null;
  };
  const bez2 = (c, p) => {
    segs.push({ t: 2, p0: cur, c, p1: p });
    cur = [...p]; lastQ = c; lastC2 = null;
  };

  while (i < toks.length) {
    if (isCmd(toks[i])) { cmd = toks[i]; i++; }
    else if (!cmd) cmd = "M";

    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const n = ARGS[up];

    if (n === 0) {                       // Z
      if (cur[0] !== start[0] || cur[1] !== start[1]) line(start);
      cur = [...start];
      lastC2 = lastQ = null;
      continue;
    }
    if (i + n > toks.length) break;

    const a = [];
    for (let k = 0; k < n; k++) a.push(parseFloat(toks[i++]));
    const at = (v, k) => (rel ? v + cur[k] : v);   // resolve a relative coordinate

    switch (up) {
      case "M": {
        const p = [at(a[0], 0), at(a[1], 1)];
        if (segs.length) line(p);
        else { cur = p; start = [...p]; }
        lastC2 = lastQ = null;
        cmd = rel ? "l" : "L";             // further pairs are implicit lines
        break;
      }
      case "L": line([at(a[0], 0), at(a[1], 1)]); lastC2 = lastQ = null; break;
      case "H": line([at(a[0], 0), cur[1]]); lastC2 = lastQ = null; break;
      case "V": line([cur[0], at(a[0], 1)]); lastC2 = lastQ = null; break;
      case "C":
        bez3([at(a[0], 0), at(a[1], 1)], [at(a[2], 0), at(a[3], 1)], [at(a[4], 0), at(a[5], 1)]);
        break;
      case "S": {
        const c1 = lastC2 ? [2 * cur[0] - lastC2[0], 2 * cur[1] - lastC2[1]] : [...cur];
        bez3(c1, [at(a[0], 0), at(a[1], 1)], [at(a[2], 0), at(a[3], 1)]);
        break;
      }
      case "Q": bez2([at(a[0], 0), at(a[1], 1)], [at(a[2], 0), at(a[3], 1)]); break;
      case "T": {
        const c = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : [...cur];
        bez2(c, [at(a[0], 0), at(a[1], 1)]);
        break;
      }
      case "A": {
        for (const p of flattenArc(a, rel, cur)) line(p);
        lastC2 = lastQ = null;
        break;
      }
      default: break;
    }
  }
  return segs;
}

/** Approximate an SVG elliptical arc with polyline points (SVG spec F.6). */
function flattenArc(a, rel, cur) {
  let rx = Math.abs(a[0]);
  let ry = Math.abs(a[1]);
  const phi = (a[2] * Math.PI) / 180;
  const largeArc = a[3] ? 1 : 0;
  const sweep = a[4] ? 1 : 0;
  const x = rel ? cur[0] + a[5] : a[5];
  const y = rel ? cur[1] + a[6] : a[6];
  const x0 = cur[0], y0 = cur[1];

  if (rx === 0 || ry === 0) return [[x, y]];

  const dx2 = (x0 - x) / 2, dy2 = (y0 - y) / 2;
  const x1p = Math.cos(phi) * dx2 + Math.sin(phi) * dy2;
  const y1p = -Math.sin(phi) * dx2 + Math.cos(phi) * dy2;
  let lam = (x1p / rx) ** 2 + (y1p / ry) ** 2;
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s; ry *= s;
    lam = 1;
  }

  const xp = x1p / rx, yp = y1p / ry;
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(den > 0 ? num / den : 0);
  if (largeArc === sweep) coef = -coef;
  const cxp = coef * (rx * yp) / ry;
  const cyp = coef * (-ry * xp) / rx;

  const cx = cxp * Math.cos(phi) - cyp * Math.sin(phi) + (x0 + x) / 2;
  const cy = cxp * Math.sin(phi) + cyp * Math.cos(phi) + (y0 + y) / 2;

  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    const t = Math.min(1, Math.max(-1, dot / len));
    let a = Math.acos(t);
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, xp, yp);
  let dtheta = ang(xp, yp, -xp, -yp);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  if (largeArc) dtheta += sweep ? 2 * Math.PI : -2 * Math.PI;

  const steps = Math.max(2, Math.ceil(Math.abs(dtheta) / 0.25));
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const t = theta1 + dtheta * (k / steps);
    out.push([
      cx + rx * Math.cos(t) * Math.cos(phi) - ry * Math.sin(t) * Math.sin(phi),
      cy + rx * Math.cos(t) * Math.sin(phi) + ry * Math.sin(t) * Math.cos(phi),
    ]);
  }
  return out;
}

/** Flattened polyline + cumulative lengths for a path string. */
export function pathGeometry(d) {
  if (_geom.has(d)) return _geom.get(d);
  const segs = parsePathData(d);
  const pts = [];
  const cum = [0];
  let total = 0;
  let prev = null;

  for (const s of segs) {
    if (!prev) { pts.push([...s.p0]); prev = s.p0; }
    if (s.t === 0) {
      const p = s.p1;
      const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      pts.push(p); cum.push(total + l); total += l; prev = p;
    } else if (s.t === 1) {
      // cubic → flatten
      const n = Math.max(2, Math.ceil(estLength(s) / 2.4));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = cubicAt(s.p0, s.c1, s.c2, s.p1, t);
        const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        pts.push(p); cum.push(total + l); total += l; prev = p;
      }
    } else {
      const n = Math.max(2, Math.ceil(estLength(s) / 2.4));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = quadAt(s.p0, s.c, s.p1, t);
        const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        pts.push(p); cum.push(total + l); total += l; prev = p;
      }
    }
  }
  const g = { pts, cum, total, segs };
  if (_geom.size > 4000) _geom.clear();
  _geom.set(d, g);
  return g;
}

/** Approximate length of a cubic bezier from its control polygon. */
function estLength(s) {
  if (s.t === 1) {
    return (Math.hypot(s.c1[0] - s.p0[0], s.c1[1] - s.p0[1])
          + Math.hypot(s.c2[0] - s.c1[0], s.c2[1] - s.c1[1])
          + Math.hypot(s.p1[0] - s.c2[0], s.p1[1] - s.c2[1])) * 0.5505;
  }
  return (Math.hypot(s.c[0] - s.p0[0], s.c[1] - s.p0[1])
        + Math.hypot(s.p1[0] - s.c[0], s.p1[1] - s.c[1])) * 0.745;
}

function cubicAt(p0, c1, c2, p1, t) {
  const u = 1 - t, uu = u * u, t2 = t * t;
  return [
    uu * u * p0[0] + 3 * uu * t * c1[0] + 3 * u * t2 * c2[0] + t2 * t * p1[0],
    uu * u * p0[1] + 3 * uu * t * c1[1] + 3 * u * t2 * c2[1] + t2 * t * p1[1],
  ];
}

function quadAt(p0, c, p1, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
          u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

/** Position at a distance along the path (mirrors getPointAtLength). */
export function pointAtLength(g, dist) {
  if (g.pts.length === 0) return [0, 0];
  if (dist <= 0) return [...g.pts[0]];
  if (dist >= g.total) return [...g.pts[g.pts.length - 1]];
  let lo = 0, hi = g.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (g.cum[mid] <= dist) lo = mid; else hi = mid;
  }
  const seg = g.cum[hi] - g.cum[lo];
  const f = seg ? (dist - g.cum[lo]) / seg : 0;
  const a = g.pts[lo], b = g.pts[hi];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Total length of a path string. */
export function pathLength(d) {
  try { return pathGeometry(d).total; } catch (_) { return 0; }
}

/** Evenly sampled points along a path. */
export function samplePath(d, samples = 72) {
  const g = pathGeometry(d);
  if (!g.pts.length) return [];
  if (!g.total) return [g.pts[0]];
  const out = [];
  for (let i = 0; i <= samples; i++) out.push(pointAtLength(g, (g.total * i) / samples));
  return out;
}

/** Smooth polyline through points (Catmull-Rom → bezier) — used for user strokes. */
export function smoothPath(pts) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;
  let s = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    s += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return s;
}

/* --------------------------------------------------------------- glyph svg */

/**
 * Build an <svg> showing the character.
 * opts: { view:'all'|'first', max: n, box:{x,y,w,h}, width (svg units) }
 */
export function glyphSVG(charData, opts = {}) {
  const box = opts.box || fitBox(charData);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");

  const n = opts.max || (charData.strokes || []).length;
  const strokes = (charData.strokes || []).slice(0, n);
  const width = opts.width || Math.max(2.2, (Math.min(box.w, box.h) * 3) / 100);

  for (let i = 0; i < strokes.length; i++) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", strokes[i].d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", String(width));
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("data-stroke", String(i));
    p.classList.add("g");
    svg.appendChild(p);
  }
  svg._strokes = strokes;
  return svg;
}

/** Show / hide whole glyph in an existing glyph svg. */
export function setStrokesVisible(svg, indices) {
  if (!svg) return;
  svg.querySelectorAll("path.g").forEach((p) => {
    p.style.opacity = indices === null ? "1" : (indices.has(+p.dataset.stroke) ? "1" : "0");
  });
}

/* ------------------------------------------------------------------- anim */

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Animate strokes one after another.
 * @returns {Promise<void>} resolves when the last stroke is drawn
 */
export function animateStrokes(svg, opts = {}) {
  const paths = [...svg.querySelectorAll("path.g")];
  const speed = opts.speed || 1;
  const per = (opts.duration || 460) / speed;
  const hold = opts.gap || 110;
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= paths.length) { resolve(); return; }
      const path = paths[i];
      const len = pathLength(path.getAttribute("d"));
      path.style.transition = "none";
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      path.getBoundingClientRect(); // force style flush
      path.style.transition = `stroke-dashoffset ${per}ms cubic-bezier(.45,.05,.25,1)`;
      path.style.strokeDashoffset = "0";
      if (opts.onStroke) opts.onStroke(i + 1, paths.length);
      const done = () => {
        path.style.transition = "none";
        path.style.strokeDasharray = "none";
        path.style.strokeDashoffset = "0";
        i += 1;
        setTimeout(next, hold);
      };
      path.addEventListener("transitionend", done, { once: true });
      // Safety net if transitionend never fires (reduced motion, etc.)
      setTimeout(done, per + 160);
    };
    next();
  });
}

/* -------------------------------------------------------------------- score */

function rasterize(ctx, box, paths, size, lineWidth) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size / Math.max(box.w, box.h);
  ctx.setTransform(s, 0, 0, s, -box.x * s, -box.y * s);
  for (const p of paths) {
    if (!p) continue;
    try { ctx.stroke(new Path2D(p)); } catch (_) {}
  }
  return ctx.getImageData(0, 0, size, size).data;
}

function toMask(data, size) {
  const m = new Uint8Array(size * size);
  for (let i = 0, n = size * size; i < n; i++) m[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  return m;
}

function popcount(m) {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

/**
 * Compare the user's drawing with the expected strokes.
 * @returns {{score:number, coverage:number, precision:number, perStroke:number[]}}
 */
export function scoreDrawing(charData, userStrokes, opts = {}) {
  const box = opts.box || fitBox(charData);
  const size = opts.size || 148;
  const expected = charData.strokes || [];

  const off = document.createElement("canvas");
  off.width = off.height = size;
  const ctx = off.getContext("2d", { willReadFrequently: true });

  const lw = Math.max(2.6, Math.min(box.w, box.h) * 0.09);

  const userData = rasterize(ctx, box, userStrokes, size, lw);
  const userMask = toMask(userData, size);
  const userN = popcount(userMask);
  if (!userN || !expected.length) return { score: 0, coverage: 0, precision: 0, perStroke: [] };

  const perStroke = [];
  let covered = 0, total = 0;
  for (const s of expected) {
    const data = rasterize(ctx, box, [s.d], size, lw);
    const mask = toMask(data, size);
    const n = popcount(mask);
    if (!n) { perStroke.push(0); continue; }
    let hit = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] && userMask[i]) hit++;
    covered += hit; total += n;
    perStroke.push(hit / n);
  }
  const coverage = total ? covered / total : 0;
  const precision = userN ? covered / userN : 0;
  const score = Math.max(0, Math.min(1, 0.62 * coverage + 0.38 * precision));
  return { score, coverage, precision, perStroke };
}

/**
 * How well the user's strokes follow the expected ones *in order*.
 * User stroke i is compared with expected stroke i, so drawing the same
 * shapes back-to-front no longer counts as "correct direction".
 */
export function directionScore(charData, userStrokes) {
  const expected = charData.strokes || [];
  if (!expected.length || !userStrokes.length) return 0;
  const n = Math.min(expected.length, userStrokes.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += monotoneMatch(expected[i].d, userStrokes[i]);
  // if the user drew more strokes than expected, the extras are noise
  return sum / Math.max(1, Math.max(expected.length, userStrokes.length));
}

/** Fraction of the expected path the user's stroke traverses monotonically. */
function monotoneMatch(expD, userD) {
  const exp = samplePath(expD, 48);
  const user = samplePath(userD, 48);
  if (!exp.length || !user.length) return 0;
  // Tolerance scales with the stroke: a 70-unit stroke tolerates ~7 units.
  const tol = Math.pow(Math.max(4, pathLength(expD) / 10), 2);
  let j = 0, matched = 0;
  for (const [x, y] of exp) {
    let bestJ = -1, bestD = Infinity;
    for (let k = j; k < user.length; k++) {
      const d = (user[k][0] - x) ** 2 + (user[k][1] - y) ** 2;
      if (d < bestD) { bestD = d; bestJ = k; }
    }
    if (bestJ >= 0 && bestD <= tol) { matched++; j = bestJ; }
    else break;
  }
  return matched / exp.length;
}

/* ================================================================== WritePad */

/**
 * Canvas practice pad: grid, ghost template, direction arrow, free drawing.
 */
export class WritePad {
  constructor(canvas, charData, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.char = charData;
    this.mode = opts.mode === "free" ? "free" : "trace";
    this.dpr = 1;
    this.box = opts.box || fitBox(charData);
    this.size = 0;
    this.current = 0;
    this.ghost = (charData.strokes || []).slice();
    this.userStrokes = [];
    this.currentPts = [];
    this.drawing = false;
    this._raf = 0;
    this._score = null;

    this._bind();
    this.resize();
  }

  get score() { return this._score; }

  _bind() {
    const c = this.canvas;
    const opts = { passive: false };
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.currentPts = [];
      this._addPoint(e);
      this._render();
    }, opts);
    c.addEventListener("pointermove", (e) => {
      if (!this.drawing) return;
      e.preventDefault();
      this._addPoint(e);
      this._render();
    }, opts);
    const up = (e) => {
      if (!this.drawing) return;
      this.drawing = false;
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
      if (this.currentPts.length > 1) {
        const d = smoothPath(this.currentPts);
        if (d) this.userStrokes.push(d);
      }
      this.currentPts = [];
      if (this.mode === "trace") this.current = Math.min(this.current + 1, this.ghost.length);
      this._render();
    };
    c.addEventListener("pointerup", up, opts);
    c.addEventListener("pointercancel", up, opts);
    c.addEventListener("pointerleave", (e) => {
      if (this.drawing && e.buttons === 0) up(e);
    }, opts);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(c.parentElement || c);
  }

  resize() {
    const host = this.canvas.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const size = Math.max(80, Math.round(Math.min(rect.width, rect.height)));
    if (size === this.size) return;
    this.size = size;
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this._render();
  }

  _addPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width;
    const cy = (e.clientY - r.top) / r.height;
    // canvas pixels -> user units
    const box = this.box;
    const scale = Math.max(box.w, box.h) / this.size;
    const x = box.x + cx * this.size * scale;
    const y = box.y + cy * this.size * scale;
    const last = this.currentPts[this.currentPts.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 1.2) return;
    this.currentPts.push([x, y]);
  }

  _render() {
    const { ctx } = this;
    if (!this.size) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);

    // grid (мэй-суги: вертикаль, горизонталь, диагонали)
    ctx.save();
    ctx.strokeStyle = getCss("--line-2");
    ctx.lineWidth = 1;
    const m = this.size * 0.5;
    ctx.beginPath();
    ctx.moveTo(m, this.size * 0.1); ctx.lineTo(m, this.size * 0.9);
    ctx.moveTo(this.size * 0.1, m); ctx.lineTo(this.size * 0.9, m);
    ctx.moveTo(this.size * 0.1, this.size * 0.1); ctx.lineTo(this.size * 0.9, this.size * 0.9);
    ctx.moveTo(this.size * 0.9, this.size * 0.1); ctx.lineTo(this.size * 0.1, this.size * 0.9);
    ctx.stroke();
    ctx.restore();

    if (this.mode === "trace" && this.ghost.length) {
      this._paintGhost(0.16, this.ghost.map((s) => s.d));
      if (this.current < this.ghost.length) {
        this._paintGhost(0.75, [this.ghost[this.current].d]);
        this._paintArrow(this.ghost[this.current].d);
      }
    }
    this._paintUser(0.95, this.userStrokes.map((d) => d));
    if (this.currentPts.length > 1) this._paintUser(1, [smoothPath(this.currentPts)]);
  }

  _transform(ctx) {
    const box = this.box;
    const s = Math.max(box.w, box.h) / this.size;
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s,
      -box.x * this.dpr * s, -box.y * this.dpr * s);
  }

  _paintGhost(alpha, paths) {
    const { ctx } = this;
    ctx.save();
    this._transform(ctx);
    ctx.strokeStyle = hexA("currentColor", alpha);
    ctx.lineWidth = Math.max(boxWidth(this.box), 2.4);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const d of paths) { try { ctx.stroke(new Path2D(d)); } catch (_) {} }
    ctx.restore();
  }

  _paintUser(alpha, paths) {
    const { ctx } = this;
    ctx.save();
    this._transform(ctx);
    ctx.strokeStyle = hexA("var(--accent)", alpha);
    ctx.lineWidth = Math.max(boxWidth(this.box), 2.4) * 0.86;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const d of paths) { try { ctx.stroke(new Path2D(d)); } catch (_) {} }
    ctx.restore();
  }

  _paintArrow(d) {
    const pts = samplePath(d, 24);
    if (pts.length < 2) return;
    const { ctx } = this;
    const p0 = pts[0], p1 = pts[2] || pts[1];
    ctx.save();
    this._transform(ctx);
    ctx.strokeStyle = hexA("var(--vermilion)", 0.9);
    ctx.lineWidth = Math.max(boxWidth(this.box) * 0.5, 1.6);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const h = Math.max(boxWidth(this.box) * 0.5, 1.6) * 3.1;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p1[0] - h * Math.cos(ang - 0.42), p1[1] - h * Math.sin(ang - 0.42));
    ctx.lineTo(p1[0] - h * Math.cos(ang + 0.42), p1[1] - h * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fillStyle = hexA("var(--vermilion)", 0.9);
    ctx.fill();
    ctx.restore();
  }

  /** Rough "how many strokes did the user draw". */
  get strokesDrawn() { return this.userStrokes.length; }

  clear() {
    this.userStrokes = [];
    this.currentPts = [];
    this.current = 0;
    this._score = null;
    this._render();
  }

  setMode(m) {
    this.mode = m;
    this.clear();
  }

  /** Score the current drawing; caches the result. */
  measure() {
    const res = scoreDrawing(this.char, this.userStrokes, { box: this.box, size: 160 });
    const dir = this.userStrokes.length ? directionScore(this.char, this.userStrokes) : 0;
    this._score = {
      score: Math.max(0, Math.min(1, res.score * 0.86 + dir * 0.14)),
      coverage: res.coverage, precision: res.precision, dir, perStroke: res.perStroke,
    };
    return this._score;
  }

  destroy() {
    if (this._ro) this._ro.disconnect();
  }
}

function boxWidth(box) { return Math.max(2.2, Math.min(box.w, box.h) * 0.033); }

function getCss(varName) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  } catch (_) { return "#000"; }
}

/** 'currentColor'/'var(--x)' is not valid inside a canvas fillStyle — resolve it. */
function hexA(spec, alpha) {
  if (spec.startsWith("var(")) {
    const v = getCss(spec.slice(4, -1).trim());
    spec = v || "#4f46e5";
  }
  if (spec === "currentColor") spec = getCss("--ink") || "#1a1a1f";
  const hex = String(spec).trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return String(spec);
}
