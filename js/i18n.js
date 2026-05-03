// i18n.js — minimal i18n with zh-CN and en string tables.
// Detects browser language on first load; user can override in settings.

(function (global) {
  'use strict';

  var STRINGS = {
    'zh': {
      'topbar.menu':         '会话',
      'topbar.new':          '新对话',
      'topbar.settings':     '设置',
      'sidebar.heading':     '对话历史',
      'sidebar.clear_all':   '[ 清空全部 ]',
      'composer.placeholder':'输入消息…',
      'composer.send':       '发送',
      'composer.stop':       '停止',
      'empty.title':         '> RetroChat 就绪。',
      'empty.hint1':         '输入消息开始聊天。',
      'empty.hint2':         '想换模型？点击右上角 ⚙。',
      'empty.title_new':     '> 新会话。',
      'empty.hint_new':      '在下方输入开始。',
      'msg.role.you':        '> 你',
      'msg.role.ai':         '< AI',
      'msg.role.sys':        '# 系统',
      'msg.thinking':        '思考中…',
      'msg.thinking_done':   '思考完成 ✓',
      'msg.error_prefix':    '[错误] ',
      'msg.copy':            '复制',
      'msg.copied':          '已复制 ✓',
      'msg.regen':           '重新生成',
      'msg.edit':            '编辑',
      'msg.edit_save':       '保存并重发',
      'msg.edit_cancel':     '取消',
      'sidebar.search':      '搜索对话…',
      'scroll.bottom':       '回到底部',
      'conv.untitled':       '未命名',
      'conv.new':            '新会话',
      'settings.title':      '设置',
      'settings.preset':     '预设',
      'settings.preset_pick':'— 选择预设 —',
      'settings.preset_custom':'自定义',
      'settings.baseurl':    'Base URL',
      'settings.baseurl_hint':'OpenAI 兼容接口的根地址。留空可使用服务器默认（仅 mimo）。要切换其他模型请同时填写 Base URL 与 API Key。',
      'settings.apikey':     'API Key',
      'settings.model':      '模型',
      'settings.temperature':'温度',
      'settings.system_prompt':      '系统提示',
      'settings.system_prompt_hint': '可选。设定 AI 的角色或行为风格，例如"你是一位中文写作助手"。留空则不发送系统消息。',
      'settings.theme':      '主题',
      'settings.theme.mac':  '老 Mac 灰',
      'settings.theme.crt':  'CRT 绿屏',
      'settings.theme.paper':'羊皮纸',
      'settings.theme.amber':'琥珀终端',
      'settings.language':   '语言',
      'settings.lang.auto':  '跟随系统',
      'settings.lang.zh':    '简体中文',
      'settings.lang.en':    'English',
      'settings.auto_title':      '智能标题',
      'settings.auto_title_hint': '首次回复后用 AI 自动概括对话主题作为标题',
      'settings.export':     '导出 JSON',
      'settings.import':     '导入 JSON',
      'settings.save':       '保存',
      'settings.close':      '关闭',
      'alert.import_ok':     '导入成功',
      'alert.import_fail':   '导入失败：',
      'alert.read_fail':     '文件读取失败',
      'confirm.delete_conv': '删除这个对话？',
      'confirm.clear_all':   '清空全部对话？此操作不可撤销。',
      'welcome.title':       '欢迎来到 RetroChat',
      'welcome.tagline':     '能在 iPhone 5s 上跑的 AI 聊天',
      'welcome.f1.t':        '复古兼容',
      'welcome.f1.d':        '全 ES5 + Flexbox + XHR 流式，iOS 12 Safari 也能丝滑',
      'welcome.f2.t':        '开箱即用',
      'welcome.f2.d':        '已默认接入 mimo-v2.5-pro，无需配置直接开聊',
      'welcome.f3.t':        '完全自定义',
      'welcome.f3.d':        '设置里可换任意 OpenAI 兼容模型 / 主题 / 语言',
      'welcome.f4.t':        '隐私至上',
      'welcome.f4.d':        '会话只存在你的浏览器 localStorage，可一键导入导出',
      'welcome.start':       '开始聊天 →',
      'welcome.skip':        '稍后再看'
    },

    'en': {
      'topbar.menu':         'Menu',
      'topbar.new':          'New chat',
      'topbar.settings':     'Settings',
      'sidebar.heading':     'CONVERSATIONS',
      'sidebar.clear_all':   '[ clear all ]',
      'composer.placeholder':'Type a message…',
      'composer.send':       'SEND',
      'composer.stop':       'STOP',
      'empty.title':         '> RetroChat ready.',
      'empty.hint1':         'type a message and press send.',
      'empty.hint2':         'switch model? press ⚙ in the top bar.',
      'empty.title_new':     '> new session.',
      'empty.hint_new':      'type below to begin.',
      'msg.role.you':        '> YOU',
      'msg.role.ai':         '< AI',
      'msg.role.sys':        '# SYS',
      'msg.thinking':        'thinking…',
      'msg.thinking_done':   'thinking ✓',
      'msg.error_prefix':    '[ERROR] ',
      'msg.copy':            'copy',
      'msg.copied':          'copied ✓',
      'msg.regen':           'regenerate',
      'msg.edit':            'edit',
      'msg.edit_save':       'save & resend',
      'msg.edit_cancel':     'cancel',
      'sidebar.search':      'Search conversations…',
      'scroll.bottom':       'Scroll to bottom',
      'conv.untitled':       'Untitled',
      'conv.new':            'New chat',
      'settings.title':      'SETTINGS',
      'settings.preset':     'Preset',
      'settings.preset_pick':'-- choose a preset --',
      'settings.preset_custom':'Custom',
      'settings.baseurl':    'Base URL',
      'settings.baseurl_hint':'OpenAI-compatible endpoint root. Leave blank to use server default (mimo only). To switch to a custom provider, fill BOTH Base URL and API Key.',
      'settings.apikey':     'API Key',
      'settings.model':      'Model',
      'settings.temperature':'Temperature',
      'settings.system_prompt':      'System prompt',
      'settings.system_prompt_hint': 'Optional. Set the AI\'s role or style, e.g. "You are a concise coding assistant". Leave blank to send no system message.',
      'settings.theme':      'Theme',
      'settings.theme.mac':  'Old Mac gray',
      'settings.theme.crt':  'CRT green',
      'settings.theme.paper':'Paper / sepia',
      'settings.theme.amber':'Amber terminal',
      'settings.language':   'Language',
      'settings.lang.auto':  'Auto (system)',
      'settings.lang.zh':    '简体中文',
      'settings.lang.en':    'English',
      'settings.auto_title':      'Auto title',
      'settings.auto_title_hint': 'After the first reply, ask the AI to summarise the topic into a short title.',
      'settings.export':     'Export JSON',
      'settings.import':     'Import JSON',
      'settings.save':       'SAVE',
      'settings.close':      'Close',
      'alert.import_ok':     'Import OK',
      'alert.import_fail':   'Import failed: ',
      'alert.read_fail':     'Read failed',
      'confirm.delete_conv': 'Delete this conversation?',
      'confirm.clear_all':   'Clear ALL conversations? This cannot be undone.',
      'welcome.title':       'Welcome to RetroChat',
      'welcome.tagline':     'An AI chat client that runs on iPhone 5s',
      'welcome.f1.t':        'Retro-compatible',
      'welcome.f1.d':        'ES5 + Flexbox + XHR streaming — smooth on iOS 12 Safari',
      'welcome.f2.t':        'Ready out of the box',
      'welcome.f2.d':        'mimo-v2.5-pro pre-configured. Just start typing.',
      'welcome.f3.t':        'Fully customisable',
      'welcome.f3.d':        'Swap to any OpenAI-compatible model, theme & language',
      'welcome.f4.t':        'Privacy first',
      'welcome.f4.d':        'Chats live in your browser localStorage. Export anytime.',
      'welcome.start':       'Start chatting →',
      'welcome.skip':        'Maybe later'
    }
  };

  // Map a navigator.language string to one of our supported codes.
  function detect() {
    var raw = '';
    try {
      raw = (navigator.languages && navigator.languages[0]) ||
            navigator.language || navigator.userLanguage || 'en';
    } catch (e) { raw = 'en'; }
    raw = String(raw).toLowerCase();
    if (raw.indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  // Resolve 'auto' to a concrete code; pass-through for explicit codes.
  function resolve(setting) {
    if (!setting || setting === 'auto') return detect();
    if (STRINGS[setting]) return setting;
    return 'en';
  }

  var current = 'en';

  function setLang(setting) {
    current = resolve(setting);
    try {
      document.documentElement.setAttribute('lang', current);
    } catch (e) {}
    apply();
  }

  function t(key) {
    var table = STRINGS[current] || STRINGS.en;
    if (key in table) return table[key];
    if (key in STRINGS.en) return STRINGS.en[key];
    return key;
  }

  // Replace text content for any element with [data-i18n], placeholder for
  // [data-i18n-placeholder], and aria-label for [data-i18n-aria].
  function apply() {
    var nodes, i, el, key;
    nodes = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    }
    nodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', t(key));
    }
    nodes = document.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      key = el.getAttribute('data-i18n-aria');
      el.setAttribute('aria-label', t(key));
    }
  }

  global.RetroI18n = {
    detect: detect,
    setLang: setLang,
    apply: apply,
    t: t,
    current: function () { return current; }
  };

})(window);
