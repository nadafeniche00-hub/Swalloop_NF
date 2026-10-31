// Small dependency-free SVG charts for the Inspector.

const W = 420;
const H = 130;
const P = 26;

export const fmt = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  if (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) return v.toExponential(2);
  return String(Number(v.toPrecision(4)));
};

// values: numbers; marker: index to highlight; log: plot log10 (for convergence curves)
export function LineChart({ values, marker, log = false }) {
  const data = values.map((v) => (log ? Math.log10(Math.max(v, 1e-12)) : v)).filter(Number.isFinite);
  if (data.length < 2) return <div className="sub">not enough data for a chart</div>;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const x = (i) => P + ((W - 2 * P) * i) / (data.length - 1);
  const y = (v) => H - P - ((H - 2 * P) * (v - lo)) / span;
  const label = (v) => (log ? `1e${Math.round(v)}` : fmt(v));
  const m = marker == null ? null : Math.min(data.length - 1, Math.max(0, marker));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <line className="grid" x1={P} x2={W - P} y1={H - P} y2={H - P} />
      <line className="grid" x1={P} x2={P} y1={P / 2} y2={H - P} />
      <polyline className="line" points={data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
      {m != null && <circle className="mark" cx={x(m)} cy={y(data[m])} r="4" />}
      <text x={P + 4} y={P / 2 + 8}>{label(hi)}</text>
      <text x={P + 4} y={H - P - 4}>{label(lo)}</text>
      <text x={W - P} y={H - 8} textAnchor="end">iteration {data.length - 1}</text>
    </svg>
  );
}

export function BarChart({ values }) {
  const data = values.slice(0, 200);
  const lo = Math.min(0, ...data);
  const hi = Math.max(0, ...data);
  const span = hi - lo || 1;
  const bw = (W - 2 * P) / data.length;
  const y = (v) => H - P - ((H - 2 * P) * (v - lo)) / span;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <line className="grid" x1={P} x2={W - P} y1={y(0)} y2={y(0)} />
      {data.map((v, i) => (
        <rect key={i} className="bar" x={P + i * bw + bw * 0.1} width={bw * 0.8} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} />
      ))}
      <text x={P + 4} y={P / 2 + 8}>{fmt(hi)}</text>
      <text x={P + 4} y={H - 8}>{fmt(lo)}</text>
    </svg>
  );
}
