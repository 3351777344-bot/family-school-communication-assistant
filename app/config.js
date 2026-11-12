const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const DEFAULT_QWEN_MODEL = 'qwen3.8-max-0902';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
const EVALUATED_QWEN_MODELS = [DEFAULT_QWEN_MODEL, 'qwen3.8-flash'];
const EVALUATED_DEEPSEEK_MODELS = [DEFAULT_DEEPSEEK_MODEL, 'deepseek-v4-pro'];

// No interpolation or execution: .env is data, and shell variables take precedence.
function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    env[match[1]] = value;
  }
  return true;
}

function readConfig(env = process.env) {
  const provider = env.AI_PROVIDER || 'deepseek';
  if (!['qwen', 'deepseek'].includes(provider)) throw new Error('AI_PROVIDER must be qwen or deepseek');
  const qwen = provider === 'qwen';
  const model = env.MODEL || (qwen ? env.QWEN_MODEL || DEFAULT_QWEN_MODEL : env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL);
  const thinkingSetting = qwen ? env.QWEN_ENABLE_THINKING : env.DEEPSEEK_ENABLE_THINKING;
  const evaluatedModels = qwen ? EVALUATED_QWEN_MODELS : EVALUATED_DEEPSEEK_MODELS;
  let thinking;
  if (['true', 'false'].includes(thinkingSetting)) {
    thinking = thinkingSetting === 'true';
  } else if (evaluatedModels.includes(model)) {
    thinking = false;
  }
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  return {
    provider, port, mock: env.MOCK === '1',
    model,
    apiBase: env.API_BASE || (qwen ? env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1' : env.DEEPSEEK_API_BASE || 'https://api.deepseek.com'),
    apiKey: (qwen ? env.DASHSCOPE_API_KEY : env.DEEPSEEK_API_KEY) || '',
    keyFile: qwen ? env.QWEN_KEY_FILE || '' : env.KEY_FILE || path.join(os.homedir(), '.family-school-communication-assistant', 'api.txt'),
    thinking
  };
}

// 资料选取策略的默认值。改动这里等于改产品行为，需同步 README 与对照实验基线。
const SOURCE_DEFAULTS = Object.freeze({
  tiering: true,        // 候选卡只在没有已审资料覆盖该步骤时出现
  maxPerMove: 8,        // 每个步骤最多给模型几个候选资料；0 表示不限
  exposeApplications: false // 是否把卡片的具体做法一并发给模型（对照实验证伪，默认关）
});
const TRUE_WORDS = ['1', 'true', 'yes', 'on'];
const FALSE_WORDS = ['0', 'false', 'no', 'off'];

function readFlag(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.includes(value)) return true;
  if (FALSE_WORDS.includes(value)) return false;
  throw new Error(name + ' must be one of ' + TRUE_WORDS.join('/') + ' or ' + FALSE_WORDS.join('/'));
}

// 集中定义名称、默认值和取值范围；运行时读取，便于对照实验在同一进程内切换。
function readSourceOptions(env = process.env) {
  let maxPerMove = SOURCE_DEFAULTS.maxPerMove;
  const rawCap = env.MAX_SOURCES_PER_MOVE;
  if (rawCap !== undefined && rawCap !== '') {
    const parsed = Number(rawCap);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 50) {
      throw new Error('MAX_SOURCES_PER_MOVE must be an integer between 0 and 50');
    }
    maxPerMove = parsed;
  }
  return {
    tiering: readFlag(env, 'SOURCE_TIERING', SOURCE_DEFAULTS.tiering),
    maxPerMove,
    exposeApplications: readFlag(env, 'EXPOSE_APPLICATIONS', SOURCE_DEFAULTS.exposeApplications)
  };
}

module.exports = { loadEnvFile, readConfig, readSourceOptions, SOURCE_DEFAULTS };
