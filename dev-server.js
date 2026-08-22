// dev-server.js — minimal local dev server.
// Mimics Vercel's behavior: routes /api/chat to api/chat.js handler,
// and serves everything else as static files from the repo root.
// Run with: node dev-server.js  (default port 3000)

const http = require('http');
const fs = require('fs');
const os = require('os');
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

// Files this server must never hand out.
//
// It serves the repo root, which contains `.env.local` (your PRESET_API_KEY)
// and `.git/config` (possibly a credentialed remote URL). Since we listen on
// every interface so you can open the app from a phone on the same WiFi,
// anyone on that network could previously just fetch them:
//     curl http://<your-lan-ip>:3000/.env.local
// Production is unaffected — Vercel only deploys committed files and both are
// gitignored — so this is strictly a dev-server hazard, but a live one.
//
// Rule: reject any path with a dot-prefixed segment, plus node_modules.
// A denylist rather than an allowlist so adding e.g. robots.txt at the root
// doesn't silently 404.
function isForbiddenPath(pathname) {
  var segs = pathname.split('/');
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (!s) continue;
    if (s.charAt(0) === '.') return true;      // .env, .env.local, .git, .vercel, .claude
    if (s === 'node_modules') return true;
  }
  return false;
}

// Best-effort LAN address, so the startup banner tells the truth about what
// is reachable instead of printing an unhelpful 0.0.0.0.
function lanAddress() {
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    if (!Object.prototype.hasOwnProperty.call(ifaces, name)) continue;
    var list = ifaces[name] || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
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

  if (isForbiddenPath(pathname)) return send404(res);

  // Prevent path traversal. normalize() collapses ".." and join() re-roots
  // the result, but we still assert containment explicitly — and compare
  // against ROOT + separator so a sibling directory sharing our prefix
  // (…/retro-chat-secrets) can't slip through a bare startsWith.
  const safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if (filePath !== ROOT && filePath.indexOf(ROOT + path.sep) !== 0) {
    return send404(res);
  }

  serveFile(res, filePath);
});

server.listen(PORT, () => {
  const lan = lanAddress();
  console.log('');
  console.log('  RetroChat dev server');
  console.log('  --------------------');
  console.log('  Local:   http://localhost:' + PORT);
  if (lan) {
    console.log('  Network: http://' + lan + ':' + PORT);
    console.log('');
    console.log('  ! Reachable by anyone on this network, and /api/chat will');
    console.log('    spend the key in .env.local. Dotfiles are not served.');
  }
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
