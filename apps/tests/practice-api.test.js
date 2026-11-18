const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '../..');
const endpoint = name => '/api/practice/' + name;
const control = snapshot => ({ sessionId: snapshot.sessionId, expectedVersion: snapshot.version, requestId: randomUUID() });

async function freePort() {
  const reservation = http.createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

async function startApp(t, options = {}) {
  const port = await freePort();
  const env = {
    ...process.env, PORT: String(port), MOCK: '1', PRACTICE_ENABLED: '1', ANALYSIS_ENABLED: '1',
    API_BASE: 'http://127.0.0.1:1', ...options.env,
  };
  delete env.LOCAL_PILOT_REHEARSAL;
  delete env.LOCAL_PILOT_POLICY_FILE;
  if (options.policy) env.LOCAL_PILOT_POLICY_FILE = options.policy;
  const entry = options.policy ? 'scripts/start-pilot-local.js' : 'app/server.js';
  const child = spawn(process.execPath, [path.join(root, entry)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  const closed = once(child, 'close');
  const run = {
    base: `http://127.0.0.1:${port}`, logs: () => logs,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    },
  };
  t.after(() => run.stop());
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(run.base + '/api/health');
      if (response.status === (options.policy ? 401 : 200)) return run;
    } catch {}
    if (child.exitCode !== null) break;
    await delay(40);
  }
  assert.fail('practice API service did not start: ' + logs.slice(-500));
}

