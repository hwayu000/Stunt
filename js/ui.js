/* ============================================================
   Stunt — UI 基礎層
   全站禁用 innerHTML 拼接使用者資料；一律走 el() / text 節點。
   CSP 為嚴格模式（無 inline script、無 onclick），互動全部事件委派。
   ============================================================ */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- DOM 建構 ---------- */
  // el('div.card', {id:'x'}, [child, '文字'])
  function el(spec, attrs, children) {
    var parts = String(spec).split('.');
    var tag = parts.shift() || 'div';
    var node = document.createElement(tag);
    if (parts.length) node.className = parts.join(' ');

    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class')        { node.className = node.className ? node.className + ' ' + v : v; }
      else if (k === 'text')    { node.textContent = v; }
      else if (k === 'html')    { throw new Error('禁止使用 html 屬性，請改用 text 或子節點'); }
      // CSP 為 style-src 'self'，inline style 會被瀏覽器擋下。
      // 需要動態尺寸時請改用 CSS 自訂屬性（node.style.setProperty 由呼叫端自行負責）。
      else if (k === 'style')   { throw new Error('禁止使用 style 屬性，請改用 class 或 CSS 變數'); }
      else if (k === 'value')   { node.value = v; }
      else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') { node[k] = !!v; }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') { node.addEventListener(k.slice(2), v); }
      else { node.setAttribute(k, v); }
    });

    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      children.forEach(function (c) { append(node, c); });
      return node;
    }
    node.appendChild(children.nodeType ? children : document.createTextNode(String(children)));
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // 圖示：<svg class="ico"><use href="#i-xxx"></svg>
  function icon(name, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  /* ---------- Tooltip：說明文字的唯一容身處 ---------- */
  function tip(bodyText, label) {
    return el('span.tip', null, [
      el('button.tip-trigger', { type: 'button', 'aria-label': label || '說明', text: '?' }),
      el('span.tip-body', { role: 'tooltip', text: bodyText })
    ]);
  }

  /* 氣泡以 fixed 定位，開啟時才計算座標並夾限在視窗內。
     這樣既不會被父容器裁切，也不會在關閉狀態撐出橫向捲軸。 */
  var GAP = 10, EDGE = 12;
  var _layer = null, _openHost = null;

  // 單一浮層掛在 body 底下。若把氣泡留在原地，只要任何祖先有 transform
  // （頁面進場動畫就會產生），position:fixed 的基準就會被改掉而算錯位置。
  function layer() {
    if (!_layer) {
      _layer = el('div.tip-layer', { role: 'tooltip' });
      document.body.appendChild(_layer);
    }
    return _layer;
  }

  function openTip(host) {
    var src = host.querySelector('.tip-body');
    if (!src) return;
    var n = layer();
    n.textContent = src.textContent;
    n.classList.add('is-open');
    n.classList.remove('is-shown', 'tip-below');

    var r = host.getBoundingClientRect();
    var bw = n.offsetWidth, bh = n.offsetHeight;
    var below = r.top < bh + GAP + EDGE;          // 上方放不下就翻到下方
    n.classList.toggle('tip-below', below);

    var top = below ? r.bottom + GAP : r.top - bh - GAP;
    var left = r.left + r.width / 2 - bw / 2;
    left = Math.max(EDGE, Math.min(left, document.documentElement.clientWidth - bw - EDGE));
    top  = Math.max(EDGE, Math.min(top, document.documentElement.clientHeight - bh - EDGE));
    n.style.left = Math.round(left) + 'px';
    n.style.top = Math.round(top) + 'px';

    host.classList.add('is-open');
    _openHost = host;
    requestAnimationFrame(function () { n.classList.add('is-shown'); });
  }

  function closeTips(except) {
    if (_openHost && _openHost !== except) _openHost.classList.remove('is-open');
    if (except !== _openHost) _openHost = null;
    if (_layer && !except) { _layer.classList.remove('is-shown', 'is-open'); }
    Array.prototype.forEach.call(document.querySelectorAll('.tip.is-open'), function (t) {
      if (t !== except) t.classList.remove('is-open');
    });
  }

  function initTips() {
    // 點擊切換。滑鼠裝置由 hover 負責開關，這裡不再處理，
    // 否則「移入已開啟 → 點擊」會立刻把剛開的氣泡關掉。
    document.addEventListener('click', function (e) {
      var hoverDevice = matchMedia('(hover: hover)').matches;
      var trigger = e.target.closest ? e.target.closest('.tip-trigger') : null;
      if (!trigger) { closeTips(); return; }
      e.preventDefault();
      // 一律開啟。若在這裡做 toggle，先觸發的 focusin／mouseover 會讓點擊變成「開了又關」。
      openTip(trigger.parentNode);
    });

    // 桌機滑鼠移入即顯示
    document.addEventListener('mouseover', function (e) {
      var host = e.target.closest ? e.target.closest('.tip') : null;
      if (!host || !matchMedia('(hover: hover)').matches) return;
      if (!host.classList.contains('is-open')) openTip(host);
    });
    document.addEventListener('mouseout', function (e) {
      var host = e.target.closest ? e.target.closest('.tip') : null;
      if (!host || !matchMedia('(hover: hover)').matches) return;
      if (host.contains(e.relatedTarget)) return;
      closeTips();
    });

    document.addEventListener('focusin', function (e) {
      var t = e.target.closest ? e.target.closest('.tip-trigger') : null;
      if (t) openTip(t.parentNode);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTips(); });
    global.addEventListener('scroll', function () { closeTips(); }, true);
    global.addEventListener('resize', function () { closeTips(); });
  }

  /* ---------- Toast ---------- */
  function toast(msg, kind) {
    var host = document.getElementById('toastHost');
    if (!host) return;
    var node = el('div.toast', { text: msg });
    if (kind === 'ok' || kind === 'error') node.classList.add('toast-' + kind);
    host.appendChild(node);
    setTimeout(function () {
      node.classList.add('is-out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
    }, kind === 'error' ? 4200 : 2600);
  }

  /* ---------- Modal ---------- */
  var _modalPrevFocus = null;
  function openModal(title, contentNodes, footNodes) {
    closeModal();
    var box = el('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div.card-head', null, [
        el('h2', { text: title }),
        el('button.btn.btn-ghost.btn-icon', {
          type: 'button', 'aria-label': '關閉', onclick: closeModal, text: '✕'
        })
      ]),
      el('div.modal-body', null, contentNodes),
      footNodes ? el('div.row.row-end.u-mt-5', null, footNodes) : null
    ]);
    var back = el('div.modal-back', { id: 'modalBack' }, box);
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });
    document.body.appendChild(back);
    _modalPrevFocus = document.activeElement;
    requestAnimationFrame(function () { back.classList.add('is-open'); });
    document.addEventListener('keydown', escClose);
    return back;
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var back = document.getElementById('modalBack');
    if (!back) return;
    document.removeEventListener('keydown', escClose);
    back.classList.remove('is-open');
    setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 240);
    if (_modalPrevFocus && _modalPrevFocus.focus) _modalPrevFocus.focus();
    _modalPrevFocus = null;
  }

  /* ---------- 其他 ---------- */
  function copyText(str) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(str)
        .then(function () { toast('已複製', 'ok'); })
        .catch(function () { toast('複製失敗，請手動選取', 'error'); });
    }
    toast('此瀏覽器不支援自動複製', 'error');
    return Promise.resolve();
  }

  /* 生成中狀態：手機底部導航亮起環繞光帶。
     以計數器累加，多個模組同時生成時不會互相把對方的光關掉。 */
  var _busyCount = 0;
  function setGenerating(on) {
    _busyCount = Math.max(0, _busyCount + (on ? 1 : -1));
    var on = _busyCount > 0;
    var nav = document.querySelector('.bottomnav');
    if (nav) nav.classList.toggle('is-generating', on);
    // 桌機沒有 Dock，指示改掛在頂欄（body 上的旗標由 CSS 接手）
    document.body.classList.toggle('is-generating', on);
  }

  function busy(btn, on, labelWhenBusy) {
    setGenerating(!!on);
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      clear(btn);
      append(btn, [el('span.spin'), ' ' + (labelWhenBusy || '處理中')]);
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || btn.textContent;
    }
  }

  global.Stunt = global.Stunt || {};
  global.Stunt.el = el;
  global.Stunt.append = append;
  global.Stunt.clear = clear;
  global.Stunt.icon = icon;
  global.Stunt.tip = tip;
  global.Stunt.initTips = initTips;
  global.Stunt.toast = toast;
  global.Stunt.openModal = openModal;
  global.Stunt.closeModal = closeModal;
  global.Stunt.copyText = copyText;
  global.Stunt.busy = busy;
  global.Stunt.setGenerating = setGenerating;
})(window);
