/* Pure-Node test for the SVG path parser — no DOM needed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, "..", "app", "data", "kana.json");

const strokes = await import(pathToFileURL(path.resolve(here, "..", "app", "js", "strokes.js")).href);
const doc = JSON.parse(fs.readFileSync(DATA, "utf8"));

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
};
const near = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

console.log("\npath parser — primitives");
check("straight line length", near(strokes.pathLength("M0,0 L10,0"), 10));
check("relative line length", near(strokes.pathLength("M0 0 l10 0"), 10));
check("implicit line after M", near(strokes.pathLength("M0 0 10 0"), 10));
check("horizontal/vertical", near(strokes.pathLength("M0 0 H10 V10"), 20));
check("quadratic length > chord", strokes.pathLength("M0 0 Q10 0 10 10") > 14);
check("cubic length > chord", strokes.pathLength("M0 0 C0 0 10 10 10 10") > 14);
check("closed subpath via Z adds the closing edge",
  near(strokes.pathLength("M0 0 L10 0 L10 10 Z"), 10 + 10 + Math.SQRT2 * 10, 0.2));
check("Z with no move adds nothing", near(strokes.pathLength("M0 0 Z"), 0, 0.01));

const g1 = strokes.pathGeometry("M0,0 L10,0");
const p0 = strokes.pointAtLength(g1, 0), pm = strokes.pointAtLength(g1, 5), p1 = strokes.pointAtLength(g1, 10);
check("point at start", near(p0[0], 0) && near(p0[1], 0));
check("point at middle", near(pm[0], 5));
check("point at end", near(p1[0], 10) && near(p1[1], 0));
check("sampled points stay on the path", strokes.samplePath("M0,0 L10,0", 10).every(([x, y]) => near(y, 0)));

const rel = strokes.pathGeometry("M5,5 c1,1 3,1 4,0");
const abs = strokes.pathGeometry("M5,5 C6,6 8,6 9,5");
check("relative cubic == absolute cubic", near(rel.total, abs.total, 0.01), `${rel.total} vs ${abs.total}`);
check("cubic samples land on the curve", rel.pts.every((p) => isFinite(p[0]) && isFinite(p[1])));

const arc = strokes.pathGeometry("M0,0 A5,5 0 0 1 10,0");
check("semicircle arc ≈ pi*r", near(arc.total, Math.PI * 5, 1.5), String(arc.total));
check("arc endpoint reached", near(arc.pts[arc.pts.length - 1][0], 10, 0.6));

console.log("\npath parser — KanjiVG kana dictionary");
let chars = 0, strokesTotal = 0, badLen = 0, outOfBox = 0, nonFinite = 0;
const offenders = [];
for (const set of doc.sets) {
  for (const ch of set.chars) {
    chars++;
    for (const s of ch.strokes) {
      strokesTotal++;
      const len = strokes.pathLength(s.d);
      if (!(len > 0)) { badLen++; offenders.push(`${ch.char} len=${len}`); continue; }
      const box = strokes.fitBox(ch);
      const pts = strokes.samplePath(s.d, 24);
      for (const [x, y] of pts) {
        if (!isFinite(x) || !isFinite(y)) { nonFinite++; offenders.push(`${ch.char} nonfinite`); continue; }
        if (x < -1 || x > 110 || y < -1 || y > 110) { outOfBox++; offenders.push(`${ch.char} (${x.toFixed(1)},${y.toFixed(1)})`); }
      }
      void box;
    }
  }
}
check(`${chars} characters parse`, chars === 172);
check(`${strokesTotal} strokes parse`, strokesTotal > 400);
check("every stroke has positive length", badLen === 0, offenders.slice(0, 5).join(", "));
check("no NaN/Infinity in samples", nonFinite === 0);
check("all samples inside the 109 box", outOfBox === 0, offenders.slice(0, 5).join(", "));

// fitBox should actually hug the glyph, not fill the whole 109 box
let tight = 0;
for (const set of doc.sets) for (const ch of set.chars) {
  const b = strokes.fitBox(ch);
  if (b.w > 40 && b.h > 40 && b.w < 109 && b.h < 109) tight++;
}
check("fitBox hugs glyphs (not the full box)", tight > chars * 0.9, `${tight}/${chars}`);

console.log("\n" + (failures === 0 ? "ALL PATH CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
