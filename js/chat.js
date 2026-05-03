// chat.js — conversation state, rendering, sending, streaming append.

(function (global, $) {
  'use strict';

  // Harden marked's link rendering once at startup. Two goals:
  //   1) Block dangerous URL schemes (javascript:, vbscript:, data:, file:)
  //      that would otherwise render as clickable links in AI responses.
  //   2) Force every external link to open in a new tab without leaking
  //      the referrer / opener handle back to the destination.
  if (global.marked && typeof global.marked.use === 'function') {
    global.marked.use({
      renderer: {
        link: function (href, title, text) {
          if (!isSafeHref(href)) return text;        // strip the link entirely
          var attrs = ' href="' + escapeAttr(href) + '"';
          if (title) attrs += ' title="' + escapeAttr(title) + '"';
          attrs += ' target="_blank" rel="noopener noreferrer"';
          return '<a' + attrs + '>' + text + '</a>';
        }
      }
    });
  }

  function isSafeHref(href) {
    if (typeof href !== 'string') return false;
    var s = href.trim();
    if (!s) return false;
    // Allow relative, root-relative, and fragment refs.
    if (s.charAt(0) === '/' || s.charAt(0) === '#' || s.charAt(0) === '?') return true;
    if (/^\.\.?\//.test(s)) return true;
    // Otherwise require an explicit safe scheme.
    return /^(https?|mailto|tel):/i.test(s);
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var state = {
    currentId: '',
    messages: [],     // [{role, content, ts}]
    streaming: false,
    activeStream: null
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(text) {
    if (global.marked && typeof global.marked.parse === 'function') {
      try {
        // marked v4 escapes HTML by default — safe for untrusted content.
        return global.marked.parse(text || '', { breaks: true, gfm: true });
      } catch (e) { /* fall through */ }
    }
    // Fallback: escape and convert newlines.
    return escapeHtml(text || '').replace(/\n/g, '<br>');
  }

  function roleLabel(role) {
    if (role === 'user') return RetroI18n.t('msg.role.you');
    if (role === 'assistant') return RetroI18n.t('msg.role.ai');
    if (role === 'system') return RetroI18n.t('msg.role.sys');
    return role;
  }

  function buildBubble(msg) {
    var $row = $('<div class="msg"></div>').addClass(msg.role);
    var $bub = $('<div class="bubble"></div>');
    $bub.append($('<span class="role"></span>').text(roleLabel(msg.role)));
    if (msg.reasoning) {
      // Collapsible thinking block — open by default while streaming, the
      // caller may choose to collapse it once content starts arriving.
      var $details = $('<details class="reasoning"></details>');
      $details.append($('<summary></summary>').text(RetroI18n.t('msg.thinking_done')));
      $details.append($('<div class="reasoning-content"></div>').text(msg.reasoning));
      $bub.append($details);
    }
    var $content = $('<div class="content"></div>').html(renderMarkdown(msg.content || ''));
    $bub.append($content);
    // Copy button on assistant messages only — user messages are typed
    // by the user, errors are rendered with a different style.
    if (msg.role === 'assistant') {
      $bub.append(
        $('<div class="msg-actions"></div>').append(
          $('<button class="msg-copy" type="button"></button>').text(RetroI18n.t('msg.copy'))
        )
      );
    }
    $row.append($bub);
    return $row;
  }

  // Clipboard with iOS 12 fallback. navigator.clipboard.writeText needs
  // iOS 13.4+ AND a secure context, so on the device we explicitly target
  // we cannot rely on it. The execCommand path works on iOS 10+.
  function copyText(text) {
    if (global.navigator && global.navigator.clipboard &&
        typeof global.navigator.clipboard.writeText === 'function' &&
        global.isSecureContext) {
      return global.navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return execCommandCopy(text); });
    }
    return Promise.resolve(execCommandCopy(text));
  }

  function execCommandCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) {}
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // Locate the assistant content text for a copy click. We use the message
  // index in state.messages — derived from DOM position — because the
  // rendered HTML may include a reasoning block we don't want copied.
  function copyMessageFromButton(btn) {
    var $btn = $(btn);
    var $row = $btn.closest('.msg');
    if (!$row.length) return;
    // The rendered DOM order matches state.messages 1:1.
    var idx = $('#messages > .msg').index($row);
    if (idx < 0 || idx >= state.messages.length) return;
    var m = state.messages[idx];
    if (m.role !== 'assistant' || !m.content) return;
    copyText(m.content).then(function (ok) {
      if (!ok) return;
      $btn.text(RetroI18n.t('msg.copied')).addClass('copied');
      setTimeout(function () {
        $btn.text(RetroI18n.t('msg.copy')).removeClass('copied');
      }, 1200);
    });
  }

  function renderAll() {
    var $msgs = $('#messages');
    $msgs.empty();
    if (!state.messages.length) {
      var $empty = $('<div class="empty"></div>');
      $empty.append($('<div class="empty-title"></div>').text(RetroI18n.t('empty.title_new')));
      $empty.append($('<div class="empty-hint"></div>').text(RetroI18n.t('empty.hint_new')));
      $msgs.append($empty);
      return;
    }
    for (var i = 0; i < state.messages.length; i++) {
      $msgs.append(buildBubble(state.messages[i]));
    }
    scrollToBottom();
  }

  function appendMessage(msg) {
    var $msgs = $('#messages');
    $msgs.find('.empty').remove();
    var $row = buildBubble(msg);
    $msgs.append($row);
    scrollToBottom();
    return $row;
  }

  // Auto-scroll behaviour: only stick to the bottom when the user is
  // already there. If they've scrolled up to read history, leave them be.
  // We reset on conversation switch / new conversation so a fresh thread
  // always glues to the bottom for the first round.
  var userScrolledUp = false;
  var SCROLL_GLUE_PX = 80;

  function bindScrollWatcher() {
    var el = document.getElementById('messages');
    if (!el || el._retroScrollBound) return;
    el._retroScrollBound = true;
    el.addEventListener('scroll', function () {
      var distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp = distance > SCROLL_GLUE_PX;
    }, { passive: true });
  }

  function scrollToBottom(force) {
    var el = document.getElementById('messages');
    if (!el) return;
    if (!force && userScrolledUp) return;
    el.scrollTop = el.scrollHeight;
  }

  function resetScrollGlue() {
    userScrolledUp = false;
  }

  function persist() {
    if (!state.currentId) return;
    // Drop a trailing assistant placeholder that has no content yet — it
    // exists only to host the streaming UI bubble. If the user refreshes
    // mid-stream we don't want to load a ghost message from localStorage.
    var msgs = state.messages.slice();
    while (msgs.length) {
      var last = msgs[msgs.length - 1];
      if (last.role === 'assistant' && !last.content && !last.reasoning) {
        msgs.pop();
      } else {
        break;
      }
    }
    var conv = RetroStorage.getConversation(state.currentId);
    if (!conv) {
      // No content yet means no conversation worth saving — wait for the
      // first delta to arrive before creating the localStorage entry.
      if (!msgs.length) return;
      conv = {
        id: state.currentId,
        title: deriveTitle(msgs),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: msgs
      };
    } else {
      // Preserve an AI-generated title — only refresh the fallback title
      // (truncated first user message) when the AI hasn't named it yet.
      if (!conv.titleAiGenerated) {
        conv.title = deriveTitle(msgs);
      }
      conv.messages = msgs;
    }
    RetroStorage.saveConversation(conv);
    refreshSidebar();
  }

  function deriveTitle(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'user' && msgs[i].content) {
        var t = msgs[i].content.replace(/\s+/g, ' ').trim();
        return t.length > 30 ? t.substring(0, 30) + '…' : t;
      }
    }
    return RetroI18n.t('conv.new');
  }

  function refreshSidebar() {
    var $list = $('#conv-list');
    $list.empty();
    var convs = RetroStorage.listConversations();
    for (var i = 0; i < convs.length; i++) {
      var c = convs[i];
      var $li = $('<li class="conv-item"></li>')
        .attr('data-id', c.id)
        .text(c.title || RetroI18n.t('conv.untitled'));
      if (c.id === state.currentId) $li.addClass('active');
      $li.append($('<span class="del" data-id="' + c.id + '">&times;</span>'));
      $list.append($li);
    }
  }

  function loadConversation(id) {
    var conv = RetroStorage.getConversation(id);
    if (!conv) {
      // No such conversation; start fresh.
      newConversation();
      return;
    }
    state.currentId = id;
    state.messages = (conv.messages || []).slice();
    RetroStorage.setCurrentId(id);
    resetScrollGlue();
    renderAll();
    refreshSidebar();
  }

  function newConversation() {
    state.currentId = RetroStorage.newConversationId();
    state.messages = [];
    RetroStorage.setCurrentId(state.currentId);
    resetScrollGlue();
    renderAll();
    refreshSidebar();
  }

  function deleteConversation(id) {
    RetroStorage.deleteConversation(id);
    var convs = RetroStorage.listConversations();
    if (convs.length) loadConversation(convs[0].id);
    else newConversation();
  }

  function clearAll() {
    RetroStorage.clearAllConversations();
    newConversation();
  }

  function setStreamingUI(on) {
    state.streaming = on;
    var $btn = $('#btn-send');
    if (on) {
      $btn.text(RetroI18n.t('composer.stop')).addClass('stop');
    } else {
      $btn.text(RetroI18n.t('composer.send')).removeClass('stop');
    }
    $('#input').prop('disabled', false);
  }

  function send(text) {
    var cfg = RetroStorage.getConfig();
    // baseUrl/apiKey may be blank — the backend falls back to server env vars.
    // Only pop settings if model is missing (rare).
    if (!cfg.model) {
      RetroSettings.open(true);
      return;
    }
    if (state.streaming) return;
    if (!text || !text.trim()) return;

    // User just hit send — they want to see the result. Reset glue so we
    // auto-scroll even if they had been browsing history.
    resetScrollGlue();

    var userMsg = { role: 'user', content: text, ts: Date.now() };
    state.messages.push(userMsg);
    appendMessage(userMsg);

    var aiMsg = { role: 'assistant', content: '', reasoning: '', ts: Date.now() };
    state.messages.push(aiMsg);
    var $row = appendMessage(aiMsg);
    var $content = $row.find('.content');
    var $bubble = $row.find('.bubble');
    var $reasoning = null;          // lazy-created when first reasoning chunk arrives
    var $reasoningContent = null;
    var collapsedOnContent = false;

    persist();
    setStreamingUI(true);

    var apiMessages = buildApiMessages(state.messages);
    if (cfg.systemPrompt && typeof cfg.systemPrompt === 'string' && cfg.systemPrompt.trim()) {
      apiMessages.unshift({ role: 'system', content: cfg.systemPrompt.trim() });
    }

    var payload = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: Number(cfg.temperature) || 0.7,
      messages: apiMessages
    };

    var stream = RetroStream.streamChat(payload, {
      onDelta: function (delta, kind) {
        if (kind === 'reasoning') {
          aiMsg.reasoning += delta;
          if (!$reasoning) {
            $reasoning = $('<details class="reasoning" open></details>')
              .append($('<summary></summary>').text(RetroI18n.t('msg.thinking')));
            $reasoningContent = $('<div class="reasoning-content"></div>');
            $reasoning.append($reasoningContent);
            $bubble.find('.role').after($reasoning);
          }
          // .text() is a cheap textNode replace — no throttle needed.
          $reasoningContent.text(aiMsg.reasoning);
        } else {
          aiMsg.content += delta;
          // Auto-collapse the thinking block once the real answer starts.
          if (!collapsedOnContent && $reasoning) {
            $reasoning.removeAttr('open');
            $reasoning.find('summary').text(RetroI18n.t('msg.thinking_done'));
            collapsedOnContent = true;
          }
          // Throttle markdown re-rendering to ~80ms. Each marked.parse()
          // re-tokenises the entire response so far; on iPhone 5s a long
          // answer with 200+ deltas would otherwise stutter visibly.
          renderContentThrottled();
        }
        scrollToBottom();
      },
      onDone: function () {
        // Force a final flush so the user sees the complete, fully-parsed
        // markdown (the throttled version may still be 80ms behind).
        renderContentNow();
        setStreamingUI(false);
        state.activeStream = null;
        persist();
        // Best-effort: ask the model for a short title for new conversations.
        maybeAutoTitle(state.currentId);
      },
      onError: function (msg) {
        renderContentNow();
        setStreamingUI(false);
        state.activeStream = null;
        var errText = '\n\n' + RetroI18n.t('msg.error_prefix') + msg;
        if (!aiMsg.content) {
          // Convert the empty assistant bubble into an error one.
          state.messages.pop();           // drop empty assistant
          $row.remove();
          var errMsg = { role: 'error', content: msg, ts: Date.now() };
          state.messages.push(errMsg);
          var $err = appendMessage(errMsg);
          $err.addClass('error');
        } else {
          aiMsg.content += errText;
          renderContentNow();
        }
        scrollToBottom();
        persist();
      }
    });
    state.activeStream = stream;

    // Per-stream render throttler. Captured in this closure so multiple
    // simultaneous turns wouldn't share state (we don't allow that today,
    // but keeping it scoped means refactors later won't introduce bugs).
    var lastRenderAt = 0;
    var pendingRenderTimer = null;
    function renderContentNow() {
      if (pendingRenderTimer) {
        clearTimeout(pendingRenderTimer);
        pendingRenderTimer = null;
      }
      $content.html(renderMarkdown(aiMsg.content));
      lastRenderAt = Date.now();
    }
    function renderContentThrottled() {
      var now = Date.now();
      if (now - lastRenderAt >= 80) {
        renderContentNow();
        return;
      }
      if (pendingRenderTimer) return;
      pendingRenderTimer = setTimeout(function () {
        pendingRenderTimer = null;
        $content.html(renderMarkdown(aiMsg.content));
        lastRenderAt = Date.now();
      }, 80);
    }
  }

  function buildApiMessages(msgs) {
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
      if (!m.content) continue;
      out.push({ role: m.role, content: m.content });
    }
    // Drop the last empty assistant placeholder if present.
    if (out.length && out[out.length - 1].role === 'assistant' && !out[out.length - 1].content) {
      out.pop();
    }
    return out;
  }

  // ---------- Auto-title (AI-generated conversation titles) ----------

  // Track in-flight title generations so we don't fire twice if onDone
  // somehow runs again (e.g., user resends fast). Keyed by conversation id.
  var titleInFlight = {};

  function maybeAutoTitle(convId) {
    if (!convId) return;
    var cfg = RetroStorage.getConfig();
    if (cfg.autoTitle === false) return;
    if (titleInFlight[convId]) return;

    var conv = RetroStorage.getConversation(convId);
    if (!conv || conv.titleAiGenerated) return;

    // Only fire on the FIRST successful round: 1 user + 1 assistant w/ content.
    var users = 0, assists = 0, asstHasContent = false;
    for (var i = 0; i < conv.messages.length; i++) {
      var m = conv.messages[i];
      if (m.role === 'user') users++;
      else if (m.role === 'assistant') {
        assists++;
        if (m.content && m.content.length > 0) asstHasContent = true;
      }
    }
    if (users !== 1 || assists !== 1 || !asstHasContent) return;

    generateTitleAsync(convId, cfg);
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.substring(0, n) + '…' : s;
  }

  function generateTitleAsync(convId, cfg) {
    var conv = RetroStorage.getConversation(convId);
    if (!conv) return;

    var firstUser = '', firstAsst = '';
    for (var i = 0; i < conv.messages.length; i++) {
      var m = conv.messages[i];
      if (!firstUser && m.role === 'user' && m.content)      firstUser = m.content;
      if (!firstAsst && m.role === 'assistant' && m.content) firstAsst = m.content;
      if (firstUser && firstAsst) break;
    }
    if (!firstUser || !firstAsst) return;

    titleInFlight[convId] = true;

    var lang = (RetroI18n && RetroI18n.current && RetroI18n.current()) || 'en';
    var sysPrompt;
    if (lang === 'zh') {
      sysPrompt =
        '你是对话标题生成器。请基于下面的"用户提问"和"AI回答"，生成一个最长12个汉字、最能概括对话主题的标题。' +
        '只输出标题本身：不要引号、不要标点、不要任何说明文字、不要前缀如"标题："。';
    } else {
      sysPrompt =
        'You are a conversation title generator. Based on the user question and AI answer below, ' +
        'output a single concise title (max 6 words) summarising the topic. ' +
        'Output ONLY the title text — no quotes, no punctuation, no explanation, no prefix.';
    }

    var userBody = truncate(firstUser, 400) + '\n\n---\n\n' + truncate(firstAsst, 600);

    var collected = '';
    RetroStream.streamChat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user',   content: userBody }
      ]
    }, {
      onDelta: function (delta, kind) {
        // Reasoning tokens are throwaway here; only consume final content.
        if (kind === 'content') collected += delta;
      },
      onDone: function () {
        delete titleInFlight[convId];
        applyGeneratedTitle(convId, collected);
      },
      onError: function () {
        // Silent failure — keep the truncated first-message title.
        delete titleInFlight[convId];
      }
    });
  }

  function cleanTitle(raw) {
    var t = String(raw || '').trim();
    // Drop everything before the last newline (some models prefix reasoning).
    var lines = t.split(/\r?\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) { t = lines[i].trim(); break; }
    }
    // Strip surrounding quotes and brackets.
    t = t.replace(/^[\s"'`「『《\[\(]+/, '').replace(/[\s"'`」』》\]\)]+$/, '');
    // Drop a leading "Title:" / "标题：" prefix if the model added one.
    t = t.replace(/^(title|标题)\s*[:：\-]\s*/i, '');
    // Strip trailing terminal punctuation.
    t = t.replace(/[。．\.!?！？:：；;,，]+$/, '').trim();
    if (t.length > 30) t = t.substring(0, 30) + '…';
    return t;
  }

  function applyGeneratedTitle(convId, raw) {
    var title = cleanTitle(raw);
    if (!title) return;
    var conv = RetroStorage.getConversation(convId);
    if (!conv) return;
    conv.title = title;
    conv.titleAiGenerated = true;
    RetroStorage.saveConversation(conv);
    refreshSidebar();
  }

  function abort() {
    if (state.activeStream) {
      state.activeStream.abort();
      state.activeStream = null;
    }
    setStreamingUI(false);
    persist();
  }

  function init() {
    bindScrollWatcher();
    // Delegated click for per-message copy buttons.
    $('#messages').on('click', '.msg-copy', function () {
      copyMessageFromButton(this);
    });
    var lastId = RetroStorage.getCurrentId();
    var convs = RetroStorage.listConversations();
    if (lastId && RetroStorage.getConversation(lastId)) {
      loadConversation(lastId);
    } else if (convs.length) {
      loadConversation(convs[0].id);
    } else {
      newConversation();
    }
  }

  global.RetroChat = {
    init: init,
    send: send,
    abort: abort,
    isStreaming: function () { return state.streaming; },
    newConversation: newConversation,
    loadConversation: loadConversation,
    deleteConversation: deleteConversation,
    clearAll: clearAll,
    refreshSidebar: refreshSidebar
  };

})(window, window.jQuery);
