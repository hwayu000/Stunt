/* ============================================================
   Stunt — 模型設定（icon 化）
   每個供應商一張卡：圖示＋名稱＋狀態。說明文字一律收在 tooltip。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;
  var el = S.el, icon = S.icon, tip = S.tip, toast = S.toast, clear = S.clear;

  // 供應商視覺：字母標記 + 主色（避免引入外部品牌圖檔）
  var LOOK = {
    deepseek: { badge: 'D',  cls: 'mk-deepseek' },
    gemini:   { badge: 'G',  cls: 'mk-gemini' }
  };

  var HINTS = {
    deepseek: '中文表現穩定、費用低，適合大量生成逐字稿與圖卡內文。需要先到 platform.deepseek.com 註冊並儲值，取得 API Key 後填在下方。',
    gemini:   'Google AI Studio 提供免費額度，不必綁信用卡。\n\n' +
              '取得步驟：\n' +
              '1. 開啟 aistudio.google.com/apikey\n' +
              '2. 用 Google 帳號登入\n' +
              '3. 按「Create API key」，選一個專案（沒有就讓它新建）\n' +
              '4. 複製那串以 AIza 開頭的字串，貼到下方 API Key 欄位\n\n' +
              '免費額度以 gemini-2.5-flash 這類 Flash 系列最寬鬆，每天可呼叫數百次；' +
              '額度用完會回報 429，隔日重置。'
  };

  var root = null;

  function mount(node) { root = node; render(); }

  function render() {
    if (!root) return;
    clear(root);

    root.appendChild(el('div.page-head', null, [
      el('h1', { id: 't-models', text: '模型設定' }),
      el('p.lede', { text: '綁定一個模型後，人設解析、逐字稿與圖卡內文才會由 AI 實際生成。' })
    ]));

    root.appendChild(modeCard());

    var grid = el('div.grid.g2.model-grid');
    Store.S.models.forEach(function (m) { grid.appendChild(modelCard(m)); });
    root.appendChild(grid);
  }

  /* ---------- 連線路線說明卡 ---------- */
  function modeCard() {
    var p = S.LLM.proxyInfo();
    var box = el('div.card.route-card');
    var statusNode = el('span.tag', { text: '偵測中…' });

    box.appendChild(el('div.card-head', null, [
      el('h2', { text: '連線路線' }),
      tip('後端代理：Key 存在伺服器的 .env，瀏覽器完全接觸不到，適合把工具分享給別人用。' +
          '瀏覽器直連：Key 只存在你這台裝置的瀏覽器，不需要架伺服器，適合自己用。'),
      el('span.spacer'),
      statusNode
    ]));

    var desc = el('p.card-sub', { text: '' });
    box.appendChild(desc);

    function paint(info) {
      if (info && info.proxy && info.ready.length) {
        statusNode.textContent = '後端代理';
        statusNode.className = 'tag tag-ok';
        desc.textContent = '伺服器已備妥：' + info.ready.join('、') +
                           '。這些供應商不需要在瀏覽器填入 Key。';
      } else if (info && info.proxy) {
        statusNode.textContent = '代理未設定 Key';
        statusNode.className = 'tag tag-warn';
        desc.textContent = '偵測到伺服器，但尚未在 .env 設定任何 API Key，將改用瀏覽器直連。';
      } else {
        statusNode.textContent = '瀏覽器直連';
        statusNode.className = 'tag tag-accent';
        desc.textContent = 'Key 僅儲存在這台裝置的瀏覽器，不會上傳任何地方。';
      }
    }

    if (p) paint(p);
    else S.LLM.detectProxy().then(paint);
    return box;
  }

  /* ---------- 單一供應商卡 ---------- */
  function modelCard(m) {
    var look = LOOK[m.id] || { badge: '?', cls: '' };
    var proxy = S.LLM.proxyInfo();
    var viaProxy = proxy && proxy.proxy && proxy.ready.indexOf(m.id) >= 0;
    var isBound = Store.S.boundId === m.id;

    var card = el('div.card.model-card' + (isBound ? '.is-active' : ''));

    card.appendChild(el('div.model-head', null, [
      el('span.model-mark.' + look.cls, { text: look.badge }),
      el('div.model-id', null, [
        el('h3', { text: m.name }),
        el('span.model-sub', { text: m.modelName })
      ]),
      tip(HINTS[m.id] || ''),
      isBound ? el('span.tag.tag-ok', null, [icon('check', 15), '使用中']) : null
    ]));

    if (viaProxy) {
      card.appendChild(el('p.card-sub', { text: '由伺服器代理，這裡不需要填 Key。' }));
    } else {
      card.appendChild(field('API Key', 'inp-key-' + m.id, Store.getKey(m.id),
                             m.id === 'gemini' ? 'AIza...' : 'sk-...', 'password'));
    }
    card.appendChild(field('模型名稱', 'inp-mn-' + m.id, m.modelName, '', 'text'));

    var actions = el('div.row.u-mt-4');
    actions.appendChild(el('button.btn.btn-primary', {
      type: 'button', text: isBound ? '更新設定' : '綁定並使用',
      onclick: function () { bind(m); }
    }));
    actions.appendChild(el('button.btn', {
      type: 'button', text: '測試連線',
      onclick: function (e) { test(m, e.currentTarget); }
    }));
    if (m.bound || Store.getKey(m.id)) {
      actions.appendChild(el('span.spacer'));
      actions.appendChild(el('button.btn.btn-ghost.btn-danger', {
        type: 'button', text: '清除', onclick: function () { unbind(m); }
      }));
    }
    card.appendChild(actions);
    return card;
  }

  function field(label, id, value, placeholder, type) {
    return el('label.field', null, [
      el('span.label', { text: label }),
      el('input.inp', { id: id, type: type || 'text', value: value || '',
                        placeholder: placeholder || '', autocomplete: 'off', spellcheck: 'false' })
    ]);
  }

  function val(id) {
    var n = document.getElementById(id);
    return n ? n.value.trim() : '';
  }

  /* ---------- 動作 ---------- */
  function bind(m) {
    var modelName = val('inp-mn-' + m.id);
    if (!modelName) { toast('請填入模型名稱', 'error'); return; }
    if (!/^[\w.:\-]{1,64}$/.test(modelName)) { toast('模型名稱只能是英數與 . : - _', 'error'); return; }

    var proxy = S.LLM.proxyInfo();
    var viaProxy = proxy && proxy.proxy && proxy.ready.indexOf(m.id) >= 0;

    if (!viaProxy) {
      var key = val('inp-key-' + m.id);
      if (!key) { toast('請填入 API Key，或改用後端代理', 'error'); return; }
      Store.setKey(m.id, key);
    }

    m.modelName = modelName;
    m.bound = true;
    Store.S.boundId = m.id;
    Store.save();
    S.updateEngineChip();
    render();
    toast('已綁定 ' + m.name, 'ok');
  }

  function unbind(m) {
    Store.setKey(m.id, '');
    m.bound = false;
    if (Store.S.boundId === m.id) {
      var other = Store.S.models.filter(function (x) { return x.bound && x.id !== m.id; })[0];
      Store.S.boundId = other ? other.id : null;
    }
    Store.save();
    S.updateEngineChip();
    render();
    toast('已清除 ' + m.name + ' 的設定');
  }

  function test(m, btn) {
    var probe = {
      id: m.id, name: m.name,
      modelName: val('inp-mn-' + m.id) || m.modelName,
      baseUrl: m.baseUrl
    };
    var typed = val('inp-key-' + m.id);
    if (typed) Store.setKey(m.id, typed);
    S.busy(btn, true, '測試中');
    var t0 = Date.now();
    S.LLM.call('請只回覆兩個字：正常', { model: probe, temperature: 0 })
      .then(function () { toast('連線正常（' + (Date.now() - t0) + ' ms）', 'ok'); })
      .catch(function (e) {
        var msg = String(e.message || e);
        if (/Failed to fetch|NetworkError/i.test(msg)) {
          msg = '無法連線。可能是 Key 不正確，或供應商封鎖瀏覽器直連。';
        }
        toast('測試失敗：' + msg, 'error');
      })
      .then(function () { S.busy(btn, false); });
  }

  S.modules = S.modules || {};
  S.modules.models = { mount: mount, render: render };
})(window);
