// Drives the running desktop app over the Chrome debugging port.
import { readFileSync } from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const run = (expression) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
}).then((d) => d.result?.result?.value ?? d.result);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('state  ', JSON.stringify(await run(`({ nodes: document.querySelectorAll('.react-flow__node').length, canvases: document.querySelectorAll('canvas').length, errors: document.querySelectorAll('.node .error').length, bridge: typeof window.swalloop, legend: document.querySelector('.legend')?.innerText, timeline: document.querySelector('.vp-bar.bottom span')?.innerText })`)));
await run(`[...document.querySelectorAll('.vp-bar.bottom button')][0].click()`);
await sleep(1200);
console.log('playing', await run(`document.querySelector('.vp-bar.bottom span')?.innerText`));
await sleep(7000);
console.log('after  ', await run(`document.querySelector('.vp-bar.bottom span')?.innerText`));
const payload = readFileSync(process.argv[2], 'utf8');
const t0 = Date.now();
const r = await run(`window.swalloop.exportFreeCAD(${payload})`);
console.log('export ', JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
ws.close();
