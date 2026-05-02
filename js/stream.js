// stream.js — XHR-based SSE reader.
// Why XHR and not fetch().body? Because iPhone 5s / iOS 12 Safari has no
// ReadableStream. XHR.onprogress fires repeatedly while bytes arrive and
// xhr.responseText grows incrementally — that is what we read here.

(function (global) {
  'use strict';

  /**
   * @param {Object} payload  Sent as JSON body to /api/chat
   * @param {Object} cb       { onDelta(text), onDone(reason), onError(msg) }
   * @returns {{abort: function}}
   */
  function streamChat(payload, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    // Some Safari versions buffer text/event-stream less aggressively if we
    // just leave responseType as the default (text). Do NOT set responseType
    // to 'stream' — old browsers will reject it.

    var lastIndex = 0;
    var buffer = '';
    var done = false;
    var aborted = false;

    function safeOnDelta(text) {
      if (!text) return;
      try { cb.onDelta && cb.onDelta(text); } catch (e) {}
    }

    function processChunk() {
      // Read only the new tail since last invocation.
      var responseText;
      try { responseText = xhr.responseText; } catch (e) { return; }
      if (responseText.length <= lastIndex) return;
      var newText = responseText.substring(lastIndex);
      lastIndex = responseText.length;
      buffer += newText;

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
        done = true;
        try { cb.onDone && cb.onDone('done'); } catch (e) {}
        return;
      }

      // Parse JSON. Old upstreams may stream non-JSON keepalives; ignore those.
      var obj;
      try { obj = JSON.parse(data); } catch (e) { return; }

      // Our proxy emits {error: "..."} on upstream failure.
      if (obj && obj.error) {
        done = true;
        try { cb.onError && cb.onError(String(obj.error)); } catch (e) {}
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
      // If the server returned a non-2xx, surface it.
      if (xhr.status < 200 || xhr.status >= 300) {
        try { cb.onError && cb.onError('HTTP ' + xhr.status); } catch (e) {}
        return;
      }
      if (!done) {
        try { cb.onDone && cb.onDone('end'); } catch (e) {}
      }
    };
    xhr.onerror = function () {
      if (aborted) return;
      try { cb.onError && cb.onError('network error'); } catch (e) {}
    };
    xhr.ontimeout = function () {
      if (aborted) return;
      try { cb.onError && cb.onError('timeout'); } catch (e) {}
    };

    try {
      xhr.send(JSON.stringify(payload));
    } catch (e) {
      try { cb.onError && cb.onError('send failed: ' + e.message); } catch (_) {}
    }

    return {
      abort: function () {
        aborted = true;
        try { xhr.abort(); } catch (e) {}
      }
    };
  }

  global.RetroStream = { streamChat: streamChat };

})(window);
