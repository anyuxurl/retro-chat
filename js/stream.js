// stream.js — XHR-based SSE reader.
// Why XHR and not fetch().body? Because iPhone 5s / iOS 12 Safari has no
// ReadableStream. XHR.onprogress fires repeatedly while bytes arrive and
// xhr.responseText grows incrementally — that is what we read here.

(function (global) {
  'use strict';

  // How long we tolerate silence before declaring the stream dead.
  //
  // A fixed xhr.timeout is the wrong tool: it caps TOTAL duration, so any
  // value short enough to catch a hang would also kill a legitimately long
  // answer. Instead we watch for *silence* and reset the clock on every
  // byte that arrives, so a reply can stream for as long as it likes as
  // long as it keeps making progress.
  //
  // Two phases, because they fail differently:
  //   • CONNECT — our own proxy writes a padding frame immediately, so if
  //     nothing at all shows up the request never reached it.
  //   • STALL   — after bytes start, a reasoning model can legitimately go
  //     quiet for a while before its first token, so this is generous.
  var CONNECT_TIMEOUT_MS = 30000;
  var STALL_TIMEOUT_MS = 90000;
  // Absolute backstop so a pathological connection can't leak a timer
  // forever. Far above any real reply.
  var HARD_TIMEOUT_MS = 15 * 60 * 1000;

  /**
   * @param {Object} payload  Sent as JSON body to /api/chat
   * @param {Object} cb       { onDelta(text, kind), onDone(reason), onError(msg) }
   * @returns {{abort: function}}
   */
  function streamChat(payload, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    // Some Safari versions buffer text/event-stream less aggressively if we
    // just leave responseType as the default (text). Do NOT set responseType
    // to 'stream' — old browsers will reject it.
    xhr.timeout = HARD_TIMEOUT_MS;

    var lastIndex = 0;
    var buffer = '';
    var done = false;
    var aborted = false;
    var settled = false;
    var gotBytes = false;
    var watchdog = null;

    // ---- settle / watchdog -------------------------------------------
    // Every exit path funnels through here so onDone/onError fire exactly
    // once and the watchdog timer can never outlive the request.
    function clearWatchdog() {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    }

    function armWatchdog() {
      clearWatchdog();
      if (settled || aborted) return;
      var wait = gotBytes ? STALL_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
      watchdog = setTimeout(function () {
        watchdog = null;
        fireError(gotBytes
          ? 'stream stalled (no data for ' + Math.round(STALL_TIMEOUT_MS / 1000) + 's)'
          : 'no response from server (' + Math.round(CONNECT_TIMEOUT_MS / 1000) + 's)');
        // Stop the dead request so it can't resurrect after we've reported.
        aborted = true;
        try { xhr.abort(); } catch (e) {}
      }, wait);
    }

    function fireDone(reason) {
      if (settled) return;
      settled = true;
      done = true;
      clearWatchdog();
      try { cb.onDone && cb.onDone(reason); } catch (e) {}
    }

    function fireError(msg) {
      if (settled) return;
      settled = true;
      done = true;
      clearWatchdog();
      try { cb.onError && cb.onError(String(msg)); } catch (e) {}
    }

    function processChunk() {
      // Read only the new tail since last invocation.
      var responseText;
      try { responseText = xhr.responseText; } catch (e) { return; }
      if (responseText.length <= lastIndex) return;
      var newText = responseText.substring(lastIndex);
      lastIndex = responseText.length;
      buffer += newText;

      // Progress — restart the silence clock.
      gotBytes = true;
      armWatchdog();

      // SSE frames are separated by a blank line. Some servers use \r\n\r\n.
      // Split on either.
      var sepRe = /\r?\n\r?\n/;
      var parts = buffer.split(sepRe);
      buffer = parts.pop(); // last piece may be partial

      for (var i = 0; i < parts.length; i++) {
        if (done) return;
        parseFrame(parts[i]);
      }
    }

    function parseFrame(frame) {
      if (!frame) return;
      // A frame is one or more lines. We only care about `data:` lines.
      var lines = frame.split(/\r?\n/);
      var dataLines = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf(':') === 0) continue;          // SSE comment line
        if (line.indexOf('data:') === 0) {
          // Per spec, strip a single leading space.
          var v = line.substring(5);
          if (v.charAt(0) === ' ') v = v.substring(1);
          dataLines.push(v);
        }
      }
      if (dataLines.length === 0) return;
      var data = dataLines.join('\n');

      if (data === '[DONE]') {
        fireDone('done');
        return;
      }

      // Parse JSON. Old upstreams may stream non-JSON keepalives; ignore those.
      var obj;
      try { obj = JSON.parse(data); } catch (e) { return; }

      // Our proxy emits {error: "..."} on upstream failure.
      if (obj && obj.error) {
        fireError(String(obj.error));
        return;
      }

      // OpenAI-compatible delta extraction.
      // Some models (mimo, deepseek-reasoner, o1-style) emit a separate
      // `delta.reasoning_content` stream BEFORE `delta.content`. We surface
      // both with a `kind` flag so the UI can render reasoning differently.
      var deltaText = '';
      var deltaKind = 'content';
      if (obj && obj.choices && obj.choices.length) {
        var c0 = obj.choices[0];
        if (c0) {
          if (c0.delta) {
            if (typeof c0.delta.reasoning_content === 'string' && c0.delta.reasoning_content) {
              deltaText = c0.delta.reasoning_content;
              deltaKind = 'reasoning';
            } else if (typeof c0.delta.content === 'string' && c0.delta.content) {
              deltaText = c0.delta.content;
              deltaKind = 'content';
            }
          } else if (c0.message && typeof c0.message.content === 'string') {
            deltaText = c0.message.content;
            deltaKind = 'content';
          }
        }
      }
      if (deltaText) {
        try { cb.onDelta && cb.onDelta(deltaText, deltaKind); } catch (e) {}
      }
    }

    xhr.onprogress = function () {
      if (aborted) return;
      processChunk();
    };
    xhr.onreadystatechange = function () {
      // Safari 12 sometimes batches progress events. Reading on state 3
      // (HEADERS_RECEIVED is 2, LOADING is 3) gives us extra opportunities.
      if (xhr.readyState === 3 && !aborted) processChunk();
    };
    xhr.onload = function () {
      if (aborted) return;
      processChunk(); // flush
      // If the server returned a non-2xx, surface it. Our error responses are
      // JSON ({"error": "..."}), so prefer that message over a bare status —
      // "Rate limit exceeded" is far more actionable than "HTTP 429".
      if (xhr.status < 200 || xhr.status >= 300) {
        fireError(errorFromResponse(xhr));
        return;
      }
      fireDone('end');
    };
    xhr.onerror = function () {
      if (aborted) return;
      fireError('network error');
    };
    xhr.ontimeout = function () {
      if (aborted) return;
      fireError('timeout');
    };

    try {
      xhr.send(JSON.stringify(payload));
      armWatchdog();
    } catch (e) {
      fireError('send failed: ' + e.message);
    }

    return {
      abort: function () {
        aborted = true;
        settled = true;      // suppress late onDone/onError from the abort
        clearWatchdog();
        try { xhr.abort(); } catch (e) {}
      }
    };
  }

  // Pull the server's JSON error message out of a non-2xx response, falling
  // back to the bare status when the body isn't ours (proxy/CDN error page).
  function errorFromResponse(xhr) {
    var text = '';
    try { text = xhr.responseText || ''; } catch (e) {}
    if (text) {
      try {
        var obj = JSON.parse(text);
        if (obj && obj.error) return String(obj.error);
      } catch (e) { /* not JSON — fall through */ }
    }
    return 'HTTP ' + xhr.status;
  }

  global.RetroStream = { streamChat: streamChat };

})(window);
