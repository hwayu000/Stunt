/* ============================================================
   Stunt — 人格口吻（HOW：你怎麼說話）
   規則引擎為主：n-gram 口頭禪探勘、開場習慣、句尾語助詞率、句長、emoji、自稱。
   LLM 只做選配補強（語氣描述與句式特徵），失敗即降級為純規則結果並 toast 告知。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;
  var el = S.el, icon = S.icon, tip = S.tip, toast = S.toast, clear = S.clear;

  var root = null;
  var pending = null;          // { raw, profile, suggestName }
  var personaId = '';          // 目前選中的人設（僅用於推薦）
  var useLLM = true;           // 是否啟用 LLM 補強

  /* ============================================================
     一、規則引擎（純函式，與 UI 無關）
     ============================================================ */

  // 口頭禪探勘：句內滑動取 2–5 字片語（n-gram），跨句重複 ≥2 次者入選，
  // 依「出現次數 × 片語長度」排序（長片語優先），並吃掉自己的子片語。
  var STOP = ['我是', '我們', '你們', '他們', '一個', '可以', '因為', '所以',
              '這個', '那個', '還是', '沒有', '時候', '已經', '如果'];

  function mineCatchphrases(raw) {
    var counts = {};
    var sents = String(raw || '').split(/[。！？!?\n，,]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    sents.forEach(function (s) {
      for (var n = 2; n <= 5; n++) {
        for (var i = 0; i + n <= s.length; i++) {
          var g = s.slice(i, i + n);
          // 只留純中文片語：含英數、空白、標點、emoji 者略過
          if (/[A-Za-z0-9\s\p{P}\p{Emoji_Presentation}]/u.test(g)) continue;
          counts[g] = (counts[g] || 0) + 1;
        }
      }
    });

    var cands = Object.keys(counts)
      .map(function (g) { return [g, counts[g]]; })
      .filter(function (p) { return p[1] >= 2 && STOP.indexOf(p[0]) < 0; })
      .sort(function (a, b) { return (b[1] * b[0].length) - (a[1] * a[0].length); });

    var kept = [];
    for (var i = 0; i < cands.length; i++) {
      var g = cands[i][0], c = cands[i][1];
      // 已入選的長片語若完整包含此短片語且次數不低於它，代表短的只是長的碎片
      var swallowed = kept.some(function (k) { return k[0].indexOf(g) >= 0 && k[1] >= c; });
      if (swallowed) continue;
      kept.push([g, c]);
      if (kept.length >= 4) break;
    }
    return kept;
  }

  // 自稱方式：統計常見第一人稱用語
  var SELF_WORDS = ['我們', '咱們', '本人', '小編', '筆者', '我'];
  function mineSelfRef(raw) {
    var text = String(raw || '');
    var best = null;
    SELF_WORDS.forEach(function (w) {
      var n = (text.split(w).length - 1);
      if (n > 0 && (!best || n > best[1])) best = [w, n];
    });
    if (!best) return '文中不出現自稱';
    return '慣用「' + best[0] + '」自稱（' + best[1] + ' 次）';
  }

  function buildVoiceProfile(raw) {
    var text = String(raw || '');
    var emojis = (text.match(/\p{Emoji_Presentation}/gu) || []).length;
    var sentences = text.split(/[。！？!?\n]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    var total = sentences.reduce(function (s, x) { return s + x.length; }, 0);
    var avgLen = Math.round(total / Math.max(1, sentences.length));

    var mined = mineCatchphrases(text);                       // ① 口頭禪 n-gram

    var op = {};                                              // ② 開場習慣：句首 4 字頻率
    sentences.forEach(function (s) {
      var o = s.slice(0, 4);
      if (o.length >= 2) op[o] = (op[o] || 0) + 1;
    });
    var opener = Object.keys(op).map(function (k) { return [k, op[k]]; })
      .filter(function (p) { return p[1] >= 2; })
      .sort(function (a, b) { return b[1] - a[1]; })[0];

    var enders = sentences.filter(function (s) { return /[啦喔啊欸嘛耶哈]$/.test(s); }).length;
    var endRate = Math.round(enders / Math.max(1, sentences.length) * 100);   // ③ 句尾語助詞率

    var colloquial = endRate >= 25 || mined.some(function (m) { return /[啦喔欸嘛]/.test(m[0]); });

    var tips = [];
    if (sentences.length < 15) {
      tips.push('樣本只有 ' + sentences.length + ' 句。口頭禪要重複出現才算數，建議貼 15 句以上（約 3 至 5 篇貼文）。');
    }
    if (avgLen >= 22) tips.push('平均句長 ' + avgLen + ' 字偏長，口播建議拆成 15 字內的短句。');
    if (!colloquial) tips.push('句尾語助詞比例低、偏書面，口播時可加「欸、啦、喔」拉近距離。');
    if (emojis === 0) tips.push('貼文幾乎不用 emoji，若要放字幕可少量點綴。');
    if (!tips.length) tips.push('口吻自然口語，適合短影音口播，維持即可。');

    return {
      tone: colloquial ? '口語親切，像朋友聊天，不端著' : '敘事沉穩，娓娓道來',
      catchphrases: mined.map(function (m) { return '「' + m[0] + '」× ' + m[1]; }),
      opener: opener ? '常用「' + opener[0] + '…」開場（' + opener[1] + ' 次）' : '開場方式多變',
      endHabit: '句尾語助詞比例 ' + endRate + '%',
      sentenceStyle: avgLen < 20 ? '短句節奏（平均 ' + avgLen + ' 字／句）'
                                 : '長句鋪陳（平均 ' + avgLen + ' 字／句）',
      emojiHabit: emojis >= 3 ? '高頻 emoji（' + emojis + ' 個）'
                : emojis > 0  ? '少量 emoji（' + emojis + ' 個）' : '不用 emoji',
      selfRef: mineSelfRef(text),
      colloquial: colloquial,
      sampleCount: sentences.length,
      tips: tips
    };
  }

  /* ---------- 冷啟動預設口吻 ---------- */
  var VOICE_PRESETS = [
    { name: '親切聊天型', match: /聊天|生活|美食|親子|穿搭|日常/, profile: {
      tone: '口語親切，像朋友聊天，不端著',
      catchphrases: ['「欸」', '「啦」', '「我跟你說」'],
      opener: '常用「欸我跟你說…」開場',
      endHabit: '句尾語助詞比例高',
      sentenceStyle: '短句節奏（12 至 15 字／句）',
      emojiHabit: '少量 emoji 點綴',
      selfRef: '慣用「我」自稱',
      colloquial: true,
      tips: ['冷啟動預設口吻。之後有實際發文再重新萃取一次會更像你本人。']
    }},
    { name: '專業顧問型', match: /顧問|房產|理財|保險|法律|醫|會計|企業|B2B|財務/, profile: {
      tone: '敘事沉穩，條理分明，給足安全感',
      catchphrases: ['「關鍵是」', '「根據經驗」'],
      opener: '常用「很多人以為…」開場',
      endHabit: '句尾語助詞比例低',
      sentenceStyle: '中句鋪陳（18 至 22 字／句）',
      emojiHabit: '不用 emoji',
      selfRef: '慣用「我」自稱',
      colloquial: false,
      tips: ['適合高客單、需要信任感的業態。']
    }},
    { name: '激勵教練型', match: /教練|健身|激勵|成長|課程|訓練|銷售|業務/, profile: {
      tone: '節奏快、有衝勁，直接對你喊話',
      catchphrases: ['「聽好」', '「現在就去做」'],
      opener: '常用「聽好…」開場',
      endHabit: '句尾以命令句為主',
      sentenceStyle: '極短句（8 至 12 字／句）',
      emojiHabit: '高頻 emoji',
      selfRef: '慣用「我」自稱，常直呼「你」',
      colloquial: true,
      tips: ['適合課程、自我成長類內容。']
    }}
  ];

  /* ---------- A/B/C 校準題目 ---------- */
  var CALIB = [
    { key: 'A', name: 'A 口語版', text: '欸我跟你說，這件事真的不能隨便啦，很多人就是在這裡吃虧的。' },
    { key: 'B', name: 'B 中性版', text: '這件事真的不能隨便處理，很多人都在這裡吃虧。' },
    { key: 'C', name: 'C 書面版', text: '此事務必審慎處理，多數人的損失皆源於輕率的決策。' }
  ];

  var ALGO_TIP =
    '演算法：① 口頭禪＝句內 2 至 5 字片語 n-gram 探勘，跨句重複 2 次以上入選，長片語優先並吃掉自己的子片語。' +
    '② 開場習慣＝句首 4 字頻率統計。③ 句尾語助詞比例。④ 句長與 emoji 分佈。⑤ 第一人稱用語統計。' +
    '這一層完全在你的瀏覽器內計算，不需要模型。若已綁定模型，會再疊一層語感判讀。';

  /* ============================================================
     二、人設推薦
     ============================================================ */

  // 人設結構可能隨版本演進，這裡淺層蒐集字串再比對關鍵字，避免綁死欄位名。
  function collectText(obj, depth) {
    if (depth > 3 || obj === null || obj === undefined) return '';
    if (typeof obj === 'string') return obj + ' ';
    if (typeof obj === 'number') return '';
    if (Array.isArray(obj)) {
      return obj.slice(0, 12).map(function (v) { return collectText(v, depth + 1); }).join('');
    }
    if (typeof obj === 'object') {
      return Object.keys(obj).slice(0, 20).map(function (k) {
        return collectText(obj[k], depth + 1);
      }).join('');
    }
    return '';
  }

  function currentPersona() {
    if (!personaId) return null;
    return (Store.S.personas || []).filter(function (p) { return p && p.id === personaId; })[0] || null;
  }

  function recommendedPreset() {
    var p = currentPersona();
    if (!p) return null;
    var text = collectText(p, 0).slice(0, 4000);
    for (var i = 0; i < VOICE_PRESETS.length; i++) {
      if (VOICE_PRESETS[i].match.test(text)) return VOICE_PRESETS[i].name;
    }
    return '親切聊天型';
  }

  /* ============================================================
     三、渲染
     ============================================================ */

  // 樣式由 index.html 統一引入（css/voice.css），此處不再動態插入。
  function mount(node) { root = node; render(); }

  function render() {
    if (!root) return;
    clear(root);

    root.appendChild(el('div.page-head', null, [
      el('h1', { id: 't-voice', text: '人格口吻' }),
      el('p.lede', { text: '人設決定你說什麼，口吻決定你怎麼說。貼上過去的發文萃取出你的說話特徵，之後生成的文案都會照這個語感走。' })
    ]));

    root.appendChild(sourceCard());
    if (pending) {
      root.appendChild(profileCard());
      root.appendChild(calibrateCard());
      root.appendChild(saveCard());
    }
    root.appendChild(listCard());
  }

  /* ---------- 步驟一：素材輸入 ---------- */
  function sourceCard() {
    var card = el('div.card');

    card.appendChild(el('div.card-head', null, [
      el('h2', null, [icon('voice', 20), ' 你的說話素材']),
      tip('兩條路：有過去的發文就貼進來，規則引擎會直接從文字裡挖出你的口頭禪與句式；' +
          '完全沒有發文就先挑一個冷啟動口吻頂著，之後累積內容再回來重新萃取。')
    ]));
    card.appendChild(el('p.card-sub', { text: '貼上 3 至 5 篇過去的貼文，或直接挑一個預設口吻起步。' }));

    // 人設選擇（僅供推薦）
    var personas = Store.S.personas || [];
    var sel = el('select.inp', {
      id: 'voice-persona',
      'aria-label': '套用人設以取得口吻建議',
      onchange: function (e) { personaId = e.currentTarget.value; render(); }
    });
    sel.appendChild(el('option', { value: '', text: '（不指定人設）' }));
    personas.forEach(function (p) {
      sel.appendChild(el('option', { value: p.id, text: p.name || '未命名人設', selected: p.id === personaId }));
    });

    card.appendChild(el('label.field', null, [
      el('span.label', null, ['依人設推薦口吻', tip('選一個已存的人設，系統會依它的專業領域推薦最合適的預設口吻，並在下方標註「推薦」。')]),
      personas.length ? sel : el('div.empty', { text: '尚未建立任何人設，可先到「人設定位」建立，或直接挑下方的預設口吻。' })
    ]));

    // 預設口吻 chips
    var rec = recommendedPreset();
    var chips = el('div.chips');
    VOICE_PRESETS.forEach(function (v, i) {
      var isRec = rec === v.name;
      chips.appendChild(el('button.chip-btn' + (isRec ? '.is-on' : ''), {
        type: 'button',
        text: v.name + (isRec ? '（推薦）' : ''),
        onclick: function () { usePreset(i); }
      }));
    });
    card.appendChild(el('label.field', null, [
      el('span.label', null, ['冷啟動預設口吻', tip('沒有發文可用時的起手式。點一下就會建立口吻檔案，記得往下命名儲存。')]),
      chips
    ]));

    // 素材輸入
    card.appendChild(el('label.field', null, [
      el('span.label', null, ['過去的發文', tip('多篇貼文之間用空行分隔即可。句數越多，口頭禪探勘越準；少於 15 句時系統會提醒你樣本不足。')]),
      el('textarea.inp', {
        id: 'voice-raw', rows: 8, spellcheck: 'false',
        placeholder: '把過去的貼文貼進來，多篇之間空一行…',
        value: pending && pending.raw && pending.raw.indexOf('（預設口吻') !== 0 ? pending.raw : ''
      })
    ]));

    // LLM 補強開關
    var chk = el('input', {
      id: 'voice-llm', type: 'checkbox', checked: useLLM,
      onchange: function (e) { useLLM = e.currentTarget.checked; }
    });
    card.appendChild(el('label.field.voice-opt', null, [
      el('span.label', null, [chk, ' 加上模型的語感判讀',
        tip('規則引擎算得出頻率，算不出語氣。開啟後會再請已綁定的模型補一段語氣描述與句式特徵；' +
            '模型未綁定或呼叫失敗時，會自動退回純規則結果，不影響萃取。')])
    ]));

    var actions = el('div.row');
    actions.appendChild(el('button.btn.btn-primary', {
      type: 'button', text: '萃取我的口吻檔案',
      onclick: function (e) { analyze(e.currentTarget); }
    }));
    actions.appendChild(el('span.spacer'));
    actions.appendChild(el('button.btn.btn-ghost', {
      type: 'button', text: '看演算法', onclick: function () {
        S.openModal('口吻萃取怎麼算出來的', [el('p', { text: ALGO_TIP })]);
      }
    }));
    card.appendChild(actions);
    return card;
  }

  /* ---------- 步驟二：口吻檔案 ---------- */
  function profileCard() {
    var p = pending.profile;
    var card = el('div.card');

    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '你的口吻檔案' }),
      tip(ALGO_TIP),
      el('span.spacer'),
      el('span.tag.tag-accent', { text: '樣本 ' + (p.sampleCount || 0) + ' 句' })
    ]));

    card.appendChild(el('p.voice-tone', { text: p.tone }));
    if (p.calibrated) {
      card.appendChild(el('div.row', null, [
        el('span.tag.tag-ok', null, [icon('check', 15), ' 已本人校準：' + p.calibrated])
      ]));
    }
    if (p.llmNote) {
      card.appendChild(el('div.rcard.voice-llm-note', null, [
        el('h4', { text: '模型的語感判讀' }),
        el('p', { text: p.llmNote })
      ]));
    }

    var grid = el('div.result-grid.u-mt-4');

    var cp = el('div.rcard', null, [el('h4', { text: '口頭禪' })]);
    if (p.catchphrases && p.catchphrases.length) {
      var cps = el('div.chips');
      p.catchphrases.forEach(function (c) { cps.appendChild(el('span.chip', { text: c })); });
      cp.appendChild(cps);
    } else {
      cp.appendChild(el('p', { text: '樣本不足：片語要跨句重複 2 次以上才會入選。' }));
    }
    grid.appendChild(cp);

    [['開場習慣', p.opener], ['句尾語助詞', p.endHabit], ['句長節奏', p.sentenceStyle],
     ['emoji 習慣', p.emojiHabit], ['自稱方式', p.selfRef]].forEach(function (pair) {
      if (!pair[1]) return;
      grid.appendChild(el('div.rcard', null, [
        el('h4', { text: pair[0] }),
        el('p', { text: pair[1] })
      ]));
    });
    card.appendChild(grid);

    if (p.tips && p.tips.length) {
      var box = el('div.notice.notice-warn.u-mt-4', null, [el('strong', { text: '可以再調整的地方' })]);
      var ul = el('ul.voice-tips');
      p.tips.forEach(function (t) { ul.appendChild(el('li', { text: t })); });
      box.appendChild(ul);
      card.appendChild(box);
    }
    return card;
  }

  /* ---------- 步驟三：A/B/C 校準 ---------- */
  function calibrateCard() {
    var p = pending.profile;
    var card = el('div.card');

    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '口吻校準' }),
      tip('規則引擎看得到頻率，看不到你的偏好。同一句話三種說法，點你本人最可能講出口的那一句，' +
          '系統會據此覆寫語氣與口語程度參數。想改隨時可以重選，選 B 代表維持萃取結果。')
    ]));
    card.appendChild(el('p.card-sub', { text: '同一句話三種說法，點選最像你本人會說的那一句。' }));

    CALIB.forEach(function (c) {
      var on = p.calibrated === c.name;
      var btn = el('button.calib-opt' + (on ? '.is-on' : ''), {
        type: 'button', 'aria-pressed': on ? 'true' : 'false',
        onclick: function () { calibrate(c.key); }
      }, [
        el('span.calib-head', null, [
          el('span.calib-name', { text: c.name }),
          on ? el('span.tag.tag-ok', { text: '你的選擇' }) : null
        ]),
        el('span.calib-text', { text: c.text })
      ]);
      card.appendChild(btn);
    });
    return card;
  }

  /* ---------- 步驟四：儲存 ---------- */
  function saveCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '存成口吻檔案' }),
      tip('存起來之後，文案架構頁就能直接套用這個口吻生成逐字稿。同一個人可以存多組，例如專業版與親切版各一。')
    ]));
    card.appendChild(el('label.field', null, [
      el('span.label', { text: '口吻名稱' }),
      el('input.inp', {
        id: 'voice-name', type: 'text', autocomplete: 'off',
        placeholder: '例：Brandy 親切口語',
        value: pending.suggestName || ''
      })
    ]));
    card.appendChild(el('div.row', null, [
      el('button.btn.btn-primary', { type: 'button', text: '儲存口吻', onclick: saveVoice }),
      el('span.spacer'),
      el('button.btn.btn-ghost', {
        type: 'button', text: '重新開始',
        onclick: function () { pending = null; render(); }
      })
    ]));
    return card;
  }

  /* ---------- 已儲存清單 ---------- */
  function listCard() {
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h2', { text: '已儲存的口吻' }),
      tip('載入會把原始素材放回上方輸入框並重新萃取，方便你補新的貼文後再算一次。')
    ]));

    var voices = Store.S.voices || [];
    if (!voices.length) {
      card.appendChild(el('div.empty', null, [
        el('strong', { text: '還沒有存過口吻' }),
        '在上方萃取或挑一個預設口吻，命名後就會出現在這裡。'
      ]));
      return card;
    }

    var list = el('div.saved-list');
    voices.forEach(function (v) {
      list.appendChild(el('div.saved-item', null, [
        el('span.nm', { text: v.name }),
        el('span.chip', { text: (v.profile && v.profile.tone) || '未記錄語氣' }),
        el('button.btn.btn-ghost', { type: 'button', text: '載入', onclick: function () { loadVoice(v.id); } }),
        el('button.btn.btn-ghost.btn-danger', { type: 'button', text: '刪除', onclick: function () { delVoice(v.id); } })
      ]));
    });
    card.appendChild(list);
    return card;
  }

  /* ============================================================
     四、動作
     ============================================================ */

  function usePreset(i) {
    var v = VOICE_PRESETS[i];
    var profile = JSON.parse(JSON.stringify(v.profile));
    profile.sampleCount = 0;
    pending = { raw: '（預設口吻，未提供發文）', profile: profile, suggestName: v.name };
    render();
    toast('已套用「' + v.name + '」，記得往下命名儲存', 'ok');
  }

  function analyze(btn) {
    var node = document.getElementById('voice-raw');
    var raw = node ? node.value.trim() : '';
    if (!raw) { toast('請貼上過去的發文，或先挑一個預設口吻', 'error'); return; }

    var profile = buildVoiceProfile(raw);
    var m = Store.boundModel();

    if (!useLLM || !S.LLM.canCall(m)) {
      pending = { raw: raw, profile: profile, suggestName: '' };
      render();
      if (useLLM && !S.LLM.canCall(m)) toast('尚未綁定可用的模型，這次只用規則引擎萃取');
      else toast('口吻檔案已建立，記得命名儲存', 'ok');
      return;
    }

    S.busy(btn, true, '萃取中');
    llmEnhance(raw, profile)
      .then(function (extra) {
        if (extra) {
          if (extra.tone) profile.tone = extra.tone;
          if (extra.sentenceFeature) profile.llmNote = extra.sentenceFeature;
        }
        pending = { raw: raw, profile: profile, suggestName: '' };
        render();
        toast('口吻檔案已建立，記得命名儲存', 'ok');
      })
      .catch(function () {
        pending = { raw: raw, profile: profile, suggestName: '' };
        render();
        toast('模型判讀失敗，已改用規則引擎的萃取結果', 'error');
      });
  }

  function llmEnhance(raw, profile) {
    var sample = raw.slice(0, 2000);
    var prompt =
      '你是語感分析師。以下是一位創作者過去的發文原文，以及規則引擎已經算出的統計特徵。\n' +
      '請只補上規則算不出來的部分：語氣描述與句式特徵。\n\n' +
      '【原文樣本】\n' + sample + '\n\n' +
      '【規則引擎結果】\n' +
      '口頭禪：' + (profile.catchphrases.join('、') || '無') + '\n' +
      '開場習慣：' + profile.opener + '\n' +
      profile.endHabit + '\n' + profile.sentenceStyle + '\n' + profile.emojiHabit + '\n\n' +
      '【輸出格式】只輸出 JSON，不要任何其他文字：\n' +
      '{"tone":"一句話描述這個人的語氣，20 字內","sentenceFeature":"描述句式特徵與慣用的表達模式，60 字內"}\n\n' +
      '【硬性規則】全程使用繁體中文；不要用「不是…而是」句式；不要總結式標語；不要商業黑話。';
    return S.LLM.callLinted(prompt, { rounds: 2, temperature: 0.7 });
  }

  function calibrate(k) {
    if (!pending) return;
    var p = pending.profile;
    if (k === 'A') {
      p.colloquial = true;
      p.tone = '口語親切，像朋友聊天，不端著';
      p.calibrated = 'A 口語版';
    } else if (k === 'B') {
      p.calibrated = 'B 中性版';
    } else {
      p.colloquial = false;
      p.tone = '敘事沉穩，措辭精準，偏書面';
      p.calibrated = 'C 書面版';
    }
    render();
    toast(k === 'B' ? '已校準：維持萃取結果' : '已校準：語氣參數依你的選擇調整', 'ok');
  }

  function saveVoice() {
    if (!pending) return;
    var node = document.getElementById('voice-name');
    var name = node ? node.value.trim() : '';
    if (!name) { toast('請幫這個口吻取個名字', 'error'); return; }
    if (name.length > 40) { toast('名稱請控制在 40 字以內', 'error'); return; }

    Store.S.voices = Store.S.voices || [];
    var existing = Store.S.voices.filter(function (v) { return v.name === name; })[0];
    if (existing) {
      existing.raw = pending.raw;
      existing.profile = pending.profile;
      existing.updatedAt = Date.now();
    } else {
      Store.S.voices.push({
        id: Store.uid('v'),
        name: name,
        raw: pending.raw,
        profile: pending.profile,
        updatedAt: Date.now()
      });
    }
    Store.save();
    render();
    toast('口吻「' + name + '」已儲存，文案架構頁可直接套用', 'ok');
  }

  function loadVoice(id) {
    var v = (Store.S.voices || []).filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    pending = { raw: v.raw || '', profile: v.profile || {}, suggestName: v.name };
    render();
    var node = document.getElementById('voice-raw');
    if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('已載入「' + v.name + '」，可補上新素材後重新萃取');
  }

  function delVoice(id) {
    Store.S.voices = (Store.S.voices || []).filter(function (v) { return v.id !== id; });
    Store.save();
    render();
    toast('已刪除該口吻');
  }

  S.modules = S.modules || {};
  S.modules.voice = { mount: mount, render: render };

  // 供其他模組與測試取用的純函式
  S.voiceEngine = {
    mineCatchphrases: mineCatchphrases,
    buildVoiceProfile: buildVoiceProfile,
    PRESETS: VOICE_PRESETS
  };
})(window);
