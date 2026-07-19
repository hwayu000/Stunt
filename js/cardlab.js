/* ============================================================
   Stunt — 圖卡文案
   流程：主題方向 → AI 出 5 個候選 → 選題 → 生成整套頁面內文與版型
        → 逐頁編輯 → 上背景圖 → canvas 上字 → 匯出 PNG
   版面：桌機左控制右預覽（預覽吸頂）；手機單欄，預覽為可左右滑動的輪播。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Stunt;
  var el = S.el, clear = S.clear, icon = S.icon, tip = S.tip, toast = S.toast;
  var E = global.CardEngine;

  var root = null;
  var BGS = [];            // 執行期背景（blob URL，不進 localStorage）
  var defs = [];           // 目前頁面定義
  var openPage = 0;        // 編輯器展開中的頁次
  var mobileTab = 'edit';  // 手機分頁：edit | preview

  function P() { return Store.S.card; }
  function list() { return (P().pages && P().pages.list) || []; }
  function hasPages() { return list().length > 0; }

  /* ================= 掛載與繪製 ================= */
  function mount(node) { root = node; render(); }

  function render() {
    if (!root) return;
    var scrollY = global.scrollY;
    clear(root);

    root.appendChild(el('div.page-head', null, [
      el('h1', { id: 't-cards', text: '圖卡文案' }),
      el('p.lede', { text: '一個主題方向，產出整套輪播圖卡的內文、版型與成品圖。' })
    ]));

    if (!hasPages()) {
      // 尚未生成 → 單欄的引導流程
      root.appendChild(el('div.cl-intro', null, [topicCard(), candidatesCard()]));
      return;
    }

    // 已有內容 → 工作台版面
    root.appendChild(mobileSwitch());
    var layout = el('div.cl-layout', null, [
      el('div.cl-controls', { 'data-pane': 'edit' }, [
        topicCard(), candidatesCard(), editorCard(), styleCard()
      ]),
      el('div.cl-preview-pane', { 'data-pane': 'preview' }, [previewCard()])
    ]);
    root.appendChild(layout);
    applyPane();
    requestAnimationFrame(function () { renderAllCanvas(); global.scrollTo(0, scrollY); });
  }

  /* 手機：編輯 / 預覽 兩個分頁，避免長頁面來回捲動 */
  function mobileSwitch() {
    return el('div.tabs.cl-mtabs', null, [
      el('button.tab' + (mobileTab === 'edit' ? '.active' : ''), {
        type: 'button', text: '編輯內容',
        onclick: function () { mobileTab = 'edit'; applyPane(); }
      }),
      el('button.tab' + (mobileTab === 'preview' ? '.active' : ''), {
        type: 'button', text: '預覽成品',
        onclick: function () { mobileTab = 'preview'; applyPane(); renderAllCanvas(); }
      })
    ]);
  }

  function applyPane() {
    var tabs = root.querySelectorAll('.cl-mtabs .tab');
    if (tabs[0]) tabs[0].classList.toggle('active', mobileTab === 'edit');
    if (tabs[1]) tabs[1].classList.toggle('active', mobileTab === 'preview');
    Array.prototype.forEach.call(root.querySelectorAll('[data-pane]'), function (n) {
      n.classList.toggle('is-mobile-hidden', n.dataset.pane !== mobileTab);
    });
  }

  /* ================= 步驟一：主題方向 ================= */
  function topicCard() {
    var p = P();
    var box = el('div.card');
    box.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '01' }),
      el('h2', { text: '主題方向' }),
      tip('先寫一句你想談的方向，AI 會給 5 個彼此角度不同的候選主題。方向越具體，候選越好用。')
    ]));

    var ta = el('textarea.inp', {
      id: 'clTopic', rows: '3',
      placeholder: '例：想跟剛入行的設計師談，怎麼把作品集整理成能拿到面試的樣子',
      value: p.topicInput || ''
    });
    ta.addEventListener('change', function () { p.topicInput = ta.value.trim(); Store.save(); });
    box.appendChild(el('label.field', null, [el('span.label', { text: '你想談什麼' }), ta]));

    var opts = el('div.cl-opts');
    opts.appendChild(selField('內容領域', 'clGenre', [
      ['auto', '自動判斷'], ['knowledge', '教學方法'], ['finance', '財經投資'],
      ['beauty', '美妝保養'], ['science', '科普知識'], ['lifestyle', '生活品味']
    ], p.genre, function (v) { p.genre = v; Store.save(); }));
    opts.appendChild(selField('內頁張數', 'clCount', [
      ['5', '5 張'], ['6', '6 張'], ['7', '7 張'], ['8', '8 張'], ['9', '9 張']
    ], String(p.pageCount), function (v) { p.pageCount = +v; Store.save(); }));
    opts.appendChild(selField('輸出比例', 'clSize', Object.keys(E.SIZES).map(function (k) {
      return [k, k + '（' + E.SIZES[k][0] + '×' + E.SIZES[k][1] + '）'];
    }), p.size, function (v) { p.size = v; Store.save(); renderAllCanvas(); }));
    box.appendChild(opts);

    box.appendChild(el('div.row.u-mt-4', null, [
      el('button.btn.btn-primary', {
        type: 'button', text: '生成主題候選',
        onclick: function (e) { genTopics(e.currentTarget); }
      })
    ]));
    return box;
  }

  function selField(label, id, options, value, onchange) {
    var sel = el('select.inp', { id: id }, options.map(function (o) {
      return el('option', { value: o[0], text: o[1], selected: String(value) === String(o[0]) });
    }));
    sel.addEventListener('change', function () { onchange(sel.value); });
    return el('label.field', null, [el('span.label', { text: label }), sel]);
  }

  /* ================= 候選主題 ================= */
  function candidatesCard() {
    var p = P();
    if (!p.candidates.length) return el('div.u-hidden');
    var box = el('div.card');
    box.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '02' }),
      el('h2', { text: '選一個主題' }),
      tip('選定後就能生成整套內文。想換題目隨時可以重選並重新生成。')
    ]));

    var wrap = el('div.cand-list');
    p.candidates.forEach(function (c, i) {
      wrap.appendChild(el('button.cand' + (p.chosen === i ? '.is-on' : ''), {
        type: 'button',
        onclick: function () { p.chosen = i; Store.save(); render(); }
      }, [
        el('span.cand-no', { text: String(i + 1).padStart(2, '0') }),
        el('span.cand-body', null, [
          el('span.cand-title', { text: c.title }),
          el('span.cand-angle', { text: c.angle }),
          el('span.cand-why', { text: c.why })
        ])
      ]));
    });
    box.appendChild(wrap);

    if (p.chosen >= 0) {
      box.appendChild(el('div.row.u-mt-4', null, [
        el('button.btn.btn-primary', {
          type: 'button', text: hasPages() ? '重新生成整套內文' : '生成整套內文',
          onclick: function (e) { genPages(e.currentTarget); }
        })
      ]));
    }
    return box;
  }

  /* ================= 逐頁編輯器 ================= */
  function editorCard() {
    var box = el('div.card');
    box.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '03' }),
      el('h2', { text: '逐頁內文' }),
      tip('每一頁都能改字、換版型、增刪條列。刪掉一條，版面會自動重新分配空間，不會留空位。'),
      el('span.spacer'),
      el('span.tag', { text: list().length + ' 頁' })
    ]));

    var acc = el('div.pg-acc');
    list().forEach(function (pg, i) { acc.appendChild(pageEditor(pg, i)); });
    box.appendChild(acc);
    return box;
  }

  function pageEditor(pg, i) {
    var isOpen = (openPage === i);
    var bp = E.BLUEPRINTS[pg.type] || E.BLUEPRINTS.form;
    var head = el('button.pg-head', {
      type: 'button', 'aria-expanded': isOpen ? 'true' : 'false',
      onclick: function () { openPage = isOpen ? -1 : i; render(); }
    }, [
      el('span.pg-no', { text: String(i + 1).padStart(2, '0') }),
      el('span.pg-name', { text: (pg.data && pg.data.title) || bp.name }),
      el('span.tag.pg-kind', { text: bp.name }),
      el('span.pg-chev', { text: '▾' })
    ]);

    // 內層單一容器：讓 grid 0fr→1fr 的高度過渡成立
    var inner = el('div.pg-inner');
    var body = el('div.pg-body', null, inner);
    if (isOpen) {
      // 版型
      var modeSel = el('select.inp', null,
        [el('option', { value: '', text: '跟隨全域版型', selected: !pg.ui.mode })].concat(
          Object.keys(E.MODES).map(function (k) {
            return el('option', { value: k, text: E.MODES[k].name, selected: pg.ui.mode === k });
          })));
      modeSel.addEventListener('change', function () {
        pg.ui.mode = modeSel.value; Store.save(); renderOne(i);
      });
      inner.appendChild(el("label.field", null, [el("span.label", { text: "這頁的版型" }), modeSel]));

      // 依藍圖產生欄位
      Object.keys(bp.fields).forEach(function (key) {
        var kind = bp.fields[key];
        if (kind === "str") inner.appendChild(strField(pg, i, key));
        else if (kind === "arr") inner.appendChild(arrField(pg, i, key));
        else if (kind === "cells") inner.appendChild(cellsField(pg, i, key));
        else if (kind === "rows") inner.appendChild(rowsField(pg, i, key));
      });

      // 背景圖
      inner.appendChild(bgRow(i));
    }
    return el('div.pg-item' + (isOpen ? '.is-open' : ''), null, [head, body]);
  }

  var FIELD_LABEL = {
    title: '標題', sub: '副標', footer: '收尾句', items: '條列內容', body: '內文',
    resultA: '結論 A', resultB: '結論 B', cells: '四格內容', rows: '列表內容',
    value: '數字', unit: '單位', caption: '說明', quote: '引言', source: '出處'
  };

  function strField(pg, i, key) {
    var longs = ['sub', 'body', 'caption', 'quote'];
    var isLong = longs.indexOf(key) >= 0;
    var node = isLong
      ? el('textarea.inp', { rows: '2', value: pg.data[key] || '' })
      : el('input.inp', { type: 'text', value: pg.data[key] || '' });
    node.addEventListener('input', function () {
      pg.data[key] = node.value; Store.save(); renderOne(i);
    });
    return el('label.field', null, [
      el('span.label', null, [
        FIELD_LABEL[key] || key,
        key === 'title' ? tip('用全形「｜」可以手動分行，例如：作品集｜三個地雷。') : null
      ]),
      node
    ]);
  }

  function arrField(pg, i, key) {
    var wrap = el('div.field');
    wrap.appendChild(el('span.label', null, [
      FIELD_LABEL[key] || key,
      tip('沉底類版型只會顯示前兩條，其餘會自動略過，以保持圖面乾淨。')
    ]));
    var arr = pg.data[key] || (pg.data[key] = []);
    arr.forEach(function (v, j) {
      var input = el('input.inp', { type: 'text', value: v });
      input.addEventListener('input', function () { arr[j] = input.value; Store.save(); renderOne(i); });
      wrap.appendChild(el('div.arr-row', null, [
        input,
        el('button.btn.btn-ghost.btn-icon.arr-del', {
          type: 'button', 'aria-label': '刪除這一條',
          onclick: function () { arr.splice(j, 1); Store.save(); render(); }
        }, icon('trash', 18))
      ]));
    });
    if (arr.length < 4) {
      wrap.appendChild(el('button.btn.btn-ghost.arr-add', {
        type: 'button',
        onclick: function () { arr.push(''); Store.save(); render(); }
      }, [icon('plus', 16), '新增一條']));
    }
    return wrap;
  }

  function cellsField(pg, i, key) {
    var wrap = el('div.field');
    wrap.appendChild(el('span.label', { text: FIELD_LABEL[key] || key }));
    var arr = pg.data[key] || (pg.data[key] = []);
    arr.forEach(function (c, j) {
      wrap.appendChild(el('div.kv-row', null, [
        subInput(c, 'name', '名稱', i, 'kv-k'),
        subInput(c, 'desc', '說明', i, 'kv-v'),
        el('button.btn.btn-ghost.btn-icon.arr-del', {
          type: 'button', 'aria-label': '刪除這一格',
          onclick: function () { arr.splice(j, 1); Store.save(); render(); }
        }, icon('trash', 18))
      ]));
    });
    if (arr.length < 4) {
      wrap.appendChild(el('button.btn.btn-ghost.arr-add', {
        type: 'button',
        onclick: function () { arr.push({ no: String(arr.length + 1).padStart(2, '0'), name: '', desc: '' }); Store.save(); render(); }
      }, [icon('plus', 16), '新增一格']));
    }
    return wrap;
  }

  function rowsField(pg, i, key) {
    var wrap = el('div.field');
    wrap.appendChild(el('span.label', { text: FIELD_LABEL[key] || key }));
    var arr = pg.data[key] || (pg.data[key] = []);
    arr.forEach(function (r, j) {
      wrap.appendChild(el('div.kv-row', null, [
        subInput(r, 'k', '名稱', i, 'kv-k'),
        subInput(r, 'v', '內容', i, 'kv-v'),
        el('button.btn.btn-ghost.btn-icon.arr-del', {
          type: 'button', 'aria-label': '刪除這一列',
          onclick: function () { arr.splice(j, 1); Store.save(); render(); }
        }, icon('trash', 18))
      ]));
    });
    if (arr.length < 4) {
      wrap.appendChild(el('button.btn.btn-ghost.arr-add', {
        type: 'button',
        onclick: function () { arr.push({ k: '', v: '' }); Store.save(); render(); }
      }, [icon('plus', 16), '新增一列']));
    }
    return wrap;
  }

  function subInput(obj, key, placeholder, i, cls) {
    var n = el('input.inp.' + cls, { type: 'text', value: obj[key] || '', placeholder: placeholder });
    n.addEventListener('input', function () { obj[key] = n.value; Store.save(); renderOne(i); });
    return n;
  }

  function bgRow(i) {
    var file = el('input', { type: 'file', accept: 'image/*,video/*', id: 'bg' + i, class: 'sr-only' });
    file.addEventListener('change', function (e) { loadBg(i, e.target.files[0]); });
    var label = BGS[i] ? (BGS[i].video ? '更換背景（目前為影片）' : '更換背景') : '上傳背景圖／影片';
    var row = el('div.row.bg-row', null, [
      el('label.btn.bg-btn', { for: 'bg' + i }, [icon('image', 18), label]),
      file
    ]);
    if (BGS[i]) {
      row.appendChild(el('button.btn.btn-ghost.btn-danger', {
        type: 'button', text: '移除',
        onclick: function () { revokeBg(i); render(); }
      }));
    }
    return row;
  }

  /* ================= 版面控制 ================= */
  function styleCard() {
    var p = P();
    var box = el('div.card');
    box.appendChild(el('div.card-head', null, [
      el('span.step-num', { text: '04' }),
      el('h2', { text: '版面與樣式' }),
      tip('這裡的設定套用到所有頁面；個別頁面的版型可以在上一區各自覆寫。')
    ]));

    var g = el('div.cl-opts');
    g.appendChild(selField('全域版型', 'clMode', Object.keys(E.MODES).map(function (k) {
      return [k, E.MODES[k].name];
    }), p.mode, function (v) { p.mode = v; Store.save(); renderAllCanvas(); }));
    g.appendChild(selField('文字顏色', 'clInk', [['1', '白字（深色照片）'], ['0', '黑字（淺色照片）']],
      p.white ? '1' : '0', function (v) { p.white = (v === '1'); Store.save(); renderAllCanvas(); }));
    box.appendChild(g);

    box.appendChild(slider('壓黑遮罩', 0, 85, p.maskAlpha, '%', function (v) {
      p.maskAlpha = v; Store.save(); renderAllCanvas();
    }, '背景太亮會吃掉文字，加一層黑可以把字撐出來。'));
    box.appendChild(slider('背景模糊', 0, 16, p.blur, 'px', function (v) {
      p.blur = v; Store.save(); renderAllCanvas();
    }, '讓背景退到後面，文字更好讀。'));
    box.appendChild(slider('文字描邊', 0, 40, Math.round((p.strokeFrac || 0) * 1000), '', function (v) {
      p.strokeFrac = v / 1000; Store.save(); renderAllCanvas();
    }, '白字加黑邊、黑字加白邊。放到 0 就是不描邊。'));

    var toggles = el('div.tgl-grid');
    [['pageno', '頁碼'], ['label', '頁面標籤'], ['corner', '角落十字'],
     ['border', '外框線'], ['footer', '收尾句'], ['shadow', '文字陰影']].forEach(function (t) {
      var on = t[0] === 'shadow' ? (p.textShadow !== false) : (p.opts[t[0]] !== false);
      var input = el('input', { type: 'checkbox', checked: on });
      input.addEventListener('change', function () {
        if (t[0] === 'shadow') p.textShadow = input.checked;
        else p.opts[t[0]] = input.checked;
        Store.save(); renderAllCanvas();
      });
      toggles.appendChild(el('label.switch', null, [input, el('span.track'), el('span', { text: t[1] })]));
    });
    box.appendChild(el('div.field', null, [el('span.label', { text: '顯示元素' }), toggles]));
    return box;
  }

  function slider(label, min, max, value, unit, oninput, hint) {
    var out = el('span.sld-val', { text: value + unit });
    var input = el('input', { type: 'range', min: min, max: max, value: value });
    input.addEventListener('input', function () {
      out.textContent = input.value + unit;
      oninput(+input.value);
    });
    return el('div.field.sld', null, [
      el('span.label', null, [label, hint ? tip(hint) : null, el('span.spacer'), out]),
      input
    ]);
  }

  /* ================= 預覽與匯出 ================= */
  function previewCard() {
    var box = el('div.card.cl-preview');
    box.appendChild(el('div.card-head', null, [
      el('h2', { text: '成品預覽' }),
      tip('這裡看到的就是實際輸出的畫面。手機上可以左右滑動逐張檢視。'),
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', {
        type: 'button', text: '匯出全部',
        onclick: function (e) { exportAll(e.currentTarget); }
      })
    ]));

    var track = el('div.card-track', { id: 'clTrack' });
    list().forEach(function (pg, i) {
      var cv = el('canvas.card-canvas', { id: 'cv' + i, 'aria-label': '第 ' + (i + 1) + ' 張圖卡' });
      track.appendChild(el('figure.card-slot', null, [
        el('div.card-canvas-wrap', null, cv),
        el('figcaption.card-foot', null, [
          el('span.card-idx', { text: String(i + 1).padStart(2, '0') + ' / ' + String(list().length).padStart(2, '0') }),
          el('span.spacer'),
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button', onclick: function () { editPage(i); }
          }, '編輯'),
          el('button.btn.btn-sm', {
            type: 'button', onclick: function () { exportOne(i); }
          }, [icon('download', 16), 'PNG'])
        ])
      ]));
    });
    box.appendChild(track);
    return box;
  }

  /* 從預覽跳到該頁的編輯器。
     手機上只設 openPage 是沒有用的——當下停在「預覽成品」分頁，
     展開的那一項在另一個看不見的面板裡，按下去像沒反應。 */
  function editPage(i) {
    openPage = i;
    mobileTab = 'edit';
    render();
    requestAnimationFrame(function () {
      var item = root.querySelector('.pg-item.is-open');
      if (item && item.scrollIntoView) item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var first = item && item.querySelector('.inp');
      if (first) first.focus({ preventScroll: true });
    });
  }

  function renderOne(i) {
    var cv = document.getElementById('cv' + i);
    if (!cv) return;
    var p = P();
    E.render(cv, {
      list: list(), index: i, defs: defs, bg: BGS[i],
      size: p.size, mode: p.mode, white: p.white, maskAlpha: p.maskAlpha,
      strokeFrac: p.strokeFrac, outline: (p.strokeFrac || 0) > 0,
      textShadow: p.textShadow, blur: p.blur, opts: p.opts, fontScale: 1
    });
  }

  function renderAllCanvas() {
    defs = E.pageDefs(list());
    list().forEach(function (_, i) { renderOne(i); });
  }

  /* ---- 背景：圖片或影片，每張卡各自獨立 ---- */
  function loadBg(i, file) {
    if (!file) return;
    var isVideo = /^video\//.test(file.type);
    var isImage = /^image\//.test(file.type);
    if (!isVideo && !isImage) { toast('只支援圖片或影片檔', 'error'); return; }
    var cap = isVideo ? 200 : 20;
    if (file.size > cap * 1024 * 1024) { toast('檔案超過 ' + cap + ' MB，請先壓縮', 'error'); return; }

    revokeBg(i);
    var url = URL.createObjectURL(file);

    if (isImage) {
      var img = new Image();
      img.onload = function () {
        BGS[i] = { el: img, url: url, w: img.naturalWidth, h: img.naturalHeight, video: false };
        render();
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast('這張圖片無法讀取', 'error'); };
      img.src = url;
      return;
    }

    // 影片：靜音才允許自動播放；playsinline 讓 iOS 不強制全螢幕
    var v = document.createElement('video');
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.addEventListener('loadeddata', function () {
      BGS[i] = { el: v, url: url, w: v.videoWidth, h: v.videoHeight, video: true };
      v.play().catch(function () {});
      render();
      startVideoLoop();
    });
    v.addEventListener('error', function () {
      URL.revokeObjectURL(url);
      toast('這支影片無法讀取，請改用 MP4（H.264）', 'error');
    });
    v.src = url;
  }

  /* 有影片背景時才開一條 rAF 迴圈，只重畫用到影片的那幾張。
     沒有影片就不跑，避免整頁常駐重繪。 */
  var _vLoop = 0;
  function startVideoLoop() {
    if (_vLoop) return;
    var tick = function () {
      var live = false;
      BGS.forEach(function (b, i) {
        if (!b || !b.video) return;
        live = true;
        if (!b.el.paused && document.getElementById('cv' + i)) renderOne(i);
      });
      if (!live) { _vLoop = 0; return; }
      _vLoop = requestAnimationFrame(tick);
    };
    _vLoop = requestAnimationFrame(tick);
  }

  function revokeBg(i) {
    var b = BGS[i];
    if (b) {
      if (b.video && b.el) { try { b.el.pause(); b.el.removeAttribute('src'); b.el.load(); } catch (e) {} }
      if (b.url) URL.revokeObjectURL(b.url);
    }
    BGS[i] = null;
  }

  /* ---- 匯出 ---- */
  function fileName(i) {
    var c = P().candidates[P().chosen];
    var base = (c && c.title ? c.title : 'stunt').replace(/[\\/:*?"<>|]/g, '');
    return base + '_' + String(i + 1).padStart(2, '0') + '.png';
  }

  function exportOne(i) {
    var cv = document.getElementById('cv' + i);
    if (!cv) return;
    cv.toBlob(function (blob) {
      if (!blob) { toast('匯出失敗', 'error'); return; }
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url; a.download = fileName(i);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
  }

  function exportAll(btn) {
    var n = list().length;
    if (!n) return;
    S.busy(btn, true, '匯出中');
    var i = 0;
    (function step() {
      if (i >= n) { S.busy(btn, false); toast('已匯出 ' + n + ' 張 PNG', 'ok'); return; }
      exportOne(i++);
      setTimeout(step, 320);       // 逐張間隔，避免瀏覽器擋下連續下載
    })();
  }

  /* ================= 生成：主題候選 ================= */
  function topicPrompt(dir) {
    return '你是一位資深社群內容策略 PM，替知識型 IG 圖文帳號規劃輪播貼文主題。\n\n' +
      '【使用者的大方向】\n' + dir + '\n\n' +
      '【任務】提出 5 個彼此角度不同的貼文主題候選。每個主題必須：\n' +
      '1. 具體到可以直接開做（有明確的痛點與交付物，拒絕空泛雞湯）\n' +
      '2. 適合拆成一整套輪播（盤點→框架→判準→實例→反例→行動清單）\n' +
      '3. 標題 3~6 個字、像檔案名\n\n' +
      '【語言】台灣繁體中文，禁止任何簡體字。\n' +
      '【禁止】「不是…而是」句式與其變體、「一句話總結」等總結式標語、空泛商業黑話。\n' +
      '【輸出】只輸出 JSON 物件，不要其他文字：\n' +
      '{"topics":[{"title":"3~6字標題","angle":"這篇在講什麼，一句具體的話","why":"為什麼有人看（點出受眾痛點）"}]}';
  }

  function genTopics(btn) {
    var p = P();
    var dir = (document.getElementById('clTopic') || {}).value || '';
    dir = dir.trim();
    if (!dir) { toast('先寫一句你想談的方向', 'error'); return; }
    p.topicInput = dir; Store.save();

    S.busy(btn, true, '生成中');
    S.LLM.detectProxy()
      .then(function () {
        if (!S.LLM.canCall(Store.boundModel())) throw new Error('尚未綁定可用的模型');
        return S.LLM.callLinted(topicPrompt(dir), { rounds: 2, temperature: 1.05 });
      })
      .then(function (obj) {
        var arr = (obj && obj.topics) || [];
        if (!arr.length) throw new Error('模型未回傳主題');
        applyTopics(arr);
      })
      .catch(function (e) {
        applyTopics(demoTopics(dir));
        toast('這是內建示範主題，並非 AI 生成：' + (e.message || e), 'error');
      })
      .then(function () { S.busy(btn, false); });
  }

  function applyTopics(arr) {
    var p = P();
    p.candidates = arr.slice(0, 5).map(function (o) {
      return { title: String(o.title || ''), angle: String(o.angle || ''), why: String(o.why || '') };
    });
    p.chosen = -1;
    Store.save();
    render();
  }

  function demoTopics(dir) {
    var k = dir.slice(0, 8) || '這個主題';
    return [
      { title: '入門地雷', angle: '把新手最常踩的四個坑逐一拆開，附上判斷方式', why: '剛開始的人最怕做白工' },
      { title: '判斷清單', angle: '給一份可以直接照著跑的自我檢查表', why: '大部分人卡在沒有標準' },
      { title: '實例拆解', angle: '拿三個真實案例對照，說明差在哪一步', why: '抽象原則看不懂，看例子才會' },
      { title: '流程重排', angle: '把常見的做事順序調整成更省力的版本', why: '同樣的力氣想換更好的結果' },
      { title: k + '盤點', angle: '先盤點現況，再決定要補哪一塊', why: '不知道自己缺什麼是最大的問題' }
    ];
  }

  /* ================= 生成：整套內文 ================= */
  function typeMenu() {
    return E.INNER_TYPES.map(function (t) {
      return t + '：' + E.BLUEPRINTS[t].desc;
    }).join('\n  ');
  }
  function modeMenu() {
    return Object.keys(E.MODES).map(function (k) { return k + '（' + E.MODES[k].name + '）'; }).join('、');
  }

  var GENRE_HINTS = {
    auto: '依主題自行判斷最適合的內容節奏。',
    finance: '財經投資：多用數據大字凸顯報酬與佔比、實例列表對照標的、判準問答做決策。版型偏理性數據感。',
    beauty: '美妝保養：圖為主、字精簡，多用金句引言、盤點清單、流程步驟。版型偏優雅留白、沉底。',
    science: '科普知識：多用四格框架拆概念、流程步驟講機制、金句引言點核心。版型偏結構化。',
    knowledge: '教學方法：多用行動清單、流程步驟、反例清單、判準問答。版型偏清晰條理。',
    lifestyle: '生活品味：圖為主情緒感，多用金句引言與盤點清單。版型偏雜誌感、沉底。'
  };

  function pagesPrompt(topic) {
    var p = P();
    var genre = p.genre || 'auto';
    var n = p.pageCount || 7;
    return '你是一位文案與版面設計都極強的內容 PM。為 IG 輪播貼文《' + topic.title + '》規劃一整套內文與版面。\n' +
      '主題角度：' + topic.angle + '\n受眾動機：' + topic.why + '\n' +
      '內容領域：' + genre + '（' + (GENRE_HINTS[genre] || GENRE_HINTS.auto) + '）\n\n' +
      '【任務】自由設計 ' + n + ' 個內頁的內容與版型（封面與收尾我另外固定）。\n' +
      '依主題與領域決定每一頁用哪種內容類型、排什麼順序、配哪個版型。不要每次都同一套順序。\n\n' +
      '【可選內容類型】\n  ' + typeMenu() + '\n\n' +
      '【可選版型模式（讓整套有節奏變化，不要全部同一個）】\n  ' + modeMenu() + '\n\n' +
      '【文案鐵律（違反即重寫）】\n' +
      '1. 言之有物：每句具體、可執行、有畫面，禁止空泛雞湯與抽象形容詞堆疊\n' +
      '2. 禁止「一句話總結」「總結來說」「總而言之」等總結式標語\n' +
      '3. 禁止「不是…而是」對比句式及所有變體，一次都不准\n' +
      '4. 台灣繁體中文，禁止任何簡體字\n' +
      '5. 字數紀律：title 每行 4~7 字（用「｜」分行，最多兩行）；清單每條 10~16 字；' +
      'footer 12~18 字；四格 desc 8~14 字；rule 的 resultA/resultB 各限 14 字\n\n' +
      '【各類型欄位】\n' +
      '- form/checklist/error/steps：{title, items:[3~4句], footer}\n' +
      '- spec：{title, cells:[{no,name(2字),desc(8~14字)}×4], footer}\n' +
      '- rule：{title, items:[問句×3], resultA, resultB}\n' +
      '- case：{title, rows:[{k(2字),v(12~20字)}×3~4], footer}\n' +
      '- stat：{title, value(數字), unit, caption, footer}\n' +
      '- quote：{title, quote(12~24字), source}\n\n' +
      '【輸出】只輸出 JSON（pages 陣列長度必須剛好 ' + n + '）：\n' +
      '{"cover":{"title":"3~6字大標","sub":"一句 14~22 字副標"},' +
      '"pages":[{"type":"內容類型","mode":"版型模式","data":{該類型欄位}}],' +
      '"copy":{"title":"收尾宣言（可用｜分行）","body":"一句內文 18~30 字"}}';
  }

  function genPages(btn) {
    var p = P();
    var c = p.candidates[p.chosen];
    if (!c) { toast('先選一個主題', 'error'); return; }

    S.busy(btn, true, '生成中');
    S.LLM.detectProxy()
      .then(function () {
        if (!S.LLM.canCall(Store.boundModel())) throw new Error('尚未綁定可用的模型');
        return S.LLM.callLinted(pagesPrompt(c), { rounds: 2, temperature: 1.0 });
      })
      .then(function (obj) { applyPages(obj); })
      .catch(function (e) {
        applyPages(demoPages(c, p.pageCount || 7));
        toast('這是內建示範內容，並非 AI 生成：' + (e.message || e), 'error');
      })
      .then(function () { S.busy(btn, false); });
  }

  function applyPages(obj) {
    var p = P();
    p.pages = E.normalizePages(obj, list());
    Store.save();
    openPage = 0;
    mobileTab = 'preview';
    render();
  }

  function demoPages(topic, n) {
    var pool = [
      { type: 'form', mode: 'swiss', data: { title: '先盤點｜現況', items: ['手上有哪些素材還沒整理', '哪一項最常被問到', '哪一項自己講不清楚'], footer: '盤點完才知道要補哪裡' } },
      { type: 'spec', mode: 'grid', data: { title: '四格｜框架', cells: [
        { no: '01', name: '對象', desc: '這份東西給誰看' },
        { no: '02', name: '目的', desc: '看完要他做什麼' },
        { no: '03', name: '證據', desc: '憑什麼相信你' },
        { no: '04', name: '取捨', desc: '什麼可以不放' }], footer: '四格填不滿就是還沒想清楚' } },
      { type: 'rule', mode: 'report', data: { title: '判準｜三問', items: ['三秒內看得出重點嗎', '拿掉這段會少什麼', '別人做得到嗎'],
        resultA: '三題都過，可以出手', resultB: '有一題卡住，先修那題' } },
      { type: 'case', mode: 'editorial', data: { title: '實例｜對照', rows: [
        { k: '之前', v: '一次塞滿所有作品，看不出強項' },
        { k: '之後', v: '只留三件，每件講清楚角色' },
        { k: '差別', v: '面試官記得住你做過什麼' }], footer: '少放一點，記得住比較重要' } },
      { type: 'error', mode: 'stagger', data: { title: '反例｜地雷', items: ['把過程當成果放上去', '用術語掩蓋沒做完的部分', '每件都寫一樣的說明'], footer: '這三個最常見也最傷' } },
      { type: 'checklist', mode: 'minimal', data: { title: '行動｜清單', items: ['挑出三件代表作', '每件補一句角色說明', '找一個人試看三分鐘'], footer: '今天就能做完前兩項' } },
      { type: 'quote', mode: 'poster', data: { title: '觀點', quote: '看得懂比看起來厲害更值錢', source: '' } },
      { type: 'steps', mode: 'hero', data: { title: '流程｜三步', items: ['先刪到剩下三件', '每件補上角色與結果', '請人限時試讀'], footer: '順序反了會白做' } },
      { type: 'stat', mode: 'bold', data: { title: '停留時間', value: '3', unit: '秒', caption: '對方決定要不要繼續看的時間', footer: '' } }
    ];
    return {
      cover: { title: topic.title, sub: topic.angle },
      pages: pool.slice(0, n),
      copy: { title: '今天｜就開始', body: '先挑三件代表作，其餘的先放著不動。' }
    };
  }

  S.modules = S.modules || {};
  S.modules.cards = { mount: mount, render: render };
})(window);
