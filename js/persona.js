/* ============================================================
   Stunt — 人設定位（WHO）
   五層人格：背景 / 專業 / 信任 / 心智模型 / 反模式 / 誠實邊界。
   解析優先走真 LLM；不可用或失敗時降級到本地規則引擎，並明確告知使用者。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;
  var el = S.el, icon = S.icon, tip = S.tip, toast = S.toast, clear = S.clear;

  /* ---------- 模組狀態 ---------- */
  var root = null;
  var resultHost = null;
  var savedHost = null;

  var activeTab = 'manual';
  var pending = null;                  // { story, result }
  var editingId = null;                // 由清單載入時記住來源，儲存時覆寫同一筆
  var antiList = defaultAnti();

  var TABS = [
    { id: 'manual', label: '手動輸入' },
    { id: 'guide',  label: '引導訪談' },
    { id: 'post',   label: '貼上貼文' }
  ];

  var QUESTIONS = [
    { id: 'iv1', label: '你是誰？（身分、所在地、年資）', ph: '例：住澳洲十二年的台灣人' },
    { id: 'iv2', label: '你提供什麼服務或產品？',         ph: '例：澳洲房產置產顧問' },
    { id: 'iv3', label: '你幫助過誰、拿到什麼結果？',     ph: '例：協助超過 300 位客戶完成置產' },
    { id: 'iv4', label: '你的興趣與個人特色？',           ph: '例：熱愛戶外活動、講話直接' }
  ];

  function defaultAnti() {
    return ['保證獲利、穩賺', '誇大成果數字', '貶低同行'];
  }

  /* ============================================================
     一、本地規則引擎（自舊版移植，作為 LLM 的降級路徑）
     ============================================================ */
  function cut(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

  function buildPersona(txt) {
    var frags = txt.split(/[。，,、\n！!；;]/).map(function (s) { return s.trim(); })
                   .filter(function (s) { return s.length >= 2; });
    var g = { bg: [], pro: [], trust: [], style: [] };
    var identity = '', proMain = '';

    frags.forEach(function (f) {
      var short = cut(f, 22);
      if (/^我是/.test(f)) {
        identity = f.replace(/^我是/, '').trim();
        g.bg.push(identity || short);
      } else if (/(提供|專注|顧問|服務|一條龍|專長|擅長|我做|^做)/.test(f)) {
        var c = f.replace(/^(我|我們)?(提供|專注於?|主要做|做)/, '').trim();
        if (c) {
          g.pro.push(cut(c, 22));
          if (!proMain) proMain = c.slice(0, 12);
        }
      } else if (/(幫助|超過|完成|成交|客戶|用戶|學員|賺到)/.test(f) && /[\d百千萬]/.test(f)) {
        g.trust.push(short);
      } else if (/(熱愛|喜歡|平常|興趣|個性|風格)/.test(f)) {
        g.style.push(f.replace(/^平常/, '').trim());
      } else if (/(打工|經歷|曾經|出身|背景|年)/.test(f)) {
        g.bg.push(short);
      } else if (/(澳洲|台灣|在地|海外)/.test(f) && g.bg.length < 4) {
        g.bg.push(short);
      }
    });

    if (!identity && frags.length) identity = frags[0].slice(0, 14);
    if (!proMain) proMain = g.pro[0] ? g.pro[0].slice(0, 10) : '你的專業';

    // 心智模型素材：抓觀點句與信念句
    var beliefs = txt.split(/[。\n！!]/).map(function (s) { return s.trim(); })
      .filter(Boolean)
      .filter(function (s) { return /(我就是|我認為|我覺得|我相信|其實|最重要|關鍵|反應就是|我堅持)/.test(s); })
      .slice(0, 3)
      .map(function (s) { return cut(s, 26); });

    var groups = [];
    if (g.bg.length)    groups.push(['背景經歷', g.bg.slice(0, 5)]);
    if (g.pro.length)   groups.push(['專業能力', g.pro.slice(0, 5)]);
    if (g.trust.length) groups.push(['信任資產', g.trust.slice(0, 4)]);
    if (g.style.length) groups.push(['個人特色', g.style.slice(0, 4)]);
    groups.push(['內容策略', [proMain + '避坑教學', '真實案例拆解', '日常見聞建立信任']]);
    groups.push(['變現方向', ['高客單' + proMain + '服務', '課程與諮詢', '私域經營']]);

    return {
      engine: 'rule',
      core: identity + '・' + proMain,
      groups: groups,
      mindset: beliefs,
      honestyNotes: honestyNotes(txt),
      numbers: extractNumbers(txt),
      weak: !g.trust.length || !g.pro.length,
      noBeliefs: !beliefs.length
    };
  }

  /* 誠實邊界：只有原文出現過的數字可以在文案中引用 */
  function extractNumbers(txt) {
    var hits = String(txt).match(/\d+(?:[.,]\d+)?\s*[%％萬千百位人年個天次件場堂]?/g) || [];
    var seen = {}, out = [];
    hits.forEach(function (h) {
      var v = h.replace(/\s+/g, '');
      if (seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    return out.slice(0, 20);
  }

  function honestyNotes(txt) {
    var notes = ['未提供的領域不裝懂、不代答', '客戶案例只引用原文寫過的，不擴寫成果'];
    if (!extractNumbers(txt).length) notes.unshift('原文沒有任何數字，權威段一律不得出現數字');
    return notes;
  }

  /* ============================================================
     二、LLM 解析
     ============================================================ */
  function buildPrompt(txt) {
    return [
      '你是人設定位分析師。請依照「五層人格架構」拆解下列自述，只輸出一個 JSON 物件，不要任何說明文字或程式碼區塊標記。',
      '',
      'JSON 結構如下（所有文字一律使用繁體中文）：',
      '{',
      '  "core": "一句話核心定位，格式為「身分・主要專業」，不超過 24 字",',
      '  "groups": [ { "title": "分類名稱", "tags": ["短標籤", "…"] } ],',
      '  "mindset": ["這個人的核心信念或觀點，每則不超過 26 字，最多 3 則"],',
      '  "antiPatterns": ["建議加入禁語清單的說法，每則不超過 14 字，最多 6 則"],',
      '  "honestyNotes": ["防止 AI 替他編造權威的提醒，每則不超過 30 字，最多 4 則"]',
      '}',
      '',
      'groups 請固定包含這些 title（沒有素材就省略該組，不要編造）：',
      '背景經歷、專業能力、信任資產、個人特色、內容策略、變現方向。',
      '',
      '硬性規則：',
      '1. 所有標籤必須能在自述中找到依據，禁止臆測或補完不存在的成就。',
      '2. 「信任資產」只放帶有可查證數字或具體成果的項目；沒有就給空陣列。',
      '3. 每個標籤 4 到 22 字，是名詞短語不是句子。',
      '4. 全文繁體中文，禁止簡體字。',
      '5. 禁止「不是…而是」句式、禁止總結式標語、禁止商業黑話（賦能、閉環、抓手、顆粒度等）。',
      '',
      '【自述原文】',
      txt
    ].join('\n');
  }

  function normalizeLLM(obj, txt) {
    var groups = [];
    if (Array.isArray(obj.groups)) {
      obj.groups.forEach(function (g) {
        if (!g) return;
        var title = typeof g.title === 'string' ? g.title.trim() : '';
        var tags = Array.isArray(g.tags)
          ? g.tags.filter(function (t) { return typeof t === 'string' && t.trim(); })
                  .map(function (t) { return cut(t.trim(), 24); })
          : [];
        if (title && tags.length) groups.push([title, tags.slice(0, 6)]);
      });
    }
    if (!groups.length) throw new Error('模型回傳的分類為空');

    var mindset = Array.isArray(obj.mindset)
      ? obj.mindset.filter(function (s) { return typeof s === 'string' && s.trim(); })
                   .map(function (s) { return cut(s.trim(), 30); }).slice(0, 3)
      : [];

    var trust = groups.filter(function (p) { return p[0].indexOf('信任') >= 0; })[0];

    return {
      engine: 'ai',
      core: (typeof obj.core === 'string' && obj.core.trim()) ? cut(obj.core.trim(), 28) : '（未命名定位）',
      groups: groups,
      mindset: mindset,
      suggestedAnti: Array.isArray(obj.antiPatterns)
        ? obj.antiPatterns.filter(function (s) { return typeof s === 'string' && s.trim(); })
                          .map(function (s) { return cut(s.trim(), 16); }).slice(0, 6)
        : [],
      honestyNotes: Array.isArray(obj.honestyNotes) && obj.honestyNotes.length
        ? obj.honestyNotes.filter(function (s) { return typeof s === 'string' && s.trim(); })
                          .map(function (s) { return cut(s.trim(), 34); }).slice(0, 4)
        : honestyNotes(txt),
      numbers: extractNumbers(txt),
      weak: !trust || !trust[1].length,
      noBeliefs: !mindset.length
    };
  }

  /* ============================================================
     三、版面
     ============================================================ */
  function mount(node) { root = node; render(); }

  function render() {
    if (!root) return;
    clear(root);

    root.appendChild(el('div.page-head', null, [
      el('h1', { id: 't-persona', text: '人設定位' }),
      el('p.lede', { text: '把你的自述拆成可被 AI 引用的人格骨架，之後所有逐字稿與圖卡都以這份設定為準。' })
    ]));

    root.appendChild(inputCard());

    resultHost = el('div.persona-result');
    root.appendChild(resultHost);
    paintResult();

    root.appendChild(savedCard());
  }

  /* ---------- 步驟一：輸入來源 ---------- */
  function inputCard() {
    var card = el('div.card');

    card.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '01' }),
      el('h2', { text: '提供背景資料' }),
      tip('三種給料方式擇一即可。手動輸入最自由；引導訪談適合不知道從何寫起的人；' +
          '貼上既有貼文則是從你已經發過的內容反推人設。三者最後都會匯進同一個輸入框，' +
          '你可以再手動修改後才送出分析。')
    ]));
    card.appendChild(el('p.card-sub', { text: '寫得越具體，解析出來的人設越能撐住後面的文案。' }));

    // 分頁籤
    var tabsBar = el('div.tabs.u-mt-4', { role: 'tablist' });
    TABS.forEach(function (t) {
      tabsBar.appendChild(el('button.tab' + (activeTab === t.id ? '.active' : ''), {
        type: 'button', role: 'tab', 'aria-selected': activeTab === t.id ? 'true' : 'false',
        'data-ptab': t.id, text: t.label,
        onclick: function () { switchTab(t.id); }
      }));
    });
    card.appendChild(tabsBar);

    card.appendChild(panelManual());
    card.appendChild(panelGuide());
    card.appendChild(panelPost());

    var actions = el('div.row.u-mt-4');
    actions.appendChild(el('button.btn.btn-primary.btn-lg', {
      type: 'button', text: '開始分析我的人設',
      onclick: function (e) { analyze(e.currentTarget); }
    }));
    actions.appendChild(el('button.btn.btn-ghost', {
      type: 'button', text: '清空重來', onclick: resetInput
    }));
    card.appendChild(actions);

    return card;
  }

  function panel(id, children) {
    return el('div.persona-panel' + (activeTab === id ? '' : '.u-hidden'), { 'data-panel': id }, children);
  }

  function panelManual() {
    return panel('manual', [
      el('label.field', null, [
        el('span.label', { text: '你的自述' }),
        el('textarea.inp.persona-ta', {
          id: 'pInput', rows: '6',
          placeholder: '你是誰、做什麼、幫助過誰拿到什麼結果、你的觀點與個人特色…'
        })
      ])
    ]);
  }

  function panelGuide() {
    var grid = el('div.grid.g2');
    QUESTIONS.forEach(function (q, i) {
      grid.appendChild(el('label.field', null, [
        el('span.label', { text: (i + 1) + '. ' + q.label }),
        el('input.inp', { id: q.id, type: 'text', placeholder: q.ph, autocomplete: 'off' })
      ]));
    });
    return panel('guide', [
      grid,
      el('button.btn', {
        type: 'button', text: '合成背景資料並帶入輸入框', onclick: composeInterview
      })
    ]);
  }

  function panelPost() {
    return panel('post', [
      el('label.field', null, [
        el('span.label', { text: '貼上你已經發過的貼文（可多篇，用空行分隔）' }),
        el('textarea.inp.persona-ta', {
          id: 'pPosts', rows: '6',
          placeholder: '直接把社群貼文全文貼進來，系統會去掉連結與主題標籤後帶入輸入框。'
        })
      ]),
      el('button.btn', {
        type: 'button', text: '擷取為背景資料', onclick: importPosts
      })
    ]);
  }

  function switchTab(id) {
    activeTab = id;
    Array.prototype.forEach.call(root.querySelectorAll('.tab[data-ptab]'), function (b) {
      var on = b.getAttribute('data-ptab') === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(root.querySelectorAll('.persona-panel'), function (p) {
      p.classList.toggle('u-hidden', p.getAttribute('data-panel') !== id);
    });
  }

  function val(id) {
    var n = document.getElementById(id);
    return n ? n.value.trim() : '';
  }
  function setVal(id, v) {
    var n = document.getElementById(id);
    if (n) n.value = v;
  }

  function composeInterview() {
    var v = QUESTIONS.map(function (q) { return val(q.id); });
    if (!v.some(Boolean)) { toast('請至少填一題', 'error'); return; }
    setVal('pInput', [
      v[0] ? '我是' + v[0] + '。' : '',
      v[1] ? '我提供' + v[1] + '。' : '',
      v[2] ? '過去' + v[2] + '。' : '',
      v[3] ? '平常' + v[3] + '。' : ''
    ].join(''));
    switchTab('manual');
    toast('已合成背景資料，可按「開始分析我的人設」', 'ok');
  }

  function importPosts(e) {
    var raw = val('pPosts');
    if (!raw) { toast('請先貼上至少一篇貼文', 'error'); return; }
    var cleaned = raw
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#＃][^\s#＃]+/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!cleaned) { toast('清理後沒有可用的文字內容', 'error'); return; }
    var prev = val('pInput');
    setVal('pInput', prev ? prev + '\n\n' + cleaned : cleaned);
    switchTab('manual');
    toast('已帶入輸入框，建議先刪掉與人設無關的段落', 'ok');
    if (e && e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
  }

  function resetInput() {
    setVal('pInput', '');
    setVal('pPosts', '');
    QUESTIONS.forEach(function (q) { setVal(q.id, ''); });
    pending = null;
    editingId = null;
    antiList = defaultAnti();
    paintResult();
    paintSaved();
    toast('已清空');
  }

  /* ============================================================
     四、分析（LLM 優先，失敗降級規則引擎）
     ============================================================ */
  function analyze(btn) {
    var txt = val('pInput');
    if (!txt) { toast('請先輸入背景資料，或改用引導訪談', 'error'); return; }
    if (txt.length < 12) { toast('內容太短，至少寫兩三句才解析得出東西', 'error'); return; }

    S.busy(btn, true, '分析中');

    function fallback(reason) {
      pending = { story: txt, result: buildPersona(txt) };
      paintResult();
      toast('這是本地規則引擎的結果，並非 AI 解析：' + reason, 'error');
      S.busy(btn, false);
    }

    S.LLM.detectProxy().then(function () {
      var m = Store.boundModel();
      if (!S.LLM.canCall(m)) {
        fallback('尚未綁定可用的模型');
        return null;
      }
      return S.LLM.callLinted(buildPrompt(txt), { rounds: 2, temperature: 0.6 })
        .then(function (obj) {
          var res = normalizeLLM(obj, txt);
          pending = { story: txt, result: res };
          if (res.suggestedAnti && res.suggestedAnti.length) {
            res.suggestedAnti.forEach(function (a) {
              if (antiList.indexOf(a) < 0) antiList.push(a);
            });
          }
          paintResult();
          toast('人設解析完成（由 ' + (m.name || 'AI') + ' 生成）', 'ok');
          S.busy(btn, false);
        })
        .catch(function (err) {
          fallback(String((err && err.message) || err));
        });
    }).catch(function (err) {
      fallback(String((err && err.message) || err));
    });
  }

  /* ============================================================
     五、結果呈現
     ============================================================ */
  function paintResult() {
    if (!resultHost) return;
    clear(resultHost);
    if (!pending) return;

    var r = pending.result;

    resultHost.appendChild(coreCard(r));
    resultHost.appendChild(groupsCard(r));
    resultHost.appendChild(el('div.grid.g2.persona-cols', null, [antiCard(), honestyCard(r)]));
    resultHost.appendChild(saveCard());
  }

  function coreCard(r) {
    var card = el('div.card.core-card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '核心定位' }),
      tip('這一句會被放進之後每一次文案生成的系統提示裡，決定 AI 用什麼身分替你說話。' +
          '格式是「身分・主要專業」，寫得越像一個具體的人越好。'),
      el('span.spacer'),
      r.engine === 'ai'
        ? el('span.tag.tag-ok', null, [icon('check', 15), 'AI 解析'])
        : el('span.tag.tag-warn', { text: '規則引擎' })
    ]));
    card.appendChild(el('div.core-banner', null, [
      el('span.core-label', { text: 'WHO — 你是誰、賣什麼、對誰說' }),
      el('span.core-text', { text: r.core })
    ]));

    if (r.weak) {
      card.appendChild(el('div.notice.notice-warn.u-mt-4', null, [
        icon('spark', 20),
        el('div', null, [
          el('strong', { text: '建議補強：權威證明不足' }),
          el('p.card-sub', { text: '缺少具體成果數字或明確服務內容。補上「幫助過幾位客戶、拿到什麼結果」會讓信任資產站得住。' })
        ])
      ]));
    }
    if (r.noBeliefs) {
      card.appendChild(el('div.notice.u-mt-4', null, [
        icon('spark', 20),
        el('div', null, [
          el('strong', { text: '心智模型缺料' }),
          el('p.card-sub', { text: '輸入裡沒有觀點句。補一兩句核心信念（我認為…、其實…），稿子才會有你的立場而不只是資訊。' })
        ])
      ]));
    }
    return card;
  }

  function groupsCard(r) {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '人格分層' }),
      tip('標記「已驗證」的標籤代表它含有可查證的數字、且來自你的原文，可以放心寫進權威段。' +
          '其餘標籤屬單次提及，引用前建議自行確認。')
    ]));
    card.appendChild(el('p.card-sub', { text: '背景、專業、信任、特色與策略五層，供後續文案分段取用。' }));

    var grid = el('div.result-grid.u-mt-4');
    r.groups.forEach(function (pair) {
      var isTrust = pair[0].indexOf('信任') >= 0;
      var chips = el('div.chips');
      pair[1].forEach(function (t) {
        var verified = isTrust && /\d/.test(t);
        chips.appendChild(verified
          ? el('span.chip.chip-ok', null, [t, el('span.chip-mark', { text: '已驗證' })])
          : el('span.chip', { text: t }));
      });
      grid.appendChild(el('div.rcard', null, [el('h4', { text: pair[0] }), chips]));
    });

    if (r.mindset && r.mindset.length) {
      var mc = el('div.chips');
      r.mindset.forEach(function (b) { mc.appendChild(el('span.chip', { text: b })); });
      grid.appendChild(el('div.rcard.rcard-mind', null, [
        el('h4', { text: '心智模型（怎麼想）' }), mc
      ]));
    }
    card.appendChild(grid);
    return card;
  }

  /* ---------- 反模式：可增刪的禁語清單 ---------- */
  function antiCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '反模式（絕不說）' }),
      tip('這是硬約束，不是建議。文案生成後會自動掃描這份清單，命中任何一條就跳警告。' +
          '把法遵上不能說、或不符合你風格的說法都加進來。')
    ]));
    card.appendChild(el('p.card-sub', { text: '一條一則，會跟著人設一起儲存。' }));

    var chips = el('div.chips.u-mt-4', { id: 'antiChips' });
    card.appendChild(chips);
    paintAnti(chips);

    var input = el('input.inp', {
      id: 'antiInput', type: 'text', placeholder: '輸入一條禁語後按 Enter', autocomplete: 'off'
    });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      addAnti(chips, input);
    });

    card.appendChild(el('div.row.u-mt-4.anti-row', null, [
      input,
      el('button.btn', { type: 'button', text: '新增', onclick: function () { addAnti(chips, input); } })
    ]));
    return card;
  }

  function paintAnti(host) {
    clear(host);
    if (!antiList.length) {
      host.appendChild(el('span.card-sub', { text: '目前沒有任何禁語，建議至少加一條。' }));
      return;
    }
    antiList.forEach(function (a, i) {
      host.appendChild(el('button.chip.chip-btn.chip-del', {
        type: 'button', 'aria-label': '刪除禁語：' + a,
        onclick: function () { antiList.splice(i, 1); paintAnti(host); }
      }, [a, el('span.chip-x', { 'aria-hidden': 'true', text: '×' })]));
    });
  }

  function addAnti(host, input) {
    var v = input.value.trim();
    if (!v) return;
    if (antiList.indexOf(v) >= 0) { toast('這條已經在清單裡了', 'error'); input.value = ''; return; }
    antiList.push(v);
    input.value = '';
    paintAnti(host);
  }

  /* ---------- 誠實邊界 ---------- */
  function honestyCard(r) {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '誠實邊界' }),
      tip('自動從你的原文抽出所有數字。之後生成逐字稿時，只要「權威證明」段出現不在這份清單裡的數字，' +
          '自檢就會標成警告，避免 AI 替你編造成果。')
    ]));
    card.appendChild(el('p.card-sub', { text: '只有以下數字可以出現在文案中。' }));

    var chips = el('div.chips.u-mt-4');
    if (r.numbers && r.numbers.length) {
      r.numbers.forEach(function (n) { chips.appendChild(el('span.chip.chip-ok', { text: n })); });
    } else {
      chips.appendChild(el('span.chip', { text: '原文沒有任何數字' }));
    }
    card.appendChild(chips);

    var list = el('ul.honesty-list.u-mt-4');
    (r.honestyNotes || []).forEach(function (n) { list.appendChild(el('li', { text: n })); });
    card.appendChild(list);
    return card;
  }

  /* ---------- 儲存 ---------- */
  function saveCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '02' }),
      el('h2', { text: '存成人設檔案' }),
      tip('儲存內容包含原始自述、解析結果、禁語清單與誠實邊界。之後在逐字稿與圖卡文案頁可以直接選用。')
    ]));

    var input = el('input.inp', {
      id: 'personaName', type: 'text',
      value: editingId ? (nameOf(editingId) || '') : '',
      placeholder: '人設名稱，例：Brandy 澳洲房產', autocomplete: 'off'
    });

    card.appendChild(el('div.row.u-mt-4.save-row', null, [
      input,
      el('button.btn.btn-primary', {
        type: 'button', text: editingId ? '更新這份人設' : '儲存人設', onclick: savePersona
      })
    ]));
    return card;
  }

  function nameOf(id) {
    var hit = Store.S.personas.filter(function (p) { return p.id === id; })[0];
    return hit ? hit.name : '';
  }

  function savePersona() {
    if (!pending) { toast('請先完成一次分析', 'error'); return; }
    var name = val('personaName');
    if (!name) { toast('請幫這份人設取個名字', 'error'); return; }

    var rec = {
      id: editingId || Store.uid('p'),
      name: name,
      story: pending.story,
      result: pending.result,
      antiPatterns: antiList.slice(),
      updatedAt: Date.now()
    };

    var idx = -1;
    Store.S.personas.forEach(function (p, i) { if (p.id === rec.id) idx = i; });
    if (idx >= 0) Store.S.personas[idx] = rec;
    else Store.S.personas.push(rec);

    editingId = rec.id;
    Store.save();
    paintSaved();
    paintResult();
    global.dispatchEvent(new CustomEvent('stunt:personas'));
    toast('人設「' + name + '」已儲存，可在文案架構頁套用', 'ok');
  }

  /* ============================================================
     六、已儲存清單
     ============================================================ */
  function savedCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '已儲存的人設' }),
      tip('載入會把原始自述放回輸入框、禁語清單也一併還原，修改後重新分析即可覆寫同一筆。')
    ]));
    savedHost = el('div.saved-list.u-mt-4');
    card.appendChild(savedHost);
    paintSaved();
    return card;
  }

  function paintSaved() {
    if (!savedHost) return;
    clear(savedHost);

    if (!Store.S.personas.length) {
      savedHost.appendChild(el('div.empty', null, [
        el('strong', { text: '尚未儲存任何人設' }),
        '在上方輸入背景資料並完成分析後，就能存成可重複套用的人設檔案。'
      ]));
      return;
    }

    Store.S.personas.forEach(function (p) {
      var core = (p.result && p.result.core) || '未命名定位';
      savedHost.appendChild(el('div.saved-item' + (p.id === editingId ? '.is-active' : ''), null, [
        el('span.nm', { text: p.name }),
        el('span.tag.tag-brand', { text: core }),
        el('span.spacer'),
        el('button.btn.btn-ghost', {
          type: 'button', text: '載入編輯', onclick: function () { loadPersona(p.id); }
        }),
        el('button.btn.btn-ghost.btn-danger', {
          type: 'button', text: '刪除', onclick: function () { delPersona(p.id); }
        })
      ]));
    });
  }

  function loadPersona(id) {
    var p = Store.S.personas.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    editingId = id;
    pending = { story: p.story, result: p.result };
    antiList = (Array.isArray(p.antiPatterns) && p.antiPatterns.length)
      ? p.antiPatterns.slice() : defaultAnti();
    activeTab = 'manual';
    render();
    setVal('pInput', p.story || '');
    toast('已載入「' + p.name + '」，可修改後重新分析', 'ok');
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function delPersona(id) {
    var p = Store.S.personas.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    Store.S.personas = Store.S.personas.filter(function (x) { return x.id !== id; });
    if (editingId === id) editingId = null;
    Store.save();
    paintSaved();
    global.dispatchEvent(new CustomEvent('stunt:personas'));
    toast('已刪除「' + p.name + '」');
  }

  S.modules = S.modules || {};
  S.modules.persona = { mount: mount, render: render };
})(window);
