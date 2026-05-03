// storage.js — wraps localStorage with three keys, plus import/export.
// ES5 + a few ES6 features that iOS 12 Safari understands (no ?. or ??).

(function (global) {
  'use strict';

  var KEY_CONFIG = 'retrochat:config';
  var KEY_CONVS  = 'retrochat:conversations';
  var KEY_CURR   = 'retrochat:currentId';
  var KEY_WELCOMED = 'retrochat:welcomed';

  var DEFAULT_CONFIG = {
    preset: 'mimo',  // 'mimo' | 'deepseek' | 'custom' | (future preset keys)
    baseUrl: '',     // only used when preset === 'custom'
    apiKey: '',      // used when the chosen preset's requiresApiKey is true
    model: 'mimo-v2.5-pro',  // only used when preset === 'custom'
    temperature: 0.7,
    systemPrompt: '',
    theme: 'mac',
    lang: 'auto',
    autoTitle: true
  };

  // Built-in presets. Each preset declares which credential/config fields
  // the user actually has to supply — the settings panel reads these flags
  // to decide which inputs to show. To add a new preset later: append a
  // new entry here, optionally add a localised label string in i18n, and
  // an <option> in index.html. No other code changes are required.
  //
  // Field semantics:
  //   label             : fallback label shown when no i18n key is hit
  //   fixedBaseUrl      : the URL the proxy will use when the user picks
  //                       this preset. '' means "let the server fall back
  //                       to its MIMO_BASE_URL env var".
  //   fixedModel        : model id sent to the upstream
  //   requiresBaseUrl   : show the Base URL input (only true for 'custom')
  //   requiresApiKey    : show the API Key input (server provides for
  //                       'mimo'; user must provide for 'deepseek' etc.)
  //   requiresModel     : show the Model input (only true for 'custom')
  var PRESETS = {
    mimo: {
      label: 'Xiaomi MiMo v2.5 Pro',
      fixedBaseUrl: '',                 // server env handles it
      fixedModel: 'mimo-v2.5-pro',
      requiresBaseUrl: false,
      requiresApiKey: false,
      requiresModel: false
    },
    deepseek: {
      label: 'DeepSeek',
      fixedBaseUrl: 'https://api.deepseek.com',
      fixedModel: 'deepseek-chat',
      requiresBaseUrl: false,
      requiresApiKey: true,             // user supplies
      requiresModel: false
    }
    // 'custom' is implicit — selecting it shows all three inputs and
    // sources baseUrl/model from the user's saved config directly.
  };

  // Resolve the credentials/model that should be sent to /api/chat for a
  // given config. Single source of truth used by chat.js when issuing the
  // streaming request, so the rest of the code never has to branch on
  // preset selection.
  function resolveCreds(cfg) {
    cfg = cfg || getConfig();
    var preset = cfg.preset || 'mimo';
    if (preset === 'custom') {
      return {
        baseUrl: cfg.baseUrl || '',
        apiKey: cfg.apiKey || '',
        model: cfg.model || ''
      };
    }
    var p = PRESETS[preset];
    if (!p) {
      // Unknown preset (e.g. removed in a later version) — fall through
      // to whatever the user has saved as if it were custom.
      return {
        baseUrl: cfg.baseUrl || '',
        apiKey: cfg.apiKey || '',
        model: cfg.model || ''
      };
    }
    return {
      baseUrl: p.fixedBaseUrl,
      apiKey: p.requiresApiKey ? (cfg.apiKey || '') : '',
      model: p.fixedModel
    };
  }

  function safeGet(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // Most likely QuotaExceededError on Safari
      return false;
    }
  }

  function getConfig() {
    var c = safeGet(KEY_CONFIG) || {};
    var merged = {};
    for (var k in DEFAULT_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) {
        merged[k] = (k in c) ? c[k] : DEFAULT_CONFIG[k];
      }
    }
    // Legacy migration: configs saved before the preset field existed only
    // had baseUrl/apiKey/model. Infer the preset from those values so the
    // settings UI doesn't suddenly drop into "custom" for existing users.
    if (!c || !('preset' in c)) {
      if (!merged.baseUrl && !merged.apiKey)                  merged.preset = 'mimo';
      else if (merged.baseUrl === 'https://api.deepseek.com') merged.preset = 'deepseek';
      else                                                    merged.preset = 'custom';
    }
    return merged;
  }

  function saveConfig(cfg) {
    var current = getConfig();
    for (var k in cfg) {
      if (Object.prototype.hasOwnProperty.call(cfg, k)) current[k] = cfg[k];
    }
    return safeSet(KEY_CONFIG, current);
  }

  function listConversations() {
    var arr = safeGet(KEY_CONVS);
    if (!arr || !Array.isArray(arr)) return [];
    arr.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return arr;
  }

  function getConversation(id) {
    if (!id) return null;
    var arr = listConversations();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
    return null;
  }

  function saveConversation(conv) {
    if (!conv || !conv.id) return false;
    conv.updatedAt = Date.now();
    var arr = listConversations();
    var found = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === conv.id) { arr[i] = conv; found = true; break; }
    }
    if (!found) arr.unshift(conv);
    var ok = safeSet(KEY_CONVS, arr);
    if (!ok) {
      // Try trimming the oldest conversations one by one until it fits.
      while (arr.length > 1 && !ok) {
        arr.sort(function (a, b) { return (a.updatedAt || 0) - (b.updatedAt || 0); });
        arr.shift();
        ok = safeSet(KEY_CONVS, arr);
      }
    }
    return ok;
  }

  function deleteConversation(id) {
    var arr = listConversations();
    var next = [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id !== id) next.push(arr[i]);
    safeSet(KEY_CONVS, next);
    if (getCurrentId() === id) setCurrentId(next.length ? next[0].id : '');
  }

  function clearAllConversations() {
    safeSet(KEY_CONVS, []);
    setCurrentId('');
  }

  function getCurrentId() {
    var v = null;
    try { v = localStorage.getItem(KEY_CURR); } catch (e) { v = null; }
    return v || '';
  }

  function setCurrentId(id) {
    try { localStorage.setItem(KEY_CURR, id || ''); } catch (e) {}
  }

  function newConversationId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function exportAll() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: getConfig(),
      conversations: listConversations(),
      currentId: getCurrentId()
    };
  }

  function importAll(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.config) saveConfig(data.config);
    if (Array.isArray(data.conversations)) safeSet(KEY_CONVS, data.conversations);
    if (typeof data.currentId === 'string') setCurrentId(data.currentId);
    return true;
  }

  // Approximate localStorage usage in bytes (UTF-16 chars * 2).
  function approxUsage() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = localStorage.getItem(k) || '';
        total += (k.length + v.length) * 2;
      }
    } catch (e) {}
    return total;
  }

  function isWelcomed() {
    try { return localStorage.getItem(KEY_WELCOMED) === '1'; } catch (e) { return false; }
  }

  function markWelcomed() {
    try { localStorage.setItem(KEY_WELCOMED, '1'); } catch (e) {}
  }

  global.RetroStorage = {
    DEFAULTS: DEFAULT_CONFIG,
    PRESETS: PRESETS,
    resolveCreds: resolveCreds,
    getConfig: getConfig,
    saveConfig: saveConfig,
    listConversations: listConversations,
    getConversation: getConversation,
    saveConversation: saveConversation,
    deleteConversation: deleteConversation,
    clearAllConversations: clearAllConversations,
    getCurrentId: getCurrentId,
    setCurrentId: setCurrentId,
    newConversationId: newConversationId,
    exportAll: exportAll,
    importAll: importAll,
    approxUsage: approxUsage,
    isWelcomed: isWelcomed,
    markWelcomed: markWelcomed
  };

})(window);
