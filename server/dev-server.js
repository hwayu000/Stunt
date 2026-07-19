#!/usr/bin/env node
/* ============================================================
   Stunt — 本機伺服器（選用）
   1) 靜態檔服務：讓 CSP 的 'self' 生效（file:// 無法正確套用）
   2) LLM 代理：/api/llm —— Key 只存在伺服器端 .env，不進瀏覽器
   純前端模式不需要這支；直接把整個資料夾丟到任何靜態主機即可。
   作者：Ash
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.woff2':'font/woff2',
  '.ico':  'image/x-icon'
};

/* ---- 載入 .env（不使用外部套件） ---- */
function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
loadEnv();

/* ---- 供應商設定：Key 一律從環境變數讀，絕不寫死 ---- */
const PROVIDERS = {
  deepseek: {
    env: 'DEEPSEEK_API_KEY',
    endpoint: () => 'https://api.deepseek.com/chat/completions',
    headers: k => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + k }),
    body: (model, prompt) => ({ model, messages: [{ role: 'user', content: prompt }], temperature: 1.1 }),
    pick: d => d.choices?.[0]?.message?.content
  },
  gemini: {
    env: 'GEMINI_API_KEY',
    endpoint: (model, k) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(k)}`,
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (model, prompt) => ({ contents: [{ parts: [{ text: prompt }] }] }),
    pick: d => d.candidates?.[0]?.content?.parts?.[0]?.text
  }
};

/* ---- 存取閘門 ----
   前端登入擋不住開發者工具，只能算門面；能真正擋住「別人用掉我的 API Key」
   的是這一層。代理端要求 X-Stunt-Account 落在允許的識別碼雜湊名單內。
   要換人可用 STUNT_ALLOWED 覆寫（逗號分隔的 sha256 十六進位值）。 */
const ALLOWED = String(process.env.STUNT_ALLOWED ||
  '26e252b34c087c5c5761ddd2212a11a3d9c3c7d1b4020e66af3aaef893df85fd,' +
  'd1ccc5cebf6ce8458816139ea5e8b2525bd85634271b61ec261cebf230389c62')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function accountOK(req) {
  const v = String(req.headers['x-stunt-account'] || '').trim().toLowerCase();
  return !!v && ALLOWED.includes(v);
}

function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('請求內容過大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---- /api/providers：告訴前端伺服器端備妥了哪些供應商 ---- */
function handleProviders(res) {
  const ready = Object.keys(PROVIDERS).filter(id => !!process.env[PROVIDERS[id].env]);
  json(res, 200, { proxy: true, ready });
}

/* ---- /api/llm：代理呼叫 ---- */
async function handleLLM(req, res) {
  if (!accountOK(req)) return json(res, 401, { error: '未授權的帳號' });
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return json(res, 400, { error: '請求格式錯誤' }); }

  const provider = String(payload.provider || '');
  const model = String(payload.model || '');
  const prompt = String(payload.prompt || '');

  const P = PROVIDERS[provider];
  if (!P) return json(res, 400, { error: '不支援的供應商' });
  if (!/^[\w.:\-]{1,64}$/.test(model)) return json(res, 400, { error: '模型名稱格式不正確' });
  if (!prompt || prompt.length > 60000) return json(res, 400, { error: '提示內容長度不合法' });

  const key = process.env[P.env];
  if (!key) return json(res, 503, { error: `伺服器未設定 ${P.env}` });

  try {
    const r = await fetch(P.endpoint(model, key), {
      method: 'POST',
      headers: P.headers(key),
      body: JSON.stringify(P.body(model, prompt))
    });
    const data = await r.json();
    if (!r.ok) return json(res, 502, { error: data?.error?.message || '上游服務回應錯誤' });
    const text = P.pick(data);
    if (!text) return json(res, 502, { error: '上游回應無法解析' });
    return json(res, 200, { text });
  } catch (e) {
    return json(res, 502, { error: '呼叫上游服務失敗' });
  }
}

/* ---- 靜態檔 ---- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 路徑穿越防護：解析後必須仍在 ROOT 之內
  const abs = path.resolve(ROOT, '.' + rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not Found'); }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(abs).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);
  if (pathname === '/api/providers' && req.method === 'GET')  return handleProviders(res);
  if (pathname === '/api/llm'       && req.method === 'POST') return handleLLM(req, res);
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method Not Allowed'); }
  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Stunt → http://${HOST}:${PORT}`);
  const ready = Object.keys(PROVIDERS).filter(id => !!process.env[PROVIDERS[id].env]);
  console.log(ready.length ? `代理已就緒：${ready.join(', ')}` : '代理未設定 Key（前端將改用瀏覽器直連模式）');
});
