// Electron main process: opens the app window and runs FreeCAD on request.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEV_URL = process.env.SWALLOOP_DEV_URL; // set by `npm run app:dev`

function findFreeCAD() {
  if (process.env.FREECAD_CMD && fs.existsSync(process.env.FREECAD_CMD)) return process.env.FREECAD_CMD;
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs')];
  for (const root of roots.filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => /^freecad/i.test(d)).sort().reverse()) {
      const exe = path.join(root, dir, 'bin', 'FreeCADCmd.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    backgroundColor: '#12171a',
    title: 'Swalloop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('freecad:export', async (_event, payload) => {
  const exe = findFreeCAD();
  if (!exe) return { ok: false, error: 'FreeCADCmd.exe not found. Install FreeCAD or set FREECAD_CMD.' };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(app.getPath('documents'), 'Swalloop', `export-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const input = path.join(os.tmpdir(), `swalloop-${stamp}.json`);
  fs.writeFileSync(input, JSON.stringify(payload));

  return new Promise((resolve) => {
    // FreeCAD is an external process and cannot read inside app.asar, so the
    // script is copied out to a real file first.
    const script = path.join(os.tmpdir(), 'swalloop_freecad_export.py');
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'freecad_export.py')));
    const child = spawn(exe, [script], {
      env: { ...process.env, SWALLOOP_IN: input, SWALLOOP_OUT: dir },
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      fs.rmSync(input, { force: true });
      if (code === 0 && fs.existsSync(path.join(dir, 'tower.FCStd'))) {
        shell.showItemInFolder(path.join(dir, 'tower.FCStd'));
        resolve({ ok: true, dir });
      } else {
        resolve({ ok: false, error: `FreeCAD exited with code ${code}. ${log.slice(-400)}` });
      }
    });
  });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
