// api/chat.js — Vercel Serverless Function
// Proxies an OpenAI-compatible /v1/chat/completions request and streams SSE
// chunks back to the browser. Designed so the client can read the response
// with old XHR.onprogress (no ReadableStream needed on the device side).

module.exports = async function handler(req, res) {
  // ---- CORS / origin gate ----------------------------------------------
  // The previous setup allowed any origin (`*`), which lets random
  // websites embed fetch('https://your-app.vercel.app/api/chat') in their
  // pages and burn your env-key tokens from visitors' browsers. We now
  // require the request's Origin (when present) to match an allowlist:
  //   - same-origin as the deploy itself
  //   - localhost (for dev)
  //   - anything in ALLOWED_ORIGINS env var (comma-separated)
  // Requests without an Origin header (curl, Postman, server-to-server)
  // are still accepted — those need to know the URL to call us.
  const allowedOrigin = resolveAllowedOrigin(req);
  if (req.headers.origin && !allowedOrigin) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Origin not allowed' }));
  }
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // Vercel Node functions parse JSON bodies automatically when the
  // Content-Type is application/json, but fall back to manual parsing.
  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return jsonError(res, 400, 'Invalid JSON body');
    }
  }

  const baseUrl = trimSlash(body && body.baseUrl);
  const apiKey = body && body.apiKey;
  const model = body && body.model;
  const messages = body && body.messages;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
  const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;

  // Fall back to server-side env vars when the client didn't provide creds.
  // This lets you bake the default mimo endpoint + key into Vercel env vars
  // (MIMO_BASE_URL / MIMO_API_KEY) without exposing them in the bundled JS.
  // We only fall back when BOTH baseUrl and apiKey are empty — mixing a
  // user-supplied baseUrl with the env key (or vice-versa) would silently
  // send the wrong key upstream.
  let upstreamBaseUrl = baseUrl;
  let upstreamApiKey = apiKey;
  let usedEnvFallback = false;
  if (!upstreamBaseUrl && !upstreamApiKey) {
    upstreamBaseUrl = trimSlash(process.env.MIMO_BASE_URL || '');
    upstreamApiKey = process.env.MIMO_API_KEY || '';
    usedEnvFallback = true;
  }

  if (!upstreamBaseUrl) {
    return jsonError(res, 400,
      'No baseUrl provided and MIMO_BASE_URL env var is not set on the server.');
  }
  if (!upstreamApiKey) {
    return jsonError(res, 400,
      'No apiKey provided and MIMO_API_KEY env var is not set on the server.');
  }
  if (!model) return jsonError(res, 400, 'model is required');
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(res, 400, 'messages must be a non-empty array');
  }

  // SSRF guard: only validate URLs that came from the client. Env-var
  // baseUrls are operator-controlled and trusted (e.g., a dev might point
  // at localhost during testing).
  if (!usedEnvFallback) {
    const urlCheck = validateUpstreamUrl(upstreamBaseUrl);
    if (!urlCheck.ok) {
      return jsonError(res, 400, 'Refused upstream URL: ' + urlCheck.reason);
    }
  }

  // Set SSE headers before we write anything. Vercel Node functions stream
  // when you call res.write() repeatedly without setting Content-Length.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.statusCode = 200;
  // Initial padding to defeat some proxies that buffer the first ~2KB.
  res.write(': retrochat connected\n\n');

  const upstreamUrl = buildChatUrl(upstreamBaseUrl);
  const payload = {
    model: model,
    messages: messages,
    temperature: temperature,
    stream: true
  };
  if (maxTokens) payload.max_tokens = maxTokens;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + upstreamApiKey,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    writeErrorFrame(res, 'Upstream unreachable: ' + (err && err.message));
    return res.end();
  }

  if (!upstream.ok) {
    let detail = '';
    try { detail = await upstream.text(); } catch (_) {}
    writeErrorFrame(res, 'Upstream ' + upstream.status + ': ' + truncate(detail, 400));
    return res.end();
  }

  // upstream.body is a web ReadableStream on Node 18 fetch.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let aborted = false;
  req.on('close', function () { aborted = true; try { reader.cancel(); } catch (_) {} });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (aborted) break;
      // Pass the bytes through verbatim. The OpenAI-compatible upstream
      // already emits `data: {...}\n\n` frames, which is what the client
      // parser expects. We do not reframe.
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    writeErrorFrame(res, 'Stream error: ' + (err && err.message));
  }

  res.end();
};

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    req.on('data', function (chunk) {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', function () {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function jsonError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message }));
}

function writeErrorFrame(res, message) {
  const safe = String(message).replace(/\r?\n/g, ' ');
  res.write('data: ' + JSON.stringify({ error: safe }) + '\n\n');
}

function trimSlash(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/\/+$/, '');
}

