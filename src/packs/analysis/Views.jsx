// Views for the analysis pack's data: a heatmap for splat grids, a multi-line plot for compared
// profiles, and an outline plot for point lists. Registered with the Inspector by shape, so any
// node that produces such data gets a picture instead of JSON.
import { useEffect, useMemo, useRef } from 'react';
import { registerDataView } from '../../core/dataViews.js';
import { fmt } from '../../core/charts.jsx';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
export const isGrid = (v) => Boolean(v) && v.kind === 'grid' && Array.isArray(v.values);
export const isPoints = (v) => Array.isArray(v) && v.length >= 3 && v.every(isPoint);
export const isOutlines = (v) => Array.isArray(v) && v.length >= 1 && v.every(isPoints);
// two to four number lists of the same length (8 or more samples): profiles to compare
export const isSeries = (v) =>
  Array.isArray(v) &&
  v.length >= 2 &&
  v.length <= 4 &&
  v.every((l) => Array.isArray(l) && l.length >= 8 && l.length === v[0].length && l.every(isNum));

const COLORS = ['#e0824f', '#6aa5d6', '#c9b36a', '#b58be0'];

// dark blue -> teal -> green -> yellow -> red
const STOPS = [[18, 32, 74], [31, 120, 150], [70, 170, 110], [225, 205, 80], [215, 70, 50]];
function ramp(t) {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
}

function Heatmap({ value }) {
  const ref = useRef(null);
  const { n, values, extent } = value;
  const [lo, hi] = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (const row of values) for (const v of row) {
      if (v < a) a = v;
      if (v > b) b = v;
    }
    return [a, b];
  }, [values]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [r, g, b] = ramp(hi > lo ? (values[j][i] - lo) / (hi - lo) : 0);
        const o = ((n - 1 - j) * n + i) * 4; // row 0 is the south edge: draw it at the bottom
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [values, n, lo, hi]);

  return (
    <div className="plotview">
      <div className="sub">
        field {n} x {n}, {2 * extent} m across, north up
      </div>
      <canvas ref={ref} className="heat" style={{ imageRendering: 'pixelated' }} />
      <div className="legend-bar">
        <span>{fmt(lo)}</span>
        <i style={{ background: `linear-gradient(90deg, ${STOPS.map((s) => `rgb(${s})`).join(',')})` }} />
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}

function Series({ value }) {
  const W = 560;
  const H = 280;
  const pad = 36;
  const all = value.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const n = value[0].length;
  const x = (i) => pad + ((W - 2 * pad) * i) / (n - 1);
  const y = (v) => H - pad - ((H - 2 * pad) * (v - lo)) / span;
  return (
    <div className="plotview">
      <div className="sub">
        {value.length} profiles of {n} samples
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="plot">
        <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="none" stroke="#2a3c50" />
        <text x={pad - 6} y={pad + 4} textAnchor="end" className="tick">{fmt(hi)}</text>
        <text x={pad - 6} y={H - pad + 4} textAnchor="end" className="tick">{fmt(lo)}</text>
        {value.map((line, k) => (
          <polyline
            key={k}
            fill="none"
            stroke={COLORS[k]}
            strokeWidth={k === 0 ? 1.6 : 2.2}
            strokeOpacity={k === 0 ? 0.75 : 1}
            points={line.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="swatches">
        {value.map((_, k) => (
          <span key={k}>
            <i style={{ background: COLORS[k] }} />
            {'ABCD'[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

function Outlines({ value }) {
  const list = isPoints(value) ? [value] : value;
  const all = list.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0) || 1;
  const m = size * 0.08;
  const many = list.length > 6;
  const color = (k) => (many ? `hsl(${Math.round(20 + (200 * k) / Math.max(1, list.length - 1))} 70% 60%)` : COLORS[k % COLORS.length]);
  return (
    <div className="plotview">
      <div className="sub">
        {list.length} outline{list.length === 1 ? '' : 's'}, equal scale, y up
      </div>
      <svg
        viewBox={`${x0 - m} ${-(y1 + m)} ${x1 - x0 + 2 * m} ${y1 - y0 + 2 * m}`}
        className="plot square"
        preserveAspectRatio="xMidYMid meet"
      >
        <line x1={x0 - m} x2={x1 + m} y1={0} y2={0} stroke="#2a3c50" strokeWidth={size / 400} />
        <line x1={0} x2={0} y1={-(y1 + m)} y2={-(y0 - m)} stroke="#2a3c50" strokeWidth={size / 400} />
        {list.map((pts, k) => (
          <polygon
            key={k}
            fill="none"
            stroke={color(k)}
            strokeWidth={size / (many ? 450 : 220)}
            points={pts.map((p) => `${p[0]},${-p[1]}`).join(' ')}
          />
        ))}
      </svg>
    </div>
  );
}

registerDataView({ name: 'grid', is: isGrid, Component: ({ value }) => <Heatmap value={value} /> });
registerDataView({ name: 'series', is: isSeries, Component: ({ value }) => <Series value={value} /> });
registerDataView({
  name: 'outlines',
  is: (v) => isPoints(v) || isOutlines(v),
  Component: ({ value }) => <Outlines value={value} />,
});
