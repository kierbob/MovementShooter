// Host online: runs the game server AND a free Cloudflare quick tunnel, so anyone can join
// from anywhere through the GitHub Pages site. Prints a join link and copies it to the clipboard.
//   node host.js            (or double-click host-online.bat)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const GAME_URL = process.env.GAME_URL || 'https://kierbob.github.io/MovementShooter/';
const BIN = join(HERE, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const DOWNLOAD = {
  win32: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  linux: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
}[process.platform];

async function ensureCloudflared() {
  if (existsSync(BIN)) return;
  if (!DOWNLOAD) throw new Error('Auto-download only supports Windows/Linux; install cloudflared yourself.');
  mkdirSync(dirname(BIN), { recursive: true });
  console.log('First run: downloading cloudflared (Cloudflare\'s tunnel program) from its official GitHub releases…');
  const res = await fetch(DOWNLOAD);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const tmp = BIN + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp, { mode: 0o755 }));
  renameSync(tmp, BIN);
  console.log('Downloaded.');
}

function copyToClipboard(text) {
  try {
    const cmd = process.platform === 'win32' ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : null;
    if (!cmd) return false;
    const p = spawn(cmd);
    p.stdin.end(text);
    return true;
  } catch { return false; }
}

await ensureCloudflared();
await import('./server.js'); // start the game server in this same process

console.log('Opening Cloudflare tunnel…');
const tunnel = spawn(BIN, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let announced = false, found = false;

// A brand-new quick tunnel takes ~10–30 s before it's reachable. Poll it (our WebSocket server
// answers a plain HTTP request with "426 Upgrade Required") and only then print the link.
async function waitUntilReachable(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.status === 426 || res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const onOutput = async (chunk) => {
  const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || found) return;
  found = true;
  console.log('Tunnel created, waiting for it to come online (usually 10–30 s)…');
  const reachable = await waitUntilReachable(m[0]);
  if (!reachable) console.error('The tunnel is slow to respond; the link below may take a little longer to work.');
  announced = true;
  const host = m[0].replace('https://', '');
  const link = `${GAME_URL}?server=${host}`;
  const copied = copyToClipboard(link);
  console.log('\n==============================================================');
  console.log(' Server is ONLINE. Send this link to your friends:');
  console.log(`\n   ${link}\n`);
  console.log(copied ? ' (copied to your clipboard)' : '');
  console.log(' You can use the same link yourself.');
  console.log(' The address changes every time you restart this window.');
  console.log('==============================================================\n');
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('exit', (code) => {
  console.error(`Cloudflare tunnel stopped (code ${code}). Friends can no longer join; restart this window.`);
});
setTimeout(() => { if (!found) console.error('Still waiting for the tunnel… check your internet connection.'); }, 20000);

const shutdown = () => { tunnel.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
