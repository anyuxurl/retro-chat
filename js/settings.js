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
    el('cfg-preset').value = cfg.preset || 'mimo';
    el('cfg-baseurl').value = cfg.baseUrl || '';
    el('cfg-apikey').value = cfg.apiKey || '';
    el('cfg-model').value = cfg.model || 'mimo-v2.5-pro';
    el('cfg-temperature').value = cfg.temperature != null ? cfg.temperature : 0.7;
    el('cfg-temperature-val').textContent = (cfg.temperature != null ? cfg.temperature : 0.7);
    el('cfg-system-prompt').value = cfg.systemPrompt || '';
    el('cfg-theme').value = cfg.theme || 'mac';
    el('cfg-lang').value = cfg.lang || 'auto';
    el('cfg-auto-title').checked = cfg.autoTitle !== false;
    syncPresetVisibility();
  }

  function readForm() {
    return {
      preset: el('cfg-preset').value || 'mimo',
      baseUrl: (el('cfg-baseurl').value || '').trim().replace(/\/+$/, ''),
      apiKey: (el('cfg-apikey').value || '').trim(),
      model: (el('cfg-model').value || '').trim(),
      temperature: parseFloat(el('cfg-temperature').value),
      systemPrompt: el('cfg-system-prompt').value || '',
      theme: el('cfg-theme').value,
      lang: el('cfg-lang').value,
      autoTitle: !!el('cfg-auto-title').checked
    };
  }

  // Show/hide credential rows based on the selected preset's declared
  // requirements. The preset object lives in storage.js so adding a new
  // preset is a one-place change.
  function syncPresetVisibility() {
    var preset = el('cfg-preset').value || 'mimo';
    var showBase, showKey, showModel;
    if (preset === 'custom') {
      showBase = showKey = showModel = true;
    } else {
      var p = RetroStorage.PRESETS[preset];
      if (!p) { showBase = showKey = showModel = false; }
      else {
        showBase  = !!p.requiresBaseUrl;
        showKey   = !!p.requiresApiKey;
        showModel = !!p.requiresModel;
      }
    }
    rowFor('cfg-baseurl').toggle(showBase);
    $('#cfg-baseurl-hint').toggle(showBase);
    rowFor('cfg-apikey').toggle(showKey);
    rowFor('cfg-model').toggle(showModel);
  }

  // Each input lives inside a label.row — find that container.
  function rowFor(inputId) {
    return $('#' + inputId).closest('.row');
  }

  function highlightMissing() {
    $('.row-input').removeClass('invalid');
    var preset = el('cfg-preset').value || 'mimo';
    var ok = true;

    if (preset === 'custom') {
      // For custom, all three must be filled — the proxy has no env
      // fallback for an arbitrary endpoint.
      if (!el('cfg-baseurl').value.trim()) { $('#cfg-baseurl').addClass('invalid'); ok = false; }
      if (!el('cfg-apikey').value.trim())  { $('#cfg-apikey').addClass('invalid');  ok = false; }
      if (!el('cfg-model').value.trim())   { $('#cfg-model').addClass('invalid');   ok = false; }
    } else {
      var p = RetroStorage.PRESETS[preset];
      if (p && p.requiresApiKey && !el('cfg-apikey').value.trim()) {
        $('#cfg-apikey').addClass('invalid'); ok = false;
      }
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
    syncPresetVisibility();
    // For non-custom presets, fill the (now hidden) baseUrl/model with
    // canonical values so a later switch back to "custom" starts from a
    // sensible state, and exported JSON stays self-describing.
    if (key && key !== 'custom') {
      var p = RetroStorage.PRESETS[key];
      if (p) {
        el('cfg-baseurl').value = p.fixedBaseUrl || '';
        el('cfg-model').value = p.fixedModel || '';
      }
    }
    $('#cfg-baseurl, #cfg-model').removeClass('invalid');
  }

  function save() {
    if (!highlightMissing()) return false;
    var data = readForm();
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
