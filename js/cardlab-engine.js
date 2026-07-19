/* ============================================================
   Stunt — 圖卡 Canvas 版面引擎
   自 CARD LAB 移植；已與 DOM 解耦：所有輸入透過 cfg 傳入，不讀全域狀態。
   核心保證：所有文字一律縮字塞進安全區，任何內容量都不溢出。
   ============================================================ */
(function (global) {
  'use strict';

  var HEAVY = '"PingFang TC","Noto Sans TC","Microsoft JhengHei UI","Microsoft JhengHei",sans-serif';
  var MONO  = '"SF Mono","Consolas","Courier New",monospace';
  var SERIF = '"Noto Serif TC","Songti TC","PMingLiU",serif';

  var SIZES = {
    '4:5':  [1080, 1350],
    '1:1':  [1080, 1080],
    '9:16': [1080, 1920],
    '3:4':  [1080, 1440],
    '16:9': [1920, 1080]
  };

  /* 每個排版模式 = 一整套版面語言。
     marginX/Top/Bot：安全區邊界（佔 W/H 比例）
     titleBand：標題區佔安全高的比例；titleAlign/bodyAlign：對齊
     stagger：每條遞增縮排；tableStyle：lines｜rule（僅橫線）｜open（無外框）
     bottomStack：文字沉底、上方留給圖；scrim：底部黑漸層濃度 */
  var MODES = {
    swiss:    { name:'Swiss Modern', marginX:.085, marginTop:.075, marginBot:.075, titleBand:.30,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'lines', accentBar:true },
    justify:  { name:'兩端對齊',     marginX:.10,  marginTop:.085, marginBot:.085, titleBand:.30,  titleAlign:'center', bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.05, tableStyle:'lines' },
    stagger:  { name:'錯落分層',     marginX:.09,  marginTop:.09,  marginBot:.08,  titleBand:.382, titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:true,  gutter:1.15, tableStyle:'rule' },
    weight82: { name:'視覺權重 8:2', marginX:.085, marginTop:.06,  marginBot:.07,  titleBand:.42,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:0.92, tableStyle:'lines' },
    triple:   { name:'三分 3:3:3',   marginX:.10,  marginTop:.08,  marginBot:.08,  titleBand:.333, titleAlign:'center', bodyAlign:'center', titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'lines' },
    focus361: { name:'焦點 3:6:1',   marginX:.085, marginTop:.06,  marginBot:.10,  titleBand:.25,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.1,  tableStyle:'lines' },
    bottom:   { name:'底部沉字',     marginX:.075, marginTop:.06,  marginBot:.07,  titleBand:.30,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'lines', bottomStack:true },
    editorial:{ name:'雜誌編排',     marginX:.11,  marginTop:.10,  marginBot:.10,  titleBand:.34,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.2,  tableStyle:'rule', accentBar:true },
    minimal:  { name:'極簡留白',     marginX:.14,  marginTop:.12,  marginBot:.12,  titleBand:.28,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.3,  tableStyle:'open' },
    poster:   { name:'大字報',       marginX:.07,  marginTop:.05,  marginBot:.06,  titleBand:.5,   titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:0.85, tableStyle:'lines' },
    grid:     { name:'網格系統',     marginX:.08,  marginTop:.08,  marginBot:.08,  titleBand:.24,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'lines' },
    centered: { name:'中央對稱',     marginX:.10,  marginTop:.10,  marginBot:.10,  titleBand:.30,  titleAlign:'center', bodyAlign:'center', titleWeight:900, stagger:false, gutter:1.1,  tableStyle:'lines' },
    report:   { name:'報告書',       marginX:.095, marginTop:.075, marginBot:.075, titleBand:.26,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'rule' },
    hero:     { name:'頂部主標',     marginX:.08,  marginTop:.055, marginBot:.08,  titleBand:.40,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:0.95, tableStyle:'lines', accentBar:true },
    splitL:   { name:'左重心',       marginX:.075, marginTop:.07,  marginBot:.08,  titleBand:.32,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:true,  gutter:1.1,  tableStyle:'rule' },
    quietBot: { name:'安靜沉底',     marginX:.10,  marginTop:.06,  marginBot:.08,  titleBand:.30,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'open', bottomStack:true },
    bold:     { name:'濃墨重壓',     marginX:.07,  marginTop:.05,  marginBot:.06,  titleBand:.46,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:0.88, tableStyle:'lines' },
    profile:  { name:'人物特輯',     marginX:.075, marginTop:.06,  marginBot:.075, titleBand:.30,  titleAlign:'left',   bodyAlign:'left',   titleWeight:900, stagger:false, gutter:1.0,  tableStyle:'open', bottomStack:true, scrim:.9, subGray:true },
    magazine: { name:'襯線雜誌',     marginX:.085, marginTop:.07,  marginBot:.08,  titleBand:.34,  titleAlign:'left',   bodyAlign:'left',   titleWeight:700, stagger:false, gutter:1.15, tableStyle:'rule', bottomStack:true, scrim:.9, titleFam:'serif', bodyFam:'serif', serifBody:true }
  };

  /* 內容區塊藍圖：每種 type = 一種內容排版，對應一個 draw 分派 */
  var BLUEPRINTS = {
    cover:     { name:'封面',     kind:'cover', fields:{ title:'str', sub:'str' }, desc:'封面大標＋副標' },
    form:      { name:'盤點清單', kind:'list',  fields:{ title:'str', items:'arr', footer:'str' }, glyph:'check', desc:'勾選清單（盤點／現況／要點）' },
    checklist: { name:'行動清單', kind:'list',  fields:{ title:'str', items:'arr', footer:'str' }, glyph:'empty', desc:'待辦框清單（步驟／行動）' },
    error:     { name:'反例清單', kind:'list',  fields:{ title:'str', items:'arr', footer:'str' }, glyph:'cross', desc:'叉框清單（錯誤／雷點／迷思）' },
    spec:      { name:'四格框架', kind:'spec',  fields:{ title:'str', cells:'cells', footer:'str' }, desc:'2×2 四格（框架／分類／象限）' },
    rule:      { name:'判準問答', kind:'rule',  fields:{ title:'str', items:'arr', resultA:'str', resultB:'str' }, desc:'問句＋結論（判斷／決策）' },
    case:      { name:'實例列表', kind:'case',  fields:{ title:'str', rows:'rows', footer:'str' }, desc:'名稱｜內容表列（實例／對照）' },
    stat:      { name:'數據大字', kind:'stat',  fields:{ title:'str', value:'str', unit:'str', caption:'str', footer:'str' }, desc:'一個大數字＋說明' },
    quote:     { name:'金句引言', kind:'quote', fields:{ title:'str', quote:'str', source:'str' }, desc:'大字引言（觀點／主張）' },
    steps:     { name:'流程步驟', kind:'steps', fields:{ title:'str', items:'arr', footer:'str' }, desc:'編號流程（1→2→3）' },
    copy:      { name:'收尾宣言', kind:'copy',  fields:{ title:'str', body:'str' }, desc:'收尾宣言＋內文' }
  };

  var INNER_TYPES = ['form', 'checklist', 'error', 'spec', 'rule', 'case', 'stat', 'quote', 'steps'];

  /* ---------------- 資料正規化 ---------------- */
  function normPageData(type, d) {
    var g = function (v, dflt) { return v == null ? dflt : String(v); };
    d = d || {};
    var bp = BLUEPRINTS[type] || BLUEPRINTS.form;
    var out = {}, f = bp.fields;
    Object.keys(f).forEach(function (key) {
      var t = f[key];
      if (t === 'str') out[key] = g(d[key], '');
      else if (t === 'arr') out[key] = (d[key] || []).slice(0, 4).map(String);
      else if (t === 'cells') out[key] = (d[key] || []).slice(0, 4).map(function (c) {
        return { no: g(c && c.no, ''), name: g(c && c.name, ''), desc: g(c && c.desc, '') };
      });
      else if (t === 'rows') out[key] = (d[key] || []).slice(0, 4).map(function (r) {
        return { k: g(r && r.k, ''), v: g(r && r.v, '') };
      });
    });
    return out;
  }

  function validMode(m) { return (m && MODES[m]) ? m : ''; }

  function randInt(n) {
    var a = new Uint32Array(1);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return a[0] % n;
  }

  /* {cover, pages:[{type,mode,data}], copy} → {list:[{type,mode,data,ui}]} */
  function normalizePages(o, prevList) {
    o = o || {};
    var prev = prevList || [];
    function mkUi(i, mode) {
      var p = prev[i] && prev[i].ui;
      return {
        color: (p && p.color) || '#111111',
        dy: (p && p.dy) || 0,
        mode: mode || (p && p.mode) || '',
        scales: (p && p.scales) || {}
      };
    }
    var list = [];
    list.push({ type: 'cover', mode: (o.cover && o.cover.mode) || '',
                data: normPageData('cover', o.cover), ui: mkUi(0, o.cover && o.cover.mode) });

    var inner = Array.isArray(o.pages) ? o.pages : [];
    var modeKeys = Object.keys(MODES);
    var prevMode = '';
    inner.forEach(function (pg) {
      var type = String((pg && pg.type) || 'form').toLowerCase();
      if (INNER_TYPES.indexOf(type) < 0) type = 'form';
      var mode = validMode(pg && pg.mode);
      if (!mode) {
        // 未指定版型 → 挑一個與前頁不同的，讓整套有節奏變化
        var pool = modeKeys.filter(function (m) { return m !== prevMode; });
        mode = pool[randInt(pool.length)] || modeKeys[0];
      }
      prevMode = mode;
      list.push({ type: type, mode: mode, data: normPageData(type, pg && pg.data), ui: mkUi(list.length, mode) });
    });

    list.push({ type: 'copy', mode: (o.copy && o.copy.mode) || '',
                data: normPageData('copy', o.copy), ui: mkUi(list.length, o.copy && o.copy.mode) });
    return { list: list };
  }

  /* list → 每頁的顯示定義（標籤、種類、符號） */
  function pageDefs(list) {
    return (list || []).map(function (pg, i) {
      var bp = BLUEPRINTS[pg.type] || BLUEPRINTS.form;
      var isCover = pg.type === 'cover';
      var label = pg.label != null ? pg.label
        : (isCover ? '' : ((bp.name || pg.type) + ' ' + String(i + 1).padStart(2, '0')));
      return { type: pg.type, label: label, name: 'P' + (i + 1) + ' ' + bp.name,
               kind: bp.kind, glyph: bp.glyph };
    });
  }

  /* ---------------- 文字工具（全部縮字防溢出） ---------------- */
  function setFont(x, weight, size, fam) { x.font = weight + ' ' + size + 'px ' + (fam || HEAVY); }

  function wrapCJK(x, text, maxW) {
    var out = [], cur = '';
    String(text).split('').forEach(function (ch) {
      if (x.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; }
      else cur += ch;
    });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }

  // 單行縮字塞寬 → 回傳最終字級
  function fitLine(x, txt, maxSize, minSize, maxW, weight, fam) {
    var sz = maxSize;
    setFont(x, weight || 900, sz, fam);
    while (x.measureText(txt).width > maxW && sz > minSize) {
      sz -= Math.max(1, maxSize * 0.02);
      setFont(x, weight || 900, sz, fam);
    }
    return sz;
  }

  // 多行區塊縮字塞「寬且高」；縮到最小仍塞不下 → 截行加省略號，永不溢出
  function fitBlock(x, text, maxSize, minSize, maxW, maxH, weight, lhRatio, fam) {
    var sz = maxSize, lr = lhRatio || 1.42;
    for (;;) {
      setFont(x, weight || 900, sz, fam);
      var lines = wrapCJK(x, text, maxW);
      var lh = sz * lr, total = lh * lines.length;
      if (total <= maxH) return { size: sz, lh: lh, lines: lines, total: total };
      if (sz <= minSize) {
        var maxLines = Math.max(1, Math.floor(maxH / lh));
        if (lines.length > maxLines) {
          lines = lines.slice(0, maxLines);
          var last = lines[maxLines - 1];
          while (last.length && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
          lines[maxLines - 1] = last + '…';
        }
        return { size: sz, lh: lh, lines: lines, total: lh * lines.length };
      }
      sz -= Math.max(1, maxSize * 0.03);
    }
  }

  function drawBgCover(x, bg, W, H, blur) {
    var sw = bg.w || bg.el.videoWidth || bg.el.naturalWidth || W;
    var sh = bg.h || bg.el.videoHeight || bg.el.naturalHeight || H;
    var scale = Math.max(W / sw, H / sh);
    var dw = sw * scale, dh = sh * scale, dx = (W - dw) / 2, dy = (H - dh) / 2;
    if (blur > 0) {
      x.save(); x.filter = 'blur(' + blur + 'px)';
      var ov = blur * 2.5;               // 模糊會露邊，畫大一點蓋掉
      x.drawImage(bg.el, dx - ov, dy - ov, dw + ov * 2, dh + ov * 2);
      x.restore();
    } else {
      x.drawImage(bg.el, dx, dy, dw, dh);
    }
  }

  /* ================= 主渲染 =================
     cfg = { list, index, defs, bg, size, mode, white, maskAlpha, strokeFrac,
             outline, textShadow, blur, opts, fontScale, exportOverlay } */
  function render(canvas, cfg) {
    var list = cfg.list || [];
    var i = cfg.index || 0;
    var page = list[i];
    if (!page) return;

    var dims = SIZES[cfg.size] || SIZES['4:5'];
    var W = dims[0], H = dims[1];
    canvas.width = W; canvas.height = H;
    var x = canvas.getContext('2d');

    var defs = cfg.defs || pageDefs(list);
    var D = defs[i];
    var ui = page.ui || {};
    var M = MODES[ui.mode] || MODES[cfg.mode] || MODES.swiss;
    var gscale = cfg.fontScale || 1;
    var dy = (ui.dy || 0) / 100 * H;
    var ink = cfg.white === false ? '#111111' : '#ffffff';
    var optOn = function (k) { var o = cfg.opts || {}; return o[k] !== false; };

    /* ---- 背景 ---- */
    if (cfg.exportOverlay) {
      x.clearRect(0, 0, W, H);                      // 透明底，供外部疊圖
    } else if (cfg.bg) {
      drawBgCover(x, cfg.bg, W, H, cfg.blur || 0);
    } else {
      x.fillStyle = '#0d0d0d'; x.fillRect(0, 0, W, H);
    }

    var ma = (cfg.maskAlpha || 0) / 100;
    if (ma > 0) { x.fillStyle = 'rgba(0,0,0,' + ma + ')'; x.fillRect(0, 0, W, H); }

    // 底部黑漸層：讓沉底的字在實拍圖上讀得清楚
    if (M.scrim > 0) {
      var g = x.createLinearGradient(0, H * 0.42, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, 'rgba(0,0,0,' + (M.scrim * 0.45).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,' + M.scrim.toFixed(3) + ')');
      x.fillStyle = g; x.fillRect(0, H * 0.42, W, H * 0.58);
    }

    x.fillStyle = ink; x.strokeStyle = ink; x.textBaseline = 'alphabetic';

    /* ---- 文字描邊：白字→黑邊、黑字→白邊 ---- */
    if (cfg.outline) {
      var origFill = CanvasRenderingContext2D.prototype.fillText;
      var outlineColor = (ink === '#ffffff') ? '#000000' : '#ffffff';
      var lw = Math.max(1.5, W * (cfg.strokeFrac || 0.012));
      x.fillText = function (str, px, py, mw) {
        this.save();
        this.shadowColor = 'transparent'; this.shadowBlur = 0;
        this.shadowOffsetX = 0; this.shadowOffsetY = 0;
        this.lineJoin = 'round'; this.miterLimit = 2;
        this.strokeStyle = outlineColor;
        this.lineWidth = lw;
        this.strokeText(str, px, py, mw);           // 先描外框
        this.restore();
        origFill.call(this, str, px, py, mw);       // 再填字色蓋住中間
      };
    }

    /* ---- 安全區 ---- */
    var A = { l: W * M.marginX, r: W * (1 - M.marginX), t: H * M.marginTop, b: H * (1 - M.marginBot) };
    A.w = A.r - A.l; A.h = A.b - A.t;

    if (cfg.textShadow !== false) {
      x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = W * 0.012;
      x.shadowOffsetX = 0; x.shadowOffsetY = W * 0.004;
    } else {
      x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    }

    // 角落十字
    if (optOn('corner')) {
      x.save(); x.shadowColor = 'transparent'; x.shadowBlur = 0;
      x.strokeStyle = ink; x.lineWidth = Math.max(2, W * 0.0016);
      var cm = W * 0.04, r = W * 0.014;
      [[cm, H * 0.03], [W - cm, H * 0.03], [cm, H - H * 0.03], [W - cm, H - H * 0.03]].forEach(function (pt) {
        x.beginPath();
        x.moveTo(pt[0] - r, pt[1]); x.lineTo(pt[0] + r, pt[1]);
        x.moveTo(pt[0], pt[1] - r); x.lineTo(pt[0], pt[1] + r);
        x.stroke();
      });
      x.restore();
    }
    // 外框
    if (optOn('border')) {
      x.save(); x.shadowColor = 'transparent'; x.shadowBlur = 0;
      x.strokeStyle = ink; x.lineWidth = Math.max(2, W * 0.0022);
      x.strokeRect(A.l - W * 0.02, A.t - H * 0.014, A.w + W * 0.04, A.h + H * 0.028);
      x.restore();
    }

    var PD = page.data || {};
    var sc = ui.scales || {};
    // 字級以短邊為基準：橫式時 W 偏大會撐爆矮帶，乘 min(1,H/W) 拉回短邊
    var edgeK = Math.min(1, H / W);
    var fz = function (v) { return v * gscale * edgeK; };
    var scSub = sc.sub || 1;
    var fzc = function (v) { return v * gscale * scSub * edgeK; };
    var BMAX = 2;   // 沉底模式鐵則：標題 + 最多 2 行內容

    var ctx = {
      x: x, W: W, H: H, A: A, M: M, ink: ink, fz: fz, fzc: fzc, dy: dy, idx: i,
      bmax: M.bottomStack ? BMAX : 99, sc: sc, kind: D.kind, glyph: D.glyph
    };

    if (D.type === 'cover') {
      drawCover(ctx, PD);
    } else {
      var kind = D.kind;
      var isTable = (kind === 'spec' || kind === 'case');
      var isList = (kind === 'list' || kind === 'rule' || kind === 'steps' || isTable);
      var stackFrac = isList ? 0.62 : 0.68;
      var stackTop = M.bottomStack ? (A.t + dy + A.h * stackFrac) : (A.t + dy);

      var bandTop = stackTop;
      if (optOn('label') && D.label) {
        setFont(x, 700, fz(W * 0.024), MONO); x.textAlign = 'left';
        var lbH = fz(W * 0.024);
        x.fillStyle = ink; x.fillText(D.label, A.l, bandTop + lbH);
        x.save(); x.shadowColor = 'transparent';
        x.strokeStyle = ink; x.lineWidth = Math.max(2, W * 0.0018);
        var ly = bandTop + lbH + H * 0.012;
        x.beginPath(); x.moveTo(A.l, ly); x.lineTo(A.r, ly); x.stroke(); x.restore();
        bandTop = ly + H * 0.006;
      }

      var usableBot = A.b + dy;
      var bandRatio = M.bottomStack ? (isList ? 0.50 : 0.46) : M.titleBand;
      var scTitleR = sc.title || 1;
      if (scTitleR > 1) bandRatio = Math.min(0.7, bandRatio * scTitleR);
      var contentTop = bandTop + (usableBot - bandTop) * bandRatio;
      var titleH = contentTop - bandTop - H * 0.012;

      // copy／quote／stat 由各自的 draw 全權處理標題，外層不重複畫（避免大字疊大字）
      var selfTitle = (kind === 'copy' || kind === 'quote' || kind === 'stat');
      if (!selfTitle) drawTitle(ctx, PD.title, bandTop, titleH);

      var hasFooter = optOn('footer') && PD.footer && !M.bottomStack;
      var contentBot = hasFooter ? (usableBot - H * 0.06) : usableBot;

      if (kind === 'copy')       drawCopy(ctx, PD, bandTop, usableBot);
      else if (kind === 'list')  drawList(ctx, PD, D.glyph || 'check', contentTop, contentBot);
      else if (kind === 'spec')  drawSpec(ctx, PD, contentTop, contentBot);
      else if (kind === 'rule')  drawRule(ctx, PD, contentTop, contentBot);
      else if (kind === 'case')  drawCase(ctx, PD, contentTop, contentBot);
      else if (kind === 'stat')  drawStat(ctx, PD, bandTop, usableBot);
      else if (kind === 'quote') drawQuote(ctx, PD, bandTop, usableBot);
      else if (kind === 'steps') drawSteps(ctx, PD, contentTop, contentBot);

      if (hasFooter && !selfTitle) drawFooter(ctx, PD.footer);

      if (optOn('pageno')) {
        setFont(x, 700, fz(W * 0.028), MONO); x.textAlign = 'right';
        x.fillText(String(i + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0'),
                   A.r, H - H * 0.03);
        x.textAlign = 'left';
      }
    }

    if (cfg.outline) delete x.fillText;   // 還原被攔截的 fillText
  }

  /* ---------------- 各版面繪製 ---------------- */

  function drawTitle(ctx, title, topY, bandH) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, fz = ctx.fz, ink = ctx.ink;
    var TFAM = M.titleFam === 'serif' ? SERIF : HEAVY;
    var scT = ctx.sc.title || 1;
    x.fillStyle = ink; x.strokeStyle = ink;

    var segs = String(title || '').split(/[｜|]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var lines = segs.length > 2 ? [segs[0], segs.slice(1).join('')] : (segs.length ? segs : ['']);
    var maxW = A.w * (M.titleAlign === 'center' ? 0.98 : 1);

    var sz = fz(W * 0.115) * scT;
    for (;;) {
      setFont(x, M.titleWeight, sz, TFAM);
      var wide = lines.some(function (l) { return x.measureText(l).width > maxW; });
      if ((!wide && sz * 1.3 * lines.length <= bandH) || sz < fz(W * 0.045) * scT) break;
      sz -= fz(W * 0.004);
    }
    setFont(x, M.titleWeight, sz, TFAM);
    var lh = sz * 1.3, blockH = lh * lines.length;
    var y = blockH <= bandH ? topY + (bandH - blockH) / 2 + sz : topY + sz;
    x.textAlign = M.titleAlign === 'center' ? 'center' : 'left';
    var px = M.titleAlign === 'center' ? W / 2 : A.l;
    lines.forEach(function (l, k) {
      var ox = M.stagger ? A.w * 0.045 * k : 0;
      x.fillStyle = ink;
      x.fillText(l, px + ox, y + k * lh);
    });
    x.textAlign = 'left';

    if (M.accentBar) {
      x.lineWidth = Math.max(3, W * 0.004);
      x.beginPath();
      x.moveTo(A.l, y + blockH - lh + lh * 0.28);
      x.lineTo(A.l + A.w * 0.12, y + blockH - lh + lh * 0.28);
      x.stroke();
    }
  }

  function glyphBox(x, cx, cy, s, mode, ink) {
    x.lineWidth = Math.max(3, s * 0.09); x.strokeStyle = ink;
    x.strokeRect(cx - s / 2, cy - s / 2, s, s);
    if (mode === 'check') {
      x.beginPath();
      x.moveTo(cx - s * 0.28, cy);
      x.lineTo(cx - s * 0.06, cy + s * 0.24);
      x.lineTo(cx + s * 0.42, cy - s * 0.34);
      x.stroke();
    }
    if (mode === 'cross') {
      x.beginPath();
      x.moveTo(cx - s * 0.26, cy - s * 0.26); x.lineTo(cx + s * 0.26, cy + s * 0.26);
      x.moveTo(cx + s * 0.26, cy - s * 0.26); x.lineTo(cx - s * 0.26, cy + s * 0.26);
      x.stroke();
    }
  }

  function drawList(ctx, p, glyph, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, ink = ctx.ink, fz = ctx.fz, fzc = ctx.fzc;
    // 人物特輯／襯線雜誌：不畫符號框，改「主標下多行副標」
    if (M.subGray || M.serifBody) {
      drawSubLines(ctx, (p.items || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean), top, bot);
      return;
    }
    var items = (p.items || []).map(function (s) { return String(s || '').trim(); })
                               .filter(Boolean).slice(0, ctx.bmax);
    var oneLine = M.bottomStack;
    var avail = bot - top, n = items.length || 1, slot = avail / n;
    var glyphW = A.w * 0.09;
    var textMaxW = A.w - glyphW - A.w * 0.03;
    var fs = fzc(W * 0.05);
    var MIN = fzc(W * 0.032);

    function blockH(sz) {
      setFont(x, 900, sz, HEAVY);
      var maxLines = 1;
      items.forEach(function (t) { maxLines = Math.max(maxLines, wrapCJK(x, t, textMaxW).length); });
      return sz * 1.36 * maxLines;
    }
    while (fs > MIN) { if (blockH(fs) <= slot * 0.92) break; fs -= fz(W * 0.003); }
    var lh = fs * 1.36;
    var perLineMax = oneLine ? 1 : Math.max(1, Math.floor((slot * 0.92) / lh));

    items.forEach(function (t, k) {
      // 只剩一條時自動往下沉，不黏在原第一行位置
      var cy = (M.bottomStack && n === 1) ? top + avail * 0.68 : top + slot * k + slot / 2;
      var gx = A.l + glyphW / 2 + (M.stagger ? A.w * 0.05 * k : 0);
      glyphBox(x, gx, cy - fs * 0.34, fs * 0.9, glyph, ink);
      setFont(x, 900, fs, HEAVY); x.textAlign = 'left'; x.fillStyle = ink;
      var w = textMaxW - (M.stagger ? A.w * 0.05 * k : 0);
      var lines = wrapCJK(x, t, w);
      if (lines.length > perLineMax) {
        lines = lines.slice(0, perLineMax);
        var last = lines[perLineMax - 1];
        while (last.length && x.measureText(last + '…').width > w) last = last.slice(0, -1);
        lines[perLineMax - 1] = last + '…';
      }
      var ty = cy - ((lines.length - 1) * lh) / 2;
      lines.forEach(function (l, j) { x.fillText(l, gx + glyphW / 2 + A.w * 0.02, ty + j * lh + fs * 0.34); });
    });
  }

  function drawSubLines(ctx, items, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, ink = ctx.ink, fz = ctx.fz, fzc = ctx.fzc;
    if (!items.length) return;
    var serif = !!M.serifBody;
    var FAM = serif ? SERIF : HEAVY;
    var weight = serif ? 500 : 600;
    var gray = M.subGray ? (ink === '#ffffff' ? 'rgba(230,230,230,0.85)' : 'rgba(40,40,40,0.85)') : ink;
    var wrap = serif, maxLines = serif ? 6 : 5;
    var avail = bot - top, maxW = A.w;
    var fs = fzc(W * (serif ? 0.040 : 0.038));
    var lhK = serif ? 1.6 : 1.42;

    function buildLines(sz) {
      setFont(x, weight, sz, FAM);
      var ls = [];
      items.forEach(function (it) {
        if (wrap) { wrapCJK(x, it, maxW).forEach(function (l) { ls.push(l); }); }
        else {
          var t = it;
          while (t.length && x.measureText(t).width > maxW) t = t.slice(0, -1);
          if (t.length < it.length) t = t.slice(0, -1) + '…';
          ls.push(t);
        }
      });
      return ls.slice(0, maxLines);
    }
    var MIN = fzc(W * 0.026);
    var lines = buildLines(fs);
    while (fs > MIN && lines.length * fs * lhK > avail * 0.98) { fs -= fz(W * 0.002); lines = buildLines(fs); }
    var lh = fs * lhK;
    setFont(x, weight, fs, FAM); x.textAlign = 'left'; x.fillStyle = gray;
    var y = top + fs;
    lines.forEach(function (l) { x.fillText(l, A.l, y); y += lh; });
    x.fillStyle = ink;
  }

  function drawRule(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, ink = ctx.ink, fz = ctx.fz, fzc = ctx.fzc;
    var items = (p.items || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    var results = [(p.resultA || '').trim(), (p.resultB || '').trim()].filter(Boolean).slice(0, ctx.bmax);
    var hasRes = results.length > 0;

    // 沉底模式：只留「標題 + 2 條結論」，問句清單砍掉（結論才是重點）
    if (M.bottomStack) {
      if (!hasRes) return;
      var slot2 = (bot - top) / results.length, maxW2 = A.w * 0.98;
      var sz2 = fzc(W * 0.056);
      for (;;) {
        setFont(x, 900, sz2, HEAVY);
        var tw = results.some(function (t) { return x.measureText(t).width > maxW2; });
        if ((!tw && sz2 * 1.3 <= slot2) || sz2 < fzc(W * 0.032)) break;
        sz2 -= fz(W * 0.002);
      }
      setFont(x, 900, sz2, HEAVY); x.textAlign = 'center'; x.fillStyle = ink;
      results.forEach(function (t, k) { x.fillText(t, W / 2, top + slot2 * k + slot2 / 2 + sz2 * 0.34); });
      x.textAlign = 'left';
      return;
    }

    var splitY = hasRes ? (top + (bot - top) * 0.58) : bot;
    if (items.length) drawList(ctx, { items: items }, 'check', top, splitY - A.h * 0.008);
    if (!hasRes) return;

    x.textAlign = 'center'; x.fillStyle = ink;
    var slot = (bot - splitY) / results.length, maxW = A.w * 0.98;
    var sz = fzc(W * 0.056);
    for (;;) {
      setFont(x, 900, sz, HEAVY);
      var tooWide = results.some(function (t) { return x.measureText(t).width > maxW; });
      if ((!tooWide && sz * 1.3 <= slot) || sz < fzc(W * 0.03)) break;
      sz -= fz(W * 0.002);
    }
    setFont(x, 900, sz, HEAVY);
    results.forEach(function (t, k) { x.fillText(t, W / 2, splitY + slot * k + slot / 2 + sz * 0.34); });
    x.textAlign = 'left';
  }

  function drawSpec(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, ink = ctx.ink, fz = ctx.fz, fzc = ctx.fzc;
    if (M.bottomStack) {
      drawKVList(ctx, (p.cells || []).map(function (c) { return { k: c.name, v: c.desc }; }), top, bot, ctx.bmax);
      return;
    }
    var L = A.l, R = A.r, mid = (L + R) / 2, midY = (top + bot) / 2;
    x.lineWidth = Math.max(2, W * 0.002); x.strokeStyle = ink;
    if (M.tableStyle !== 'open') x.strokeRect(L, top, R - L, bot - top);
    x.beginPath();
    x.moveTo(mid, top); x.lineTo(mid, bot);
    x.moveTo(L, midY);  x.lineTo(R, midY);
    x.stroke();

    var cells = (p.cells || []).filter(function (c) { return (c.name || c.desc || c.no); });
    var pos = [[L, top], [mid, top], [L, midY], [mid, midY]];
    var cw = (R - L) / 2, ch = (bot - top) / 2, pad = cw * 0.09;
    cells.forEach(function (c, i) {
      var cx = pos[i][0], cy = pos[i][1];
      x.textAlign = 'left'; x.fillStyle = ink;
      var noSz = fitLine(x, c.no || '', fz(W * 0.058), fz(W * 0.032), cw - pad * 2, 700, MONO);
      setFont(x, 700, noSz, MONO);
      x.fillText(c.no || String(i + 1).padStart(2, '0'), cx + pad, cy + pad + noSz);
      var nmSz = fitLine(x, c.name || '', fzc(W * 0.05), fzc(W * 0.032), cw - pad * 2, 900, HEAVY);
      setFont(x, 900, nmSz, HEAVY);
      x.fillText(c.name || '', cx + pad, cy + pad + noSz + nmSz * 1.3);
      var descTop = cy + pad + noSz + nmSz * 1.3 + nmSz * 0.45;
      var b = fitBlock(x, c.desc || '', fzc(W * 0.034), fz(W * 0.026), cw - pad * 2,
                       cy + ch - pad - descTop, 500, 1.45, HEAVY);
      setFont(x, 500, b.size, HEAVY);
      b.lines.forEach(function (l, j) { x.fillText(l, cx + pad, descTop + b.size + j * b.lh); });
    });
  }

  /* 沉底模式的 SPEC／CASE 精簡條列：不畫表格框，改「粗名 — 說明」短列 */
  function drawKVList(ctx, pairs, top, bot, rowsMax) {
    var x = ctx.x, W = ctx.W, A = ctx.A, ink = ctx.ink, fzc = ctx.fzc;
    var rows = pairs.filter(function (p) { return p.k || p.v; }).slice(0, rowsMax || 4);
    var n = rows.length || 1, slot = (bot - top) / n;
    var kMaxW = A.w * 0.34;
    rows.forEach(function (r, i) {
      var cy = top + slot * i + slot / 2;
      x.textAlign = 'left'; x.fillStyle = ink;
      var kSz = fitLine(x, r.k || '', fzc(W * 0.05), fzc(W * 0.034), kMaxW, 900, HEAVY);
      setFont(x, 900, kSz, HEAVY);
      x.fillText(r.k || '', A.l, cy + kSz * 0.34);
      x.save(); x.shadowColor = 'transparent'; x.strokeStyle = ink; x.lineWidth = Math.max(2, W * 0.0016);
      var sepX = A.l + kMaxW + A.w * 0.02;
      x.beginPath(); x.moveTo(sepX, cy - slot * 0.28); x.lineTo(sepX, cy + slot * 0.28); x.stroke(); x.restore();
      var vX = sepX + A.w * 0.03, vMaxW = A.r - vX;
      var vSz = fitLine(x, r.v || '', fzc(W * 0.04), fzc(W * 0.026), vMaxW, 600, HEAVY);
      setFont(x, 600, vSz, HEAVY);
      var vt = r.v || '';
      while (vt.length && x.measureText(vt).width > vMaxW) vt = vt.slice(0, -1);
      if (vt.length < (r.v || '').length) vt = vt.slice(0, -1) + '…';
      x.fillText(vt, vX, cy + vSz * 0.34);
    });
  }

  function drawCase(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, ink = ctx.ink, fz = ctx.fz, fzc = ctx.fzc;
    if (M.bottomStack) {
      drawKVList(ctx, (p.rows || []).map(function (r) { return { k: r.k, v: r.v }; }), top, bot, ctx.bmax);
      return;
    }
    var rows = (p.rows || []).filter(function (r) { return (r.k || r.v); });   // 刪掉的列不佔位
    var n = rows.length || 1;
    var L = A.l, R = A.r, rh = (bot - top) / n, kw = A.w * 0.2;
    x.lineWidth = Math.max(2, W * 0.002); x.strokeStyle = ink;
    if (M.tableStyle !== 'open' && M.tableStyle !== 'rule') x.strokeRect(L, top, R - L, rh * n);
    rows.forEach(function (r, i) {
      var ry = top + rh * i;
      if (i) { x.beginPath(); x.moveTo(L, ry); x.lineTo(R, ry); x.stroke(); }
      else if (M.tableStyle === 'rule' || M.tableStyle === 'open') {
        x.beginPath(); x.moveTo(L, ry); x.lineTo(R, ry); x.stroke();
      }
      if (M.tableStyle !== 'open') {
        x.beginPath(); x.moveTo(L + kw, ry + rh * 0.18); x.lineTo(L + kw, ry + rh * 0.82); x.stroke();
      }
      x.textAlign = 'left'; x.fillStyle = ink;
      var kSz = fitLine(x, r.k || '', fzc(W * 0.046), fzc(W * 0.026), kw - A.w * 0.04, 900, HEAVY);
      setFont(x, 900, kSz, HEAVY);
      x.fillText(r.k || '', L + A.w * 0.025, ry + rh * 0.5 + kSz * 0.34);
      var vMaxW = R - L - kw - A.w * 0.06;
      var b = fitBlock(x, r.v || '', fzc(W * 0.038), fz(W * 0.022), vMaxW, rh * 0.82, 700, 1.4, HEAVY);
      setFont(x, 700, b.size, HEAVY);
      var ty = ry + rh * 0.5 - ((b.lines.length - 1) * b.lh) / 2 + b.size * 0.34;
      b.lines.forEach(function (l, j) { x.fillText(l, L + kw + A.w * 0.03, ty + j * b.lh); });
    });
    if (M.tableStyle === 'rule') { x.beginPath(); x.moveTo(L, bot); x.lineTo(R, bot); x.stroke(); }
  }

  function drawCopy(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, M = ctx.M, ink = ctx.ink, fz = ctx.fz, sc = ctx.sc;
    var scT = sc.title || 1, scS = sc.sub || 1;
    var igStyle = !!(M.subGray || M.serifBody);
    var TFAM = M.titleFam === 'serif' ? SERIF : HEAVY;
    var BFAM = M.serifBody ? SERIF : HEAVY;
    var tW = M.titleWeight || 900, bW = M.serifBody ? 500 : 700;
    var AL = igStyle ? 'left' : 'center';
    var PX = igStyle ? A.l : W / 2;
    var bMaxW = igStyle ? A.w : A.w * 0.9;

    var bandH = bot - top;
    var declFrac = scS > 1.15 ? (scS > 1.5 ? 0.40 : 0.48) : 0.56;
    var Hbody = top + bandH * declFrac;

    var segs = String(p.title || '').split(/[｜|]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var tl = segs.length ? segs : [''];
    var titZone = Hbody - top;
    var tsz = fz(W * 0.09) * scT;
    for (;;) {
      setFont(x, tW, tsz, TFAM);
      var wide = tl.some(function (l) { return x.measureText(l).width > A.w; });
      if ((!wide && tsz * 1.28 * tl.length <= titZone) || tsz < fz(W * 0.045) * scT) break;
      tsz -= fz(W * 0.003);
    }
    setFont(x, tW, tsz, TFAM); x.textAlign = AL; x.fillStyle = ink;
    var tlh = tsz * 1.28, titBlock = tlh * tl.length;
    var ty = top + (titZone - titBlock) / 2 + tsz;
    tl.forEach(function (l, k) { x.fillText(l, PX, ty + k * tlh); });

    var bodyZone = bot - Hbody;
    if ((p.body || '').trim() && bodyZone > fz(W * 0.03)) {
      var bb = fitBlock(x, p.body || '', fz(W * 0.036) * scS, fz(W * 0.022) * scS,
                        bMaxW, bodyZone * 0.9, bW, igStyle ? 1.7 : 1.6, BFAM);
      var bmaxCopy = (scS > 1.15 || igStyle) ? 3 : 2;
      var lines = bb.lines.slice(0, bmaxCopy);
      if (bb.lines.length > bmaxCopy) {
        var li = bmaxCopy - 1, last = lines[li];
        while (last.length && x.measureText(last + '…').width > bMaxW) last = last.slice(0, -1);
        lines[li] = last + '…';
      }
      setFont(x, bW, bb.size, BFAM); x.fillStyle = ink;
      var total = bb.size + (lines.length - 1) * bb.lh;
      lines.forEach(function (l, j) {
        x.fillText(l, PX, Hbody + (bodyZone - total) / 2 + bb.size + j * bb.lh);
      });
    }
    x.textAlign = 'left';
  }

  function drawFooter(ctx, txt) {
    var x = ctx.x, W = ctx.W, H = ctx.H, A = ctx.A, ink = ctx.ink, fz = ctx.fz;
    if (!txt) return;
    x.fillStyle = ink;
    var sz = fitLine(x, txt, fz(W * 0.05), fz(W * 0.026), A.w, 900, HEAVY);
    setFont(x, 900, sz, HEAVY);
    x.textAlign = 'center';
    x.fillText(txt, W / 2, A.b - H * 0.005);
    x.textAlign = 'left';
  }

  function drawStat(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, ink = ctx.ink, fz = ctx.fz, sc = ctx.sc;
    var scV = sc.value || 1, scT = sc.title || 1, scS = sc.sub || 1;
    var zone = bot - top;
    x.fillStyle = ink;

    if ((p.title || '').trim()) {
      var tsz = fitLine(x, p.title, fz(W * 0.05) * scT, fz(W * 0.03), A.w, 900, HEAVY);
      setFont(x, 900, tsz, HEAVY); x.textAlign = 'center';
      x.fillText(p.title, W / 2, top + tsz);
    }

    var val = String(p.value || ''), unit = String(p.unit || '');
    var vsz = fz(W * 0.34) * scV;
    function totalWidth() {
      setFont(x, 900, vsz * 0.34, HEAVY);
      var uw = x.measureText(unit).width;
      setFont(x, 900, vsz, HEAVY);
      return x.measureText(val).width + uw + W * 0.01;
    }
    while (totalWidth() > A.w && vsz > fz(W * 0.12)) vsz -= fz(W * 0.01);

    var usz = vsz * 0.34;
    setFont(x, 900, vsz, HEAVY); var vw = x.measureText(val).width;
    setFont(x, 900, usz, HEAVY); var uw2 = x.measureText(unit).width;
    var startX = (W - (vw + uw2 + W * 0.01)) / 2, cy = top + zone * 0.5;
    setFont(x, 900, vsz, HEAVY); x.textAlign = 'left'; x.fillText(val, startX, cy + vsz * 0.34);
    setFont(x, 900, usz, HEAVY); x.fillText(unit, startX + vw + W * 0.01, cy + vsz * 0.34);

    if ((p.caption || '').trim()) {
      var cb = fitBlock(x, p.caption, fz(W * 0.04) * scS, fz(W * 0.026), A.w * 0.9, zone * 0.22, 700, 1.5, HEAVY);
      setFont(x, 700, cb.size, HEAVY); x.textAlign = 'center'; x.fillStyle = ink;
      cb.lines.forEach(function (l, j) { x.fillText(l, W / 2, cy + zone * 0.28 + cb.size + j * cb.lh); });
    }
    x.textAlign = 'left';
  }

  function drawQuote(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, ink = ctx.ink, fz = ctx.fz, sc = ctx.sc;
    var scQ = sc.quote || 1, scS = sc.sub || 1;
    var zone = bot - top;
    var q = String(p.quote || p.title || '');
    x.fillStyle = ink;

    setFont(x, 900, fz(W * 0.16), SERIF); x.textAlign = 'left';
    x.save(); x.globalAlpha = 0.5; x.fillText('“', A.l, top + fz(W * 0.13)); x.restore();

    var qb = fitBlock(x, q, fz(W * 0.075) * scQ, fz(W * 0.04), A.w * 0.92, zone * 0.62, 900, 1.4, HEAVY);
    setFont(x, 900, qb.size, HEAVY); x.textAlign = 'center'; x.fillStyle = ink;
    var qTotal = qb.size + (qb.lines.length - 1) * qb.lh;
    var qy = top + zone * 0.16 + (zone * 0.6 - qTotal) / 2;
    qb.lines.forEach(function (l, j) { x.fillText(l, W / 2, qy + qb.size + j * qb.lh); });

    if ((p.source || '').trim()) {
      var ssz = fitLine(x, '— ' + p.source, fz(W * 0.038) * scS, fz(W * 0.026), A.w * 0.8, 700, SERIF);
      setFont(x, 700, ssz, SERIF); x.textAlign = 'center';
      x.fillText('— ' + p.source, W / 2, bot - ssz);
    }
    x.textAlign = 'left';
  }

  function drawSteps(ctx, p, top, bot) {
    var x = ctx.x, W = ctx.W, A = ctx.A, ink = ctx.ink, fz = ctx.fz, fzc = ctx.fzc;
    var items = (p.items || []).map(function (s) { return String(s || '').trim(); })
                               .filter(Boolean).slice(0, ctx.bmax);
    var n = items.length || 1, slot = (bot - top) / n;
    var numW = A.w * 0.16;
    items.forEach(function (t, k) {
      var cy = top + slot * k + slot / 2;
      setFont(x, 900, fz(W * 0.06), MONO); x.textAlign = 'left'; x.fillStyle = ink;
      x.fillText(String(k + 1).padStart(2, '0'), A.l, cy + fz(W * 0.06) * 0.34);
      if (k < items.length - 1) {
        x.save(); x.shadowColor = 'transparent'; x.strokeStyle = ink; x.lineWidth = Math.max(2, W * 0.0016);
        x.beginPath();
        x.moveTo(A.l + numW * 0.28, cy + fz(W * 0.06) * 0.5);
        x.lineTo(A.l + numW * 0.28, cy + slot - fz(W * 0.06) * 0.5);
        x.stroke(); x.restore();
      }
      var tb = fitBlock(x, t, fzc(W * 0.046), fz(W * 0.03), A.r - (A.l + numW), slot * 0.82, 900, 1.3, HEAVY);
      var lines = tb.lines.slice(0, 2);
      setFont(x, 900, tb.size, HEAVY);
      var ty = cy - ((lines.length - 1) * tb.lh) / 2;
      lines.forEach(function (l, j) { x.fillText(l, A.l + numW, ty + tb.size * 0.34 + j * tb.lh); });
    });
  }

  function drawCover(ctx, c) {
    var x = ctx.x, W = ctx.W, H = ctx.H, A = ctx.A, M = ctx.M, ink = ctx.ink,
        fz = ctx.fz, dy = ctx.dy, sc = ctx.sc;
    var t = String(c.title || '');
    var scT = sc.title || 1, scS = sc.sub || 1;
    var fzT = function (v) { return fz(v) * scT; };
    var fzS = function (v) { return fz(v) * scS; };
    var TFAM = M.titleFam === 'serif' ? SERIF : HEAVY, tW = M.titleWeight || 900;
    var SFAM = M.serifBody ? SERIF : HEAVY, sW = M.serifBody ? 500 : 800;
    var subGray = M.subGray ? (ink === '#ffffff' ? 'rgba(230,230,230,0.9)' : 'rgba(40,40,40,0.9)') : ink;

    var b = fitBlock(x, c.sub || '', fzS(W * 0.046), fzS(W * 0.028), A.w * 0.72, H * 0.18, sW, 1.7, SFAM);

    if (M.bottomStack) {
      var bandTop = A.t + dy + A.h * 0.68;          // 文字帶只占下方 32%，上方留給圖
      var bandBot = A.b + dy;
      var titZoneBot = bandBot - (b.total + b.size * 1.8);
      var tsegs = t.split(/[｜|]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var tzoneH = titZoneBot - bandTop;
      var sz = fzT(W * 0.13), tlines;
      for (;;) {
        setFont(x, tW, sz, TFAM);
        tlines = tsegs.length >= 2 ? [tsegs[0], tsegs.slice(1).join(' ')] : wrapCJK(x, t, A.w);
        if (tlines.length > 2) tlines = [tlines[0], tlines.slice(1).join('')];
        var wide = tlines.some(function (l) { return x.measureText(l).width > A.w; });
        if ((!wide && sz * 1.2 * tlines.length <= tzoneH) || sz < fzT(W * 0.055)) break;
        sz -= fz(W * 0.004);
      }
      setFont(x, tW, sz, TFAM); x.textAlign = 'left'; x.fillStyle = ink;
      var tlh = sz * 1.2;
      var tyy = titZoneBot - tlh * tlines.length + sz * 0.85;
      tlines.forEach(function (l, k) { x.fillText(l, A.l, tyy + k * tlh); });

      setFont(x, sW, b.size, SFAM); x.fillStyle = subGray;
      var sy = bandBot - b.total - b.size * 0.4;
      x.save(); x.shadowColor = 'transparent';
      x.lineWidth = Math.max(2, W * 0.0018); x.strokeStyle = ink;
      x.beginPath(); x.moveTo(A.l, sy - b.size * 0.85); x.lineTo(A.l + A.w * 0.06, sy - b.size * 0.85); x.stroke();
      x.restore();
      b.lines.forEach(function (l, k) { x.fillText(l, A.l, sy + b.size + k * b.lh); });
      x.fillStyle = ink;
      return;
    }

    // 一般模式：大標置頂、副標置底
    var sz2 = fzT(W * 0.42);
    setFont(x, 900, sz2, HEAVY);
    while (x.measureText(t).width > A.w && sz2 > fzT(W * 0.1)) { sz2 -= fz(W * 0.01); setFont(x, 900, sz2, HEAVY); }
    x.textAlign = M.titleAlign === 'center' ? 'center' : 'left'; x.fillStyle = ink;
    x.fillText(t, M.titleAlign === 'center' ? W / 2 : A.l, A.t + dy + sz2);
    x.textAlign = 'left';

    setFont(x, 800, b.size, HEAVY);
    var sy2 = A.b + dy - b.total - H * 0.02;
    x.lineWidth = Math.max(2, W * 0.0018);
    x.beginPath(); x.moveTo(A.l, sy2 - b.size * 0.9); x.lineTo(A.l + A.w * 0.06, sy2 - b.size * 0.9); x.stroke();
    b.lines.forEach(function (l, k) { x.fillText(l, A.l, sy2 + b.size + k * b.lh); });
    var ey = sy2 + b.size + (b.lines.length - 1) * b.lh + b.size * 0.7;
    x.beginPath(); x.moveTo(A.l, ey); x.lineTo(A.l + A.w * 0.72, ey); x.stroke();
  }

  global.CardEngine = {
    MODES: MODES, BLUEPRINTS: BLUEPRINTS, INNER_TYPES: INNER_TYPES, SIZES: SIZES,
    normalizePages: normalizePages, normPageData: normPageData,
    pageDefs: pageDefs, validMode: validMode, render: render,
    fonts: { HEAVY: HEAVY, MONO: MONO, SERIF: SERIF }
  };
})(window);
