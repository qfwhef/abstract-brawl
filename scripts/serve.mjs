import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './files.mjs';
const args = process.argv.slice(2), at = args.indexOf('--port');
const port = at < 0 ? 3100 : Number(args[at + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (route.includes('\\') || route.includes('\0') || route.split('/').some(p => p.startsWith('.'))) throw new Error('Invalid path');
    let file = path.resolve(root, '.' + route);
    if (path.relative(root, file).startsWith('..')) throw new Error('Outside root');
    if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) file = path.join(file, 'index.html');
    const real = fs.realpathSync(file);
    if (path.relative(root, real).startsWith('..') || !fs.statSync(real).isFile()) throw new Error('Invalid file');
    res.writeHead(200, { 'Content-Type': mime[path.extname(real)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(real).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
try {
  const { attach } = await import('../server/net-server.mjs');
  attach(server);
} catch {}
server.on('error', err => { console.error(err.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`抽象大乱斗（含 /ws 联机服务）：http://127.0.0.1:${port}/`));

