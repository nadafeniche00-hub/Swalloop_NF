import { useContext } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { registry } from './core/registry.js';
import { EvalContext } from './context.js';

const fmt = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  return String(Number(v.toPrecision(4)));
};

export default function OpNode({ id, data }) {
  const def = registry.nodeTypes[data.type];
  const { updateNodeData, getEdges, getNode, addNodes } = useReactFlow();
  const { results, wired, pairs, types } = useContext(EvalContext);
  const res = results.get(id);
  // loop nodes take their data type from the wire into Loop Start's Initial
  const stateType =
    data.type === 'loopStart' ? types.outType(id, 'state') : data.type === 'loopEnd' ? types.outType(id, 'result') : null;
  const wires = wired.get(id) || new Set();
  const setParam = (pid, value) =>
    updateNodeData(id, (n) => ({ params: { ...n.data.params, [pid]: value } }));

  const rawNumber = (pid) => (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) setParam(pid, v);
  };

  // Loop End: the node feeding the paired Loop Start can adopt the result, if its
  // type declares an adopt(value) -> params hook (the Tower does).
  const adopt = (() => {
    if (data.type !== 'loopEnd' || !res || res.error || data.params.kind === 'For each') return null;
    const startId = pairs.get(id);
    const wire = startId && getEdges().find((e) => e.target === startId && e.targetHandle === 'initial');
    const src = wire && getNode(wire.source);
    const hook = src && registry.nodeTypes[src.data.type]?.adopt;
    const value = res.outputs?.result;
    return hook && value ? { src, hook, value } : null;
  })();
  const adoptHere = () =>
    updateNodeData(adopt.src.id, (n) => ({ params: { ...n.data.params, ...adopt.hook(adopt.value) } }));
  const adoptAsNew = () => {
    const type = adopt.src.data.type;
    addNodes({
      id: `${type}-${Date.now().toString(36)}`,
      type: 'op',
      position: { x: adopt.src.position.x, y: adopt.src.position.y + 440 },
      data: { type, params: { ...adopt.src.data.params, ...adopt.hook(adopt.value) } },
    });
  };

  return (
    <div className="node" style={{ '--cat': registry.categoryColor(def.category) }}>
      <div className="node-head">
        <span>{def.title}</span>
        <small>
          {def.category}
          {stateType && stateType !== 'any' ? ` · ${stateType}` : ''}
        </small>
      </div>

      {def.inputs.map((port) => (
        <div className="row in" key={port.id}>
          <Handle type="target" position={Position.Left} id={port.id} className={`h-${types.inType(id, port.id)}`} />
          <span className="label">{port.label}</span>
          {data.type === 'readout' && <span className="value">{fmt(res?.inputs?.value)}</span>}
        </div>
      ))}

      {def.params
        .filter((p) => !p.visible || p.visible(data.params))
        .map((p) => {
        const linked = wires.has(p.id);
        const value = data.params[p.id];
        return (
          <div className="row in param" key={p.id}>
            {!p.select && (
              <Handle type="target" position={Position.Left} id={p.id} className="h-number" />
            )}
            <span className="label">{p.label}</span>
            {p.select ? (
              <select
                className="nodrag"
                value={value}
                onChange={(e) => setParam(p.id, e.target.value)}
              >
                {p.select.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : p.slider ? (
              <span className="slider nodrag">
                <input
                  type="range"
                  min={data.params.min}
                  max={data.params.max}
                  step={(data.params.max - data.params.min) / 200}
                  value={value}
                  disabled={linked}
                  onChange={rawNumber(p.id)}
                />
                <em>{fmt(value)}</em>
              </span>
            ) : (
              <input
                className="nodrag"
                type="number"
                value={value}
                step={p.step}
                min={p.min}
                max={p.max}
                disabled={linked}
                onChange={rawNumber(p.id)}
              />
            )}
          </div>
        );
      })}

      {def.outputs.map((port) => {
        const v = res?.outputs?.[port.id];
        return (
          <div className="row out" key={port.id}>
            {port.type === 'number' && <span className="value">{fmt(v)}</span>}
            <span className="label">{port.label}</span>
            <Handle type="source" position={Position.Right} id={port.id} className={`h-${types.outType(id, port.id)}`} />
          </div>
        );
      })}

      {adopt && (
        <div className="actions nodrag">
          <button onClick={adoptHere} title="Store this result in the node that feeds Loop Start and switch it to Adopted">
            Adopt result
          </button>
          <button onClick={adoptAsNew} title="Copy the node that feeds Loop Start and give the copy this result">
            Adopt as new
          </button>
        </div>
      )}

      {def.describe && !res?.error && (
        <div className="note">
          {def.describe(data.params)}
          {data.type === 'loopEnd' ? ` Paired with ${pairs.get(id) ? 'Loop Start' : 'nothing'}.` : ''}
        </div>
      )}
      {res?.error && <div className="error">{res.error}</div>}
    </div>
  );
}
