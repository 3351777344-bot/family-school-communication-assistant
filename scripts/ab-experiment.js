/**
 * 同题对照实验：只切换一个变量，其余完全一致，比较资料引用的分布和稳定性。
 *
 * 用法：node scripts/ab-experiment.js --variable=sources   [--repeats=2] [--report=路径] [--dry]
 *       node scripts/ab-experiment.js --variable=applications
 *
 * sources      A 不分级不限量（改动前）  B 权威度分级 + 每步上限 8
 * applications A 不发具体做法            B 额外发 applications
 *
 * 会产生真实模型费用；--dry 用固定桩跑通流程。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { loadEnvFile, readConfig } = require(path.join(root, 'app/config'));
loadEnvFile(path.join(root, '.env'));
const config = readConfig(process.env);
const { requestCompletion } = require(path.join(root, 'app/model-client'));
const { prepareCommunication } = require(path.join(root, 'app/prepare'));
const { outputFixture } = require(path.join(root, 'tests/fixtures/prepare-output'));
const cases = require(path.join(root, 'evals/cases/communication-v1.json'));

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const repeats = Number((args.find(a => a.startsWith('--repeats=')) || '--repeats=2').split('=')[1]);
const reportFlag = args.find(a => a.startsWith('--report='));
const variable = (args.find(a => a.startsWith('--variable=')) || '--variable=sources').split('=')[1];

const VARIABLES = {
  sources: {
    label: '资料分级与每步上限',
    A: { label: '不分级不限量', env: { SOURCE_TIERING: '0', MAX_SOURCES_PER_MOVE: '0' } },
    B: { label: '分级 + 上限 8', env: { SOURCE_TIERING: '1', MAX_SOURCES_PER_MOVE: '8' } },
  },
  applications: {
    label: '是否向模型发送具体做法',
    A: { label: '只发原文', env: { EXPOSE_APPLICATIONS: '0' } },
    B: { label: '额外发具体做法', env: { EXPOSE_APPLICATIONS: '1' } },
  },
};
const config0 = VARIABLES[variable];
if (!config0) throw new Error('未知变量：' + variable);

const kindOf = id => (!id ? 'none'
  : id.startsWith('teacher-') ? 'teacher'
    : id.startsWith('candidate-') ? 'candidate' : 'method');

function applyEnv(env) {
  for (const key of ['SOURCE_TIERING', 'MAX_SOURCES_PER_MOVE', 'EXPOSE_APPLICATIONS']) delete process.env[key];
  Object.assign(process.env, env);
}

async function runOnce(input) {
  const started = Date.now();
  let promptChars = 0;
  try {
    const complete = dry
      ? async messages => {
        promptChars = JSON.stringify(messages).length;
        return { content: JSON.stringify(outputFixture(input.scene)), usage: null };
      }
      : async messages => {
        promptChars = JSON.stringify(messages).length;
        return requestCompletion({
          apiBase: config.apiBase, apiKey: config.apiKey, model: config.model,
          messages, json: true, provider: config.provider, thinking: config.thinking,
        });
      };
    const data = await prepareCommunication(input, { complete });
    return {
      ok: true, status: data.status,
      attempts: data.generation ? data.generation.attempts : 0,
      validation: data.generation ? data.generation.validation : [],
      points: data.points.map(point => ({
        move: point.moveId, source: point.reference?.id ?? null, kind: kindOf(point.reference?.id),
      })),
      promptChars, draftLength: data.draft ? data.draft.length : 0,
      elapsedMs: Date.now() - started, usage: data.generation?.usage?.at(-1) ?? null,
    };
  } catch (error) {
    return {
      ok: false, error: error.code || 'UNEXPECTED', status: null, attempts: 2,
      validation: error.validation || [], points: [], promptChars,
      draftLength: 0, elapsedMs: Date.now() - started, usage: null,
    };
  }
}

function summarise(runs) {
  const tally = { teacher: 0, candidate: 0, method: 0, none: 0 };
  const status = { ready: 0, needs_information: 0, manual_review: 0 };
  let points = 0, calls = 0, firstPass = 0, failures = 0, cited = 0, promptChars = 0, drafts = 0, draftChars = 0;
  for (const run of runs) {
    promptChars += run.promptChars;
    if (!run.ok) { failures++; continue; }
    status[run.status] = (status[run.status] ?? 0) + 1;
    if (run.attempts > 0) { calls++; if (run.attempts === 1) firstPass++; }
    if (run.draftLength) { drafts++; draftChars += run.draftLength; }
    for (const point of run.points) {
      points++;
      tally[point.kind]++;
      if (point.source) cited++;
    }
  }
  const share = value => (points ? value / points : 0);
  return {
    runs: runs.length, failures, calls, firstPass, points, cited,
    firstPassRate: calls ? firstPass / calls : null,
    usable: runs.length - failures,
    avgPromptChars: runs.length ? Math.round(promptChars / runs.length) : 0,
    avgDraftChars: drafts ? Math.round(draftChars / drafts) : 0,
    status, tally,
    share: {
      teacher: share(tally.teacher), candidate: share(tally.candidate),
      method: share(tally.method), none: share(tally.none),
    },
  };
}

function aggregate(rows, arm) {
  const out = {
    runs: 0, failures: 0, calls: 0, firstPass: 0, points: 0, cited: 0, usable: 0,
    tally: { teacher: 0, candidate: 0, method: 0, none: 0 },
    status: { ready: 0, needs_information: 0, manual_review: 0 },
    promptChars: 0, draftChars: 0, drafts: 0,
  };
  for (const row of rows) {
    const item = row[arm];
    Object.assign(out, {
      runs: out.runs + item.runs, failures: out.failures + item.failures,
      calls: out.calls + item.calls, firstPass: out.firstPass + item.firstPass,
      points: out.points + item.points, cited: out.cited + item.cited,
      usable: out.usable + item.usable,
      promptChars: out.promptChars + item.avgPromptChars * item.runs,
      draftChars: out.draftChars + item.avgDraftChars * (item.runs - item.failures),
      drafts: out.drafts + (item.runs - item.failures),
    });
    for (const key of Object.keys(out.tally)) out.tally[key] += item.tally[key];
    for (const key of Object.keys(out.status)) out.status[key] += item.status[key] ?? 0;
  }
  const share = value => (out.points ? value / out.points : 0);
  return {
    ...out,
    firstPassRate: out.calls ? out.firstPass / out.calls : null,
    avgPromptChars: out.runs ? Math.round(out.promptChars / out.runs) : 0,
    avgDraftChars: out.drafts ? Math.round(out.draftChars / out.drafts) : 0,
    share: {
      teacher: share(out.tally.teacher), candidate: share(out.tally.candidate),
      method: share(out.tally.method), none: share(out.tally.none),
    },
  };
}

// 按用例配对的 bootstrap：重复抽样用例，估计占比差值的稳定性。
function pairedBootstrap(pairs, field, rounds = 5000) {
  if (!pairs.length) return null;
  const stats = [];
  for (let round = 0; round < rounds; round++) {
    let aHits = 0, bHits = 0, aPoints = 0, bPoints = 0;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[Math.floor(Math.random() * pairs.length)];
      aHits += pair.A.tally[field]; aPoints += pair.A.points;
      bHits += pair.B.tally[field]; bPoints += pair.B.points;
    }
    if (aPoints && bPoints) stats.push(bHits / bPoints - aHits / aPoints);
  }
  stats.sort((x, y) => x - y);
  const at = q => stats[Math.floor(q * (stats.length - 1))];
  return { mean: stats.reduce((sum, v) => sum + v, 0) / stats.length, low: at(0.025), high: at(0.975) };
}

async function main() {
  if (!dry && !config.apiKey) throw new Error('缺少模型密钥，无法执行对照实验');
  const perCase = [];
  const total = cases.length * repeats * 2;
  let done = 0;
  for (const [caseIndex, entry] of cases.entries()) {
    const runs = { A: [], B: [] };
    for (let repeat = 0; repeat < repeats; repeat++) {
      const order = (caseIndex + repeat) % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
      for (const arm of order) {
        applyEnv(config0[arm].env);
        runs[arm].push(await runOnce({ ...entry.input, inputRevision: 1 }));
        done++;
        process.stdout.write(arm + ':' + entry.id + ' ' + done + '/' + total + '\r');
      }
    }
    perCase.push({ id: entry.id, A: summarise(runs.A), B: summarise(runs.B) });
  }
  applyEnv({});
  process.stdout.write('\n');

  const allA = aggregate(perCase, 'A');
  const allB = aggregate(perCase, 'B');
  const report = {
    experiment: 'variable:' + variable, variableLabel: config0.label,
    ranOn: new Date().toISOString(), model: config.model, provider: config.provider,
    dry, repeats, cases: cases.length,
    armA: { description: config0.A.label, env: config0.A.env, ...allA },
    armB: { description: config0.B.label, env: config0.B.env, ...allB },
    paired: Object.fromEntries(['teacher', 'candidate', 'method', 'none']
      .map(field => [field, pairedBootstrap(perCase, field)])),
    perCase,
  };
  const target = reportFlag ? reportFlag.slice('--report='.length)
    : path.join(root, 'evals/runs/ab-' + variable + '.json');
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');

  const pct = value => (value === null ? 'n/a' : (value * 100).toFixed(1) + '%');
  const row = (label, a, b) => console.log(
    label.padEnd(14), pct(a).padStart(9), pct(b).padStart(9),
    a !== null && b !== null ? ((b - a) * 100).toFixed(1).padStart(8) + 'pp' : '');

  console.log('\n' + config0.label + '（' + cases.length + ' 用例 × ' + repeats + ' 轮 × 2 组）');
  console.log('指标'.padEnd(14), ('A ' + config0.A.label).padStart(9), ('B ' + config0.B.label).padStart(9), '差值'.padStart(10));
  row('课件卡占比', allA.share.teacher, allB.share.teacher);
  row('候选卡占比', allA.share.candidate, allB.share.candidate);
  row('通用方法卡占比', allA.share.method, allB.share.method);
  row('无引用占比', allA.share.none, allB.share.none);
  row('首次通过率', allA.firstPassRate, allB.firstPassRate);
  console.log('\n可用结果', allA.usable + '/' + allA.runs, 'vs', allB.usable + '/' + allB.runs,
    '| 要点数', allA.points, 'vs', allB.points,
    '| prompt 均值', allA.avgPromptChars, 'vs', allB.avgPromptChars,
    '| 底稿均长', allA.avgDraftChars, 'vs', allB.avgDraftChars);
  for (const field of ['teacher', 'candidate', 'method']) {
    const p = report.paired[field];
    if (p) console.log('  ' + field + ' 差值 95% 区间: [' + (p.low * 100).toFixed(1) + ', ' + (p.high * 100).toFixed(1) + ']');
  }
  console.log('报告：' + target);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
