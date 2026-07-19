/* ============================================================
   Stunt — 狀態層
   全部資料只存在使用者自己的瀏覽器（localStorage），不上傳任何伺服器。
   API Key 另存於獨立 key，登出時可一鍵清除。
   ============================================================ */
(function (global) {
  'use strict';

  /* 每個帳號一組獨立的儲存空間。鍵名帶帳號後綴，兩個帳號的資料
     在 localStorage 層就分開，沒有任何共用結構可以互相污染。 */
  var ACCOUNT = '';
  var STORE_KEY = 'stunt_v1';
  var KEY_STORE = 'stunt_keys_v1';   // API Key 單獨存放，方便一鍵清除
  var SCHEMA = 1;

  function keyFor(base) { return ACCOUNT ? base + '__' + ACCOUNT : base; }

  var MODEL_DEFS = [
    { id: 'deepseek', name: 'DeepSeek',  modelName: 'deepseek-v4-flash', baseUrl: '', hint: '性價比高，中文表現穩定。需要付費儲值。' },
    { id: 'gemini',   name: 'Google Gemini', modelName: 'gemini-2.5-flash', baseUrl: '', hint: '有免費額度，不必綁信用卡，適合先試用。' }
  ];

  function defaults() {
    return {
      schemaVersion: SCHEMA,
      personas: [],
      voices: [],
      models: MODEL_DEFS.map(function (m) {
        return { id: m.id, name: m.name, modelName: m.modelName, baseUrl: m.baseUrl, bound: false };
      }),
      boundId: null,
      proxyMode: 'auto',            // auto | direct | proxy
      skills: [
        { id: 'hook',       name: '三秒爆款 Hook 檢測', desc: '對開頭句評「滑掉風險」分數，並提供一鍵矯正。', installed: true },
        { id: 'colloquial', name: '口語化改寫',         desc: '把書面語替換成口說順的說法。',                installed: true },
        { id: 'retention',  name: '完播率結構優化',     desc: '在段落交界補上鉤子，降低中途離開。',          installed: false }
      ],
      card: {                        // 圖卡文案的專案狀態
        topicInput: '', candidates: [], chosen: -1, pages: null,
        genre: 'auto', pageCount: 7, size: '4:5', mode: 'swiss',
        maskAlpha: 45, white: true, strokeFrac: 0.012, textShadow: true, blur: 0,
        opts: { pageno: true, label: true, corner: true, border: false, footer: true }
      }
    };
  }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (e) { return null; }
  }

  function load() {
    var raw = readJSON(keyFor(STORE_KEY));
    var base = defaults();
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA) return base;

    // 逐欄挑選，不整包信任 localStorage 的內容（防止被竄改的結構造成崩潰）
    var s = base;
    if (Array.isArray(raw.personas)) s.personas = raw.personas;
    if (Array.isArray(raw.voices))   s.voices   = raw.voices;
    if (Array.isArray(raw.skills))   s.skills   = base.skills.map(function (sk) {
      var hit = raw.skills.filter(function (r) { return r && r.id === sk.id; })[0];
      return hit ? { id: sk.id, name: sk.name, desc: sk.desc, installed: !!hit.installed } : sk;
    });
    if (Array.isArray(raw.models)) s.models = base.models.map(function (m) {
      var hit = raw.models.filter(function (r) { return r && r.id === m.id; })[0];
      if (!hit) return m;
      return {
        id: m.id, name: m.name,
        modelName: typeof hit.modelName === 'string' && hit.modelName ? hit.modelName : m.modelName,
        baseUrl:   typeof hit.baseUrl === 'string' ? hit.baseUrl : m.baseUrl,
        bound: !!hit.bound
      };
    });
    if (typeof raw.boundId === 'string') s.boundId = raw.boundId;
    if (['auto', 'direct', 'proxy'].indexOf(raw.proxyMode) >= 0) s.proxyMode = raw.proxyMode;
    if (raw.card && typeof raw.card === 'object') {
      Object.keys(base.card).forEach(function (k) {
        if (k === 'opts') return;
        if (raw.card[k] !== undefined && raw.card[k] !== null) s.card[k] = raw.card[k];
      });
      if (raw.card.opts && typeof raw.card.opts === 'object') {
        Object.keys(base.card.opts).forEach(function (k) {
          if (typeof raw.card.opts[k] === 'boolean') s.card.opts[k] = raw.card.opts[k];
        });
      }
    }
    return s;
  }

  var S = load();

  /* 切換帳號：換掉命名空間並重讀。登入時呼叫，之後所有讀寫都落在該帳號名下。 */
  function use(account) {
    ACCOUNT = String(account || '').toLowerCase();
    S = load();
    return S;
  }
  function account() { return ACCOUNT; }

  function save() {
    try { localStorage.setItem(keyFor(STORE_KEY), JSON.stringify(S)); }
    catch (e) { global.Stunt && global.Stunt.toast && global.Stunt.toast('本機儲存空間已滿，請清除部分資料', 'error'); }
  }

  /* ---------- API Key：獨立保管 ---------- */
  function keys() { return readJSON(keyFor(KEY_STORE)) || {}; }
  function getKey(id) { var k = keys()[id]; return typeof k === 'string' ? k : ''; }
  function setKey(id, val) {
    var k = keys();
    if (val) k[id] = val; else delete k[id];
    try { localStorage.setItem(keyFor(KEY_STORE), JSON.stringify(k)); } catch (e) {}
  }
  function clearKeys() { try { localStorage.removeItem(keyFor(KEY_STORE)); } catch (e) {} }

  function model(id) {
    var hit = S.models.filter(function (m) { return m.id === id; })[0];
    return hit || null;
  }
  function boundModel() { return S.boundId ? model(S.boundId) : null; }

  function reset() {
    try { localStorage.removeItem(keyFor(STORE_KEY)); } catch (e) {}
    clearKeys();
    S = defaults();
    return S;
  }

  function uid(prefix) {
    var a = new Uint32Array(2);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return (prefix || 'id') + '_' + a[0].toString(36) + a[1].toString(36);
  }

  global.Store = {
    get S() { return S; },
    save: save, reset: reset, uid: uid,
    use: use, account: account,
    getKey: getKey, setKey: setKey, clearKeys: clearKeys,
    model: model, boundModel: boundModel,
    MODEL_DEFS: MODEL_DEFS,
    STORE_KEY: STORE_KEY, KEY_STORE: KEY_STORE
  };
})(window);
