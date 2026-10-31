import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import OpNode from './NodeView.jsx';
import Start from './Start.jsx';
import { fileToGraph, graphToFile } from './core/graphFile.js';
import { EvalContext } from './context.js';
import { evaluate, wouldCycle } from './core/engine.js';
import { registry } from './core/registry.js';
import { compatible, resolveTypes } from './core/types.js';
import './packs/index.js'; // registers the node packs
import { VIEWS } from './packs/views.jsx';

const nodeTypes = { op: OpNode };
const TEMPLATE_NAMES = Object.keys(registry.templates);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canvas';

function Editor({ initial, meta, onHome }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [toast, setToast] = useState(null);
  const [template, setTemplate] = useState(meta.name);
  const [description, setDescription] = useState(meta.description ?? '');
  const fileInput = useRef(null);
  const [activeView, setActiveView] = useState(null);
  const counter = useRef(100);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Re-evaluate only when something other than node positions changes.
  const signature = useMemo(
    () =>
      JSON.stringify([
        nodes.map((n) => [n.id, n.data]),
        edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle]),
      ]),
    [nodes, edges],
  );
  const startSignature = useRef(signature);
  const evaluation = useMemo(
    () => evaluate(nodes, edges, registry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  // Port types, with Loop Start / Loop End following the data wired into them.
  const types = useMemo(
    () => resolveTypes(nodes, edges, registry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const wired = useMemo(() => {
    const m = new Map();
    for (const e of edges) {
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.target).add(e.targetHandle);
    }
    return m;
  }, [edges]);

  const ctxValue = useMemo(
    () => ({ results: evaluation.results, wired, pairs: evaluation.pairs, types }),
    [evaluation, wired, types],
  );

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(null), 5000);
  };

  const isValidConnection = useCallback(
    (c) => {
      const s = nodes.find((n) => n.id === c.source);
      const t = nodes.find((n) => n.id === c.target);
      if (!s || !t || s.id === t.id) return false;
      return compatible(types.outType(s.id, c.sourceHandle), types.inType(t.id, c.targetHandle));
    },
    [nodes, types],
  );

  const onConnect = useCallback(
    (c) => {
      if (wouldCycle(edges, c.source, c.target)) {
        showToast(
          'Refused: this wire would feed a result back into its own inputs. Use Loop Start and Loop End for feedback.',
        );
        return;
      }
      setEdges((es) =>
        addEdge(
          { ...c, id: `${c.source}.${c.sourceHandle}-${c.target}.${c.targetHandle}` },
          es.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle)),
        ),
      );
    },
    [edges, setEdges],
  );

  const addNode = (type) => {
    const id = `${type}-${counter.current++}`;
    const jitter = (counter.current % 5) * 24;
    const position = screenToFlowPosition({
      x: window.innerWidth * 0.14 + jitter,
      y: window.innerHeight * 0.3 + jitter,
    });
    setNodes((ns) => [
      ...ns,
      { id, type: 'op', position, data: { type, params: registry.defaultParams(type) } },
    ]);
  };

  const show = (g, name, desc) => {
    setTemplate(name);
    setDescription(desc ?? '');
    setNodes(g.nodes);
    setEdges(g.edges);
    startSignature.current = null; // a freshly loaded canvas is not "modified"
    setTimeout(() => fitView({ padding: 0.1 }), 50);
  };

  const loadTemplate = (name) => show(registry.templates[name](), name, registry.templateInfo[name]?.description);

  const leave = () => {
    const dirty = startSignature.current !== null && startSignature.current !== signature;
    if (!dirty || window.confirm('Leave this canvas? Changes since it was opened are not saved.')) onHome();
  };

  const saveFile = () => {
    const file = graphToFile({ nodes, edges }, { name: template, description });
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(template)}.swalloop.json`;
    a.click();
    URL.revokeObjectURL(url);
    startSignature.current = signature;
    showToast(`Saved ${a.download}`);
  };

  const openFile = async (f) => {
    try {
      const g = fileToGraph(JSON.parse(await f.text()), registry);
      show(g, g.meta.name, g.meta.description);
      if (g.problems.length) showToast(`Opened with ${g.problems.length} wire(s) skipped: ${g.problems[0]}`);
    } catch (err) {
      showToast(`Could not open the file: ${err.message}`);
    }
  };

  // Wires whose types no longer fit (e.g. after changing what feeds a loop) are drawn red.
  const shownEdges = useMemo(
    () =>
      edges.map((e) =>
        types.edgeOk(e)
          ? e
          : { ...e, label: 'type mismatch', style: { stroke: '#e0574a', strokeDasharray: '5 4', strokeWidth: 1.8 } },
      ),
    [edges, types],
  );

  // View nodes (Viewer, Inspector) that evaluate without error; one drives the right-hand pane.
  const viewNodes = nodes.filter(
    (n) => VIEWS[n.data.type] && evaluation.results.get(n.id) && !evaluation.results.get(n.id).error,
  );
  const viewNode = viewNodes.find((n) => n.id === activeView) ?? viewNodes[0];
  const View = viewNode ? VIEWS[viewNode.data.type] : null;
  const viewResult = viewNode ? evaluation.results.get(viewNode.id) : null;

  return (
    <EvalContext.Provider value={ctxValue}>
      <div className="app">
        <aside className="palette">
          <h1 className="brand">
            <svg viewBox="0 0 64 40" width="34" height="22" aria-hidden="true">
              <path d="M2 6 C16 2 26 10 32 22 C38 10 48 2 62 6 C50 8 42 16 36 28 L40 38 L32 31 L24 38 L28 28 C22 16 14 8 2 6 Z" fill="currentColor" />
            </svg>
            Swalloop
            <small>hironboucle</small>
          </h1>
          <button className="home" onClick={leave}>
            ← Start screen
          </button>
          <label className="preset">
            Template
            <select value={template} onChange={(e) => loadTemplate(e.target.value)}>
              {!registry.templates[template] && <option value={template}>{template}</option>}
              {TEMPLATE_NAMES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <div className="filebar">
            <button onClick={() => fileInput.current?.click()}>Open file…</button>
            <button onClick={saveFile}>Save file</button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.swalloop"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) openFile(f);
                e.target.value = '';
              }}
            />
          </div>
          {registry.categories.map((cat) => {
            const types = Object.entries(registry.nodeTypes).filter(([, d]) => d.category === cat.name);
            if (!types.length) return null;
            return (
              <section key={cat.name}>
                <h2 style={{ color: cat.color }}>{cat.name}</h2>
                {types.map(([type, d]) => (
                  <button key={type} onClick={() => addNode(type)}>
                    + {d.title}
                  </button>
                ))}
              </section>
            );
          })}
          <p className="hint">Select a node or wire and press Delete to remove it.</p>
        </aside>

        <main className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
            fitViewOptions={{ padding: 0.1 }}
            minZoom={0.15}
            colorMode="dark"
            defaultEdgeOptions={{ style: { strokeWidth: 1.6 } }}
          >
            <Background gap={22} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="minimap" />
          </ReactFlow>
          {toast && <div className="toast">{toast}</div>}
        </main>

        <section className="view">
          {viewNodes.length > 1 && (
            <div className="viewswitch">
              View
              <select value={viewNode.id} onChange={(e) => setActiveView(e.target.value)}>
                {viewNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {registry.nodeTypes[n.data.type].title} ({n.id})
                  </option>
                ))}
              </select>
            </div>
          )}
          {View ? (
            <View key={viewNode.id} inputs={viewResult.inputs} params={viewResult.params} />
          ) : (
            <div className="viewport empty">Connect data to a Viewer node to see it here.</div>
          )}
        </section>
      </div>
    </EvalContext.Provider>
  );
}

export default function App() {
  const [session, setSession] = useState(null); // null = start screen
  const [error, setError] = useState('');

  const begin = (graph, meta) => {
    setError('');
    setSession({ key: Date.now(), graph, meta });
  };
  const openTemplate = (name) =>
    begin(registry.templates[name](), { name, description: registry.templateInfo[name]?.description });
  const openBlank = () => begin({ nodes: [], edges: [] }, { name: 'Untitled', description: '' });
  const openFile = async (f) => {
    try {
      const g = fileToGraph(JSON.parse(await f.text()), registry);
      begin({ nodes: g.nodes, edges: g.edges }, g.meta);
    } catch (err) {
      setError(`Could not open ${f.name}: ${err.message}`);
    }
  };

  if (!session) return <Start onTemplate={openTemplate} onBlank={openBlank} onFile={openFile} error={error} />;
  return (
    <ReactFlowProvider key={session.key}>
      <Editor initial={session.graph} meta={session.meta} onHome={() => setSession(null)} />
    </ReactFlowProvider>
  );
}