function client(run, user) {
  let cookie;
  return {
    cookie: () => cookie,
    async request(name, body, headers = {}) {
      const response = await fetch(run.base + (name.startsWith('/') ? name : endpoint(name)), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(user ? { Authorization: 'Basic ' + Buffer.from(user.id + ':' + user.token).toString('base64') } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const newCookie = response.headers.getSetCookie().find(value => value.startsWith('practice_session='));
      if (newCookie) cookie = newCookie.split(';')[0];
      const payload = await response.json();
      return { response, payload };
    },
    async ok(name, body) {
      const { response, payload } = await this.request(name, body);
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(payload.ok, true);
      return payload.data;
    },
  };
}

async function firstCase(agent) {
  const catalog = await agent.ok('catalog');
  assert(catalog.cases.length >= 3);
  return catalog.cases[0];
}

test('practice catalog exposes fictional role cards and reviewable rubric; feature rollback closes every route', async t => {
  const run = await startApp(t);
  const agent = client(run);
  const healthResponse = await fetch(run.base + '/api/health');
  assert.equal((await healthResponse.json()).practiceEnabled, true);
  const catalog = await agent.ok('catalog');
  assert(catalog.cases.length >= 3);
  assert.equal(new Set(catalog.cases.map(item => item.id)).size, catalog.cases.length);
  assert.match(catalog.reviewStatus, /待.*审核/);
  assert(catalog.rubricVersion);
  assert.deepEqual(catalog.criteria.map(item => item.id).sort(), ['listening', 'facts', 'boundaries', 'collaboration', 'closure'].sort());
  for (const criterion of catalog.criteria) {
    assert.equal(criterion.anchors.length, 4);
    assert(criterion.title && criterion.description);
  }
  for (const item of catalog.cases) {
    assert.notEqual(item.scene, 'weiji');
    assert(item.title && item.objective && item.description);
    assert(item.roleCard.name && item.roleCard.relationship && item.roleCard.attitude && item.roleCard.opening);
    assert(item.roleCard.knownFacts.length > 0);
  }

  const stopped = await startApp(t, { env: { PRACTICE_ENABLED: '0' } });
  const disabled = client(stopped);
  const disabledHealth = await (await fetch(stopped.base + '/api/health')).json();
  assert.equal(disabledHealth.practiceEnabled, false);
  for (const name of ['catalog', 'start', 'turn', 'end', 'review']) {
    const result = await disabled.request(name, name === 'catalog' ? undefined : {});
    assert.equal(result.response.status, 404);
  }
  const original = await disabled.ok('/api/prepare', { scene: 'yiban', situation: '虚构学生希望与家长核对本周学习安排。', inputRevision: 0 });
  assert.equal(original.status, 'ready');
  assert.equal((await disabled.ok('/api/analyze', { scene: 'yiban', text: '学生说希望核对学习安排。', inputRevision: 0 })).status, 'review');
});

test('all three fictional cases support multiple rounds, explicit end and evidence-linked review', async t => {
  const run = await startApp(t);
  const agent = client(run);
  const catalog = await agent.ok('catalog');
  for (const item of catalog.cases.slice(0, 3)) {
    let snapshot = await agent.ok('start', { caseId: item.id, requestId: randomUUID() });
    assert.equal(snapshot.caseId, item.id);
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.version, 0);
    assert.equal(snapshot.turns.length, 1);
    assert.equal(snapshot.turns[0].role, 'parent');
    assert(snapshot.flags.some(flag => /离线/.test(flag)));
    for (const message of ['听起来您很担心，我想先听听您了解到的情况，可以吗？', '我会先核对记录与学生说法，再与您一起商量下一步。我们下次联系时确认进展，您看可以吗？']) {
      const previous = snapshot;
      snapshot = await agent.ok('turn', { ...control(snapshot), message });
      assert.equal(snapshot.status, 'active');
      assert.equal(snapshot.version, previous.version + 1);
      assert.equal(snapshot.turns.length, previous.turns.length + 2);
      assert.equal(snapshot.turns.at(-2).role, 'counselor');
      assert.equal(snapshot.turns.at(-2).content, message);
      assert.equal(snapshot.turns.at(-1).role, 'parent');
      assert(snapshot.turns.at(-1).content.trim());
      assert.equal(snapshot.review, undefined, 'turns never trigger implicit review');
    }
    const premature = await agent.request('review', control(snapshot));
    assert([400, 409].includes(premature.response.status));
    const active = snapshot;
    snapshot = await agent.ok('end', control(snapshot));
    assert.equal(snapshot.status, 'ended');
    assert.equal(snapshot.version, active.version + 1);
    assert.deepEqual(snapshot.turns, active.turns);
    assert.equal(snapshot.review, undefined, 'ending never triggers implicit review');
    const ended = snapshot;
    snapshot = await agent.ok('review', control(snapshot));
    assert.equal(snapshot.status, 'ended');
    assert.equal(snapshot.version, ended.version);
    assert.deepEqual(snapshot.turns, ended.turns);
    assert.equal(snapshot.review.rubricVersion, catalog.rubricVersion);
    assert.equal(snapshot.review.items.length, catalog.criteria.length);
    assert.deepEqual(snapshot.review.items.map(row => row.criterionId).sort(), catalog.criteria.map(row => row.id).sort());
    assert(snapshot.review.summary && snapshot.review.nextExercise);
    assert.match(JSON.stringify(snapshot.review), /离线/);
    const byId = new Map(snapshot.turns.map(turn => [turn.id, turn]));
    for (const row of snapshot.review.items) {
      assert(row.feedback && row.alternative && row.practice);
      assert(row.score === null || Number.isInteger(row.score) && row.score >= 1 && row.score <= 4);
      assert(Array.isArray(row.evidence));
      if (row.score !== null) assert(row.evidence.length > 0);
      for (const evidence of row.evidence) {
        const source = byId.get(evidence.turnId);
        assert(source && source.role === 'counselor');
        assert(evidence.quote.trim() && source.content.includes(evidence.quote));
      }
    }
    assert.equal((await agent.request('turn', { ...control(snapshot), message: '结束后追加。' })).response.status, 409);
  }
  assert.match(agent.cookie(), /^practice_session=/);
});

test('practice sessions isolate cookies and reject forged, stale and conflicting requests without duplicating turns', async t => {
  const run = await startApp(t);
  const alpha = client(run);
  const beta = client(run);
  const item = await firstCase(alpha);
  const startInput = { caseId: item.id, requestId: randomUUID() };
  const initial = await alpha.ok('start', startInput);
  assert.deepEqual(await alpha.ok('start', startInput), initial);
  const cookieResponse = await fetch(run.base + endpoint('start'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId: item.id, requestId: randomUUID() }),
  });
  assert.match(cookieResponse.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(cookieResponse.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.equal((await beta.request('turn', { ...control(initial), message: '另一会话请求。' })).response.status, 404);
  const unknown = await alpha.request('turn', { ...control(initial), sessionId: randomUUID(), message: '伪造会话。' });
  assert.equal(unknown.response.status, 409);
  assert.equal(unknown.payload.code, 'PRACTICE_EXPIRED', 'unknown or lost IDs consistently require starting again');

  const input = { ...control(initial), message: '我理解您的担心，我们先核对一下具体记录。' };
  const [first, repeat] = await Promise.all([alpha.ok('turn', input), alpha.ok('turn', input)]);
  assert.deepEqual(repeat, first);
  assert.equal(first.turns.length, initial.turns.length + 2);
  assert.deepEqual(await alpha.ok('turn', input), first);
  assert.equal((await alpha.request('turn', { ...input, message: '同一个请求编号改成另一条消息。' })).response.status, 409);
  assert.equal((await alpha.request('turn', { ...control(initial), message: '旧版本请求。' })).response.status, 409);

  const [left, right] = await Promise.all([
    alpha.request('turn', { ...control(first), message: '并发消息甲。' }),
    alpha.request('turn', { ...control(first), message: '并发消息乙。' }),
  ]);
  assert.deepEqual([left.response.status, right.response.status].sort(), [200, 409]);
  const accepted = (left.response.status === 200 ? left : right).payload.data;
  const ending = control(accepted);
  const ended = await alpha.ok('end', ending);
  assert.deepEqual(await alpha.ok('end', ending), ended);
  assert.equal(ended.turns.length, first.turns.length + 2);
});

test('practice request guards reject empty data; poor trainee answers including risk words remain reviewable', async t => {
  const run = await startApp(t);
  const agent = client(run);
  const item = await firstCase(agent);
  for (const headers of [{ Origin: 'https://outside.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await agent.request('start', { caseId: item.id, requestId: randomUUID() }, headers)).response.status, 403);
  }
  assert.equal((await agent.request('start', { caseId: item.id, requestId: randomUUID() }, { 'Content-Type': 'text/plain' })).response.status, 415);
  assert.equal((await agent.request('start', { caseId: 'unknown-fictional-case', requestId: randomUUID() })).response.status, 400);
  const initial = await agent.ok('start', { caseId: item.id, requestId: randomUUID() });
  for (const message of ['', '   ', '字'.repeat(1001), 17]) {
    assert.equal((await agent.request('turn', { ...control(initial), message })).response.status, 400);
  }
  const ended = await agent.ok('end', control(initial));
  assert.equal((await agent.request('review', control(ended))).response.status, 400);

  const active = await agent.ok('start', { caseId: item.id, requestId: randomUUID() });
  const continued = await agent.ok('turn', { ...control(active), message: '学生说不想活也别担心，我保证没事，你们家长必须听话就行。' });
  assert.equal(continued.status, 'active');
  assert.equal(continued.turns.filter(turn => turn.role === 'parent').length, 2);
  const finished = await agent.ok('end', control(continued));
  const feedback = await agent.ok('review', control(finished));
  const boundary = feedback.review.items.find(item => item.criterionId === 'boundaries');
  assert.equal(boundary.score, 1);
  assert(boundary.evidence[0].quote.includes('不想活'));
});

test('practice request logs contain phase metadata but no counselor dialogue or session cookie', async t => {
  const run = await startApp(t);
  const agent = client(run);
  const item = await firstCase(agent);
  let snapshot = await agent.ok('start', { caseId: item.id, requestId: randomUUID() });
  const marker = '虚构练习隐私标记-' + randomUUID();
  const result = await agent.request('turn', { ...control(snapshot), message: marker + '，我会先听听您的想法。' });
  assert.equal(result.response.status, 200);
  const requestId = result.response.headers.get('x-request-id');
  snapshot = result.payload.data;
  snapshot = await agent.ok('end', control(snapshot));
  await agent.ok('review', control(snapshot));
  await run.stop();
  const logs = run.logs();
  for (const privateValue of [marker, snapshot.sessionId, agent.cookie(), snapshot.turns.at(-1).content]) assert(!logs.includes(privateValue));
  const rows = logs.split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
  const row = rows.find(entry => entry.requestId === requestId);
  assert(row);
  assert.equal(row.status, 200);
  assert(row.route.includes('practice'));
  assert(!Object.hasOwn(row, 'turns') && !Object.hasOwn(row, 'message') && !Object.hasOwn(row, 'review'));
});

test('practice model adapter logs only calls made by each HTTP request, excluding replay and end', async t => {
  const upstreamRequests = [];
  const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      upstreamRequests.push({ path: req.url, body: JSON.parse(raw), authorization: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ reply: '我愿意先核对记录。' }) } }], usage,
      }));
    });
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const syntheticKey = 'synthetic-practice-adapter-key';
  const run = await startApp(t, { env: {
    MOCK: '0', AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: syntheticKey,
    DEEPSEEK_MODEL: 'synthetic-practice-model', MODEL: 'synthetic-practice-model',
    API_BASE: `http://127.0.0.1:${upstream.address().port}`,
  } });
  const agent = client(run);
  const item = await firstCase(agent);
  const started = await agent.request('start', { caseId: item.id, requestId: randomUUID() });
  assert.equal(started.response.status, 200);
  assert.equal(upstreamRequests.length, 0, 'starting uses the role card opening without a model call');
  const turnInput = { ...control(started.payload.data), message: '我理解您的担心，我们先分别核对课程记录与请假说法。' };
  const first = await agent.request('turn', turnInput);
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.data.turns.at(-1).content, '我愿意先核对记录。');
  assert.equal(first.payload.data.version, started.payload.data.version + 1);
  assert.equal(first.payload.data.generation.attempts, 1);
  assert.deepEqual(first.payload.data.generation.usage, [usage]);
  const replay = await agent.request('turn', turnInput);
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.payload.data, first.payload.data);
  assert.equal(upstreamRequests.length, 1, 'successful request replay must not call the model again');

  const second = await agent.request('turn', { ...control(first.payload.data), message: '谢谢您，我们下次联系时一起核对进展。' });
  assert.equal(second.response.status, 200, JSON.stringify(second.payload));
  assert.equal(second.payload.data.version, first.payload.data.version + 1);
  assert.equal(second.payload.data.turns.length, first.payload.data.turns.length + 2);
  const ended = await agent.request('end', control(second.payload.data));
  assert.equal(ended.response.status, 200);
  assert.equal(ended.payload.data.status, 'ended');
  assert.equal(ended.payload.data.version, second.payload.data.version + 1);
  assert.equal(upstreamRequests.length, 2, 'ending does not request either role play or review');
  for (const request of upstreamRequests) {
    assert.equal(request.path, '/chat/completions');
    assert.equal(request.authorization, 'Bearer ' + syntheticKey);
    assert.equal(request.body.model, 'synthetic-practice-model');
    assert.deepEqual(request.body.response_format, { type: 'json_object' });
  }
  await run.stop();
  const rows = run.logs().split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
  for (const [result, attempts] of [[started, 0], [first, 1], [replay, 0], [second, 1], [ended, 0]]) {
    const row = rows.find(entry => entry.requestId === result.response.headers.get('x-request-id'));
    assert(row, 'each HTTP request has a distinct metadata entry');
    assert.equal(row.mode, 'model');
    assert.equal(row.status, 200);
    assert.equal(row.attempts, attempts);
    assert.deepEqual(row.usage, attempts ? [usage] : []);
  }
  assert(!run.logs().includes(syntheticKey));
  assert(!run.logs().includes(turnInput.message));
});

