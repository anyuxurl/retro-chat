// settings.js — settings modal logic.

(function (global, $) {
  'use strict';

  function el(id) { return document.getElementById(id); }

  var VALID_THEMES = { mac: 1, paper: 1, amber: 1, crt: 1 };

  function applyTheme(theme) {
    if (!theme || !VALID_THEMES[theme]) theme = 'mac';
    var body = document.body;
    body.className = ''; // wipe
    if (body.classList) body.classList.add('theme-' + theme);
    else body.className = 'theme-' + theme;
  }

  function applyLang(lang) {
    if (global.RetroI18n) RetroI18n.setLang(lang || 'auto');
    // The send button label is dynamic; refresh it now that strings changed.
    if (global.RetroChat && !RetroChat.isStreaming()) {
      $('#btn-send').text(RetroI18n.t('composer.send'));
    } else if (global.RetroChat && RetroChat.isStreaming()) {
      $('#btn-send').text(RetroI18n.t('composer.stop'));
    }
    // Refresh empty-state strings if shown.
    if (global.RetroChat) RetroChat.refreshSidebar();
  }

  function fillForm(cfg) {
    el('cfg-baseurl').value = cfg.baseUrl || '';
    el('cfg-apikey').value = cfg.apiKey || '';
    el('cfg-model').value = cfg.model || 'mimo-v2.5-pro';
    el('cfg-temperature').value = cfg.temperature != null ? cfg.temperature : 0.7;
    el('cfg-temperature-val').textContent = (cfg.temperature != null ? cfg.temperature : 0.7);
    el('cfg-theme').value = cfg.theme || 'mac';
    el('cfg-lang').value = cfg.lang || 'auto';
    el('cfg-auto-title').checked = cfg.autoTitle !== false;
  }

  function readForm() {
    return {
      baseUrl: (el('cfg-baseurl').value || '').trim().replace(/\/+$/, ''),
      apiKey: (el('cfg-apikey').value || '').trim(),
      model: (el('cfg-model').value || '').trim(),
      temperature: parseFloat(el('cfg-temperature').value),
      theme: el('cfg-theme').value,
      lang: el('cfg-lang').value,
      autoTitle: !!el('cfg-auto-title').checked
    };
  }

  function highlightMissing() {
    $('.row-input').removeClass('invalid');
    var ok = true;
    // Only `model` is strictly required. baseUrl + apiKey may both be empty
    // (server-side env vars handle it) OR both filled (user-provided creds);
    // mixing one filled + one empty is invalid.
    if (!el('cfg-model').value.trim()) {
      $('#cfg-model').addClass('invalid'); ok = false;
    }
    var bu = el('cfg-baseurl').value.trim();
    var ak = el('cfg-apikey').value.trim();
    if ((bu && !ak) || (!bu && ak)) {
      if (!bu) $('#cfg-baseurl').addClass('invalid');
      if (!ak) $('#cfg-apikey').addClass('invalid');
      ok = false;
    }
    return ok;
  }

  function open(forceFirstRun) {
    fillForm(RetroStorage.getConfig());
    $('.row-input').removeClass('invalid');
    $('#settings-modal').addClass('open');
    if (forceFirstRun) highlightMissing();
  }

  function close() {
    $('#settings-modal').removeClass('open');
  }

  function applyPreset(key) {
    if (!key || key === 'custom') return;
    var p = RetroStorage.PRESETS[key];
    if (!p) return;
    el('cfg-baseurl').value = p.baseUrl;
    el('cfg-model').value = p.model;
    $('#cfg-baseurl, #cfg-model').removeClass('invalid');
  }

  function save() {
    var data = readForm();
    if (!highlightMissing()) return false;
    RetroStorage.saveConfig(data);
    applyTheme(data.theme);
    applyLang(data.lang);
    close();
    return true;
  }

  function exportJson() {
    var blob;
    var data = JSON.stringify(RetroStorage.exportAll(), null, 2);
    try {
      blob = new Blob([data], { type: 'application/json' });
    } catch (e) {
      // Old Safari fallback: open a data URL.
      var uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(data);
      window.open(uri, '_blank');
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'retrochat-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        RetroStorage.importAll(data);
        var cfg = RetroStorage.getConfig();
        fillForm(cfg);
        applyTheme(cfg.theme);
        applyLang(cfg.lang);
        if (global.RetroChat) {
          RetroChat.refreshSidebar();
          var convs = RetroStorage.listConversations();
          if (convs.length) RetroChat.loadConversation(convs[0].id);
          else RetroChat.newConversation();
        }
        alert(RetroI18n.t('alert.import_ok'));
      } catch (e) {
        alert(RetroI18n.t('alert.import_fail') + e.message);
      }
    };
    reader.onerror = function () { alert(RetroI18n.t('alert.read_fail')); };
    reader.readAsText(file);
  }

  function bind() {
    $('#btn-settings').on('click', function () { open(false); });
    $('#btn-close-settings').on('click', close);
    $('#settings-modal').on('click', function (e) {
      if (e.target.id === 'settings-modal') close();
    });
    $('#cfg-preset').on('change', function () { applyPreset(this.value); });
    $('#cfg-temperature').on('input change', function () {
      el('cfg-temperature-val').textContent = this.value;
    });
    $('#btn-save-settings').on('click', save);

    $('#btn-export').on('click', exportJson);
    $('#btn-import').on('click', function () { $('#import-file').trigger('click'); });
    $('#import-file').on('change', function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = '';
    });

    // Live preview for theme & language while the modal is open.
    $('#cfg-theme').on('change', function () { applyTheme(this.value); });
    $('#cfg-lang').on('change', function () { applyLang(this.value); });
  }

  global.RetroSettings = {
    open: open,
    close: close,
    applyTheme: applyTheme,
    applyLang: applyLang,
    bind: bind
  };

})(window, window.jQuery);
