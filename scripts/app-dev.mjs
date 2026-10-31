// Starts the Vite dev server and opens Electron on it (hot reload in the desktop window).
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5173, strictPort: true } });
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SWALLOOP_DEV_URL: url },
});
electron.on('close', async () => {
  await server.close();
  process.exit(0);
});