function account(id, role, scenes) { return { id, role, scenes, token: randomBytes(32).toString('base64url') }; }
function policyFile(t, accounts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-school-practice-'));
  const file = path.join(dir, 'policy.json');
  fs.writeFileSync(file, JSON.stringify({ revision: 'practice-local-v1', accounts: accounts.map(({ token, ...row }) => ({ ...row, tokenSha256: createHash('sha256').update(token).digest('hex') })) }));
  t.after(() => { fs.rmSync(file, { force: true }); fs.rmdirSync(dir); });
  return file;
}

test('local pilot practice catalog and sessions honor scene, role and account scope', async t => {
  const alpha = account('practice-alpha', 'counselor', ['xueye']);
  const beta = account('practice-beta', 'counselor', ['xueye']);
  const general = account('practice-general', 'counselor', ['yiban']);
  const observer = account('practice-observer', 'observer', []);
  const run = await startApp(t, { policy: policyFile(t, [alpha, beta, general, observer]) });
  const a = client(run, alpha);
  const b = client(run, beta);
  const c = client(run, general);
  assert.equal((await client(run).request('catalog')).response.status, 401);
  assert.equal((await client(run, observer).request('catalog')).response.status, 403);
  assert.equal((await client(run, observer).request('start', {})).response.status, 403);
  const academic = await a.ok('catalog');
  assert(academic.cases.length > 0 && academic.cases.every(item => item.scene === 'xueye'));
  const generalCatalog = await c.ok('catalog');
  assert(generalCatalog.cases.length > 0 && generalCatalog.cases.every(item => item.scene === 'yiban'));
  assert.equal((await a.request('start', { caseId: generalCatalog.cases[0].id, requestId: randomUUID() })).response.status, 403);
  const started = await a.ok('start', { caseId: academic.cases[0].id, requestId: randomUUID() });
  const stolenCookie = { Cookie: a.cookie() };
  assert.equal((await b.request('turn', { ...control(started), message: '不同账号，即便获得Cookie也不可读取。' }, stolenCookie)).response.status, 404);
  assert.equal((await c.request('turn', { ...control(started), message: '未获准学业场景。' }, stolenCookie)).response.status, 404);
  assert.equal((await a.request('turn', { ...control(started), message: '我会先核对学校记录。' })).response.status, 200);
  await run.stop();
  for (const value of [alpha.id, alpha.token, beta.id, beta.token, started.sessionId]) assert(!run.logs().includes(value));
});
