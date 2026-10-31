// Floor boundary curves.
//
// Every slab outline is a closed superellipse |x/a|^n + |y/b|^n = 1, sampled
// at the same number of points on every floor so the floors can be lofted.
// `round` runs from 0 (rounded rectangle) to 1 (ellipse); w and d are the
// bounding-box dimensions, `rot` turns the outline about the tower axis.

export const RING_N = 64;

export const superExponent = (round) => 2 + 18 * Math.pow(1 - Math.min(1, Math.max(0, round)), 1.5);

export function ringPoints(f) {
  const e = 2 / superExponent(f.round ?? 0);
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const pts = [];
  for (let k = 0; k < RING_N; k++) {
    const t = (k / RING_N) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x = (f.w / 2) * Math.sign(ct) * Math.pow(Math.abs(ct), e);
    const y = (f.d / 2) * Math.sign(st) * Math.pow(Math.abs(st), e);
    pts.push([f.cx + x * c - y * s, f.cy + x * s + y * c]);
  }
  return pts;
}

// Plate area, a little under the bounding box once the corners round off.
export const plateArea = (f) => f.w * f.d * (1 - 0.215 * (f.round ?? 0));

// Hard limits a floor must respect. Set by Orient (env.limits) and re-applied by
// every node that resizes a floor afterwards, so no later step can break them.
//   minW, minD     smallest bounding-box sides (m), 0 = off
//   minRadius      smallest corner radius (m), 0 = off. The corner radius is
//                  taken as roundness x half of the shorter side, so a full
//                  ellipse (roundness 1) has the largest possible radius.
export function clampFloor(f, lim) {
  if (!lim) return;
  if (lim.minW > 0) f.w = Math.max(f.w, lim.minW);
  if (lim.minD > 0) f.d = Math.max(f.d, lim.minD);
  if (lim.minRadius > 0) {
    const half = Math.max(Math.min(f.w, f.d) / 2, 1e-9);
    f.round = Math.min(1, Math.max(f.round ?? 0, lim.minRadius / half));
  }
}

// Corner radius in metres, by the definition above.
export const cornerRadius = (f) => (f.round ?? 0) * (Math.min(f.w, f.d) / 2);
