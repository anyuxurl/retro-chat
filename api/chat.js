// api/chat.js — Vercel Serverless Function
// Proxies an OpenAI-compatible /v1/chat/completions request and streams SSE
// chunks back to the browser. Designed so the client can read the response
// with old XHR.onprogress (no ReadableStream needed on the device side).

module.exports = async function handler(req, res) {
  // ---- CORS / origin gate ----------------------------------------------
  // Allowing any origin (`*`) would let random websites embed
  // fetch('https://your-app.vercel.app/api/chat') in their pages and burn
  // your env-key tokens from visitors' browsers. We require the request's
  // Origin (when present) to match an allowlist:
  //   - same-origin as the deploy itself
  //   - localhost (for dev)
  //   - anything in ALLOWED_ORIGINS env var (comma-separated)
  const originHeader = (req.headers && req.headers.origin) || '';
  const allowedOrigin = originHeader ? matchAllowlist(req, originHeader) : null;
  if (originHeader && !allowedOrigin) {
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

  // "Did this come from a browser sitting on one of our own pages?"
  // Origin alone is not enough to decide: some older WebKit builds (and the
  // iOS 12 Safari we explicitly target) are inconsistent about sending
  // Origin on same-origin XHR. So we accept an allowlisted Referer as a
  // second signal. Neither header is a security boundary against a
  // determined attacker — curl can forge both — which is exactly why the
  // rate limiter below is the real backstop. This check's job is narrower:
  // stop the trivial "point curl at the URL and get free tokens" case.
  const browserVerified = !!allowedOrigin || isAllowedReferer(req);

  // ---- Rate limit -------------------------------------------------------
  // Applied before body parsing so a flood can't make us read 2MB each time.
  const clientIp = clientIpOf(req);
  const verdict = rateLimit(clientIp, Date.now());
  if (!verdict.ok) {
    res.setHeader('Retry-After', String(verdict.retryAfter));
    return jsonError(res, 429,
      'Rate limit exceeded (' + verdict.scope + '). Retry in ' +
      verdict.retryAfter + 's.');
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
  if (!body || typeof body !== 'object') {
    return jsonError(res, 400, 'Invalid JSON body');
  }

  const baseUrl = trimSlash(body && body.baseUrl);
  const apiKey = body && body.apiKey;
  const model = body && body.model;
  const messages = body && body.messages;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;

  // Fall back to server-side env vars when the client didn't provide creds.
  // This lets you bake the default preset endpoint + key + model into Vercel
  // env vars (PRESET_BASE_URL / PRESET_API_KEY / PRESET_MODEL) without
  // exposing them in the bundled JS. Legacy MIMO_* names are still honoured.
  // We only fall back when BOTH baseUrl and apiKey are empty — mixing a
  // user-supplied baseUrl with the env key (or vice-versa) would silently
  // send the wrong key upstream.
  let upstreamBaseUrl = baseUrl;
  let upstreamApiKey = apiKey;
  let upstreamModel = model;
  let usedEnvFallback = false;
  if (!upstreamBaseUrl && !upstreamApiKey) {
    // Spending the OPERATOR's key. Anyone who knows the deploy URL could
    // otherwise curl this endpoint and get unmetered AI on your bill, so
    // the env-credential path is gated on the request looking like it came
    // from a browser sitting on one of our own pages. Requests that bring
    // their own baseUrl+apiKey skip this gate — they spend their own money.
    // Set ALLOW_KEYLESS_API=1 to opt out (e.g. a trusted server-to-server
    // integration that legitimately has no Origin/Referer).
    if (!browserVerified && process.env.ALLOW_KEYLESS_API !== '1') {
      return jsonError(res, 403,
        'This endpoint only serves the server preset to requests from an ' +
        'allowed origin. Supply your own baseUrl + apiKey, or add your ' +
        'origin to ALLOWED_ORIGINS.');
    }
    upstreamBaseUrl = trimSlash(process.env.PRESET_BASE_URL || process.env.MIMO_BASE_URL || '');
    upstreamApiKey = process.env.PRESET_API_KEY || process.env.MIMO_API_KEY || '';
    // The preset's model id is server-controlled too; ignore any client
    // value so the operator can swap models purely from the Vercel dashboard.
    upstreamModel = process.env.PRESET_MODEL || upstreamModel;
    usedEnvFallback = true;
  }

  if (!upstreamBaseUrl) {
    return jsonError(res, 400,
      'No baseUrl provided and PRESET_BASE_URL env var is not set on the server.');
  }
  if (!upstreamApiKey) {
    return jsonError(res, 400,
      'No apiKey provided and PRESET_API_KEY env var is not set on the server.');
  }
  if (!upstreamModel) {
    return jsonError(res, 400,
      'No model provided and PRESET_MODEL env var is not set on the server.');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(res, 400, 'messages must be a non-empty array');
  }

  // ---- Input caps -------------------------------------------------------
  // Without these a single request can carry an arbitrarily large prompt,
  // which is the other half of the cost problem: the rate limiter bounds
  // how OFTEN you can call, this bounds how EXPENSIVE one call can be.
  const shape = checkMessages(messages);
  if (!shape.ok) return jsonError(res, 400, shape.reason);

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
    model: upstreamModel,
    messages: messages,
    temperature: temperature,
    stream: true
  };
  // Always cap the reply length. An uncapped completion is unbounded spend,
  // and the client never sends maxTokens today, so previously every request
  // ran with whatever the upstream default was. A client may ask for LESS
  // than the cap but never more. Set MAX_TOKENS_CAP=0 to disable capping.
  const maxTokens = resolveMaxTokens(body.maxTokens);
  if (maxTokens) payload.max_tokens = maxTokens;

  // ---- Deadline guard ---------------------------------------------------
  // Vercel enforces maxDuration (configured in vercel.json). If we run right
  // up against it the platform kills the function mid-frame and the browser
  // sees a silently truncated answer — indistinguishable from the model just
  // stopping. So we stop ourselves slightly early and emit a real error
  // frame the UI can show. The AbortController covers both the initial
  // fetch (an upstream that never responds) and the read loop.
  const budgetMs = intEnv('STREAM_BUDGET_MS', 55000);
  const ac = new AbortController();
  let timedOut = false;
  const deadline = budgetMs
    ? setTimeout(function () { timedOut = true; try { ac.abort(); } catch (_) {} }, budgetMs)
    : null;
  const clearDeadline = function () { if (deadline) clearTimeout(deadline); };

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + upstreamApiKey,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
  } catch (err) {
    clearDeadline();
    writeErrorFrame(res, timedOut
      ? 'Upstream did not respond within ' + Math.round(budgetMs / 1000) + 's.'
      : 'Upstream unreachable: ' + (err && err.message));
    return res.end();
  }

  if (!upstream.ok) {
    clearDeadline();
    let detail = '';
    try { detail = await upstream.text(); } catch (_) {}
    writeErrorFrame(res, 'Upstream ' + upstream.status + ': ' + truncate(detail, 400));
    return res.end();
  }

  // upstream.body is a web ReadableStream on Node 18 fetch.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let aborted = false;
  req.on('close', function () {
    aborted = true;
    try { ac.abort(); } catch (_) {}
    try { reader.cancel(); } catch (_) {}
  });

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
    if (!timedOut && !aborted) {
      writeErrorFrame(res, 'Stream error: ' + (err && err.message));
    }
  }

  clearDeadline();
  // Tell the user why the reply stops here rather than letting it look like
  // the model finished. The client keeps whatever text already streamed.
  if (timedOut) {
    writeErrorFrame(res,
      'Response truncated: hit the ' + Math.round(budgetMs / 1000) +
      's server time limit. Try a shorter prompt, or raise maxDuration in ' +
      'vercel.json (and STREAM_BUDGET_MS) on a plan that allows it.');
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

// ---- Abuse limits ----------------------------------------------------------
// All tunable from the Vercel dashboard without touching client code.

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function limits() {
  return {
    perMinute: intEnv('RATE_LIMIT_RPM', 15),
    perHour: intEnv('RATE_LIMIT_RPH', 120),
    maxMessages: intEnv('MAX_MESSAGES', 100),
    maxChars: intEnv('MAX_INPUT_CHARS', 60000),
    maxTokensCap: intEnv('MAX_TOKENS_CAP', 8192)
  };
}

function resolveMaxTokens(requested) {
  const cap = limits().maxTokensCap;
  const asked = (typeof requested === 'number' && requested > 0)
    ? Math.floor(requested) : 0;
  if (!cap) return asked;               // cap disabled — honour client only
  if (!asked) return cap;
  return Math.min(asked, cap);
}

function checkMessages(messages) {
  const L = limits();
  if (L.maxMessages && messages.length > L.maxMessages) {
    return { ok: false, reason: 'Too many messages (max ' + L.maxMessages + ')' };
  }
  let chars = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object') {
      return { ok: false, reason: 'messages[' + i + '] must be an object' };
    }
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') {
      return { ok: false, reason: 'messages[' + i + '] has an unsupported role' };
    }
    if (typeof m.content !== 'string') {
      return { ok: false, reason: 'messages[' + i + '].content must be a string' };
    }
    chars += m.content.length;
  }
  if (L.maxChars && chars > L.maxChars) {
    return { ok: false, reason: 'Prompt too large (max ' + L.maxChars + ' chars)' };
  }
  return { ok: true };
}

