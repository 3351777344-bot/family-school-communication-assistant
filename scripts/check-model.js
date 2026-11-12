const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile, readConfig } = require('../app/config');
const { requestCompletion } = require('../app/model-client');
loadEnvFile(path.join(__dirname, '..', '.env'));
const provider = process.argv.find(arg => arg.startsWith('--provider='))?.split('=')[1];
const model = process.argv.find(arg => arg.startsWith('--model='))?.split('=')[1];
const config = readConfig({ ...process.env, ...(provider ? { AI_PROVIDER: provider } : {}), ...(model ? { MODEL: model } : {}) });
let key = config.apiKey.trim();
if (!key && config.keyFile && fs.existsSync(config.keyFile)) {
  key = fs.readFileSync(config.keyFile, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => line.includes('=') ? line.slice(line.indexOf('=') + 1).trim() : line).find(line => line.length > 10) || '';
}
const report = { provider: config.provider, model: config.model, configured: !!key, liveRequest: false };
async function main() {
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(report)); return; }
  if (!key) throw new Error('Selected provider key is not configured in .env');
  report.liveRequest = true;
  const result = await requestCompletion({ apiBase: config.apiBase, apiKey: key, model: config.model,
    messages: [{ role: 'user', content: 'Connectivity check with synthetic input. Return only JSON: {"ok":true}' }],
    json: true, provider: config.provider, thinking: config.thinking, maxTokens: 512 });
  const content = result.content;
  const parsed = JSON.parse(content || 'null');
  if (!parsed || parsed.ok !== true) throw new Error('Provider did not return the expected JSON; check model parameters');
  report.ok = true; report.usage = result.usage;
  console.log(JSON.stringify(report));
}
main().catch(error => {
  // Never print request headers, response bodies, environment values or credentials.
  console.error(JSON.stringify({ ...report, ok: false, code: error.code || "MODEL_PREFLIGHT_FAILED", error: error.name === 'TimeoutError' ? 'Request timed out' : error.message.replace(/sk-[\w-]+/g, '[REDACTED]') }));
  process.exitCode = 1;
});
