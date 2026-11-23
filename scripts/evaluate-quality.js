/**
 * 质量基线/对照：用真实模型生成沟通准备，再让模型按 5 项评分表打分。
 *
 * 用法：
 *   node scripts/evaluate-quality.js --label=A [--selection=order] [--budget=8] [--tiering=1]
 *                                    [--repeats=1] [--judge=1] [--report=路径] [--dry]
 *
 * 计费：每个用例 1 次生成 + 1 次评分（--judge=0 可关闭评分）。
 * 评分维度（1–5，越高越好）：事实锚定、具体性、贴合度、少空话、可直接用。
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
const flag = (name, fallback) => {
  const hit = args.find(item => item.startsWith('--' + name + '='));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const dry = args.includes('--dry');
const label = flag('label', 'A');
const repeats = Number(flag('repeats', '1'));
const judgeOn = flag('judge', '1') !== '0';
const reportFlag = flag('report', '');
const env = {
  SOURCE_SELECTION: flag('selection', 'order'),
  MAX_SOURCES_PER_MOVE: flag('budget', '8'),
  SOURCE_TIERING: flag('tiering', '1'),
  EXPOSE_APPLICATIONS: '0',
};

const DIMENSIONS = ['anchoring', 'concreteness', 'relevance', 'noFluff', 'usability'];
const DIMENSION_NAMES = {
  anchoring: '事实锚定', concreteness: '具体性', relevance: '贴合度',
  noFluff: '少空话', usability: '可直接用',
};

const RUBRIC = [
  '你是高校辅导员家校沟通培训的评分员。请只输出 JSON，不要输出其他文字。',
  '评分对象是一份“家校沟通准备”输出，包含沟通要点、给家长的底稿和追问回应。',
  '按 5 项各打 1–5 分（整数），5 最好，1 最差：',
  '1) anchoring 事实锚定：底稿里的事实、次数、时间是否都能在输入原文找到；有没有编造数字或结论。',
  '2) concreteness 具体性：要点是否落到“下一句怎么说、下一步做什么”，而不是泛泛而谈。',
  '3) relevance 贴合度：是否针对本案例的具体情况和家长反应，而不是通用建议。',
  '4) noFluff 少空话：是否避免“要重视”“多关注”“加强沟通”这类没有信息量的话；分越高空话越少。',
  '5) usability 可直接用：底稿是否像真人会说的话，辅导员能否直接照着发。',
  '同时给每项一句不超过 20 字的理由，最后给 overall 一句话总评。',
  '输出格式：{"anchoring":{"score":1-5,"note":""},"concreteness":{...},"relevance":{...},"noFluff":{...},"usability":{...},"overall":""}',
].join('\n');

function applyEnv() {
  for (const key of ['SOURCE_SELECTION', 'MAX_SOURCES_PER_MOVE', 'SOURCE_TIERING', 'EXPOSE_APPLICATIONS']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
}

async function complete(messages) {
  if (dry) {
    return { content: JSON.stringify(outputFixture('xueye')), usage: null };
  }
  return requestCompletion({
    apiBase: config.apiBase, apiKey: config.apiKey, model: config.model,
    messages, json: true, provider: config.provider, thinking: config.thinking,
  });
}

function outputForJudge(result) {
  const points = result.points.map(point => ({
    move: point.title ?? point.moveId,
    why: point.why,
    reply: point.detail?.reply,
    reference: point.reference
      ? { id: point.reference.id, title: point.reference.title, quote: point.reference.quote }
      : null,
  }));
  return {
    points,
    draft: result.draft,
    faq: result.faq,
    missingFacts: result.missingFacts,
    notices: result.notices,
  };
}

async function judgeOnce(entry, result) {
  if (!result.draft) return { skipped: true, reason: 'no_draft' };
  if (dry) {
    return Object.fromEntries(DIMENSIONS.map((dim, index) => [dim, { score: 3 + (index % 2), note: '桩' }]));
  }
  const prompt = [
    { role: 'system', content: RUBRIC },
    {
      role: 'user',
      content: JSON.stringify({
        case: { id: entry.id, input: entry.input, expected: entry.expected },
        output: outputForJudge(result),
      }),
    },
  ];
  const response = await requestCompletion({
    apiBase: config.apiBase, apiKey: config.apiKey, model: config.model,
    messages: prompt, json: true, provider: config.provider, thinking: config.thinking,
  });
  const parsed = JSON.parse(response.content);
  const scores = {};
  for (const dim of DIMENSIONS) {
    const raw = Number(parsed?.[dim]?.score);
    scores[dim] = {
      score: Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : null,
      note: typeof parsed?.[dim]?.note === 'string' ? parsed[dim].note.slice(0, 40) : '',
    };
  }
  scores.overall = typeof parsed?.overall === 'string' ? parsed.overall.slice(0, 80) : '';
  return scores;
}

async function runCase(entry) {
  const started = Date.now();
  let promptChars = 0;
  const instrumented = async messages => {
    promptChars = JSON.stringify(messages).length;
    return complete(messages);
  };
  applyEnv();
  let result;
  try {
    result = await prepareCommunication({ ...entry.input, inputRevision: 1 }, { mock: false, complete: instrumented });
  } catch (error) {
    return {
      id: entry.id, ok: false, error: error.code || error.message,
      validation: error.validation || [], promptChars, elapsedMs: Date.now() - started,
    };
  }
  const scores = judgeOn ? await judgeOnce(entry, result) : null;
  return {
    id: entry.id, ok: true, status: result.status,
    attempts: result.generation?.attempts ?? 0,
    validation: result.generation?.validation ?? [],
    usage: result.generation?.usage ?? [],
    points: result.points.map(point => ({
      move: point.moveId, title: point.title,
      source: point.reference?.id ?? null,
      kind: !point.reference ? 'none'
        : point.reference.id.startsWith('teacher-') ? 'teacher'
          : point.reference.id.startsWith('candidate-') ? 'candidate' : 'method',
    })),
    draftLength: result.draft?.length ?? 0,
    promptChars, elapsedMs: Date.now() - started,
    scores,
    raw: {
      draft: result.draft, faq: result.faq, missingFacts: result.missingFacts,
      points: result.points.map(point => ({
        move: point.moveId, title: point.title, why: point.why,
        reply: point.detail?.reply ?? null, reference: point.reference?.id ?? null,
        quote: point.reference?.quote ?? null,
      })),
    },
  };
}

function mean(values) {
  const list = values.filter(value => Number.isFinite(value));
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

function summarise(rows) {
  const ok = rows.filter(row => row.ok);
  const scored = rows.filter(row => row.scores && !row.scores.skipped);
  const dims = Object.fromEntries(DIMENSIONS.map(dim => [dim, mean(scored.map(row => row.scores[dim]?.score))]));
  const dimensionMeans = Object.values(dims).filter(value => value !== null);
  const calls = ok.filter(row => row.attempts > 0);
  return {
    runs: rows.length, ok: ok.length, failures: rows.length - ok.length,
    scored: scored.length,
    status: ok.reduce((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, {}),
    firstPassRate: calls.length ? calls.filter(row => row.attempts === 1).length / calls.length : null,
    avgPromptChars: Math.round(mean(rows.map(row => row.promptChars)) ?? 0),
    avgDraftChars: Math.round(mean(ok.map(row => row.draftLength)) ?? 0),
    dims,
    overall: mean(dimensionMeans),
    citations: ok.reduce((acc, row) => {
      for (const point of row.points) acc[point.kind] = (acc[point.kind] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function main() {
  if (!dry && !config.apiKey) throw new Error('缺少模型密钥，无法执行质量评测');
  const rows = [];
  const total = cases.length * repeats;
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const entry of cases) {
      rows.push(await runCase(entry));
      process.stdout.write('run ' + rows.length + '/' + total + '\r');
    }
  }
  process.stdout.write('\n');
  const summary = summarise(rows);
  const report = {
    experiment: 'quality', label, ranOn: new Date().toISOString(),
    provider: config.provider, model: config.model, dry, env, repeats, cases: cases.length,
    summary, rows,
  };
  const target = reportFlag || path.join(root, 'evals/runs', 'quality-' + label + '-' + Date.now() + '.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');

  const fmt = value => (value === null ? 'n/a' : value.toFixed(2));
  console.log('\n质量评分 ' + label + '（' + cases.length + ' 用例 × ' + repeats + ' 轮，' + config.model + '）');
  for (const dim of DIMENSIONS) console.log('  ' + DIMENSION_NAMES[dim] + '  ' + fmt(summary.dims[dim]));
  console.log('  综合      ' + fmt(summary.overall));
  console.log('  可用 ' + summary.ok + '/' + summary.runs + '，首次通过率 ' + (summary.firstPassRate === null ? 'n/a' : (summary.firstPassRate * 100).toFixed(1) + '%')
    + '，prompt 均值 ' + summary.avgPromptChars + '，底稿均长 ' + summary.avgDraftChars);
  console.log('  引用分布 ' + JSON.stringify(summary.citations));
  console.log('  报告：' + target);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
