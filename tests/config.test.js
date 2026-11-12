const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnvFile, readConfig, readSourceOptions, SOURCE_DEFAULTS } = require('../app/config');

test('.env loading preserves shell values, quotes and empty placeholders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-school-config-'));
  const file = path.join(dir, '.env');
  try {
    fs.writeFileSync(file, '\uFEFF# 配置\nMOCK=1\nAI_PROVIDER=qwen\nDASHSCOPE_API_KEY=\nQWEN_MODEL="test-model"\nLABEL=sample # comment\n');
    const env = { MOCK: '0' };
    assert.equal(loadEnvFile(file, env), true);
    assert.equal(env.MOCK, '0');
    assert.equal(env.DASHSCOPE_API_KEY, '');
    assert.equal(env.QWEN_MODEL, 'test-model');
    assert.equal(env.LABEL, 'sample');
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test('资料选取策略有集中默认值，非法取值启动即报错', () => {
  assert.deepEqual(readSourceOptions({}), {
    tiering: SOURCE_DEFAULTS.tiering,
    maxPerMove: SOURCE_DEFAULTS.maxPerMove,
    exposeApplications: SOURCE_DEFAULTS.exposeApplications,
  });
  assert.deepEqual(readSourceOptions({
    SOURCE_TIERING: '0', MAX_SOURCES_PER_MOVE: '0', EXPOSE_APPLICATIONS: '1',
  }), { tiering: false, maxPerMove: 0, exposeApplications: true });
  for (const word of ['1', 'true', 'yes', 'on', ' TRUE ']) {
    assert.equal(readSourceOptions({ SOURCE_TIERING: word }).tiering, true, word);
  }
  for (const word of ['0', 'false', 'no', 'off', 'OFF']) {
    assert.equal(readSourceOptions({ EXPOSE_APPLICATIONS: word }).exposeApplications, false, word);
  }
  // 留空等于没配，回落到默认值。
  assert.equal(readSourceOptions({ MAX_SOURCES_PER_MOVE: '' }).maxPerMove, SOURCE_DEFAULTS.maxPerMove);
  for (const bad of ['2', 'maybe', '  ']) {
    assert.throws(() => readSourceOptions({ SOURCE_TIERING: bad }), /SOURCE_TIERING/, bad);
    assert.throws(() => readSourceOptions({ EXPOSE_APPLICATIONS: bad }), /EXPOSE_APPLICATIONS/, bad);
  }
  for (const bad of ['-1', '1.5', 'abc', '51', '8.0x']) {
    assert.throws(() => readSourceOptions({ MAX_SOURCES_PER_MOVE: bad }), /MAX_SOURCES_PER_MOVE/, bad);
  }
});

test('provider keys and endpoints remain isolated', () => {
  const env = { AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'synthetic-qwen', DEEPSEEK_API_KEY: 'synthetic-ds' };
  const qwen = readConfig(env);
  assert.equal(qwen.apiKey, 'synthetic-qwen');
  assert.equal(qwen.model, 'qwen3.8-max-0902');
  assert.equal(qwen.thinking, false);
  assert.equal(readConfig({ ...env, QWEN_ENABLE_THINKING: 'true' }).thinking, true);
  assert.equal(readConfig({ ...env, QWEN_MODEL: 'qwen3.8-flash' }).thinking, false);
  assert.equal(readConfig({ ...env, QWEN_MODEL: 'other-qwen' }).thinking, undefined);
  const ds = readConfig({ ...env, AI_PROVIDER: 'deepseek' });
  assert.equal(ds.apiKey, 'synthetic-ds');
  assert.equal(ds.model, 'deepseek-flash');
  assert.equal(ds.apiBase, 'https://api.deepseek.com');
  assert.equal(ds.thinking, false);
  assert.equal(readConfig({ DEEPSEEK_API_KEY: 'synthetic-ds', DASHSCOPE_API_KEY: 'synthetic-qwen' }).provider, 'deepseek');
  assert.equal(readConfig({ DEEPSEEK_ENABLE_THINKING: 'true' }).thinking, true);
  assert.throws(() => readConfig({ AI_PROVIDER: 'unknown' }));
  assert.throws(() => readConfig({ PORT: 'invalid' }));
});
