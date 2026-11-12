const test = require('node:test');
const assert = require('node:assert/strict');
const { requestCompletion } = require('../app/model-client');
const options = { apiBase: 'http://127.0.0.1', apiKey: 'synthetic-key', model: 'synthetic-model', messages: [{ role: 'user', content: 'synthetic' }] };

test('quota errors expose a stable code without upstream body or credentials', async () => {
  await assert.rejects(requestCompletion({ ...options, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'AllocationQuota.FreeTierOnly', message: 'private synthetic-key' } }), { status: 403 }) }), error => error.code === 'MODEL_FREE_QUOTA_EXHAUSTED' && !error.message.includes('synthetic-key'));
});
test('truncated output is not accepted as a complete generation', async () => {
  await assert.rejects(requestCompletion({ ...options, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })) }), error => error.code === 'MODEL_OUTPUT_TRUNCATED');
});
test('only aggregate usage and final content are returned', async () => {
  const result = await requestCompletion({ ...options, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}', reasoning_content: 'private reasoning' } }], usage: { total_tokens: 12, arbitrary_field: 'private' } })) });
  assert.deepEqual(result.usage, { total_tokens: 12 });
  assert(!JSON.stringify(result).includes('private'));
});
test('timeout receives a stable recoverable UI message', async () => {
  await assert.rejects(requestCompletion({ ...options, timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })), { once: true })) }), error => error.code === 'MODEL_TIMEOUT' && error.status === 504);
});
test('DeepSeek non-thinking evaluation uses its native request parameter', async () => {
  let sent;
  await requestCompletion({
    ...options, provider: 'deepseek', thinking: false, json: true,
    fetchImpl: async (_url, { body }) => {
      sent = JSON.parse(body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
    }
  });
  assert.deepEqual(sent.thinking, { type: 'disabled' });
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.equal(Object.hasOwn(sent, 'enable_thinking'), false);
});
