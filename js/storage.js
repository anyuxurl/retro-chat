// storage.js — wraps localStorage with three keys, plus import/export.
// ES5 + a few ES6 features that iOS 12 Safari understands (no ?. or ??).

(function (global) {
  'use strict';

  var KEY_CONFIG = 'retrochat:config';
  var KEY_CONVS  = 'retrochat:conversations';
  var KEY_CURR   = 'retrochat:currentId';
  var KEY_WELCOMED = 'retrochat:welcomed';

  var DEFAULT_CONFIG = {
    baseUrl: '',     // empty → backend uses MIMO_BASE_URL env var
    apiKey: '',      // empty → backend uses MIMO_API_KEY env var
    model: 'mimo-v2.5-pro',
    temperature: 0.7,
    systemPrompt: '',
    theme: 'mac',
    lang: 'auto',
    autoTitle: true
  };

  // Keep this list short — most users want mimo or deepseek; everything
  // else can be entered manually via "Custom".
  // Note: the mimo preset deliberately leaves baseUrl empty so requests fall
  // through to the server-side env defaults instead of exposing the URL in
  // the bundled JS. Users wanting a non-default mimo gateway can fill it in.
  var PRESETS = {
    mimo: {
      baseUrl: '',
      model: 'mimo-v2.5-pro'
    },
    deepseek: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    }
  };

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
