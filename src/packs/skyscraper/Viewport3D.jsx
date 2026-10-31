import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import * as THREE from 'three';
import { RING_N, ringPoints } from './geometry.js';
import { useTimeline } from '../../core/useTimeline.js';
import { METRICS } from './metrics.js';

const rad = (d) => (d * Math.PI) / 180;
// data space is z-up (x east, y north); three.js is y-up
const toWorld = (x, y, z) => [x, z, -y];

// ---- colour spectrum --------------------------------------------------------
const clamp01 = (t) => Math.min(1, Math.max(0, t));
// Turbo colormap (polynomial fit): the full blue -> green -> yellow -> red sweep.
function turbo(t) {
  t = clamp01(t);
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return new THREE.Color().setRGB(clamp01(r), clamp01(g), clamp01(b), THREE.SRGBColorSpace);
}
const stops = (hex) => (t) => {
  const x = clamp01(t) * (hex.length - 1);
  const i = Math.min(hex.length - 2, Math.floor(x));
  return new THREE.Color(hex[i]).lerp(new THREE.Color(hex[i + 1]), x - i);
};
const CMAPS = {
  Turbo: turbo,
  Viridis: stops(['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6dcd59', '#b4de2c', '#fde725']),
  Inferno: stops(['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4']),
  'Cool-warm': stops(['#3b4cc0', '#8db0fe', '#dddddd', '#f4987a', '#b40426']),
};
const NEUTRAL = new THREE.Color('#e9e6de');
const bearing = (deg) => ({ x: Math.sin(rad(deg)), y: Math.cos(rad(deg)) });

// Turns the Viewer node's settings into a colouring function.
//   cfg: { color, cmap, range, min, max, reverse }; ref: the tower the
//   automatic range is taken from, so colours stay put while a run replays.
function makePainter(cfg, ref) {
  const metric = METRICS[cfg?.color];
  if (!metric || !ref) return { active: false, color: () => NEUTRAL };
  let [lo, hi] = metric.range === 'auto' ? [0, 0] : metric.range;
  if (cfg.range === 'Manual') [lo, hi] = [cfg.min, cfg.max];
  else if (metric.range === 'auto') {
    const v = ref.floors.map((f) => metric.value(f, { x: 0, y: 0 }, {}));
    lo = Math.min(...v);
    hi = Math.max(...v);
    if (hi - lo < 1e-9) hi = lo + 1;
  }
  const cmap = CMAPS[cfg.cmap] ?? turbo;
  const flip = cfg.reverse === 'Yes';
  const span = hi - lo || 1;
  const at = (t) => cmap(flip ? 1 - clamp01(t) : clamp01(t));
  return {
    active: true,
    name: cfg.color,
    unit: metric.unit,
    lo,
    hi,
    manual: cfg.range === 'Manual',
    cmap: at,
    color: (f, n, ctx) => at((metric.value(f, n, ctx) - lo) / span),
  };
}

