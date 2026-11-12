const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const launcher = path.join(__dirname, '../scripts/start-pilot-local.js');
const input = { scene: 'xueye', situation: '虚构记录演练标记甲。本周记录有一次提交延迟，拟核对。', inputRevision: 1 };
const marker = 'pilot-private-marker-wp5';
const account = (id, role, scenes) => ({ id, role, scenes, token: randomBytes(32).toString('base64url') });

function policyFile(t, revision, accounts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-school-pilot-'));
  const file = path.join(dir, 'policy.json');
  fs.writeFileSync(file, JSON.stringify({
    revision,
    accounts: accounts.map(({ token, ...row }) => ({
      ...row, tokenSha256: createHash('sha256').update(token).digest('hex'),
    })),
  }));
  t.after(() => {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(dir);
  });
  return file;
}

async function freePort() {
  const reservation = http.createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

function spawnPilot(port, file, upstream = 'http://127.0.0.1:1', entry = launcher) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env, PORT: String(port), MOCK: '0', API_BASE: upstream,
      DEEPSEEK_API_KEY: marker, LOCAL_PILOT_POLICY_FILE: file,
      LOCAL_PILOT_REHEARSAL: '',
      HTML_FILE: '家校沟通助手_演示版.html',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  const closed = once(child, 'close');
  return {
    child, closed, logs: () => logs, base: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    },
  };
}

async function startPilot(t, port, file, upstream) {
  const run = spawnPilot(port, file, upstream);
  t.after(() => run.stop());
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(run.base + '/api/health')).status === 401) return run;
    } catch {}
    if (run.child.exitCode !== null) break;
    await delay(40);
  }
  assert.fail('pilot did not start with a guarded health endpoint');
}

function credentials(user) {
  return 'Basic ' + Buffer.from(user.id + ':' + user.token).toString('base64');
}

