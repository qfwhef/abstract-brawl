/* Abstract Brawl production server (Node >= 22).
 * - Static hosting from ROOT (default: parent dir of this file), same rules as the dev static server.
 * - Online room WebSocket service attaches at /ws on the same port (see net-server.mjs).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { attach as attachRooms } from './net-server.mjs';

const root = path.resolve(process.env.ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.env.PORT || 80);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};
const compressible = new Set(['.html', '.js', '.css', '.md', '.json', '.svg']);
// Images are already compressed (webp/png); never re-compress them.
const longCache = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.woff2', '.ico']);

function cacheControlFor(ext) {
  if (ext === '.html') return 'no-cache'; // revalidate every visit so updates ship immediately
  if (longCache.has(ext)) return 'public, max-age=2592000'; // 30 days
  return 'no-cache'; // js/css: revalidate with ETag so code updates take effect immediately
}

function resolveSafe(route) {
  const file = path.resolve(root, '.' + route);
  if (path.relative(root, file).startsWith('..')) return null;
  let target = file;
  try {
    if (fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) target = path.join(target, 'index.html');
    target = fs.realpathSync(target);
  } catch { return null; }
  if (path.relative(root, target).startsWith('..')) return null;
  if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) return null;
  return target;
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let route;
  try { route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (route.includes('\0') || route.split('/').some(p => p.startsWith('.'))) { res.writeHead(400); res.end(); return; }
  const file = resolveSafe(route);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }

  const ext = path.extname(file).toLowerCase();
  const type = mime[ext] || 'application/octet-stream';
  const stat = fs.statSync(file);
  const headers = {
    'Content-Type': type,
    'Cache-Control': cacheControlFor(ext),
    'X-Content-Type-Options': 'nosniff',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  headers.ETag = etag;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }

  const wantsGzip = compressible.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (wantsGzip) headers['Content-Encoding'] = 'gzip';
  if (req.method === 'HEAD') {
    if (!wantsGzip) headers['Content-Length'] = stat.size;
    res.writeHead(200, headers); res.end(); return;
  }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  if (wantsGzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  else {
    headers['Content-Length'] = stat.size;
    stream.pipe(res);
  }
});

server.on('error', err => { console.error(err.message); process.exit(1); });
attachRooms(server);
server.listen(port, '0.0.0.0', () => console.log(`abstract-brawl server (static + /ws rooms) listening on 0.0.0.0:${port}, root=${root}`));