// ---- tower geometry: a smooth loft through the floor outlines -------------
function buildTower(tower, paint) {
  const F = tower.floors;
  const m = RING_N;
  const rings = F.map(ringPoints);
  const zTop = F[F.length - 1].z + tower.h;
  const wind = tower.env.wind;
  const sunEnv = tower.env.sun;
  const ctx = {
    up: wind ? bearing(wind.from) : null,
    sun: sunEnv ? bearing(sunEnv.azimuth) : null,
  };

  const pos = [];
  const col = [];
  const addRing = (r, f, z) => {
    for (let k = 0; k < m; k++) {
      const a = r[(k + m - 1) % m];
      const b = r[(k + 1) % m];
      // outward normal of a counter-clockwise outline
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      const c = paint.color(f, { x: ty / len, y: -tx / len }, ctx);
      pos.push(...toWorld(r[k][0], r[k][1], z));
      col.push(c.r, c.g, c.b);
    }
  };
  F.forEach((f, i) => addRing(rings[i], f, f.z));
  addRing(rings[rings.length - 1], F[F.length - 1], zTop);

  const idx = [];
  for (let i = 0; i < F.length; i++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const a = i * m + k;
      const b = i * m + k2;
      const c = (i + 1) * m + k2;
      const d = (i + 1) * m + k;
      idx.push(a, b, c, a, c, d);
    }
  }
  // roof cap: a fan around the outline centre
  const topStart = F.length * m;
  const cx = rings[rings.length - 1].reduce((s, p) => s + p[0], 0) / m;
  const cy = rings[rings.length - 1].reduce((s, p) => s + p[1], 0) / m;
  const roof = paint.color(F[F.length - 1], { x: 0, y: 0 }, ctx).multiplyScalar(0.92);
  const centre = pos.length / 3;
  pos.push(...toWorld(cx, cy, zTop));
  col.push(roof.r, roof.g, roof.b);
  for (let k = 0; k < m; k++) idx.push(centre, topStart + ((k + 1) % m), topStart + k);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // slab edges as fine lines every few floors
  const lines = [];
  const step = Math.max(1, Math.round(F.length / 40));
  for (let i = 0; i < F.length; i += step) {
    const r = rings[i];
    for (let k = 0; k < m; k++) {
      const p = r[k];
      const q = r[(k + 1) % m];
      lines.push(...toWorld(p[0], p[1], F[i].z), ...toWorld(q[0], q[1], F[i].z));
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  return { geo, lineGeo };
}

function Tower({ tower, paint }) {
  const { geo, lineGeo } = useMemo(() => buildTower(tower, paint), [tower, paint]);
  useEffect(() => () => { geo.dispose(); lineGeo.dispose(); }, [geo, lineGeo]);
  const lit = paint.active;
  return (
    <group>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.32}
          metalness={0.05}
        />
      </mesh>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color={lit ? '#ffffff' : '#1b2a2a'} transparent opacity={lit ? 0.22 : 0.28} />
      </lineSegments>
    </group>
  );
}

// The very first iteration, shown as a faint outline for comparison.
function Ghost({ tower }) {
  const geo = useMemo(() => {
    const F = tower.floors;
    const pts = [];
    for (let i = 0; i < F.length; i += 5) {
      const r = ringPoints(F[i]);
      r.forEach((p, k) => {
        const q = r[(k + 1) % r.length];
        pts.push(...toWorld(p[0], p[1], F[i].z), ...toWorld(q[0], q[1], F[i].z));
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [tower]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#2f7d4f" transparent opacity={0.45} />
    </lineSegments>
  );
}

function Context({ context }) {
  return (
    <group>
      {context.buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, -b.y]} castShadow receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial
            color={new THREE.Color('#cfccc4').multiplyScalar(0.85 + 0.15 * Math.min(1, b.h / 200))}
            roughness={0.9}
          />
          <Edges color="#8d8a82" />
        </mesh>
      ))}
    </group>
  );
}

function WindArrow({ from }) {
  const arrow = useMemo(() => {
    const up = new THREE.Vector3(Math.sin(rad(from)), 0, -Math.cos(rad(from)));
    const origin = up.clone().multiplyScalar(190).setY(30);
    return new THREE.ArrowHelper(up.clone().negate(), origin, 90, 0x2f6fb0, 20, 12);
  }, [from]);
  return <primitive object={arrow} />;
}

function Scene({ tower, ghost, context, paint, showGhost }) {
  const sun = tower.env.sun || { azimuth: 150, altitude: 35 };
  const s = rad(sun.azimuth);
  const a = rad(sun.altitude);
  const sunPos = [Math.sin(s) * Math.cos(a) * 500, Math.sin(a) * 500, Math.cos(s) * Math.cos(a) * 500];
  return (
    <>
      <color attach="background" args={['#f3f1ec']} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#ffffff', '#c9c4b8', 0.4]} />
      <directionalLight
        position={sunPos}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-320}
        shadow-camera-right={320}
        shadow-camera-top={320}
        shadow-camera-bottom={-320}
        shadow-camera-near={10}
        shadow-camera-far={1400}
        shadow-bias={-0.0004}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.2, 0]}>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color="#dcd9d0" roughness={1} />
      </mesh>
      <gridHelper args={[800, 40, '#c4c0b5', '#d0ccc1']} position={[0, 0.05, 0]} />
      {context && <Context context={context} />}
      <Tower tower={tower} paint={paint} />
      {showGhost && ghost && <Ghost tower={ghost} />}
      {tower.env.wind && <WindArrow from={tower.env.wind.from} />}
    </>
  );
}

