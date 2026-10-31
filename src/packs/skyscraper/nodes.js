// Node library for the tower form-finding study.
//
// Every definition describes ports, parameters and a pure compute() function.
// Numeric params also get an input port with the same id, so a wire can
// override the widget (like a Grasshopper slider). Select params do not.
//
// Value shapes
//   tower   { h, sides, env, floors: [{ z, w, d, rot, cx, cy, windF, wind, sun, util }] }
//   context { buildings: [{ x, y, w, d, h }] }          (metres, z up)
//
// Wind direction and sun azimuth are compass bearings in degrees, clockwise
// from north (+y). Wind is the direction the wind comes FROM.

import { num, select } from '../../core/define.js';
import { clampFloor, plateArea, ringPoints } from './geometry.js';
import { CMAP_NAMES, METRIC_NAMES } from './metrics.js';

export const cloneTower = (t) => ({
  ...t,
  env: { ...t.env },
  floors: t.floors.map((f) => ({ ...f })),
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = (deg) => (deg * Math.PI) / 180;

// One relaxation step along the height: every floor moves toward the average of
// its neighbours by `s` (0 = untouched, 1 = fully averaged). Applied to the
// quantities the loft is built from, so the outline stays a smooth ramp.
function smoothFloors(F, s) {
  if (!(s > 0) || F.length < 3) return;
  for (const key of ['rot', 'w', 'd', 'round']) {
    const src = F.map((f) => f[key]);
    for (let i = 0; i < F.length; i++) {
      const a = src[Math.max(0, i - 1)];
      const b = src[Math.min(F.length - 1, i + 1)];
      F[i][key] = (1 - s) * src[i] + s * 0.5 * (a + b);
    }
  }
}

// What a Tower keeps when a loop result is adopted: geometry only, no wind/sun/utilisation.
const freezeTower = (t) => ({
  h: t.h,
  floors: t.floors.map((f) => ({ z: f.z, w: f.w, d: f.d, rot: f.rot, cx: f.cx, cy: f.cy, round: f.round ?? 0 })),
});
const thawTower = (s) => ({
  h: s.h,
  env: {},
  floors: s.floors.map((f) => ({ ...f, windF: 0, wind: 0, sun: 1, util: 0 })),
});

// unit vector pointing toward a compass bearing
const bearing = (deg) => ({ x: Math.sin(rad(deg)), y: Math.cos(rad(deg)) });


const TOWER_IN = { id: 'tower', label: 'Tower', type: 'tower' };
const TOWER_OUT = { id: 'tower', label: 'Tower', type: 'tower' };

// Wind pressure (kN/m2) at height z for a reference speed measured at 10 m.
const windPressure = (z, vRef, alpha) =>
  (0.5 * 1.25 * vRef * vRef * Math.pow(Math.max(z, 10) / 10, 2 * alpha)) / 1000;

// Footprint extents of a rotated rectangle w x d.
function projections(f, dir) {
  const u = { x: Math.cos(f.rot), y: Math.sin(f.rot) };
  const v = { x: -Math.sin(f.rot), y: Math.cos(f.rot) };
  const n = { x: -dir.y, y: dir.x };
  return {
    // width seen by the wind (perpendicular to the flow)
    frontal: f.w * Math.abs(u.x * n.x + u.y * n.y) + f.d * Math.abs(v.x * n.x + v.y * n.y),
    // length along the flow
    along: f.w * Math.abs(u.x * dir.x + u.y * dir.y) + f.d * Math.abs(v.x * dir.x + v.y * dir.y),
  };
}

// What the Floor profile node can read from a floor.
const PROFILE_QUANTITIES = {
  'Wind load': (f) => f.windF,
  'Wind exposure': (f) => f.wind,
  'Sun exposure': (f) => f.sun,
  Utilisation: (f) => f.util,
  Width: (f) => f.w,
  Depth: (f) => f.d,
  'Plate area': (f) => plateArea(f),
  'Rotation (deg)': (f) => (f.rot * 180) / Math.PI,
  Roundness: (f) => f.round,
};

export const SKYSCRAPER_NODES = {
  context: {
    title: 'Context',
    category: 'Site',
    inputs: [],
    outputs: [{ id: 'context', label: 'Context', type: 'context' }],
    params: [
      select('style', 'Style', 'Manhattan', ['Manhattan', 'Dubai']),
      num('ring', 'Blocks', 3, { step: 1, min: 1, max: 6 }),
      num('heightScale', 'Height x', 1, { step: 0.1, min: 0.2, max: 3 }),
      num('seed', 'Seed', 7, { step: 1 }),
    ],
    compute: (_i, p) => {
      const rnd = mulberry32(Math.floor(p.seed));
      const dubai = p.style === 'Dubai';
      const pitch = dubai ? 150 : 72;
      const plot = dubai ? 70 : 54;
      const R = Math.max(1, Math.floor(p.ring));
      const buildings = [];
      for (let i = -R; i <= R; i++) {
        for (let j = -R; j <= R; j++) {
          if (i === 0 && j === 0) continue; // the site
          const r = rnd();
          let h;
          if (dubai) h = r > 0.78 ? 150 + rnd() * 120 : 12 + rnd() * 50;
          else h = 25 + Math.pow(rnd(), 1.6) * 130;
          const w = plot * (0.7 + rnd() * 0.3);
          const d = plot * (0.7 + rnd() * 0.3);
          buildings.push({ x: i * pitch, y: j * pitch, w, d, h: h * p.heightScale });
        }
      }
      return { context: { style: p.style, pitch, buildings } };
    },
  },

  tower: {
    title: 'Tower',
    category: 'Site',
    inputs: [],
    outputs: [TOWER_OUT],
    params: [
      num('floors', 'Floors', 60, { step: 1, min: 2, max: 150 }),
      num('floorH', 'Floor height', 4, { step: 0.1 }),
      num('width', 'Width', 36, { step: 1 }),
      num('depth', 'Depth', 36, { step: 1 }),
      num('twist', 'Twist (deg)', 0, { step: 5 }),
      num('round', 'Roundness', 0.2, { min: 0, max: 1 }),
      // Initial = the sliders above. Adopted = a loop result stored with the
      // Adopt buttons on Loop End (kept per floor, so nothing is lost).
      select('source', 'Source', 'Initial', ['Initial', 'Adopted']),
    ],
    describe: (p) =>
      p.snapshot
        ? `Adopted result stored (${p.snapshot.floors.length} floors). Source picks the sliders or the adopted tower.`
        : 'Sliders only. Use "Adopt" on the Loop End to store a result here.',
    // Generic hook the editor calls from Loop End: value -> param patch.
    adopt: (value) => ({ snapshot: freezeTower(value), source: 'Adopted' }),
    compute: (_i, p) => {
      if (p.source === 'Adopted' && p.snapshot) return { tower: thawTower(p.snapshot) };
      const n = Math.max(2, Math.floor(p.floors));
      const floors = Array.from({ length: n }, (_, i) => ({
        z: i * p.floorH,
        w: p.width,
        d: p.depth,
        rot: rad((p.twist * i) / (n - 1)),
        cx: 0,
        cy: 0,
        round: p.round,
        windF: 0,
        wind: 0,
        sun: 1,
        util: 0,
      }));
      return {
        tower: { h: p.floorH, env: {}, floors },
      };
    },
  },

  wind: {
    title: 'Wind',
    category: 'Physics',
    inputs: [TOWER_IN, { id: 'context', label: 'Context', type: 'context', optional: true }],
    outputs: [TOWER_OUT],
    params: [
      num('speed', 'Speed 10m (m/s)', 40, { step: 1, min: 0 }),
      num('from', 'From (deg)', 300, { step: 5 }),
      num('alpha', 'Terrain exp.', 0.25, { step: 0.01, min: 0.1, max: 0.4 }),
    ],
    compute: ({ tower, context }, p) => {
      const t = cloneTower(tower);
      const up = bearing(p.from); // towards the wind source
      const dir = { x: -up.x, y: -up.y }; // the way the wind travels
      const perp = { x: -up.y, y: up.x };
      t.env.wind = { from: p.from, speed: p.speed };
      for (const f of t.floors) {
        const zm = f.z + t.h / 2;
        const { frontal, along } = projections(f, dir);
        // Neighbours upwind and taller than this floor shelter it.
        let shield = 1;
        for (const b of context?.buildings || []) {
          if (b.h <= zm) continue;
          const along2 = b.x * up.x + b.y * up.y;
          if (along2 <= 0 || along2 > 220) continue;
          const lateral = Math.abs(b.x * perp.x + b.y * perp.y);
          const bFront = b.w * Math.abs(perp.x) + b.d * Math.abs(perp.y);
          if (lateral < bFront / 2 + frontal / 2) shield *= 0.78;
        }
        shield = Math.max(0.3, shield);
        const ratio = along / Math.max(frontal, 1e-6);
        // elongation along the flow and rounded corners both cut the drag
        const cd = (1.4 - 0.3 * Math.min(2, Math.max(0, ratio - 1))) * (1 - 0.35 * f.round);
        const q = windPressure(zm, p.speed, p.alpha);
        f.windF = q * cd * frontal * t.h * shield; // kN
        f.wind = shield;
      }
      return { tower: t };
    },
  },

  // Per floor: search candidate rotations of the slab outline and move toward
  // the best one. The score trades wind load (drag x frontal width, scaled by
  // how exposed the floor is) against how squarely the long facade faces the
  // sun. Floors that carry more wind adapt faster and round their corners, so
  // the loft grades along the height of the tower.

  orient: {
    title: 'Orient',
    category: 'Physics',
    inputs: [TOWER_IN],
    outputs: [TOWER_OUT],
    params: [
      num('rate', 'Rate', 0.2, { min: 0, max: 1 }),
      num('aspect', 'Aspect', 1.8, { step: 0.1, min: 1, max: 4 }),
      num('round', 'Max roundness', 0.8, { min: 0, max: 1 }),
      num('sunWeight', 'Sun weight', 0.7, { min: 0, max: 2 }),
      num('sunAz', 'Sun azimuth', 150, { step: 5 }),
      // Limits. 0 means "off" for the sizes and the twist; they always win over
      // the optimiser, and Structure re-applies the size limits after resizing.
      num('minW', 'Min width (m)', 0, { step: 1, min: 0 }),
      num('minD', 'Min depth (m)', 0, { step: 1, min: 0 }),
      num('minRadius', 'Min corner radius (m)', 0, { step: 0.5, min: 0 }),
      num('maxStep', 'Max rotation / pass (deg)', 90, { step: 1, min: 0, max: 90 }),
      num('maxTwist', 'Max twist from base (deg)', 0, { step: 5, min: 0, max: 180 }),
      num('smooth', 'Floor-to-floor smoothing', 0, { min: 0, max: 1 }),
      select('search', 'Search', 'Grid', ['Grid', 'Refined']),
    ],
    compute: ({ tower }, p) => {
      const t = cloneTower(tower);
      const limits = { minW: p.minW, minD: p.minD, minRadius: p.minRadius };
      t.env.limits = limits;
      const prevRot = t.floors.map((f) => f.rot);
      const wind = t.env.wind;
      if (!wind) {
        t.floors.forEach((f) => clampFloor(f, limits));
        return { tower: t };
      }
      const up = bearing(wind.from);
      const dir = { x: -up.x, y: -up.y };
      const sun = bearing(p.sunAz);
      const fmax = Math.max(1e-9, ...t.floors.map((f) => f.windF));
      const K = 36;
      for (const f of t.floors) {
        const loadFrac = f.windF / fmax;
        let best = f.rot;
        let bestCost = Infinity;
        let bestC = K / 2;
        const costs = new Array(K + 1);
        const ref = Math.sqrt(f.w * f.d);
        for (let c = 0; c <= K; c++) {
          const th = f.rot + (c / K - 0.5) * Math.PI;
          const { frontal, along } = projections({ ...f, rot: th }, dir);
          const cd = (1.4 - 0.3 * Math.min(2, Math.max(0, along / frontal - 1))) * (1 - 0.35 * f.round);
          const windCost = f.wind * ((cd * frontal) / (1.4 * ref));
          // normal of the longer facade: local y when w is the long side
          const n = f.w >= f.d ? { x: -Math.sin(th), y: Math.cos(th) } : { x: Math.cos(th), y: Math.sin(th) };
          const sunCost = 1 - Math.abs(n.x * sun.x + n.y * sun.y);
          const cost = windCost + p.sunWeight * sunCost + 0.02 * (Math.abs(th - f.rot) / (Math.PI / 2));
          costs[c] = cost;
          if (cost < bestCost) {
            bestCost = cost;
            best = th;
            bestC = c;
          }
        }
        // Refined: the candidates sit on a 5 degree grid that moves with the floor; placing the
        // minimum between grid points stops floors hopping from one candidate to the next, which
        // is what keeps a smoothed loop from settling. Grid is the plain search (default).
        if (p.search === 'Refined' && bestC > 0 && bestC < K) {
          const a = costs[bestC - 1];
          const b = costs[bestC];
          const d = costs[bestC + 1];
          const den = a - 2 * b + d;
          if (den > 1e-12) {
            const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - d)) / den));
            best = f.rot + ((bestC + delta) / K - 0.5) * Math.PI;
          }
        }
        const k = p.rate * (0.3 + 0.7 * loadFrac);
        f.rot += k * (best - f.rot);
        const area = f.w * f.d;
        f.w += k * (Math.sqrt(area * p.aspect) - f.w);
        f.d += k * (Math.sqrt(area / p.aspect) - f.d);
        f.round += k * (p.round * loadFrac - f.round);
      }

      // Neighbour averaging first, then the hard limits, so a limit is never undone by smoothing.
      smoothFloors(t.floors, p.smooth);
      const step = rad(Math.min(90, Math.max(0, p.maxStep)));
      t.floors.forEach((f, i) => {
        f.rot = prevRot[i] + Math.max(-step, Math.min(step, f.rot - prevRot[i]));
      });
      if (p.maxTwist > 0) {
        const lim = rad(p.maxTwist);
        const base = t.floors[0].rot;
        for (const f of t.floors) f.rot = base + Math.max(-lim, Math.min(lim, f.rot - base));
      }
      t.floors.forEach((f) => clampFloor(f, limits));
      return { tower: t };
    },
  },

  structure: {
    title: 'Structure',
    category: 'Physics',
    inputs: [TOWER_IN],
    outputs: [TOWER_OUT],
    params: [
      num('allow', 'Allowable (MPa)', 6, { step: 0.5, min: 1 }),
      num('load', 'Floor load (kN/m2)', 10, { step: 0.5, min: 0 }),
      num('fraction', 'Structural share', 0.08, { min: 0.02, max: 0.5 }),
      num('relax', 'Relaxation', 0.3, { min: 0.01, max: 1 }),
      num('minPlate', 'Min plate (m)', 20, { step: 1 }),
      num('maxPlate', 'Max plate (m)', 60, { step: 1 }),
    ],
    compute: ({ tower }, p) => {
      const t = cloneTower(tower);
      const F = t.floors;
      const n = F.length;
      const allowKpa = p.allow * 1000;
      // suffix sums for the axial load and the wind moment about each floor
      const axial = new Array(n).fill(0);
      const moment = new Array(n).fill(0);
      let sumN = 0;
      let sumF = 0;
      let sumFz = 0;
      for (let i = n - 1; i >= 0; i--) {
        const zm = F[i].z + t.h / 2;
        sumN += p.load * plateArea(F[i]);
        sumF += F[i].windF;
        sumFz += F[i].windF * zm;
        axial[i] = sumN;
        moment[i] = sumFz - F[i].z * sumF;
      }
      t.env.allow = allowKpa;
      t.env.fraction = p.fraction;
      for (let i = 0; i < n; i++) {
        const f = F[i];
        const area = plateArea(f);
        const depth = Math.max(f.d, 1);
        const demand = axial[i] + (6 * moment[i]) / depth; // kN
        const req = demand / (p.fraction * allowKpa);
        const lo = p.minPlate * p.minPlate;
        const hi = p.maxPlate * p.maxPlate;
        const target = Math.min(hi, Math.max(lo, req));
        const next = area + p.relax * (target - area);
        const s = Math.sqrt(next / area);
        f.w *= s;
        f.d *= s;
        clampFloor(f, t.env.limits); // Orient's size limits hold after resizing too
        f.util = demand / (p.fraction * plateArea(f) * allowKpa);
      }
      return { tower: t };
    },
  },

  sun: {
    title: 'Sun',
    category: 'Physics',
    inputs: [TOWER_IN, { id: 'context', label: 'Context', type: 'context', optional: true }],
    outputs: [TOWER_OUT],
    params: [
      num('azimuth', 'Azimuth (deg)', 150, { step: 5 }),
      num('altitude', 'Altitude (deg)', 35, { step: 1, min: 1, max: 89 }),
    ],
    compute: ({ tower, context }, p) => {
      const t = cloneTower(tower);
      const dir = bearing(p.azimuth);
      const slope = Math.tan(rad(p.altitude));
      t.env.sun = { azimuth: p.azimuth, altitude: p.altitude };
      for (const f of t.floors) {
        const zm = f.z + t.h / 2;
        const c = Math.cos(f.rot);
        const s = Math.sin(f.rot);
        const samples = [
          [0, 0],
          [f.w / 2, f.d / 2],
          [-f.w / 2, f.d / 2],
          [f.w / 2, -f.d / 2],
          [-f.w / 2, -f.d / 2],
        ].map(([x, y]) => ({ x: f.cx + x * c - y * s, y: f.cy + x * s + y * c }));
        let lit = 0;
        for (const o of samples) {
          let blocked = false;
          for (const b of context?.buildings || []) {
            // distance along the ray to the near face of the box (slab test)
            let t0 = 0;
            let t1 = Infinity;
            const slab = (origin, d, lo, hi) => {
              if (Math.abs(d) < 1e-9) return origin >= lo && origin <= hi;
              let a = (lo - origin) / d;
              let bb = (hi - origin) / d;
              if (a > bb) [a, bb] = [bb, a];
              t0 = Math.max(t0, a);
              t1 = Math.min(t1, bb);
              return t0 <= t1;
            };
            if (
              slab(o.x, dir.x, b.x - b.w / 2, b.x + b.w / 2) &&
              slab(o.y, dir.y, b.y - b.d / 2, b.y + b.d / 2) &&
              t1 > 0 &&
              b.h > zm + t0 * slope
            ) {
              blocked = true;
              break;
            }
          }
          if (!blocked) lit++;
        }
        f.sun = lit / samples.length;
      }
      return { tower: t };
    },
  },

  metrics: {
    title: 'Metrics',
    category: 'Output',
    inputs: [TOWER_IN],
    outputs: [
      { id: 'gfa', label: 'Floor area (m2)', type: 'number' },
      { id: 'material', label: 'Structure (m3)', type: 'number' },
      { id: 'moment', label: 'Base moment (MNm)', type: 'number' },
      { id: 'util', label: 'Max utilisation', type: 'number' },
    ],
    params: [],
    compute: ({ tower }) => {
      const F = tower.floors;
      const gfa = F.reduce((s, f) => s + plateArea(f), 0);
      const frac = tower.env.fraction ?? 0.12;
      const moment = F.reduce((s, f) => s + f.windF * (f.z + tower.h / 2), 0) / 1000;
      return {
        gfa,
        material: gfa * frac * tower.h,
        moment,
        util: Math.max(...F.map((f) => f.util)),
      };
    },
  },

  // The two loop nodes are executed by the engine (see engine.js); their
  // compute() only runs when they are evaluated outside of a loop.

  // ---- adapters: a tower or a context becomes the plain lists the analysis pack works on ----

  // One value per floor, bottom to top, plus the mid-height of each floor. Rotation is in degrees.
  profile: {
    title: 'Floor profile',
    category: 'Analysis',
    inputs: [TOWER_IN],
    outputs: [
      { id: 'values', label: 'Values', type: 'list' },
      { id: 'z', label: 'Heights (m)', type: 'list' },
    ],
    params: [select('quantity', 'Quantity', 'Wind load', Object.keys(PROFILE_QUANTITIES))],
    compute: ({ tower }, p) => ({
      values: tower.floors.map((f) => PROFILE_QUANTITIES[p.quantity](f)),
      z: tower.floors.map((f) => f.z + tower.h / 2),
    }),
  },

  // The slab outline of one floor as a point list (the same curve the viewer draws). Floor index is
  // clamped into range, so a large number means the top floor.
  outline: {
    title: 'Floor outline',
    category: 'Analysis',
    inputs: [TOWER_IN],
    outputs: [{ id: 'points', label: 'Points', type: 'points' }],
    params: [num('floor', 'Floor', 0, { step: 1, min: 0 })],
    compute: ({ tower }, p) => {
      const i = Math.min(tower.floors.length - 1, Math.max(0, Math.floor(p.floor)));
      return { points: ringPoints(tower.floors[i]) };
    },
  },

  // Every neighbouring building as a 2D Gaussian splat: centred on the building, spread a quarter of
  // its footprint, more opaque the taller it is, nearer to the viewer the taller it is.
  splats: {
    title: 'Context splats',
    category: 'Analysis',
    inputs: [{ id: 'context', label: 'Context', type: 'context' }],
    outputs: [{ id: 'splats', label: 'Splats', type: 'splats' }],
    params: [num('hRef', 'Full opacity at (m)', 150, { step: 10, min: 1 })],
    compute: ({ context }, p) => ({
      splats: context.buildings.map((b) => ({
        x: b.x,
        y: b.y,
        sx: b.w / 4,
        sy: b.d / 4,
        rot: 0,
        opacity: Math.min(1, b.h / p.hRef),
        depth: -b.h,
        value: b.h,
      })),
    }),
  },

  viewer: {
    title: 'Viewer',
    category: 'Output',
    inputs: [
      TOWER_IN,
      { id: 'context', label: 'Context', type: 'context', optional: true },
      { id: 'history', label: 'History', type: 'history', optional: true },
    ],
    outputs: [],
    params: [
      select('color', 'Colour by', 'Utilisation', METRIC_NAMES),
      select('cmap', 'Colormap', 'Turbo', CMAP_NAMES),
      select('range', 'Range', 'Auto', ['Auto', 'Manual']),
      num('min', 'Min', 0, { step: 0.1 }),
      num('max', 'Max', 1, { step: 0.1 }),
      select('reverse', 'Reverse', 'No', ['No', 'Yes']),
    ],
    compute: () => ({}),
  },
};
