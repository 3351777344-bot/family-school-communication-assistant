const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { outputFixture } = require('./fixtures/prepare-output');
const cases = require('../evals/cases/communication-v1.json');

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function app(env, run) {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const childEnv = {
    ...process.env, PORT: String(port), MOCK: '0', QWEN_KEY_FILE: path.join(__dirname, 'nonexistent-key'),
    KEY_FILE: path.join(__dirname, 'nonexistent-key'), ...env,
  };
  delete childEnv.LOCAL_PILOT_POLICY_FILE;
  delete childEnv.LOCAL_PILOT_REHEARSAL;
  const child = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], {
    env: childEnv, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
      await delay(50);
    }
    assert(ready, 'local service startup');
    await run(base);
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
  }
}

test('Qwen adapter uses selected key/model and health makes no paid request', async () => {
  const bodies = [];
  const fake = http.createServer((req, res) => {
    let raw = ''; req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      bodies.push({ data: JSON.parse(raw), auth: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(outputFixture()) } }] }));
    });
  });
  const port = await listen(fake);
  try {
    await app({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'synthetic-key', QWEN_MODEL: 'test-qwen', QWEN_ENABLE_THINKING: 'false', API_BASE: `http://127.0.0.1:${port}` }, async base => {
      const health = await (await fetch(base + '/api/health')).json();
      assert.equal(health.provider, 'qwen'); assert.equal(health.configured, true);
      assert.equal(bodies.length, 0);
      assert(!JSON.stringify(health).includes('synthetic-key'));
      const response = await fetch(base + '/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: 'xueye', situation: '虚构学生联系电话13800138000，需沟通学习情况' }) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.data.steps[0], '风险上报与专业研判');
      assert.equal(result.data.generation.attempts, 1);
      assert.equal(result.data.points[0].reference.id, 'method-academic-facts');
      assert.equal(result.data.points[0].reference.reviewStatus, '待核实');
      assert.equal(result.data.inputEvidence[0].quote, '虚构学生联系电话[手机号]，需沟通学习情况');
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].data.model, 'test-qwen');
      assert.equal(bodies[0].data.enable_thinking, false);
      assert.equal(bodies[0].auth, 'Bearer synthetic-key');
      assert(!JSON.stringify(bodies[0].data).includes('13800138000'));
      assert(!JSON.stringify(bodies[0].data).includes('学业警示工作流程'));
    });
  } finally { await new Promise(resolve => fake.close(resolve)); }
});

test('quota failure is classified and does not trigger a JSON repair retry', async () => {
  let calls = 0;
  const fake = http.createServer((_req, res) => {
    calls++;
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'AllocationQuota.FreeTierOnly', message: 'private error body' } }));
  });
  const port = await listen(fake);
  try {
    await app({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'synthetic-key', API_BASE: `http://127.0.0.1:${port}` }, async base => {
      const response = await fetch(base + '/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: 'xueye', situation: '缺课' }) });
      const result = await response.json();
      assert.equal(response.status, 503); assert.equal(result.code, 'MODEL_FREE_QUOTA_EXHAUSTED');
      assert.equal(calls, 1); assert(!JSON.stringify(result).includes('private error body'));
    });
  } finally { await new Promise(resolve => fake.close(resolve)); }
});

test('main DeepSeek route uses the DeepSeek key and non-thinking request format', async () => {
  let upstream;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      upstream = { body: JSON.parse(raw), authorization: req.headers.authorization };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(outputFixture()) } }] }));
    });
  });
  const port = await listen(fake);
  try {
    await app({
      AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'synthetic-deepseek',
      DASHSCOPE_API_KEY: 'synthetic-other-provider', DEEPSEEK_MODEL: 'deepseek-flash',
      DEEPSEEK_ENABLE_THINKING: '', API_BASE: `http://127.0.0.1:${port}`
    }, async base => {
      const response = await fetch(base + '/api/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: 'xueye', situation: '虚构场景，作业未交一次，准备与家长核对。' })
      });
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.equal(data.generation.provider, 'deepseek');
      assert.equal(upstream.body.model, 'deepseek-flash');
      assert.deepEqual(upstream.body.thinking, { type: 'disabled' });
      assert.equal(Object.hasOwn(upstream.body, 'enable_thinking'), false);
      assert.equal(upstream.authorization, 'Bearer synthetic-deepseek');
    });
  } finally { await new Promise(resolve => fake.close(resolve)); }
});

