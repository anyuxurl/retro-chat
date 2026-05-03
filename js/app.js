// app.js — entry point. Wires up DOM events and bootstraps modules.

(function (global, $) {
  'use strict';

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  }

  function openSidebar()  { $('#sidebar, #backdrop').addClass('open'); }
  function closeSidebar() { $('#sidebar, #backdrop').removeClass('open'); }

  function showWelcome() {
    $('#welcome-modal').addClass('open');
  }

  // "Start chatting" — close, mark as welcomed (won't show again),
  // and focus the composer so the user can type immediately.
  function startFromWelcome() {
    $('#welcome-modal').removeClass('open');
    RetroStorage.markWelcomed();
    var input = document.getElementById('input');
    if (input && typeof input.focus === 'function') {
      try { input.focus(); } catch (e) {}
    }
  }

  // "Maybe later" — close the modal but DON'T mark as welcomed, so the user
  // can come back to the intro on the next visit.
  function skipWelcome() {
    $('#welcome-modal').removeClass('open');
  }

  function bind() {
    // Composer submit (Enter to send, Shift+Enter for newline).
    $('#composer').on('submit', function (e) {
      e.preventDefault();
      if (RetroChat.isStreaming()) {
        RetroChat.abort();
        return;
      }
      var $input = $('#input');
      var text = $input.val();
      if (!text || !text.trim()) return;
      RetroChat.send(text);
      $input.val('');
    });

    $('#input').on('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      // Multiple ways to detect that the user is mid-IME composition
      // (Pinyin / Japanese / Korean candidate selection). On iOS Safari
      // `e.isComposing` is unreliable, so we also track the explicit
      // composition events and the legacy keyCode 229 (IME processing).
      if (composing) return;
      if (e.isComposing === true) return;
      if (e.keyCode === 229 || e.which === 229) return;
      e.preventDefault();
      $('#composer').trigger('submit');
    });
    // Composition tracking for the textarea — the IME may also fire its
    // own `Enter` to confirm the candidate which would otherwise submit
    // the form. Keep `composing` true through the whole composition
    // window plus a brief grace period after compositionend, because some
    // browsers (notably Mobile Safari) deliver the keydown for that final
    // Enter *after* compositionend has fired.
    var composing = false;
    var composeGrace = null;
    $('#input').on('compositionstart', function () {
      composing = true;
      if (composeGrace) { clearTimeout(composeGrace); composeGrace = null; }
    });
    $('#input').on('compositionend', function () {
      if (composeGrace) clearTimeout(composeGrace);
      composeGrace = setTimeout(function () {
        composing = false;
        composeGrace = null;
      }, 80);
    });

    // Conversation list — delegate clicks for items + delete buttons.
    $('#conv-list').on('click', '.conv-item .del', function (e) {
      e.stopPropagation();
      var id = $(this).attr('data-id');
      if (id && confirm(RetroI18n.t('confirm.delete_conv'))) {
        RetroChat.deleteConversation(id);
      }
    });
    $('#conv-list').on('click', '.conv-item', function () {
      var id = $(this).attr('data-id');
      if (!id) return;
      RetroChat.loadConversation(id);
      if (isMobile()) closeSidebar();
    });

    $('#btn-new').on('click', function () {
      RetroChat.newConversation();
      if (isMobile()) closeSidebar();
    });
    $('#btn-clear-all').on('click', function () {
      if (confirm(RetroI18n.t('confirm.clear_all'))) {
        RetroChat.clearAll();
      }
    });

    // Mobile sidebar toggling.
    $('#btn-menu').on('click', function () {
      if ($('#sidebar').hasClass('open')) closeSidebar();
      else openSidebar();
    });
    $('#backdrop').on('click', closeSidebar);

    // Sidebar conversation search — filter on every keystroke.
    $('#conv-search').on('input', function () {
      RetroChat.refreshSidebar();
    });

    // Welcome modal buttons.
    $('#btn-welcome-start').on('click', startFromWelcome);
    $('#btn-welcome-skip').on('click', skipWelcome);

    // Wire up the settings modal.
    RetroSettings.bind();
  }

  $(function () {
    var cfg = RetroStorage.getConfig();

    // 1) Apply language FIRST so all subsequent renders pick up the strings.
    RetroSettings.applyLang(cfg.lang);

    // 2) Apply theme.
    RetroSettings.applyTheme(cfg.theme);

    // 3) Wire up handlers.
    bind();

    // 4) Bootstrap chat (creates / loads conversations).
    RetroChat.init();

    // 5) First-run welcome (shown only once per device).
    if (!RetroStorage.isWelcomed()) {
      showWelcome();
    }
  });

})(window, window.jQuery);