// Sliding-window rate limiter, per client IP.
//
// IMPORTANT CAVEAT: this lives in the process's memory. Vercel reuses warm
// instances, so it reliably catches a single client hammering one instance
// — the common abuse case — but it is NOT a global limit: concurrent cold
// starts each get their own window. For a hard guarantee, back this with
// Upstash/Vercel KV. Treat it as a speed bump plus a spend ceiling, not a
// cryptographic boundary.
const rateBuckets = new Map();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_TRACKED_IPS = 5000;

function rateLimit(key, now) {
  const L = limits();
  if (!L.perMinute && !L.perHour) return { ok: true };

  let hits = rateBuckets.get(key);
  if (!hits) {
    hits = [];
    rateBuckets.set(key, hits);
  }

  // Drop anything outside the widest window we care about.
  const oldest = now - HOUR;
  while (hits.length && hits[0] < oldest) hits.shift();

  if (L.perHour && hits.length >= L.perHour) {
    return {
      ok: false,
      scope: 'hourly',
      retryAfter: Math.max(1, Math.ceil((hits[0] + HOUR - now) / 1000))
    };
  }
  if (L.perMinute) {
    const minuteAgo = now - MINUTE;
    let inMinute = 0;
    let firstInMinute = now;
    for (let i = hits.length - 1; i >= 0; i--) {
      if (hits[i] < minuteAgo) break;
      inMinute++;
      firstInMinute = hits[i];
    }
    if (inMinute >= L.perMinute) {
      return {
        ok: false,
        scope: 'per-minute',
        retryAfter: Math.max(1, Math.ceil((firstInMinute + MINUTE - now) / 1000))
      };
    }
  }

  hits.push(now);
  pruneBuckets(now);
  return { ok: true };
}