// Accept any of these baseUrl shapes and produce the right /chat/completions URL:
//   https://api.example.com                  -> /v1/chat/completions
//   https://api.example.com/v1               -> /chat/completions
//   https://api.example.com/v1/chat/completions  -> use as-is
function buildChatUrl(baseUrl) {
  var u = trimSlash(baseUrl);
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v\d+$/.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---- CORS allowlist --------------------------------------------------------

function resolveAllowedOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return null;             // non-browser request — no CORS header

  // Same-origin (typical Vercel deploy: page and API share the host).
  const host = req.headers.host || '';
  if (host) {
    if (origin === 'https://' + host) return origin;
    if (origin === 'http://' + host)  return origin;
  }

  // Localhost dev on any port (http or https).
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin;
  }

  // Operator-defined extras (comma-separated).
  const extras = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(function (s) { return s.trim(); })
    .filter(Boolean);
  if (extras.indexOf(origin) >= 0) return origin;

  return null;
}

// ---- SSRF guard ------------------------------------------------------------

function validateUpstreamUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); }
  catch (e) { return { ok: false, reason: 'invalid URL' }; }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: 'only http(s) protocols allowed' };
  }

  const host = (u.hostname || '').toLowerCase();
  if (!host) return { ok: false, reason: 'missing hostname' };

  // Block obvious internal hostnames.
  if (host === 'localhost' || host.endsWith('.localhost') ||
      host === 'metadata' || host === 'metadata.google.internal') {
    return { ok: false, reason: 'internal hostname blocked' };
  }

  // IPv4 literal — block private / reserved ranges.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split('.').map(Number);
    if (p.some(function (n) { return Number.isNaN(n) || n < 0 || n > 255; })) {
      return { ok: false, reason: 'malformed IPv4' };
    }
    if (p[0] === 0)                                       return { ok: false, reason: '0.0.0.0/8 blocked' };
    if (p[0] === 10)                                      return { ok: false, reason: 'private 10/8 blocked' };
    if (p[0] === 127)                                     return { ok: false, reason: 'loopback blocked' };
    if (p[0] === 169 && p[1] === 254)                     return { ok: false, reason: 'link-local 169.254/16 blocked (cloud metadata)' };
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31)         return { ok: false, reason: 'private 172.16/12 blocked' };
    if (p[0] === 192 && p[1] === 168)                     return { ok: false, reason: 'private 192.168/16 blocked' };
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127)        return { ok: false, reason: 'CGNAT 100.64/10 blocked' };
    if (p[0] >= 224)                                      return { ok: false, reason: 'multicast/reserved blocked' };
  }

  // IPv6 — block loopback, link-local, unique-local.
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return { ok: false, reason: 'IPv6 loopback blocked' };
  }
  if (host.indexOf(':') >= 0) {
    if (host.startsWith('fe8') || host.startsWith('fe9') ||
        host.startsWith('fea') || host.startsWith('feb')) {
      return { ok: false, reason: 'IPv6 link-local fe80::/10 blocked' };
    }
    if (host.startsWith('fc') || host.startsWith('fd')) {
      return { ok: false, reason: 'IPv6 unique-local fc00::/7 blocked' };
    }
  }

  return { ok: true };
}
