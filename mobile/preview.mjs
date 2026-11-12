// Opens the mobile build in a phone-sized desktop window (Edge/Chrome app mode).
// No Android SDK or emulator needed. The dev server stands in for Capacitor's native HTTP.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const url = `http://127.0.0.1:${port}/`;

console.log('Building mobile bundle...');
const build = spawnSync(process.execPath, [join(root, 'mobile', 'build.mjs')], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

const server = spawn(process.execPath, [join(root, 'mobile', 'dev-server.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit']
});
server.stdout.on('data', (d) => process.stdout.write(d));
server.on('exit', (code) => { if (!shuttingDown) { console.error('Preview server stopped'); process.exit(code || 1); } });
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try { server.kill(); } catch (e) {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const candidates = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) {
  console.error(`No Edge/Chrome found. The preview is ready at ${url}`);
  console.error('Press Ctrl+C to stop the server.');
  setInterval(() => {}, 1 << 30);
} else {
setTimeout(() => {
  const profile = join(os.tmpdir(), 'noctra-mobile-preview');
  console.log(`Opening ${url} in a phone-sized window...`);
  const child = spawn(browser, [
    `--app=${url}`,
    '--window-size=390,844',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-features=Translate'
  ], { stdio: 'ignore' });
  child.on('exit', shutdown);
}, 900);
}