test('P05 不再暂停，仍生成底稿并附保密提示；P01 正常调用上游', async () => {
  let calls = 0;
  const fake = http.createServer((req, res) => {
    calls++;
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(outputFixture('xinli')) } }] }));
  });
  const port = await listen(fake);
  try {
    await app({
      AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'synthetic-deepseek',
      DEEPSEEK_MODEL: 'deepseek-flash', API_BASE: `http://127.0.0.1:${port}`
    }, async base => {
      async function post(id, patch) {
        const response = await fetch(base + '/api/prepare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cases.find(entry => entry.id === id).input, ...patch })
        });
        assert.equal(response.status, 200);
        return (await response.json()).data;
      }
      const confidential = await post('P05', { inputRevision: 1, studentWishPreset: 'confidential' });
      assert.equal(confidential.status, 'ready');
      assert.equal(confidential.inputRevision, 1);
      assert(confidential.draft);
      assert.equal(confidential.notices.length, 1);
      assert.match(confidential.notices[0], /保密/);
      assert.equal(calls, 1);
      const ready = await post('P01', { inputRevision: 2 });
      assert.equal(ready.status, 'ready');
      assert.equal(ready.inputRevision, 2);
      assert(ready.draft);
      assert.deepEqual(ready.notices, []);
      assert.equal(calls, 2);
    });
  } finally { await new Promise(resolve => fake.close(resolve)); }
});

test('事实清单随生成一并返回，逐事实入稿接口已下线', async () => {
  await app({ MOCK: '1' }, async base => {
    const post = async (route, input) => {
      const response = await fetch(base + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
      });
      return { status: response.status, body: await response.json() };
    };
    const prepare = async (id, revision) => {
      const input = { ...cases.find(entry => entry.id === id).input, inputRevision: revision };
      const response = await post('/api/prepare', input);
      assert.equal(response.status, 200);
      return { input, result: response.body.data };
    };
    const academic = await prepare('A02', 1);
    const [record, report, goal] = academic.result.facts;
    assert.equal(record.kind, 'record');
    assert.equal(report.source, '学生自述');
    assert.equal(record.group, report.group);
    for (const fact of [record, report]) {
      const original = academic.result.inputEvidence.find(item => item.id === fact.field);
      assert.equal(original.quote.slice(fact.start, fact.end), fact.quote);
    }
    assert.equal(goal.eligible, false);
    assert(academic.result.draft);
    assert.equal(academic.result.draftContext, undefined);

    const mental = await prepare('P01', 2);
    const [observation, sleep] = mental.result.facts;
    assert.equal(observation.time, '近两周');
    assert.equal(observation.source, '观察者待核对');
    assert.equal(sleep.source, '学生自述');

    const gone = await post('/api/draft/facts', {
      input: academic.input, draftContext: 'fixture', reviews: [{ id: record.id, checked: true, disclosure: 'allowed' }]
    });
    assert.equal(gone.status, 404);

    const manual = await prepare('S01', 3);
    assert.equal(manual.result.status, 'manual_review');
    assert.equal(manual.result.draft, null);
  });
});

test('missing real key returns 503 rather than an example response', async () => {
  await app({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: '' }, async base => {
    const response = await fetch(base + '/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: 'xueye', situation: '虚构学生需要沟通学习情况' }) });
    const data = await response.json();
    assert.equal(response.status, 503); assert.equal(data.ok, false); assert.equal(data.data, undefined);
  });
});

test('manual safety branch works without a key and returns no draft', async () => {
  await app({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: '' }, async base => {
    const response = await fetch(base + '/api/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: 'xinli', situation: '虚构场景，准备联系家长', studentWish: '学生说不想活' })
    });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.crisis, true);
    assert.equal(data.draft, null);
    assert.equal(data.generation, undefined);
  });
});

test('static serving rejects secrets, traversal and malformed escapes without crashing', async () => {
  await app({ MOCK: '1' }, async base => {
    for (const route of ['/.env', '/app/config.js', '/assets/%2e%2e%5c.env', '/assets/secret.key']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
    assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const index = await (await fetch(base + '/')).text();
    if (index.includes('/assets/')) {
      const asset = index.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
      const response = await fetch(base + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
  });
});
