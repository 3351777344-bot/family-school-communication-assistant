class ModelError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'ModelError'; this.code = code; this.status = status; }
}

function upstreamError(status, providerCode) {
  if (providerCode === 'AllocationQuota.FreeTierOnly') return new ModelError('MODEL_FREE_QUOTA_EXHAUSTED', '当前模型免费额度已耗尽，账号处于仅免费额度模式，请在服务商控制台核对额度设置', 503);
  if (status === 401) return new ModelError('MODEL_AUTH_FAILED', '模型鉴权失败，请核对所选服务商的密钥', 503);
  if (status === 403) return new ModelError('MODEL_ACCESS_DENIED', '模型访问被拒绝，请核对权限、地域和额度', 503);
  if (status === 429) return new ModelError('MODEL_RATE_LIMITED', '模型服务限流，请稍后重试', 503);
  if (status === 400 || status === 404) return new ModelError('MODEL_CONFIG_INVALID', '模型名称或请求参数不受支持，请核对配置', 503);
  return new ModelError('MODEL_UPSTREAM_FAILED', '模型服务暂不可用，请稍后重试');
}

async function requestCompletion({ apiBase, apiKey, model, messages, json = false, provider = 'qwen', thinking, maxTokens = 4096, temperature = 0.2, timeoutMs = 60000, fetchImpl = fetch }) {
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (json) body.response_format = { type: 'json_object' };
  if (thinking !== undefined) {
    if (provider === 'deepseek') body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    else body.enable_thinking = thinking;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetchImpl(apiBase.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify(body), signal: ctrl.signal
    });
    let data;
    try { data = await response.json(); }
    catch {
      if (!response.ok) throw upstreamError(response.status);
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务返回了无法读取的响应');
    }
    if (!response.ok) throw upstreamError(response.status, data?.error?.code || data?.code);
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ModelError('MODEL_OUTPUT_TRUNCATED', '模型输出达到长度上限，结果未完整返回，请调整输出预算后重试');
    if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new ModelError('MODEL_OUTPUT_EMPTY', '模型没有返回有效正文，请检查模型参数与输出预算');
    // Whitelist aggregate usage; never return upstream request text or reasoning traces.
    const usage = data.usage ? Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(key => Number.isFinite(data.usage[key])).map(key => [key, data.usage[key]])) : null;
    return { content: choice.message.content, usage, finishReason: choice.finish_reason || null };
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (error.name === 'AbortError') throw new ModelError('MODEL_TIMEOUT', '模型请求超时，输入和上次结果已保留', 504);
    throw new ModelError('MODEL_NETWORK_FAILED', '无法连接模型服务，请检查网络与接口地址');
  } finally { clearTimeout(timer); }
}

module.exports = { ModelError, upstreamError, requestCompletion };
