// dev-server.js — minimal local dev server.
// Mimics Vercel's behavior: routes /api/chat to api/chat.js handler,
// and serves everything else as static files from the repo root.
// Run with: node dev-server.js  (default port 3000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Tiny .env loader — read .env.local and .env if present, populate
// process.env. Mirrors what `vercel dev` does so local + deployed behave
// the same. Already-set env vars are NOT overwritten.
function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let loaded = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
      loaded++;
    }
  }
  if (loaded > 0) {
    console.log('  [env] loaded ' + loaded + ' var(s) from ' + path.basename(filePath));
  }
}
loadDotenv(path.join(ROOT, '.env.local'));
loadDotenv(path.join(ROOT, '.env'));

const apiHandler = require('./api/chat.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function send404(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('404 Not Found');
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send404(res);
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || '/');

  // API route
  if (pathname === '/api/chat') {
    try {
      await apiHandler(req, res);
    } catch (err) {
      console.error('[api/chat] handler threw:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
      } else {
        try { res.end(); } catch (_) {}
      }
    }
    return;
  }

  // Static files — default to /index.html for "/"
  if (pathname === '/') pathname = '/index.html';

  // Prevent path traversal.
  const safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return send404(res);

  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  RetroChat dev server');
  console.log('  --------------------');
  console.log('  Local:   http://localhost:' + PORT);
  console.log('  Network: http://0.0.0.0:' + PORT);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