function request(base, route, { user, body, method = body === undefined ? 'GET' : 'POST', headers } = {}) {
  return fetch(base + route, {
    method,
    headers: {
      ...(user ? { Authorization: credentials(user) } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function statusWithRawHeaders(base, route, user, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + route, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: credentials(user), 'Content-Type': 'application/json', ...headers },
    }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('local pilot authorizes pages and APIs, enforces scene and owner, and logs metadata only', async t => {
  const alpha = account('synthetic-alpha', 'counselor', ['xueye']);
  const beta = account('synthetic-beta', 'counselor', ['xueye']);
  const observer = account('synthetic-observer', 'observer', []);
  let outbound = 0;
  const upstream = http.createServer((_req, res) => { outbound++; res.end('{}'); }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const run = await startPilot(t, await freePort(), policyFile(t, 'local-v1', [alpha, beta, observer]),
    `http://127.0.0.1:${upstream.address().port}`);
  const get = (route, user, headers) => request(run.base, route, { user, headers });
  const post = (route, body, user, headers) => request(run.base, route, { user, body, headers });

  const anon = await get('/');
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('www-authenticate'), /^Basic /);
  assert.equal((await post('/api/prepare', input)).status, 401);
  assert.equal((await post('/api/draft/facts', {}, undefined, { 'X-Forwarded-User': alpha.id })).status, 401);
  assert.equal((await get('/api/health', { ...alpha, token: beta.token })).status, 401);
  assert.equal(await statusWithRawHeaders(run.base, '/api/health', alpha, { Host: 'rebound.invalid' }), 403);
  assert.equal(await statusWithRawHeaders(run.base, '/api/prepare', alpha, { Origin: 'https://outside.invalid' }, input), 403);
  assert.equal(await statusWithRawHeaders(run.base, '/api/prepare', alpha, { 'Sec-Fetch-Site': 'cross-site' }, input), 403);
  assert.equal((await post('/api/prepare', input, alpha, { 'Content-Type': 'text/plain' })).status, 415);

  const health = await (await get('/api/health', observer)).json();
  assert.deepEqual(health, {
    ok: true, mock: true, provider: 'deepseek', model: 'deepseek-flash', configured: false,
    mode: 'pilot-local', policyRevision: 'local-v1', allowedScenes: [],
  });
  assert.equal((await get('/', observer)).status, 403);
  assert.equal((await get('/assets/index.js', observer)).status, 403);
  assert.equal((await post('/api/prepare', input, observer)).status, 403);
  assert.equal((await post('/api/draft/facts', {}, observer)).status, 403);
  const workbench = await get('/', alpha);
  if (fs.existsSync(path.join(__dirname, '../dist/web/index.html'))) {
    assert.equal(workbench.status, 200);
    const asset = (await workbench.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert(asset);
    assert.equal((await get(asset)).status, 401);
    const assetResponse = await get(asset, alpha);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get('cache-control'), 'no-store');
  } else {
    assert.equal(workbench.status, 503);
  }
  assert.equal((await get('/' + encodeURIComponent('家校沟通助手_演示版.html'), alpha)).status, 404);
  assert.equal((await get('/.env', alpha)).status, 404);
  assert.equal((await get('/api/' + marker + '?detail=' + marker, alpha)).status, 404);
  assert.equal((await post('/api/prepare', { ...input, scene: 'xinli', disclosureStatus: 'confirmed' }, alpha)).status, 403);
  const prepared = await post('/api/prepare', input, alpha);
  assert.equal(prepared.status, 200);
  const requestId = prepared.headers.get('x-request-id');
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  const { data } = await prepared.json();
  assert.equal(data.status, 'ready');
  const fact = data.facts.find(item => item.eligible && item.quote.includes('提交延迟'));
  assert(fact);
  // 逐事实入稿接口已下线，受控演练不应再暴露它。
  assert.equal((await post('/api/draft/facts', { input, reviews: [{ id: fact.id }] }, alpha)).status, 404);
  assert.equal(outbound, 0);

  await run.stop();
  for (const privateValue of [input.situation, marker, alpha.id, alpha.token, beta.token]) {
    assert(!run.logs().includes(privateValue));
  }
  const rows = run.logs().split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
  const entry = rows.find(row => row.requestId === requestId);
  assert.deepEqual(Object.keys(entry).sort(),
    ['event', 'time', 'requestId', 'route', 'method', 'status', 'durationMs', 'policyRevision', 'mode', 'result'].sort());
  assert.equal(entry.route, 'prepare');
  assert.equal(entry.status, 200);
  assert.equal(entry.result, 'ready');
  assert(rows.some(row => row.route === 'other' && row.status === 404));
});

test('local rollback restores verified scene scope without restoring revoked credentials', async t => {
  const previous = account('synthetic-retired', 'counselor', ['xueye']);
  const retained = account('synthetic-retained', 'counselor', ['xueye']);
  const port = await freePort();
  const initial = await startPilot(t, port, policyFile(t, 'local-v1', [previous, retained]));
  const post = (base, route, body, user) => request(base, route, { body, user });
  const ready = await post(initial.base, '/api/prepare', input, retained);
  const { data: original } = await ready.json();
  assert.equal(original.status, 'ready');
  assert.equal((await post(initial.base, '/api/prepare', input, previous)).status, 200);
  await initial.stop();
  await assert.rejects(fetch(initial.base + '/api/health'));

  const narrowed = { ...retained, scenes: ['yiban'] };
  const changed = await startPilot(t, port, policyFile(t, 'local-v2', [narrowed]));
  assert.equal((await post(changed.base, '/api/prepare', input, previous)).status, 401);
  assert.equal((await post(changed.base, '/api/prepare', input, retained)).status, 403);
  assert.equal((await post(changed.base, '/api/prepare', { ...input, scene: 'yiban' }, retained)).status, 200);
  await changed.stop();
  await assert.rejects(fetch(changed.base + '/api/health'));

  const rollback = await startPilot(t, port, policyFile(t, 'local-v1-rollback', [retained]));
  const health = await (await request(rollback.base, '/api/health', { user: retained })).json();
  assert.equal(health.policyRevision, 'local-v1-rollback');
  assert.equal(health.mock, true);
  assert.equal((await post(rollback.base, '/api/prepare', input, previous)).status, 401);
  const restored = await (await post(rollback.base, '/api/prepare', input, retained)).json();
  assert.equal(restored.data.status, 'ready');
  assert(restored.data.draft);
  assert(restored.data.facts.length > 0);
});

test('missing or invalid local pilot policy stops startup instead of exposing demo endpoints', async t => {
  const user = account('duplicate', 'counselor', ['xueye']);
  for (const file of ['', policyFile(t, 'invalid-v1', [user, user])]) {
    const port = await freePort();
    const run = spawnPilot(port, file);
    t.after(() => run.stop());
    const [code] = await run.closed;
    assert.equal(code, 1);
    assert.match(run.logs(), /权限配置缺失或无效/);
    await assert.rejects(fetch(run.base + '/api/health'));
  }
  const direct = spawnPilot(await freePort(), policyFile(t, 'local-v1', [user]),
    undefined, path.join(__dirname, '../app/server.js'));
  t.after(() => direct.stop());
  const [code] = await direct.closed;
  assert.equal(code, 1);
  assert.match(direct.logs(), /请用受控入口启动/);
  await assert.rejects(fetch(direct.base + '/api/health'));
});
