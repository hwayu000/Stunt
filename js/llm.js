/* ============================================================
   Stunt — LLM 呼叫層（雙軌）
   路線 A｜後端代理：偵測到同源 /api/llm 就走代理，Key 留在伺服器。
   路線 B｜瀏覽器直連：無代理時用使用者自己填的 Key 直接呼叫供應商。
   兩者皆不可用 → 呼叫端自行降級到本地示範資料。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;

  /* ---------- 代理偵測（只做一次，結果快取） ---------- */
  var _proxy = null;
  function detectProxy() {
    if (_proxy) return Promise.resolve(_proxy);
    if (Store.S.proxyMode === 'direct') { _proxy = { proxy: false, ready: [] }; return Promise.resolve(_proxy); }
    return fetch('/api/providers', { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        _proxy = (d && d.proxy) ? { proxy: true, ready: d.ready || [] } : { proxy: false, ready: [] };
        return _proxy;
      })
      .catch(function () { _proxy = { proxy: false, ready: [] }; return _proxy; });
  }
  function proxyInfo() { return _proxy; }
  function resetProxyCache() { _proxy = null; }

  /* ---------- 供應商直連設定 ---------- */
  var DIRECT = {
    deepseek: {
      url: function () { return 'https://api.deepseek.com/chat/completions'; },
      headers: function (k) { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }; },
      body: function (m, prompt, temp) {
        return { model: m.modelName, messages: [{ role: 'user', content: prompt }], temperature: temp };
      },
      pick: function (d) { return d.choices && d.choices[0] && d.choices[0].message.content; }
    },
    gemini: {
      url: function (m, k) {
        return 'https://generativelanguage.googleapis.com/v1beta/models/' +
               encodeURIComponent(m.modelName) + ':generateContent?key=' + encodeURIComponent(k);
      },
      headers: function () { return { 'Content-Type': 'application/json' }; },
      body: function (m, prompt) { return { contents: [{ parts: [{ text: prompt }] }] }; },
      pick: function (d) {
        return d.candidates && d.candidates[0] && d.candidates[0].content.parts[0].text;
      }
    }
  };

  /* ---------- 可否真的呼叫 ---------- */
  function canCall(m) {
    if (!m) return false;
    var p = proxyInfo();
    if (p && p.proxy && p.ready.indexOf(m.id) >= 0) return true;
    return !!Store.getKey(m.id);
  }

  function readJSON(r) {
    return r.json()
      .catch(function () { throw new Error('回應不是有效的 JSON'); })
      .then(function (d) {
        if (!r.ok) throw new Error((d && d.error && (d.error.message || d.error)) || ('HTTP ' + r.status));
        return d;
      });
  }

  /* ---------- 主呼叫 ---------- */
  function call(prompt, opts) {
    opts = opts || {};
    var m = opts.model || Store.boundModel();
    if (!m) return Promise.reject(new Error('尚未綁定模型'));
    var temp = typeof opts.temperature === 'number' ? opts.temperature : 1.1;

    return detectProxy().then(function (p) {
      // 路線 A：後端代理（本機模型不走代理，直接打使用者自己的服務）
      if (p.proxy && p.ready.indexOf(m.id) >= 0) {
        return fetch('/api/llm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // 代理端會驗這個帳號；沒登入就打不動代理
            'X-Stunt-Account': (Stunt.currentAccount && Stunt.currentAccount()) || ''
          },
          body: JSON.stringify({ provider: m.id, model: m.modelName, prompt: prompt })
        }).then(readJSON).then(function (d) {
          if (!d.text) throw new Error(d.error || '代理回應無法解析');
          return d.text;
        });
      }

      // 路線 B：瀏覽器直連
      var cfg = DIRECT[m.id];
      if (!cfg) throw new Error('不支援的供應商');
      var key = Store.getKey(m.id);
      if (!key) throw new Error('尚未填入 API Key');

      return fetch(cfg.url(m, key), {
        method: 'POST',
        headers: cfg.headers(key),
        body: JSON.stringify(cfg.body(m, prompt, temp))
      }).then(readJSON).then(function (d) {
        var text = cfg.pick(d);
        if (!text) throw new Error('回應無法解析');
        return text;
      });
    });
  }

  /* ---------- 從回應中取出 JSON ---------- */
  function pickJSON(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  /* ---------- 文案鐵律 ---------- */
  var SIMP = /[这来时会说对开关闭见觉学习实际员产业车轮门题话语进运达过还没样种类别经济营销计划设备资讯网络机构组织权处务证监录亲爱恋结构总统领导华丽艺术医药养护师专业价值内营养]/;
  var BAN_PATTERNS = [
    { re: /不是[^，。！？]{1,20}[，,]?\s*(而是|就是|是)/, why: '出現「不是…而是／就是」句式' },
    { re: /(一句話總結|總結來說|總的來說|綜上所述|說到底就是)/, why: '出現總結式標語' },
    { re: /(賦能|閉環|抓手|顆粒度|生態位打法)/, why: '出現空泛的商業黑話' }
  ];

  function lintText(str) {
    var bad = [];
    if (!str) return bad;
    if (SIMP.test(str)) bad.push('內容含簡體字，必須全部改為繁體');
    BAN_PATTERNS.forEach(function (p) { if (p.re.test(str)) bad.push(p.why); });
    return bad;
  }

  function lintDeep(obj, path) {
    var bad = [];
    path = path || '';
    if (typeof obj === 'string') {
      lintText(obj).forEach(function (w) { bad.push((path ? path + '：' : '') + w); });
    } else if (Array.isArray(obj)) {
      obj.forEach(function (v, i) { bad = bad.concat(lintDeep(v, path + '[' + i + ']')); });
    } else if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) { bad = bad.concat(lintDeep(obj[k], path ? path + '.' + k : k)); });
    }
    return bad;
  }

  /* ---------- 帶 lint 閉環的生成 ---------- */
  function callLinted(prompt, opts) {
    opts = opts || {};
    var rounds = opts.rounds || 2;
    var current = prompt;

    function attempt(n) {
      return call(current, opts).then(function (raw) {
        var obj = pickJSON(raw);
        if (!obj) throw new Error('模型未回傳有效 JSON');
        var bad = lintDeep(obj);
        if (!bad.length) return obj;
        if (n >= rounds) throw new Error('文案鐵律連續 ' + rounds + ' 輪未通過：' + bad.slice(0, 3).join('；'));
        current = prompt + '\n\n【上一版違規清單，逐條修正後重新輸出完整 JSON】\n' + bad.join('\n');
        return attempt(n + 1);
      });
    }
    return attempt(1);
  }

  S.LLM = {
    call: call, callLinted: callLinted, pickJSON: pickJSON,
    lintText: lintText, lintDeep: lintDeep,
    canCall: canCall, detectProxy: detectProxy, proxyInfo: proxyInfo,
    resetProxyCache: resetProxyCache
  };
})(window);
