/**
 * 家校沟通助手 · 本地服务（零依赖）
 * ------------------------------------------------------------
 * 作用：
 *   1. 把网页发出去（http://127.0.0.1:8787）
 *   2. 替网页去调 DeepSeek（key 只在这台电脑上，不会进网页）
 *   3. 调用前做脱敏、调用后做校验（诊断词、越权、危机场景）
 *
 * 启动：node server.js
 * 测试（不联网，用假数据跑通整条链路）：set MOCK=1 && node server.js
 *
 * 环境变量（都可选）：
 *   PORT           端口，默认 8787
 *   KEY_FILE       DeepSeek项目外key文件；根目录.env可配置双服务商
 *   MODEL          兼容的全局模型覆盖；优先使用各服务商的 *_MODEL 配置
 *   API_BASE       接口地址，默认 https://api.deepseek.com
 *   MOCK           =1 时不调真接口，用本地假数据
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { randomUUID } = require('node:crypto');
const { loadEnvFile, readConfig, readSourceOptions } = require('./config');
const { ModelError, requestCompletion } = require('./model-client');
const { InputError, validatePrepareInput } = require('./contracts');
const { OutputError } = require('./prepare-output');
const { prepareCommunication } = require('./prepare');
const { cardCount } = require('./knowledge');
const { loadPilotPolicy, authenticate, trustedLocalRequest } = require('./pilot-access');
const pilotMode = process.env.LOCAL_PILOT_REHEARSAL === '1';
if (!pilotMode && Object.hasOwn(process.env, 'LOCAL_PILOT_POLICY_FILE')) {
  throw new Error('已设置本地试点演练权限文件，请用受控入口启动。');
}
const pilot = pilotMode
  ? loadPilotPolicy(process.env.LOCAL_PILOT_POLICY_FILE)
  : null;
if (!pilot) loadEnvFile(path.join(__dirname, '..', '.env'));
const config = readConfig(pilot ? { PORT: process.env.PORT, MOCK: '1' } : process.env);
// 启动即校验资料选取开关，配置写错就直接报错，不要等到请求时才 500。
const sourceOptions = readSourceOptions();

const PORT = config.port;
const KEY_FILE = config.keyFile;
const MODEL = config.model;
const API_BASE = config.apiBase;
const MOCK = !!pilot || config.mock;

const ROOT = __dirname;
const HTML_FILE = process.env.HTML_FILE || "家校沟通助手_原型v3.html";
// 允许直接访问当前版本页面（防止路径穿越）
const ALLOWED_HTML = ["家校沟通助手_原型v3.html", "家校沟通助手_演示版.html"];

let API_KEY = "";
function loadKey() {
  if (config.apiKey) {
    API_KEY = config.apiKey.trim();
    return "env";
  }
  try {
    const raw = fs.readFileSync(KEY_FILE, "utf8");
    // 支持两种写法：直接放 key，或 KEY=值
    const line = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .map(s => (s.includes("=") ? s.slice(s.indexOf("=") + 1).trim() : s))
      .find(s => s.length > 10);
    if (line) { API_KEY = line; return "file"; }
  } catch (e) {
    /* 没有 key 也能起服务，只是不能真调 */
  }
  return "none";
}

function keyHint() {
  if (!API_KEY) return "未找到 key";
  return "已配置（连通性尚需验证）";
}

