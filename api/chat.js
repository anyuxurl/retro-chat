// api/chat.js — Vercel Serverless Function
// Proxies an OpenAI-compatible /v1/chat/completions request and streams SSE
// chunks back to the browser. Designed so the client can read the response
// with old XHR.onprogress (no ReadableStream needed on the device side).

module.exports = async function handler(req, res) {
  // CORS — same-origin in production, but useful for local tooling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
  if (!upstreamBaseUrl && !upstreamApiKey) {
    upstreamBaseUrl = trimSlash(process.env.MIMO_BASE_URL || '');
    upstreamApiKey = process.env.MIMO_API_KEY || '';
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