// Keep the map from growing without bound on a long-lived warm instance.
function pruneBuckets(now) {
  if (rateBuckets.size <= MAX_TRACKED_IPS) return;
  const cutoff = now - HOUR;
  for (const [k, v] of rateBuckets) {
    if (!v.length || v[v.length - 1] < cutoff) rateBuckets.delete(k);
  }
  // Still oversized (all entries active) — evict oldest-inserted first.
  // Map preserves insertion order, so this drops the least-recently-created.
  if (rateBuckets.size > MAX_TRACKED_IPS) {
    const excess = rateBuckets.size - MAX_TRACKED_IPS;
    let i = 0;
    for (const k of rateBuckets.keys()) {
      if (i++ >= excess) break;
      rateBuckets.delete(k);
    }
  }
}

function clientIpOf(req) {
  const h = req.headers || {};
  // Vercel sets this itself and it cannot be spoofed by the caller.
  const vercel = h['x-vercel-forwarded-for'];
  if (vercel) return String(vercel).split(',')[0].trim();
  const xff = h['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const real = h['x-real-ip'];
  if (real) return String(real).trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ---- CORS allowlist --------------------------------------------------------

function matchAllowlist(req, origin) {
  if (!origin) return null;

  // Same-origin (typical Vercel deploy: page and API share the host).
  const host = (req.headers && req.headers.host) || '';
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

// Second-chance browser signal for clients that omit Origin on same-origin
// POSTs. We only read the scheme+host of the Referer, never the path.
function isAllowedReferer(req) {
  const referer = (req.headers && req.headers.referer) || '';
  if (!referer) return false;
  let u;
  try { u = new URL(referer); } catch (e) { return false; }
  return !!matchAllowlist(req, u.protocol + '//' + u.host);
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
