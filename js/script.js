/* ============================================================
   Stunt — 文案架構（逐字稿生成）
   流程：人設 ＋ 口吻 ＋ 模型 → 主題 → 生成五段逐字稿
        → 技能管線後處理 → 自檢報告 → Hook 風險檢測
   真呼叫走 Stunt.LLM.call（自行 parse 五段 JSON，保留多輪自檢與技能管線），
   生成後另用 Stunt.LLM.lintDeep 掃一次文案鐵律；無法呼叫時降級本地模擬引擎。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;
  var el = S.el, tip = S.tip, toast = S.toast, clear = S.clear;

  /* ---------- 常數 ---------- */
  var PRESETS = {
    re: {
      label: '範例：澳洲房產',
      topic: '去澳洲買房',
      pain: '因為絕大部分人都這樣想，結果在稅法和流程上踩了大坑。今天我就來告訴你三個更好的做法。',
      how: '首先，搞清楚澳洲的稅法和政策，這裡和台灣完全不同。第二，文化差異可不是小事，思維落差會讓你在交易中吃虧。最後，找一個在當地有經驗的顧問陪你走完流程。'
    },
    pet: {
      label: '範例：寵物旅館',
      topic: '給貓咪洗澡',
      pain: '很多人都問為什麼貓咪洗完澡後皮膚會發癢或掉毛，很可能就是因為用錯了洗毛精。',
      how: '正確的做法是選擇專為貓咪設計的洗毛精，保護皮膚不受刺激，讓毛髮柔順健康。'
    }
  };

  var STRUCTS = { fz: ['pain', 'how', 'auth'], zf: ['how', 'pain', 'auth'], auth: ['auth', 'pain', 'how'] };
  var STRUCT_LABEL = {
    fz: '反正：痛點 → 正確做法 → 權威',
    zf: '正反：正確做法 → 痛點 → 權威',
    auth: '權威開場：權威 → 痛點 → 做法',
    rnd: '隨機排列'
  };
  var SEC_NAMES = { hook: '黃金開頭 Hook', pain: '痛點共鳴', how: '正確做法', auth: '權威證明', cta: '行動呼籲 CTA' };
  var LEN_LABEL = { '30': '30 秒短版（8-12 句）', '60': '60 秒完整版（15-20 句）', '90': '90 秒深度版（20-28 句）' };
  var NUMS = ['①', '②', '③', '④', '⑤'];

  /* 隨機句庫：本地模擬引擎用，確保同樣輸入不會每次一模一樣 */
  function pk(a) { return a[Math.floor(Math.random() * a.length)]; }
  var HOOKS = [
    function (t) { return '你' + t + '，千萬不要一開始就照別人的方法做'; },
    function (t) { return t + '之前，99% 的人都漏了這一步'; },
    function (t) { return '為什麼你' + t + '總是吃虧？問題出在第一步'; },
    function (t) { return t + '，最怕的不是沒做，是用錯方法'; }
  ];
  var PAINS = [
    '因為絕大部分人都這樣想，結果走了很多冤枉路。',
    '很多人來找我的時候，已經在這裡賠過一次了。',
    '這個誤區我看過太多次，每次都是同一個劇本。'
  ];
  var TRANS = ['今天我來告訴你更好的做法。', '接下來給你能直接用的步驟。', '我直接給你答案。'];
  var AUTHS = [
    function (m) {
      return '像我' + (m.identity ? '是' + m.identity : '') +
             (m.trust ? '，' + m.trust : '，在這個領域累積大量實戰') + '，這些都是實打實踩出來的經驗。';
    },
    function (m) {
      return (m.trust ? m.trust + '。' : '') + '我' + (m.identity ? '作為' + m.identity + '，' : '') + '講的每一步都自己驗證過。';
    }
  ];
  var CTAS = [
    function (kw) { return kw ? '想知道更多，直接在留言區打「' + kw + '」，我私訊你完整資料。' : '想知道更多，歡迎留言或私訊我。'; },
    function (kw) { return kw ? '需要的人現在留言「' + kw + '」，我一個一個回。' : '有問題直接留言，我都會回。'; }
  ];

  /* ---------- 模組狀態（不進 Store，避免與並行模組搶 schema） ---------- */
  var root = null;
  var state = {
    personaId: '', voiceId: '', topic: '', preset: 'custom',
    struct: 'fz', len: '60', kw: '', outline: '',
    suggest: null,   // { specific:[], broad:[], src:'' }
    result: null
  };
  var outBox = null, sugBox = null;

  /* ---------- 人設 / 口吻 欄位安全存取（來源模組可能仍在建置中） ---------- */
  function persona() {
    return (Store.S.personas || []).filter(function (p) { return p && p.id === state.personaId; })[0] || null;
  }
  function voice() {
    return (Store.S.voices || []).filter(function (v) { return v && v.id === state.voiceId; })[0] || null;
  }
  function pmeta(p) { return (p && p.result && p.result.meta) || {}; }
  function pcore(p) { return (p && p.result && p.result.core) || (p && p.name) || ''; }
  function pstory(p) { return (p && p.story) || ''; }
  function vprofile(v) { return (v && v.profile) || null; }
  function tagCls(extra) { return extra ? 'span.tag.' + extra : 'span.tag'; }

  /* ============================================================
     版面
     ============================================================ */
  function mount(node) { root = node; render(); }

  function render() {
    if (!root) return;

    var ps = Store.S.personas || [], vs = Store.S.voices || [];
    if (!state.personaId && ps.length) state.personaId = ps[0].id;
    if (!state.voiceId && vs.length) state.voiceId = vs[0].id;

    clear(root);
    root.appendChild(el('div.page-head', null, [
      el('h1', { id: 't-script', text: '文案架構' }),
      el('p.lede', { text: '把人設與口吻套進一支可直接口播的五段逐字稿，生成後自動做風險與誠實邊界檢查。' })
    ]));

    root.appendChild(prereqCard());
    root.appendChild(topicCard());
    root.appendChild(skillCard());
    root.appendChild(runCard());

    outBox = el('div.script-out');
    root.appendChild(outBox);
    paintResult();
  }

  /* ---------- 卡一：前置條件 ---------- */
  function prereqCard() {
    var card = el('div.card');
    var p = persona(), v = voice(), m = Store.boundModel();

    card.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '01' }),
      el('h2', { text: '素材與引擎' }),
      tip('逐字稿由三樣東西決定：人設決定「我是誰、能講什麼」，口吻決定「怎麼講」，模型決定「由誰生成」。三者齊備才會走真實生成，缺任何一項會降級成本地示範內容。')
    ]));

    card.appendChild(el('div.row.badge-row', null, [
      el(tagCls(p ? 'tag-brand' : 'tag-warn'), { text: p ? '人設：' + p.name : '未選人設' }),
      el(tagCls(v ? 'tag-accent' : 'tag-warn'), { text: v ? '口吻：' + v.name : '未選口吻' }),
      el(tagCls(m ? 'tag-ok' : 'tag-danger'), { text: m ? '引擎：' + m.modelName : '未綁定模型' })
    ]));

    var grid = el('div.grid.g2.u-mt-4');
    grid.appendChild(selectField('套用人設', 'sc-persona', ps().map(function (x) {
      return { value: x.id, label: x.name };
    }), state.personaId, '— 尚未建立人設 —', function (val) {
      state.personaId = val; state.suggest = null; render();
    }));
    grid.appendChild(selectField('套用口吻', 'sc-voice', vs().map(function (x) {
      return { value: x.id, label: x.name };
    }), state.voiceId, '— 尚未建立口吻 —', function (val) {
      state.voiceId = val; render();
    }));
    card.appendChild(grid);

    function ps() { return Store.S.personas || []; }
    function vs() { return Store.S.voices || []; }

    var miss = [];
    if (!p) miss.push({ text: '建立人設', page: 'persona' });
    if (!v) miss.push({ text: '建立口吻', page: 'voice' });
    if (!m) miss.push({ text: '綁定模型', page: 'models' });
    if (miss.length) {
      card.appendChild(el('div.notice.notice-warn.u-mt-4', null, [
        el('div.notice-body', null, [
          el('strong', { text: '還差 ' + miss.length + ' 項才能真實生成' }),
          el('p.card-sub', { text: '現在按下生成只會得到本地示範內容。' }),
          el('div.row.u-mt-4', null, miss.map(function (x) {
            return el('button.btn', { type: 'button', text: '前往' + x.text, onclick: function () { S.go(x.page); } });
          }))
        ])
      ]));
    }
    return card;
  }

  /* ---------- 卡二：主題與參數 ---------- */
  function topicCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '02' }),
      el('h2', { text: '主題與長度' }),
      tip('主題越具體，逐字稿越不容易寫成空話。按「請 AI 給建議」會依你的人設與這個方向生成 6 個候選主題，點一下即可帶入；沒有可用模型時改用本地建議。')
    ]));

    var input = el('input.inp', {
      id: 'sc-topic', type: 'text', value: state.topic,
      placeholder: '例：去澳洲買房', autocomplete: 'off',
      oninput: function (e) { state.topic = e.currentTarget.value; }
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); askTopics(document.getElementById('sc-sug-btn')); }
    });

    card.appendChild(el('label.field', null, [
      el('span.label', { text: '影片主題' }),
      el('div.row.row-nowrap', null, [
        input,
        el('button.btn', {
          id: 'sc-sug-btn', type: 'button', text: '請 AI 給建議',
          onclick: function (e) { askTopics(e.currentTarget); }
        })
      ])
    ]));

    sugBox = el('div.sug-box');
    card.appendChild(sugBox);
    paintSuggest();

    var grid = el('div.grid.g3');
    grid.appendChild(selectField('影片長度', 'sc-len', ['30', '60', '90'].map(function (k) {
      return { value: k, label: LEN_LABEL[k] };
    }), state.len, null, function (v) { state.len = v; }));
    grid.appendChild(selectField('段落結構', 'sc-struct', ['fz', 'zf', 'auth', 'rnd'].map(function (k) {
      return { value: k, label: STRUCT_LABEL[k] };
    }), state.struct, null, function (v) { state.struct = v; }));
    grid.appendChild(selectField('內容來源', 'sc-preset', [{ value: 'custom', label: '自訂大綱' }].concat(
      Object.keys(PRESETS).map(function (k) { return { value: k, label: PRESETS[k].label }; })
    ), state.preset, null, function (v) {
      state.preset = v;
      if (PRESETS[v]) state.topic = PRESETS[v].topic;
      render();
    }));
    card.appendChild(grid);

    card.appendChild(el('label.field', null, [
      el('span.label', null, ['CTA 留言關鍵字', tip('結尾會引導觀眾留下這個關鍵字，方便你日後辨識來自這支影片的詢問。留白則使用一般性的留言引導。')]),
      el('input.inp', {
        id: 'sc-kw', type: 'text', value: state.kw, placeholder: '例：報名', autocomplete: 'off',
        oninput: function (e) { state.kw = e.currentTarget.value; }
      })
    ]));

    if (state.preset === 'custom') {
      var ta = el('textarea.inp.ta', {
        id: 'sc-outline', rows: 4,
        placeholder: '例：\n澳洲買房要先看稅\n台澳文化差異會吃虧\n一定要找在地顧問',
        oninput: function (e) { state.outline = e.currentTarget.value; }
      });
      ta.value = state.outline;
      card.appendChild(el('label.field', null, [
        el('span.label', null, ['自訂大綱（選填）', tip('一行一個重點，生成時會逐點展開成逐字稿的「正確做法」段。留白時由模型自行決定內容骨架。')]),
        ta
      ]));
    }
    return card;
  }

  /* ---------- 卡三：技能管線 ---------- */
  function skillCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '03' }),
      el('h2', { text: '技能管線' }),
      tip('技能是生成完成之後才執行的後處理：口語化改寫會把書面語換成口說順的說法並拆開長句；完播率結構優化會在中段補上留人的鉤句；Hook 檢測會對開頭句評分並提供一鍵矯正。')
    ]));
    card.appendChild(el('p.card-sub', { text: '打開的技能會在每次生成後依序執行，並回報實際做了什麼。' }));

    var list = el('div.skill-list.u-mt-4');
    (Store.S.skills || []).forEach(function (sk) {
      var input = el('input', {
        type: 'checkbox', checked: !!sk.installed,
        onchange: function (e) { sk.installed = e.currentTarget.checked; Store.save(); }
      });
      list.appendChild(el('div.skill-row', null, [
        el('label.switch', null, [input, el('span.track'), el('span.skill-nm', { text: sk.name })]),
        tip(sk.desc || '')
      ]));
    });
    card.appendChild(list);
    return card;
  }

  /* ---------- 卡四：執行 ---------- */
  function runCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '04' }),
      el('h2', { text: '生成逐字稿' }),
      tip('每次生成都會隨機換一個切入角度（數據對比、親身故事、反常識觀點…），因此同樣的輸入按第二次不會得到相同的稿子。')
    ]));
    card.appendChild(el('div.row', null, [
      el('button.btn.btn-primary.btn-lg', {
        id: 'sc-run', type: 'button', text: '生成逐字稿',
        onclick: function (e) { genScript(e.currentTarget); }
      })
    ]));
    return card;
  }

  /* ---------- 小工具 ---------- */
  function selectField(label, id, opts, value, emptyLabel, onchange) {
    var sel = el('select.inp', {
      id: id,
      onchange: function (e) { onchange(e.currentTarget.value); }
    });
    if (!opts.length && emptyLabel) sel.appendChild(el('option', { value: '', text: emptyLabel }));
    opts.forEach(function (o) {
      sel.appendChild(el('option', { value: o.value, text: o.label, selected: o.value === value }));
    });
    if (value) sel.value = value;
    return el('label.field', null, [el('span.label', { text: label }), sel]);
  }

  /* ============================================================
     主題建議
     ============================================================ */
  function localSuggest(topic, p) {
    var pro = pmeta(p).pro || (p ? p.name : '這個領域');
    if (topic) {
      var t = topic.slice(0, 14);
      return {
        specific: [
          pk([t + '最常踩的 3 個坑', t + '前沒人告訴你的 3 件事']),
          pk(['一個真實案例：' + t + '從 0 到完成', '我幫客戶' + t + '的完整過程']),
          pk([t + '的隱藏成本清單', t + '前必問的 5 個問題'])
        ],
        broad: ['為什麼要' + t, '新手' + t + '指南', pk([t + '的行業真相', '關於' + t + '的常見迷思'])],
        src: '依主題「' + t + '」與人設本地生成'
      };
    }
    var trust = pmeta(p).trust;
    return {
      specific: [
        pro + '最常踩的 3 個坑',
        '一個真實案例：' + (trust ? String(trust).slice(0, 14) + '…的過程' : '客戶從 0 到成交'),
        pro + '收費前你該問的 5 個問題'
      ],
      broad: ['為什麼你需要' + pro, '新手入門' + pro, pro + '的行業真相'],
      src: '依人設本地生成'
    };
  }

  function askTopics(btn) {
    var p = persona();
    if (!p) { toast('請先選擇人設，建議才會貼近你的定位', 'error'); return; }
    var topic = (state.topic || '').trim();
    if (!topic) { toast('請先輸入一個大方向', 'error'); return; }

    var m = Store.boundModel();
    if (!S.LLM.canCall(m)) {
      state.suggest = localSuggest(topic, p);
      paintSuggest();
      toast('目前沒有可呼叫的模型，這是本地建議');
      return;
    }

    S.busy(btn, true, '生成中');
    var prompt = '根據影片主題「' + topic + '」與創作者人設「' + pcore(p) + '」（背景：' + pstory(p).slice(0, 100) +
      '），生成 6 個短影音主題建議，一律繁體中文：3 個「具體」型（含數字、案例或清單角度，緊扣主題）、' +
      '3 個「廣泛」型（入門／迷思／趨勢角度）。每個 18 字內。' +
      '只輸出 JSON，不要任何其他文字：{"specific":["a","b","c"],"broad":["a","b","c"]}';

    S.LLM.call(prompt, { temperature: 1.1 })
      .then(function (raw) {
        var o = S.LLM.pickJSON(raw);
        if (!o || !Array.isArray(o.specific) || !Array.isArray(o.broad)) throw new Error('回應不是預期的 JSON');
        state.suggest = {
          specific: o.specific.slice(0, 3).map(String),
          broad: o.broad.slice(0, 3).map(String),
          src: '由 ' + m.modelName + ' 依主題「' + topic.slice(0, 14) + '」與人設生成'
        };
        paintSuggest();
      })
      .catch(function (e) {
        state.suggest = localSuggest(topic, p);
        paintSuggest();
        toast('建議生成失敗：' + (e.message || e) + '，已改用本地建議', 'error');
      })
      .then(function () { S.busy(btn, false); });
  }

  function paintSuggest() {
    if (!sugBox) return;
    clear(sugBox);
    var s = state.suggest;
    if (!s) return;

    sugBox.appendChild(el('div.row', null, [
      el('span.label', { text: '主題建議' }),
      tip('具體主題（帶數字、案例、清單）通常比廣泛主題更容易讓觀眾停留。' + s.src + '。點一下即可帶入上方輸入框。')
    ]));

    var chips = el('div.chips.u-mt-4');
    function add(list, kind, cls) {
      (list || []).forEach(function (t) {
        chips.appendChild(el('button.chip.chip-btn', {
          type: 'button',
          onclick: function () {
            state.topic = t;
            var n = document.getElementById('sc-topic');
            if (n) n.value = t;
            toast('已帶入主題');
          }
        }, [el('span.sug-kind.' + cls, { text: kind }), t]));
      });
    }
    add(s.specific, '具體', 'k-spec');
    add(s.broad, '廣泛', 'k-broad');
    sugBox.appendChild(chips);
  }

  /* ============================================================
     Prompt 組裝（來源的硬約束全部保留）
     ============================================================ */
  function buildScriptPrompt(p) {
    var v = vprofile(p.voice);
    var range = { '30': '100-180', '60': '250-360', '90': '360-500' }[p.len];
    var sentBudget = {
      '30': '8-12 句：hook 1-2 句、痛點 2-3 句、做法 3-5 句、權威 1 句、CTA 1 句',
      '60': '15-20 句：hook 1-2 句、痛點 3-4 句、做法 7-10 句、權威 2-3 句、CTA 1-2 句',
      '90': '20-28 句：hook 2 句、痛點 4-5 句、做法 10-14 句、權威 3 句、CTA 2 句'
    }[p.len];
    var nums = (pmeta(p.persona).numbers || []).join('、') || '（無）';
    var anti = (p.persona.antiPatterns || []).join('；');
    var voiceLine = v
      ? '語氣：' + (v.tone || '自然') + '；' + (v.sentenceStyle || '') + '；' + (v.opener || '') +
        '；口頭禪：' + ((v.catchphrases || []).join('、') || '無') + '（自然使用 1-2 次，不可硬塞）'
      : '自然口語';

    return '你是短影音口播逐字稿寫手。用繁體中文、第一人稱，寫一支可直接口播的逐字稿。\n\n' +
      '【人設（我是誰）】\n' + pstory(p.persona) + '\n核心定位：' + pcore(p.persona) + '\n\n' +
      '【口吻要求】' + voiceLine + '\n\n' +
      '【主題】「' + p.topic + '」—— 這是最重要的要求：全文必須緊扣這個主題，每一段都要給出「該主題下的具體內容」' +
      '（具體項目、具體情境、具體金額區間或步驟），嚴禁寫成任何主題都能套用的空話。\n' +
      (p.outline.length
        ? '【必須涵蓋的大綱重點】\n' + p.outline.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n') + '\n'
        : '') +
      '【切入角度】本次用「' + p.angle + '」的角度切入（每次生成角度不同，請充分發揮此角度）。\n\n' +
      '【硬約束】\n' +
      '1. 禁語：保證、穩賺、絕對、躺賺、零風險' + (anti ? '；另外絕不：' + anti : '') + '\n' +
      '2. 誠實邊界：「個人成果數字」只能用人設原文出現過的數字（' + nums + '），不得編造；' +
      '主題相關的客觀數字可用「大約／左右」表達\n' +
      '3. 總長度 ' + range + ' 字、句數 ' + sentBudget + '\n' +
      '4. 「做法」段是全片主體：每一個做法點都要展開 2-3 句——具體項目或數字區間＋真實情境或例子＋一句可執行建議。' +
      '寫不滿句數就代表內容不夠具體，請補具體細節而不是湊空話\n' +
      '5. 結尾必須引導觀眾留言「' + (p.kw || '想了解') + '」\n' +
      '6. 一律繁體中文，禁止簡體字；禁止「不是…而是／就是」句式；禁止總結式標語；禁止商業黑話\n\n' +
      '【輸出格式】只輸出 JSON，不要任何其他文字：\n' +
      '{"hook":"開頭鉤子，25字內，點名受眾＋衝突或好奇缺口，禁止自我介紹開頭",' +
      '"pain":"痛點共鳴（緊扣主題的具體痛點）","how":"正確做法（主題下的具體步驟或項目）",' +
      '"auth":"權威證明（用人設真實經歷）","cta":"行動呼籲"}';
  }

  function parseScriptJSON(raw) {
    var o = S.LLM.pickJSON(raw);
    if (!o) throw new Error('模型回傳非 JSON');
    var keys = ['hook', 'pain', 'how', 'auth', 'cta'], out = {};
    for (var i = 0; i < keys.length; i++) {
      if (!o[keys[i]]) throw new Error('缺少段落 ' + keys[i]);
      out[keys[i]] = String(o[keys[i]]);
    }
    return out;
  }

  /* ============================================================
     Hook 風險評分（純規則引擎）
     ============================================================ */
  function scoreHook(hook) {
    var score = 100, issues = [];
    if (/^(大家好|我是|哈囉|嗨)/.test(hook)) {
      score -= 25; issues.push('開頭是自我介紹 — 觀眾 1 秒內就滑掉，先給衝突再說你是誰（-25）');
    }
    if (hook.length > 30) {
      score -= 15; issues.push('開頭 ' + hook.length + ' 字，3 秒內念不完，建議壓到 25 字內（-15）');
    }
    if (!/(你|你們|大家)/.test(hook)) {
      score -= 12; issues.push('缺少受眾稱呼（你／你們）（-12）');
    }
    if (!/(千萬不要|別再|不要|錯|最怕|沒人告訴你|99%|為什麼)/.test(hook) && !/\d/.test(hook) && !/[?？]/.test(hook)) {
      score -= 20; issues.push('缺少衝突或好奇缺口（警告詞、數字、反問）（-20）');
    }
    return { score: Math.max(0, score), issues: issues };
  }

  /* ============================================================
     生成主流程
     ============================================================ */
  function genScript(btn) {
    var p = persona();
    if (!p) { toast('請先選擇人設（沒有就到「人設定位」建立一個）', 'error'); return; }
    var v = voice();
    var m = Store.boundModel();

    var topicRaw = (state.topic || '').trim() || '你的主題';
    var t0 = topicRaw.charAt(0) === '你' ? topicRaw.slice(1) : topicRaw;
    var outline = String(state.outline || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var len = state.len, kw = (state.kw || '').trim();

    var mid = STRUCTS[state.struct];
    if (!mid) mid = ['pain', 'how', 'auth'].sort(function () { return Math.random() - 0.5; });
    var order = ['hook'].concat(mid, ['cta']);
    var angle = pk(['數據對比', '親身故事', '客戶真實案例', '反常識觀點', '清單盤點', '時間軸對比（剛來 vs 現在）']);

    var ctx = {
      mode: 'sim', hookRace: null, beliefUsed: false,
      hi: 0, ai: 0, ci: 0, angle: angle, mid: mid, order: order,
      t0: t0, len: len, kw: kw, persona: p, voice: v, model: m
    };

    var real = S.LLM.canCall(m);
    S.busy(btn, true, real ? '呼叫 ' + m.modelName + ' 中' : '生成中');

    var work;
    if (real) {
      work = S.LLM.call(buildScriptPrompt({
        persona: p, voice: v, topic: t0, outline: outline, len: len, kw: kw, angle: angle
      }), { temperature: 1.1 })
        .then(function (raw) { ctx.mode = 'real'; return parseScriptJSON(raw); })
        .catch(function (e) {
          toast('LLM 呼叫失敗：' + (e.message || e) + '，本次改用本地模擬引擎', 'error');
          return simulate(ctx, outline);
        });
    } else {
      work = new Promise(function (r) { setTimeout(r, 500); }).then(function () { return simulate(ctx, outline); });
    }

    work.then(function (texts) { finish(texts, ctx); })
      .catch(function (e) { toast('生成失敗：' + (e.message || e), 'error'); })
      .then(function () { S.busy(btn, false); });
  }

  /* ---------- 本地模擬引擎（含 Hook 三版併行生成、評分擇優） ---------- */
  function simulate(ctx, outline) {
    var meta = pmeta(ctx.persona), t0 = ctx.t0, len = ctx.len;
    ctx.ai = Math.floor(Math.random() * AUTHS.length);
    ctx.ci = Math.floor(Math.random() * CTAS.length);

    var idxs = HOOKS.map(function (_, i) { return i; }).sort(function () { return Math.random() - 0.5; }).slice(0, 3);
    var race = idxs.map(function (i) {
      var text = HOOKS[i](t0);
      return { i: i, text: text, score: scoreHook(text).score };
    }).sort(function (a, b) { return b.score - a.score; });
    ctx.hi = race[0].i;
    ctx.hookRace = race;

    var pain, how, preset = PRESETS[state.preset];
    if (preset) {
      pain = len === '30' ? preset.pain.split('。')[0] + '。' : preset.pain + pk(TRANS);
      how = len === '30' ? preset.how.split('。')[0] + '。' : preset.how;
    } else {
      pain = (len === '30' ? '' : '講到' + t0 + '，') + pk(PAINS) + (len === '30' ? '' : pk(TRANS));
      if (len === '30') {
        var ls = outline.slice(0, 2);
        how = ls.length
          ? '記住' + (ls.length > 1 ? '兩件事' : '一件事') + '：' + ls.join('；') + '。'
          : '記住一件事：' + t0 + '要先搞懂規則，再動手。';
      } else {
        how = outline.length
          ? outline.map(function (l, i) { return '第' + ('一二三四五'[i] || (i + 1)) + '，' + l + '。'; }).join('')
          : '第一，先搞清楚' + t0 + '背後真正的規則。第二，避開新手在' + t0 + '上最常踩的坑。第三，找有經驗的人帶你走一遍。';
      }
    }

    var auth = len === '30' ? (meta.trust || '我有大量實戰經驗') + '。' : AUTHS[ctx.ai](meta);
    var texts = { hook: HOOKS[ctx.hi](t0) + '。', pain: pain, how: how, auth: auth, cta: CTAS[ctx.ci](ctx.kw) };

    var beliefs = (meta.beliefs || []).filter(function (b) { return String(b).slice(-1) !== '…'; });
    if (beliefs.length && len !== '30' && Math.random() < 0.6) {
      texts.pain += pk(beliefs) + '。';
      ctx.beliefUsed = true;
    }
    return texts;
  }

  /* ---------- 後處理：技能管線 → 自檢 → 呈現 ---------- */
  function finish(texts, ctx) {
    var reports = runSkills(texts, ctx);
    var checks = runChecks(texts, ctx);
    var lint = S.LLM.lintDeep(texts);

    var total = ctx.order.reduce(function (s, k) { return s + texts[k].length; }, 0);
    var structNote = state.struct === 'rnd'
      ? '隨機（' + ctx.mid.map(function (k) { return SEC_NAMES[k]; }).join(' → ') + '）'
      : STRUCT_LABEL[state.struct];

    var note = ctx.mode === 'real'
      ? '真實生成（temperature 1.1）。本次隨機切入角度：「' + ctx.angle + '」——同樣輸入再按一次會換角度。結構：' + structNote
      : (ctx.beliefUsed ? '已織入你的觀點句一則。' : '') +
        'Hook 三版併行擇優：' +
        (ctx.hookRace || []).map(function (h) { return '#' + (h.i + 1) + ' ' + h.score + ' 分'; }).join(' / ') +
        ' → 採用 #' + (ctx.hi + 1) + '。權威句式 #' + (ctx.ai + 1) + '、CTA 版型 #' + (ctx.ci + 1) + '、結構：' + structNote;

    state.result = {
      mode: ctx.mode,
      sections: ctx.order.map(function (k) {
        return { key: k, name: SEC_NAMES[k], lock: k === 'hook', text: texts[k] };
      }),
      reports: reports, checks: checks, lint: lint,
      estSec: Math.round(total / 4.3), total: total, len: ctx.len, note: note,
      personaName: ctx.persona.name,
      voiceName: ctx.voice ? ctx.voice.name : '',
      modelName: ctx.model ? ctx.model.modelName : '未綁定'
    };
    paintResult();
    if (outBox && outBox.scrollIntoView) outBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (ctx.mode === 'real') toast('已由 ' + state.result.modelName + ' 生成', 'ok');
    else toast('逐字稿已生成（本地模擬引擎，內容僅供示範）');
  }

  function hasSkill(id) {
    return (Store.S.skills || []).some(function (s) { return s.id === id && s.installed; });
  }

  function runSkills(texts, ctx) {
    var reports = [];

    if (hasSkill('colloquial')) {
      var splits = 0, swaps = 0;
      var SWAP = [['非常', '超'], ['十分', '超'], ['因此', '所以'], ['即可', '就好'], ['進行', '去做']];
      Object.keys(texts).forEach(function (k) {
        var t = texts[k];
        SWAP.forEach(function (pair) {
          var n = t.split(pair[0]).length - 1;
          if (n) { swaps += n; t = t.split(pair[0]).join(pair[1]); }
        });
        // 長句拆短：超過 32 字的句子在第一個逗號處切成兩句
        t = t.split('。').map(function (s) {
          if (s.length > 32 && s.indexOf('，') >= 0) {
            splits++;
            var i = s.indexOf('，');
            return s.slice(0, i) + '。' + s.slice(i + 1);
          }
          return s;
        }).join('。');
        texts[k] = t;
      });
      reports.push({ name: '口語化改寫', pass: true, note: '已拆短 ' + splits + ' 句、口語替換 ' + swaps + ' 處' });
    }

    if (hasSkill('retention')) {
      var HOOK_WORDS = /(先別滑|最關鍵|重點來了|注意聽|最後一點)/;
      if (!HOOK_WORDS.test(texts.how)) {
        texts.how = '重點來了——' + texts.how;
        reports.push({ name: '完播率結構優化', pass: true, note: '中段未偵測到下鉤句，已在「正確做法」開頭插入「重點來了——」' });
      } else {
        reports.push({ name: '完播率結構優化', pass: true, note: '中段已有下鉤句，通過檢查' });
      }
    }

    // 結尾行動指令：只看結尾有沒有給觀眾明確動作，不比對任何外部規則表
    var ACTION = /(留言|私訊|按下|點擊|追蹤|收藏|分享|填表|報名|預約|打「)/;
    var hasAction = ACTION.test(texts.cta);
    reports.push({
      name: '結尾行動指令',
      pass: hasAction,
      note: hasAction
        ? (ctx.kw ? '結尾已給出明確動作，並帶上關鍵字「' + ctx.kw + '」。' : '結尾已給出明確動作。')
        : '結尾沒有明確要觀眾做什麼，建議補一句具體動作，例如請觀眾留言指定關鍵字。'
    });

    return reports;
  }

  function runChecks(texts, ctx) {
    var len = ctx.len, order = ctx.order;
    var total = order.reduce(function (s, k) { return s + texts[k].length; }, 0);
    var estSec = Math.round(total / 4.3);
    var range = { '30': [100, 190], '60': [230, 380], '90': [340, 520] }[len];
    var sentTarget = { '30': [8, 12], '60': [15, 20], '90': [20, 28] }[len];

    var allSents = [];
    order.forEach(function (k) {
      texts[k].split(/[。！？]/).forEach(function (s) {
        s = s.trim();
        if (s) allSents.push(s);
      });
    });
    var seenSent = {}, dup = false;
    allSents.forEach(function (s) { if (seenSent[s]) dup = true; seenSent[s] = 1; });
    var hasTrans = /(今天我|接下來|我直接|重點來了|首先|第一|記住)/.test(texts.pain + texts.how);

    var checks = [
      { label: '段落銜接：痛點與做法之間有過渡句', ok: hasTrans },
      { label: '無重複句', ok: !dup },
      {
        label: '長度符合 ' + len + ' 秒目標（' + range[0] + '-' + range[1] + ' 字）',
        ok: total >= range[0] && total <= range[1],
        detail: '實際 ' + total + ' 字，預估口播 ' + estSec + ' 秒'
      },
      {
        label: '句數達標（目標 ' + sentTarget[0] + '-' + sentTarget[1] + ' 句）',
        ok: allSents.length >= sentTarget[0],
        detail: '實際 ' + allSents.length + ' 句；句數不足通常代表內容不夠具體'
      }
    ];

    // 反模式：內建誇大話術 ＋ 人設自訂禁語
    var RISKY = ['保證', '穩賺', '絕對', '躺賺', '零風險', '100%'];
    var anti = [];
    (ctx.persona.antiPatterns || []).forEach(function (s) {
      String(s).split(/[\/、,，\s]/).forEach(function (w) {
        w = w.trim();
        if (w.length >= 2 && w.length <= 6) anti.push(w);
      });
    });
    var fullText = order.map(function (k) { return texts[k]; }).join('');
    var seenW = {}, antiHits = [];
    RISKY.concat(anti).forEach(function (w) {
      if (seenW[w]) return;
      seenW[w] = 1;
      if (fullText.indexOf(w) >= 0) antiHits.push(w);
    });
    checks.push({
      label: '反模式檢查：未觸犯禁語與誇大話術',
      ok: !antiHits.length,
      detail: antiHits.length ? '發現：' + antiHits.join('、') + '，請改寫' : '',
      severe: !!antiHits.length
    });

    // 誠實邊界：權威段的數字必須出現在人設原文
    var storyNums = (pmeta(ctx.persona).numbers || []).map(String);
    var fabNums = (texts.auth.match(/\d+/g) || []).filter(function (n) { return storyNums.indexOf(n) < 0; });
    checks.push({
      label: '誠實邊界：權威段的數字皆來自人設原文，沒有被編造',
      ok: !fabNums.length,
      detail: fabNums.length ? '「' + fabNums.join('、') + '」不在人設原文中，請人工核對' : '',
      severe: !!fabNums.length
    });

    return checks;
  }

  /* ============================================================
     結果呈現
     ============================================================ */
  function paintResult() {
    if (!outBox) return;
    clear(outBox);
    var r = state.result;
    if (!r) return;

    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '你的逐字稿' }),
      tip('開頭 Hook 是整支影片的命脈，建議照原文念；其餘段落可依現場感覺微調。下方自檢僅為規則層檢查，發布前仍請自己讀過一遍。')
    ]));

    card.appendChild(el('div.row.badge-row', null, [
      el(tagCls('tag-ok'), { text: '引擎：' + r.modelName + (r.mode === 'real' ? '（真實呼叫）' : '（本地模擬）') }),
      el(tagCls('tag-brand'), { text: '人設：' + r.personaName }),
      el(tagCls(r.voiceName ? 'tag-accent' : 'tag-warn'), { text: r.voiceName ? '口吻：' + r.voiceName : '未套用口吻' }),
      el(tagCls(''), { text: String(LEN_LABEL[r.len]).split('（')[0] + '・預估口播 ' + r.estSec + ' 秒' })
    ]));

    var secs = el('div.u-mt-5');
    r.sections.forEach(function (s, i) {
      secs.appendChild(el('div.sect', null, [
        el('div.row.sect-head', null, [
          el('span.sect-name', { text: (NUMS[i] || '') + ' ' + s.name }),
          el('span.spacer'),
          el(tagCls(s.lock ? 'tag-danger' : ''), { text: s.lock ? '建議照原文念' : '可微調' })
        ]),
        el('p', { text: s.text })
      ]));
    });
    card.appendChild(secs);

    card.appendChild(el('div.row.u-mt-5', null, [
      el('button.btn.btn-primary', {
        type: 'button', text: '複製逐字稿',
        onclick: function () {
          S.copyText(r.sections.map(function (s) { return s.text; }).join('\n'));
        }
      })
    ]));
    outBox.appendChild(card);

    if (hasSkill('hook')) outBox.appendChild(hookCard());
    outBox.appendChild(reportCard(r));
  }

  /* ---------- Hook 風險檢測卡 ---------- */
  function hookCard() {
    var card = el('div.card.hook-card');
    var r = state.result;
    var idx = -1;
    r.sections.forEach(function (s, i) { if (s.key === 'hook') idx = i; });
    if (idx < 0) return card;

    var hook = r.sections[idx].text.replace(/。$/, '');
    var res = scoreHook(hook);
    var level = res.score >= 85 ? 'low' : res.score >= 65 ? 'mid' : 'high';
    var label = res.score >= 85 ? '低風險，抓得住前 3 秒'
              : res.score >= 65 ? '中風險，有優化空間' : '高風險，大概率被滑掉';

    card.appendChild(el('div.card-head', null, [
      el('h3', { text: '三秒爆款 Hook 檢測' }),
      tip('純規則的滑掉風險評分：自我介紹開頭扣 25、超過 30 字扣 15、沒有點名受眾扣 12、沒有衝突或好奇缺口扣 20。低於 85 分建議重寫。'),
      el('span.spacer'),
      el(tagCls('tag-accent'), { text: '技能自動執行' })
    ]));

    card.appendChild(el('div.row', null, [
      el('span.risk-score.rk-' + level, { text: String(res.score) }),
      el('strong.rk-' + level, { text: label })
    ]));

    var fill = el('div.risk-fill' + (level === 'mid' ? '.mid' : level === 'high' ? '.high' : ''));
    card.appendChild(el('div.risk-meter', null, fill));
    requestAnimationFrame(function () { fill.style.width = res.score + '%'; });

    if (res.issues.length) {
      card.appendChild(el('ul.chk-list', null, res.issues.map(function (i) {
        return el('li.chk-warn', { text: i });
      })));
    } else {
      card.appendChild(el('p.chk-pass', { text: '通過全部檢測：有受眾點名、有衝突缺口、3 秒可念完。' }));
    }

    if (res.score < 85) {
      card.appendChild(el('div.row.u-mt-4', null, [
        el('button.btn', { type: 'button', text: '一鍵矯正 Hook', onclick: function () { fixHook(idx); } })
      ]));
    }
    return card;
  }

  function fixHook(idx) {
    var t = ((state.topic || '').trim() || '做這件事');
    if (t.charAt(0) === '你') t = t.slice(1);
    t = t.slice(0, 16);
    // 產生數個候選，用同一支評分引擎擇優，避免換了一句卻沒變好
    var best = [
      '你們' + t + '，千萬不要再用老方法了',
      '你' + t + '之前，99% 的人都漏了這一步',
      '為什麼你' + t + '總是吃虧？問題出在第一步'
    ].map(function (c) { return { text: c, score: scoreHook(c).score }; })
     .sort(function (a, b) { return b.score - a.score; })[0];

    state.result.sections[idx].text = best.text + '。';
    paintResult();
    toast('Hook 已重寫並重新評分（' + best.score + ' 分）', 'ok');
  }

  /* ---------- 自檢報告卡 ---------- */
  function reportCard(r) {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h3', { text: '生成後自檢' }),
      tip('三層檢查：技能管線實際做了什麼、通順性與長度是否達標、以及誠實邊界——權威段若出現人設原文沒有的數字會提出警告。')
    ]));

    if (r.reports.length) {
      var rl = el('div.stack');
      r.reports.forEach(function (x) {
        rl.appendChild(el('div.skill-report', null, [
          el('div.row', null, [
            el('strong', { text: x.name }),
            el(tagCls(x.pass ? 'tag-ok' : 'tag-warn'), { text: x.pass ? '已執行' : '需注意' })
          ]),
          el('p.card-sub', { text: x.note })
        ]));
      });
      card.appendChild(rl);
    }

    card.appendChild(el('ul.chk-list.u-mt-5', null, r.checks.map(function (c) {
      return el('li.' + (c.ok ? 'chk-ok' : c.severe ? 'chk-danger' : 'chk-warn'), {
        text: (c.ok ? '通過 — ' : '注意 — ') + c.label + (c.detail ? '（' + c.detail + '）' : '')
      });
    })));

    if (r.lint && r.lint.length) {
      card.appendChild(el('div.notice.notice-danger.u-mt-5', null, [
        el('div.notice-body', null, [
          el('strong', { text: '文案鐵律違規 ' + r.lint.length + ' 項，建議重新生成' }),
          el('ul.chk-list', null, r.lint.slice(0, 8).map(function (w) {
            return el('li.chk-danger', { text: w });
          }))
        ])
      ]));
    }

    var severe = r.checks.filter(function (c) { return c.severe; });
    if (severe.length) {
      card.appendChild(el('div.notice.notice-warn.u-mt-4', null, [
        el('div.notice-body', null, [
          el('strong', { text: '請人工核對後再發布' }),
          el('p.card-sub', {
            text: severe.map(function (c) { return c.label + '：' + (c.detail || '未通過'); }).join('；')
          })
        ])
      ]));
    }

    card.appendChild(el('p.card-sub.u-mt-4', { text: r.note }));
    return card;
  }

  S.modules = S.modules || {};
  S.modules.script = { mount: mount, render: render };
})(window);
