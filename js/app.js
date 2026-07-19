/* ============================================================
   Stunt — 進入點：Landing → 登入 → 工作台，導航與頁面調度
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;
  var PAGES = {
    persona: '人設定位',
    voice:   '人格口吻',
    script:  '文案架構',
    cards:   '圖卡文案',
    models:  '模型設定'
  };
  var AUTH_KEY = 'stunt_auth';
  var LAST_PAGE_KEY = 'stunt_last_page';
  // 允許進入的識別碼以雜湊存放，原文不寫在原始碼裡。
  // 名單以外一律拒絕；沒有萬用字元、沒有空白識別碼。
  // 每組識別碼在 Store 底下有各自的命名空間，資料不共用。
  var ALLOWED = [
    '26e252b34c087c5c5761ddd2212a11a3d9c3c7d1b4020e66af3aaef893df85fd',
    'd1ccc5cebf6ce8458816139ea5e8b2525bd85634271b61ec261cebf230389c62'
  ];
  var ACCOUNT_KEY = 'stunt_account';
  var LABEL_KEY = 'stunt_label';

  // 正規化：去空白（含全形）、轉小寫。除此之外不做任何寬鬆處理。
  function normAccount(v) {
    return String(v == null ? '' : v).replace(/[\s　]+/g, '').toLowerCase();
  }

  function digest(v) {
    var bytes = new TextEncoder().encode('stunt:' + normAccount(v));
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  // 回傳雜湊（通過）或 null（不在名單內）
  function resolveAccount(v) {
    if (!normAccount(v)) return Promise.resolve(null);
    return digest(v).then(function (h) { return ALLOWED.indexOf(h) >= 0 ? h : null; });
  }

  // 目前登入者的識別碼；未登入或 sessionStorage 被竄改成名單外的值都回 null
  function currentAccount() {
    try {
      if (sessionStorage.getItem(AUTH_KEY) !== '1') return null;
      var h = sessionStorage.getItem(ACCOUNT_KEY);
      return ALLOWED.indexOf(h) >= 0 ? h : null;
    } catch (e) { return null; }
  }
  S.currentAccount = currentAccount;

  var landing = document.getElementById('landingView');
  var appV    = document.getElementById('appView');

  /* ---------- 視圖切換：Landing 本身就是登入畫面 ---------- */
  function showLanding() { landing.hidden = false; appV.hidden = true; }
  function showApp() {
    landing.hidden = true; appV.hidden = false;
    var last = sessionStorage.getItem(LAST_PAGE_KEY);
    go(PAGES[last] ? last : 'persona');
  }

  /* ---------- 導航 ---------- */
  function go(page) {
    if (!PAGES[page]) page = 'persona';
    Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) {
      p.classList.toggle('active', p.id === 'page-' + page);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (b) {
      b.classList.toggle('active', b.dataset.nav === page);
    });
    document.getElementById('pageTitle').textContent = PAGES[page];
    try { sessionStorage.setItem(LAST_PAGE_KEY, page); } catch (e) {}

    var mod = S.modules && S.modules[page];
    if (mod && typeof mod.render === 'function') mod.render();
    updateSideStat();
    condense(document.getElementById('page-' + page));
    document.querySelector('.content').scrollTop = 0;
    global.scrollTo({ top: 0, behavior: 'auto' });
  }
  S.go = go;

  /* ---------- 引擎徽章（右上角，反映目前綁定模型） ---------- */
  function updateEngineChip() {
    var chip = document.getElementById('engineChip');
    if (!chip) return;
    var m = Store.boundModel();
    if (m) {
      chip.textContent = m.name;
      chip.className = 'tag engine-chip tag-ok';
      chip.title = '目前引擎：' + m.name + '／' + m.modelName + '（點擊前往模型設定）';
    } else {
      chip.textContent = '未綁定模型';
      chip.className = 'tag engine-chip tag-warn';
      chip.title = '尚未綁定模型，生成功能將以示範資料執行（點擊前往設定）';
    }
  }
  S.updateEngineChip = updateEngineChip;

  /* ---------- 手機版精簡：把敘述文字收進氣泡，只留標題與操作 ----------
     桌機保留完整敘述；窄螢幕改成標題旁一個 ? ，點開才看細節。 */
  function condense(scope) {
    if (!scope) return;
    if (!matchMedia('(max-width: 767px)').matches) return;
    // 只收頁首導語。卡片內的單行副標留著——把它也收掉會讓某些卡片變成空殼。
    var targets = scope.querySelectorAll('.page-head .lede');
    Array.prototype.forEach.call(targets, function (node) {
      var text = (node.textContent || '').trim();
      if (!text) return;
      var head = node.previousElementSibling;
      if (!head) {
        // .card-sub 在 .card-head 之後 → 掛到卡首標題上
        var card = node.closest('.card');
        head = card && card.querySelector('.card-head');
      }
      var anchor = head && (head.querySelector('h1, h2, h3') || head);
      if (!anchor) return;

      // 該區已經有說明氣泡 → 併進去，不要再多長一顆 ?
      var existing = anchor.parentNode.querySelector('.tip .tip-body');
      if (existing) {
        if (existing.textContent.indexOf(text) < 0) {
          existing.textContent = text + '\n\n' + existing.textContent;
        }
        node.remove();
        return;
      }
      var t = S.tip(text);
      t.classList.add('tip-condensed');
      anchor.parentNode.insertBefore(t, anchor.nextSibling);
      node.remove();
    });
  }

  /* ---------- 側欄素材狀態：把留白變成可用資訊 ---------- */
  function updateSideStat() {
    var host = document.getElementById('sideStat');
    if (!host) return;
    var card = Store.S.card;
    var pages = (card.pages && card.pages.list) ? card.pages.list.length : 0;
    var rows = [
      ['01', '人設', Store.S.personas.length, '個'],
      ['02', '口吻', Store.S.voices.length, '個'],
      ['03', '主題', card.candidates ? card.candidates.length : 0, '則'],
      ['04', '圖卡', pages, '頁']
    ];
    S.clear(host);
    rows.forEach(function (r) {
      host.appendChild(S.el('div.side-stat-row' + (r[2] ? '.has' : ''), null, [
        S.el('dt', { text: r[0] }),
        S.el('dd.nm', { text: r[1] }),
        S.el('dd.val', { text: r[2] ? (r[2] + ' ' + r[3]) : '—' })
      ]));
    });
  }
  S.updateSideStat = updateSideStat;

  /* 進入工作台：先把 Store 切到該帳號的命名空間，再重掛所有模組。
     順序反過來的話，模組會先讀到上一個帳號留在記憶體裡的資料。 */
  function enter(acct) {
    // 命名空間取雜湊前 12 碼即可，足以區隔且不外露原文
    Store.use(acct.slice(0, 12));
    mountAll();
    updateEngineChip();
    updateSideStat();
    // 顯示名稱單純回放使用者自己輸入的字，只作視覺用途
    var name = '';
    try { name = sessionStorage.getItem(LABEL_KEY) || ''; } catch (e) {}
    var badge = document.getElementById('acctBadge');
    if (badge) badge.textContent = name;
    var av = document.getElementById('acctAvatar');
    if (av) av.textContent = name.charAt(0) || '·';
    showApp();
  }

  function mountAll() {
    Object.keys(PAGES).forEach(function (k) {
      var mod = S.modules && S.modules[k];
      var host = document.getElementById('page-' + k);
      if (!mod || !host) return;
      S.clear(host);
      if (typeof mod.mount === 'function') mod.mount(host);
    });
  }

  /* ---------- 登入 ---------- */
  function doLogin(e) {
    e.preventDefault();
    var input = document.getElementById('loginUser');
    var err = document.getElementById('loginErr');
    var typed = normAccount(input.value);
    resolveAccount(typed).then(function (acct) {
      if (acct) {
        try {
          sessionStorage.setItem(AUTH_KEY, '1');
          sessionStorage.setItem(ACCOUNT_KEY, acct);
          sessionStorage.setItem(LABEL_KEY, typed.charAt(0).toUpperCase() + typed.slice(1));
        } catch (e2) {}
        err.hidden = true;
        enter(acct);
        return;
      }
      err.textContent = '帳號不正確';
      err.hidden = false;
      var form = document.getElementById('loginForm');
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      input.focus();
    });
  }

  function logout() {
    try {
      sessionStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(ACCOUNT_KEY);
      sessionStorage.removeItem(LABEL_KEY);
      sessionStorage.removeItem(LAST_PAGE_KEY);
    } catch (e) {}
    var input = document.getElementById('loginUser');
    if (input) input.value = '';
    // 把上一個帳號的畫面與記憶體狀態一併清掉，換人登入時不會殘留
    Object.keys(PAGES).forEach(function (k) {
      var host = document.getElementById('page-' + k);
      if (host) S.clear(host);
    });
    Store.use('');
    showLanding();
  }

  /* ---------- 啟動 ---------- */
  function boot() {
    S.initTips();

    document.getElementById('loginForm').addEventListener('submit', doLogin);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // 導航：側欄與底部導航共用 data-nav
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-nav]') : null;
      if (!btn) return;
      go(btn.dataset.nav);
    });

    // 還原登入狀態時同樣要過白名單：sessionStorage 被塞成名單外的值一律當未登入。
    // 模組要等帳號確定後才掛載，避免在未登入狀態就把資料畫出來。
    var acct = currentAccount();
    if (acct) enter(acct);
    else logout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