const fmtLegend = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : String(Number(v.toPrecision(3))));

function Legend({ paint }) {
  const gradient = useMemo(() => {
    if (!paint.active) return '';
    const hex = Array.from({ length: 12 }, (_, i) => `#${paint.cmap(i / 11).getHexString(THREE.SRGBColorSpace)}`);
    return `linear-gradient(to right, ${hex.join(',')})`;
  }, [paint]);
  if (!paint.active) return null;
  return (
    <div className="legend">
      <b>
        {paint.name}
        {paint.unit}
      </b>
      <div className="bar" style={{ background: gradient }} />
      <span>{fmtLegend(paint.lo)}</span>
      <span>{fmtLegend(paint.hi)}</span>
      <small>{paint.manual ? 'manual range' : 'range from the tower'}</small>
    </div>
  );
}

export default function Viewport3D({ inputs: viewer, params: color }) {
  const [axo, setAxo] = useState(true);
  const [showGhost, setShowGhost] = useState(true);
  const [status, setStatus] = useState(null);
  const canExport = Boolean(window.swalloop);
  const onExport = async (v) => {
    setStatus('Exporting to FreeCAD...');
    const r = await window.swalloop.exportFreeCAD({ tower: v.tower, context: v.context });
    setStatus(r.ok ? `Saved: ${r.dir}` : `FreeCAD export failed: ${r.error}`);
    setTimeout(() => setStatus(null), 7000);
  };
  const paint = useMemo(() => makePainter(color, viewer?.tower), [color, viewer?.tower]);

  const { frames: history, last, count, max, shownIter, frame, setIter, playing, setPlaying } =
    useTimeline(viewer?.history);

  if (!viewer?.tower) {
    return <div className="viewport empty">Connect a tower to a Viewer node to see it here.</div>;
  }

  const shown = history && frame < last ? history[frame] : viewer.tower;
  // frames inside the loop skipped post-processing (e.g. Sun), so borrow the
  // environment from the final tower
  const tower = { ...shown, env: { ...viewer.tower.env, ...shown.env } };

  return (
    <div className="viewport">
      <Canvas
        key={axo ? 'axo' : 'persp'}
        shadows
        orthographic={axo}
        camera={
          axo
            ? { position: [320, 300, 320], zoom: 1.5, near: -3000, far: 5000 }
            : { position: [360, 240, 360], fov: 32, near: 1, far: 5000 }
        }
      >
        <Scene tower={tower} ghost={history?.[0]} context={viewer.context} paint={paint} showGhost={showGhost} />
        <OrbitControls makeDefault target={[0, 90, 0]} />
      </Canvas>

      <div className="vp-bar top">
        <div className="seg">
          <button className={axo ? 'on' : ''} onClick={() => setAxo(true)}>Axo</button>
          <button className={!axo ? 'on' : ''} onClick={() => setAxo(false)}>Perspective</button>
        </div>
        <label>
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
          Start form
        </label>
        {canExport && <button onClick={() => onExport(viewer)}>Export to FreeCAD</button>}
      </div>

      {history && (
        <div className="vp-bar bottom">
          <button onClick={() => setPlaying((p) => !p)}>{playing ? 'Stop' : 'Play'}</button>
          <input
            type="range"
            min={0}
            max={max}
            value={shownIter}
            onChange={(e) => {
              setPlaying(false);
              const v = Number(e.target.value);
              setIter(v >= count ? null : v);
            }}
          />
          <span>
            iteration {shownIter} / {max} max
            {shownIter >= count && count < max ? ` · converged at ${count}` : ''}
          </span>
        </div>
      )}
      {status && <div className="vp-status">{status}</div>}
      <Legend paint={paint} />
    </div>
  );
}
