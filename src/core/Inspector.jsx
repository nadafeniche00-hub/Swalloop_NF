import { useMemo } from 'react';
import { BarChart, LineChart, fmt } from './charts.jsx';
import { DATA_VIEWS } from './dataViews.js';
import { registry } from './registry.js';
import { useTimeline } from './useTimeline.js';

const isNumberList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number');

function Body({ value, numericSeries, marker }) {
  if (typeof value === 'boolean') {
    return (
      <>
        <div className="big">{String(value)}</div>
        <div className="sub">boolean</div>
      </>
    );
  }
  if (typeof value === 'number') {
    return (
      <>
        <div className="big">{fmt(value)}</div>
        <div className="sub">number</div>
        {numericSeries && <LineChart values={numericSeries} marker={marker} />}
      </>
    );
  }
  if (isNumberList(value)) {
    return (
      <>
        <div className="sub">list of {value.length} numbers</div>
        <BarChart values={value} />
      </>
    );
  }
  const text = JSON.stringify(value, (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v), 2) ?? 'undefined';
  return (
    <>
      <div className="sub">{Array.isArray(value) ? `list of ${value.length}` : typeof value}</div>
      <pre>{text.length > 6000 ? `${text.slice(0, 6000)}\n...` : text}</pre>
    </>
  );
}

// Shows whatever flows into an Inspector node, picking a view by data type.
export default function Inspector({ inputs }) {
  const { value, history } = inputs;
  const view = DATA_VIEWS.find((v) => v.is(value));
  const tl = useTimeline(history);

  // how much the state changed at each iteration: a convergence curve for any data type
  const change = useMemo(() => {
    const f = history?.frames;
    if (!f || f.length < 2) return null;
    return f.slice(1).map((s, i) => registry.distance(f[i], s)).filter(Number.isFinite);
  }, [history]);
  const numeric = useMemo(
    () => (history?.frames?.every((s) => typeof s === 'number') ? history.frames : null),
    [history],
  );

  if (view) {
    const Component = view.Component;
    return <Component value={value} history={history} />;
  }

  const shown = tl.frames && tl.frame < tl.last ? tl.frames[tl.frame] : value;
  return (
    <div className="inspector">
      <div className="body">
        <Body value={shown} numericSeries={numeric} marker={tl.frame} />
      </div>
      {change && change.length > 1 && (
        <div className="panel">
          <h3>Change per iteration (log scale)</h3>
          <LineChart values={change} marker={Math.min(change.length - 1, Math.max(0, tl.frame - 1))} log />
        </div>
      )}
      {tl.frames && (
        <div className="bar-row">
          <button onClick={() => tl.setPlaying((p) => !p)}>{tl.playing ? 'Stop' : 'Play'}</button>
          <input
            type="range"
            min={0}
            max={tl.max}
            value={tl.shownIter}
            onChange={(e) => {
              tl.setPlaying(false);
              const v = Number(e.target.value);
              tl.setIter(v >= tl.count ? null : v);
            }}
          />
          <span className="sub">
            iteration {tl.shownIter} / {tl.max} max
            {tl.shownIter >= tl.count && tl.count < tl.max ? ` · stopped at ${tl.count}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