function send(res, code, obj, type = "application/json; charset=utf-8") {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("请求体过大")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(new InputError("请求体不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

function denyScene(res) {
  return send(res, 403, { ok: false, code: 'PILOT_SCENE_FORBIDDEN', error: '该账号未获准操作此场景。' });
}

async function prepareRoute(req, res, actor, recordResult) {
  const input = await readBody(req);
  if (actor && !actor.scenes.has(input?.scene)) return denyScene(res);
  const data = await prepareCommunication(input, {
    mock: MOCK,
    complete(messages) {
      if (!API_KEY) {
        throw new ModelError('MODEL_KEY_MISSING', '当前模型密钥未配置，请填写项目根目录 .env 并重启服务', 503);
      }
      return requestCompletion({
        apiBase: API_BASE, apiKey: API_KEY, model: MODEL, messages,
        json: true, provider: config.provider, thinking: config.thinking
      });
    }
  });
  if (data.generation) Object.assign(data.generation, { provider: config.provider, model: MODEL });
  recordResult(data.status);
  return send(res, 200, { ok: true, data });
}

const assetsPattern = /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/;
function routeLabel(pathname) {
  if (pathname === '/api/health') return 'health';
  if (pathname === '/api/prepare') return 'prepare';
  if (pathname === '/' || pathname === '/index.html') return 'workbench';
  if (assetsPattern.test(pathname)) return 'asset';
  return 'other';
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const requestId = pilot ? randomUUID() : null;
  let p = '';
  let route = 'other';
  let result = null;
  try {
    let actor;
    if (pilot) {
      res.setHeader('X-Request-Id', requestId);
      if (!trustedLocalRequest(req, PORT)) {
        return send(res, 403, { ok: false, code: 'PILOT_ORIGIN_FORBIDDEN', error: '请从本地演练地址访问。' });
      }
      actor = authenticate(pilot, req.headers.authorization);
      if (!actor) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Family School Local Rehearsal", charset="UTF-8"');
        return send(res, 401, { ok: false, code: 'PILOT_AUTH_REQUIRED', error: '请使用已获准的虚构演练账号。' });
      }
    }
    try { p = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname); }
    catch { return send(res, 400, { ok: false, error: 'bad path' }); }
    route = routeLabel(p);
    if (actor?.role === 'observer' && !(req.method === 'GET' && route === 'health')) {
      return send(res, 403, { ok: false, code: 'PILOT_ROLE_FORBIDDEN', error: '观察账号仅可查看演练健康状态。' });
    }
    if (pilot && req.method === 'POST' && route === 'prepare' &&
        req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return send(res, 415, { ok: false, code: 'PILOT_JSON_REQUIRED', error: '演练业务请求需要 JSON。' });
    }

    // 静态页
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const built = path.resolve(ROOT, '../dist/web/index.html');
      if (pilot && !fs.existsSync(built)) {
        return send(res, 503, { ok: false, code: 'PILOT_BUILD_MISSING', error: '请先构建新版工作台。' });
      }
      const html = fs.readFileSync(pilot || (!process.env.HTML_FILE && fs.existsSync(built)) ? built : path.join(ROOT, HTML_FILE), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    if (req.method === 'GET' && assetsPattern.test(p)) {
      const file = path.resolve(ROOT, '../dist/web', '.' + p);
      if (!fs.existsSync(file)) return send(res, 404, { ok: false, error: 'asset not found' });
      if (pilot) res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(file));
    }
    const base = path.basename(p);
    if (!pilot && req.method === "GET" && ALLOWED_HTML.includes(base) && p !== "/") {
      const html = fs.readFileSync(path.join(ROOT, base), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && p === "/favicon.ico") { res.writeHead(204); return res.end(); }

    // 健康检查
    if (req.method === "GET" && p === "/api/health") {
      if (pilot) {
        return send(res, 200, {
          ok: true, mock: true, provider: config.provider, model: MODEL, configured: false,
          mode: 'pilot-local', policyRevision: pilot.revision, allowedScenes: [...actor.scenes],
        });
      }
      const info = { ok: true, mock: MOCK, provider: config.provider, model: MODEL, configured: !!API_KEY, key: keyHint(), kb: cardCount, ping: null };
      return send(res, 200, info);
    }

    // 生成沟通准备
    if (req.method === "POST" && p === "/api/prepare") {
      return await prepareRoute(req, res, actor, status => { result = status; });
    }
    return send(res, 404, { ok: false, error: pilot ? "not found" : "not found: " + p });
  } catch (e) {
    if (e instanceof InputError || e instanceof ModelError) {
      return send(res, e.status, { ok: false, code: e.code, error: e.message });
    }
    if (e instanceof OutputError) {
      return send(res, e.status, { ok: false, code: e.code, error: '模型输出未通过结构或来源校验，请重试。输入与上次结果已保留。' });
    }
    if (pilot) return send(res, 500, { ok: false, code: 'PILOT_INTERNAL_ERROR', error: '本地演练请求未完成。' });
    console.error("[error]", req.method, p, e.message);
    return send(res, 500, { ok: false, error: e.message.slice(0, 300) });
  } finally {
    if (pilot) {
      console.log(JSON.stringify({
        event: 'pilot_request', time: new Date().toISOString(), requestId, route,
        method: ['GET', 'POST'].includes(req.method) ? req.method : 'OTHER',
        status: res.headersSent ? res.statusCode : null, durationMs: Date.now() - t0,
        policyRevision: pilot.revision, mode: 'offline', result,
      }));
    } else if (p.startsWith("/api/")) {
      console.log(`${req.method} ${p} ${Date.now() - t0}ms`);
    }
  }
});

const src = pilot ? 'none' : loadKey();
server.listen(PORT, "127.0.0.1", () => {
  if (pilot) {
    console.log(`本地试点演练 · http://127.0.0.1:${PORT} · 权限版本 ${pilot.revision} · 离线`);
    return;
  }
  console.log("────────────────────────────────────────────");
  console.log("  家校沟通助手 · 本地服务已启动");
  console.log("  地址：http://127.0.0.1:" + PORT);
  console.log("  模型：" + MODEL + (MOCK ? "（离线示例模式）" : ""));
  console.log("  Key ：" + keyHint() + "（来源：" + src + "）");
  console.log("  知识库：" + cardCount + " 条（kb_v3.json）");
  console.log("  资料：" + (sourceOptions.tiering ? "按权威度分级" : "不分级")
    + "，每步最多 " + (sourceOptions.maxPerMove || "不限")
    + (sourceOptions.exposeApplications ? "，发送具体做法" : ""));
  console.log("────────────────────────────────────────────");
  if (!MOCK && !API_KEY) console.log("  ⚠ 生成底稿需要配置当前服务商的密钥。");
});
