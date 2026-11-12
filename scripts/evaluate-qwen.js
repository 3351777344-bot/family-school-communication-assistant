const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { loadEnvFile, readConfig } = require('../app/config');
const { requestCompletion } = require('../app/model-client');
const { prepareCommunication } = require('../app/prepare');
const cases = require('../evals/cases/communication-v1.json');

const flashRecheck = process.argv.includes('--flash-recheck');
const groundedPilot = process.argv.includes('--grounded-pilot');
const qualityPilot = process.argv.includes('--quality-pilot');
const deepseekQuality = process.argv.includes('--deepseek-quality');
const provider = deepseekQuality ? 'deepseek' : 'qwen';
const models = deepseekQuality ? ['deepseek-flash', 'deepseek-v4-pro'] :
  flashRecheck ? ['qwen3.8-flash'] : ['qwen3.8-flash', 'qwen3.8-max-0902'];
const live = process.argv.includes('--live');
const holdoutIds = ['A02', 'A03', 'P02', 'G03', 'M02'];
const qualityIds = ['A01', 'A05', 'P01', 'P05', 'G01', 'G04', 'M01', 'M03'];
const pilot = cases.filter(entry => qualityPilot || deepseekQuality ? qualityIds.includes(entry.id) :
  groundedPilot ? holdoutIds.includes(entry.id) : entry.pilot);
const local = cases.filter(entry => entry.local);
const purpose = deepseekQuality ? 'deepseek-quality' : qualityPilot ? 'quality-pilot' :
  groundedPilot ? 'grounded-pilot' : flashRecheck ? 'flash-recheck' : 'paired-pilot';
const report = { suite: 'communication-v1', purpose, provider, live, thinking: false, results: [] };
const reportPath = path.join(__dirname, '../evals/runs', provider + '-pilot-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');

function record(row) {
  report.results.push(row);
  const { data, ...summary } = row;
  console.log(JSON.stringify(summary));
  if (live) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
}

async function evaluate(entry, model, config) {
  const started = performance.now();
  const calls = [];
  const base = { caseId: entry.id, model, calls };
  try {
    const data = await prepareCommunication(entry.input, {
      async complete(messages) {
        if (!model) throw new Error('LOCAL_CASE_CALLED_MODEL');
        const call = { usage: null };
        calls.push(call);
        const result = await requestCompletion({
          apiBase: config.apiBase, apiKey: config.apiKey, model, provider,
          json: true, thinking: false, messages
        });
        call.usage = result.usage;
        return result;
      }
    });
    record({ ...base, ok: true, latencyMs: Math.round(performance.now() - started), data });
    return true;
  } catch (error) {
    record({
      ...base, ok: false, latencyMs: Math.round(performance.now() - started),
      code: error.code || 'EVAL_FAILED', validation: error.validation || []
    });
    return error.code === 'MODEL_OUTPUT_INVALID';
  }
}

async function main() {
  for (const entry of local) {
    if (!await evaluate(entry, null, {})) throw new Error('人工核实分支评测失败');
  }
  if (!live) {
    console.log(JSON.stringify({ models, pilot: pilot.map(entry => entry.id), maxRequests: pilot.length * models.length * 2 }));
    return;
  }

  const env = { ...process.env, AI_PROVIDER: provider };
  loadEnvFile(path.join(__dirname, '../.env'), env);
  const config = readConfig(env);
  if (!config.apiKey.trim()) throw new Error('缺少评测服务商的密钥');
  const officialBase = deepseekQuality ? 'https://api.deepseek.com' : 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (config.apiBase.replace(/\/$/, '') !== officialBase) {
    throw new Error('评测使用服务商官方端点，当前配置不匹配');
  }
  for (const entry of pilot) {
    for (const model of models) {
      if (!await evaluate(entry, model, config)) {
        console.log(JSON.stringify({ stopped: true, reportPath }));
        process.exitCode = 1;
        return;
      }
    }
  }
  console.log(JSON.stringify({ reportPath }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
