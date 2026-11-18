const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalysisWorkflow } = require('../../app/analysis');
const frozen = require('../../evals/cases/analysis-v1.json');
const { outputFixture } = require('./fixtures/prepare-output');

const owner = 'synthetic-session-a';
const sample = frozen.cases.find(row => row.id === 'MA01');
const input = (patch = {}) => ({ text: sample.text, scene: sample.scene, inputRevision: 1, ...patch });
const reviews = (analysis, choose = () => true) => analysis.items.map(item => ({
  id: item.id, reviewStatus: choose(item) ? 'confirmed' : 'pending', disclosable: choose(item),
}));
const request = (analysis, selected = reviews(analysis), patch = {}) => ({
  analysisId: analysis.analysisId, inputRevision: analysis.inputRevision, scene: sample.scene,
  reviews: selected, ...patch,
});
const status = code => error => error.status === code;
const completion = value => ({ content: JSON.stringify(value), usage: null });

test('分析保留有效原文位置、各方归属，默认不核对也不披露', async () => {
  const flow = createAnalysisWorkflow({ mock: true });
  const result = await flow.analyze(input(), owner);
  assert.equal(result.status, 'review');
  assert.equal(result.inputRevision, 1);
  assert(result.analysisId);
  assert(result.items.length >= 3);
  for (const item of result.items) {
    assert.equal(sample.text.slice(item.start, item.end), item.quote);
    assert.equal(item.reviewStatus, 'pending');
    assert.equal(item.disclosable, false);
    assert(item.source);
  }
  assert(result.items.some(item => item.kind === 'record'));
  assert(result.items.some(item => /学生/.test(item.source)));
  assert(result.items.some(item => /家长/.test(item.source)));
  assert(result.flags.length, 'offline mode must be visible');
});

test('只允许已核对且获准的条目进入底稿，未选内容不出现在任何个案结果中', async () => {
  const flow = createAnalysisWorkflow({ mock: true });
  const analysis = await flow.analyze(input(), owner);
  const allowed = analysis.items.filter(item => item.kind === 'record');
  const result = await flow.prepare(request(analysis, reviews(analysis, item => item.kind === 'record')), owner);
  assert.equal(result.status, 'ready');
  assert(result.draft.includes(allowed[0].quote));
  const caseResult = {
    ...result,
    // 通用资料的标题和摘录可以包含与个案相同的词，核对范围是本次个案内容。
    points: result.points.map(({ reference, ...point }) => point),
  };
  for (const forbidden of sample.mustExclude) assert(!JSON.stringify(caseResult).includes(forbidden), forbidden);
  assert.equal(result.approvedItems.length, allowed.length);
  assert(result.flags.length);
});

test('无获准条目、只勾披露未核对、伪造条目编号均拒绝', async () => {
  const flow = createAnalysisWorkflow({ mock: true });
  const analysis = await flow.analyze(input(), owner);
  await assert.rejects(flow.prepare(request(analysis, []), owner), status(400));
  await assert.rejects(flow.prepare(request(analysis, analysis.items.map(item => ({
    id: item.id, reviewStatus: 'pending', disclosable: true,
  }))), owner), status(400));
  await assert.rejects(flow.prepare(request(analysis, [{ id: 'forged-id', reviewStatus: 'confirmed', disclosable: true }]), owner), status(400));
});

test('会话、版本与TTL在服务端隔离；新版本使旧分析失效', async () => {
  let now = 1000;
  const flow = createAnalysisWorkflow({ mock: true, ttlMs: 100, now: () => now });
  const analysis = await flow.analyze(input(), owner);
  await assert.rejects(flow.prepare(request(analysis), 'synthetic-session-b'), status(404));
  await assert.rejects(flow.prepare(request(analysis, undefined, { inputRevision: 2 }), owner), status(409));
  await assert.rejects(flow.analyze(input({ text: sample.text + '新记录。' }), owner), status(409));
  const newer = await flow.analyze(input({ inputRevision: 2 }), owner);
  await assert.rejects(flow.prepare(request(analysis), owner), status(409));
  now += 101;
  await assert.rejects(flow.prepare(request(newer), owner), status(409));
});

test('否定和不确定语气保留原文，不把家长判断改成学生事实', async () => {
  const flow = createAnalysisWorkflow({ mock: true });
  for (const id of ['MA02', 'MA03']) {
    const row = frozen.cases.find(entry => entry.id === id);
    const analysis = await flow.analyze(input({ text: row.text, scene: row.scene }), id);
    assert(analysis.items.some(item => row.text.slice(item.start, item.end) === item.quote));
    const first = analysis.items[0];
    const result = await flow.prepare(request(analysis, reviews(analysis, item => item.id === first.id), { scene: row.scene }), id);
    assert(result.draft.includes(first.quote));
    for (const forbidden of row.mustExclude) assert(!result.draft.includes(forbidden));
  }
});

test('同句逗号连接的学生陈述与家长判断分别定位和归属', async () => {
  const text = '学生说没有缺课，家长认为只是贪玩。';
  const flow = createAnalysisWorkflow({ mock: true });
  const analysis = await flow.analyze(input({ text }), owner);
  assert.equal(analysis.items.length, 2);
  const [student, parent] = analysis.items;
  assert.equal(student.quote, '学生说没有缺课');
  assert.equal(student.source, '学生自述');
  assert.equal(student.kind, 'report');
  assert.equal(parent.quote, '家长认为只是贪玩。');
  assert.equal(parent.source, '家长判断');
  assert.equal(parent.kind, 'speculation');
  for (const item of analysis.items) assert.equal(text.slice(item.start, item.end), item.quote);
  const result = await flow.prepare(request(analysis, reviews(analysis, item => item.id === student.id)), owner);
  assert(result.draft.includes('学生说没有缺课'));
  assert(!result.draft.includes('贪玩'));
  assert(!JSON.stringify(result.approvedItems).includes('家长判断'));
});

test('导入来源标签归入后续条目并保留正文位置，不把来源标签当事实', async () => {
  const firstLabel = '虚构记录.pdf · 第1页';
  const secondLabel = '虚构表格.xlsx · 课程记录 · 第2行';
  const text = `【导入来源：${firstLabel}】\n课程平台显示本周缺课两次。\n学生说其中一次请过假。\n【导入来源：${secondLabel}】\n家长认为只是贪玩。`;
  const flow = createAnalysisWorkflow({ mock: true });
  const analysis = await flow.analyze(input({ text }), owner);
  assert.equal(analysis.items.length, 3);
  for (const [index, item] of analysis.items.entries()) {
    assert.equal(text.slice(item.start, item.end), item.quote);
    assert(!item.quote.includes('【导入来源：'));
    assert(item.source.includes(index < 2 ? firstLabel : secondLabel));
  }
  assert(analysis.items[1].source.includes('学生'));
  assert(analysis.items[2].source.includes('家长'));
});

test('人工补充向模型交接时明确原来源，本地仍可追溯原quote及位置', async () => {
  let generationContext;
  const flow = createAnalysisWorkflow({ mock: false, async complete(messages) {
    const context = JSON.parse(messages[1].content);
    if (context.candidates) return completion({ items: [], questions: [], conflicts: [] });
    generationContext = context;
    const output = outputFixture();
    output.draft = '家长您好。想和您核对一下本次沟通的情况。' + context.approvedItems.map(item => item.quote).join('\n') +
      '您了解到的情况是怎样的？我们可以先核对记录，再共同商量后续支持方式。';
    return completion(output);
  } });
  const analysis = await flow.analyze(input(), owner);
  const original = analysis.items[0];
  const selected = reviews(analysis, item => item.id === original.id);
  const correction = '记录仍需向任课老师进一步核对。';
  selected[0].correction = correction;
  const result = await flow.prepare(request(analysis, selected), owner);
  const expectedQuote = `辅导员人工补充（原来源：${original.source}）：${correction}`;
  assert.equal(generationContext.approvedItems[0].quote, expectedQuote);
  assert.equal(generationContext.evidence[0].quote, expectedQuote);
  const approved = result.approvedItems[0];
  assert.equal(approved.quote, original.quote);
  assert.equal(sample.text.slice(approved.start, approved.end), original.quote);
  assert.equal(approved.correction, correction);
  assert.equal(approved.source, `人工补充（原来源：${original.source}）`);
  assert(result.draft.includes(expectedQuote));
});

test('危机提醒先于模型，分析和人工更正的生成入口共用规则', async () => {
  let calls = 0;
  const flow = createAnalysisWorkflow({ mock: false, complete() { calls++; throw Error('must not call'); } });
  const analysis = await flow.analyze(input({ text: '学生说不想活。' }), owner);
  assert.equal(analysis.status, 'manual_review');
  assert.equal(calls, 0);
  const mock = createAnalysisWorkflow({ mock: true });
  const safe = await mock.analyze(input(), owner);
  const reviewed = reviews(safe, item => item.id === safe.items[0].id);
  reviewed[0].correction = '学生说不想活。';
  const blocked = await mock.prepare(request(safe, reviewed), owner);
  assert.equal(blocked.status, 'manual_review');
  assert.equal(blocked.draft, null);
});

test('分析模型仅收到脱敏候选，生成模型仅收到允许入稿内容和编号', async () => {
  const prompts = [];
  const flow = createAnalysisWorkflow({ mock: false, async complete(messages) {
    prompts.push(structuredClone(messages));
    const context = JSON.parse(messages[1].content);
    if (context.candidates) return completion({ items: [], questions: [], conflicts: [] });
    const output = outputFixture();
    output.draft = '家长您好。想和您核对一下本次沟通的情况。' + context.approvedItems.map(item => item.quote).join('\n') +
      '您了解到的情况是怎样的？我们可以先核对记录，再共同商量后续支持方式。您看什么时候方便联系？';
    return completion(output);
  } });
  const text = '【导入来源：虚构记录13800138000.pdf · 第1页】\n' + sample.text + '学生联系电话13800138000。';
  const analysis = await flow.analyze(input({ text }), owner);
  assert(analysis.items[0].source.includes('13800138000'), 'local source remains traceable to the input');
  const result = await flow.prepare(request(analysis, reviews(analysis, item => item.kind === 'record')), owner);
  assert(!JSON.stringify(prompts[0]).includes('13800138000'));
  assert(JSON.stringify(prompts[0]).includes('[手机号]'));
  const analysisContext = JSON.parse(prompts[0][1].content);
  assert(analysisContext.candidates[0].source.includes('[手机号]'), 'model-facing source label must also be redacted');
  const generation = prompts[1][1].content;
  for (const privateText of ['学生说其中一次请过假。', '家长认为只是贪玩。', '13800138000']) assert(!generation.includes(privateText));
  assert(generation.includes(analysis.items[0].id));
  assert(result.draft.includes(analysis.items[0].quote));
  assert.equal(result.generation.attempts, 1);
});

test('人工补充与原文来源分别保留；模型丢失归属或添加日期原因时拒绝并只修复一次', async () => {
  const mock = createAnalysisWorkflow({ mock: true });
  const source = await mock.analyze(input(), owner);
  const selected = reviews(source, item => item.id === source.items[0].id);
  selected[0].correction = '辅导员已核对课程记录，仍需向任课老师确认。';
  const supplemented = await mock.prepare(request(source, selected), owner);
  assert.equal(supplemented.approvedItems[0].quote, source.items[0].quote);
  assert.match(supplemented.approvedItems[0].source, /人工补充/);
  assert(supplemented.draft.includes(selected[0].correction));

  for (const invalid of [quote => quote.replace('课程平台显示', ''), quote => quote + '昨天因为贪玩导致缺课。']) {
    let generationCalls = 0;
    const flow = createAnalysisWorkflow({ mock: false, async complete(messages) {
      const context = JSON.parse(messages[1].content);
      if (context.candidates) return completion({ items: [], questions: [], conflicts: [] });
      generationCalls++;
      const output = outputFixture();
      output.draft = '家长您好。想和您核对一下本次沟通的情况。' + invalid(context.approvedItems[0].quote) +
        '您了解到的情况是怎样的？我们可以先核对记录，再共同商量后续支持方式。';
      return completion(output);
    } });
    const analysis = await flow.analyze(input(), owner);
    await assert.rejects(flow.prepare(request(analysis, reviews(analysis, item => item.kind === 'record')), owner));
    assert.equal(generationCalls, 2);
  }
});

test('无效来源结构最多修复一次；网络错误不伪装成示例且可重试', async () => {
  let calls = 0;
  const valid = { items: [], questions: [], conflicts: [] };
  const flow = createAnalysisWorkflow({ mock: false, async complete() {
    calls++;
    return completion(calls === 1 ? { ...valid, items: [{ id: 'invented-source' }] } : valid);
  } });
  const analysis = await flow.analyze(input(), owner);
  assert.equal(calls, 2);
  assert(analysis.items.length >= 3);
  let failed = true;
  const network = createAnalysisWorkflow({ mock: false, async complete() {
    if (failed) throw Object.assign(Error('synthetic timeout'), { code: 'MODEL_TIMEOUT', status: 504 });
    return completion(valid);
  } });
  await assert.rejects(network.analyze(input(), owner), error => error.code === 'MODEL_TIMEOUT');
  failed = false;
  assert.equal((await network.analyze(input(), owner)).status, 'review');
  let attempts = 0;
  const broken = createAnalysisWorkflow({ mock: false, async complete() {
    attempts++; return completion({ items: [{ id: 'invented-source' }] });
  } });
  await assert.rejects(broken.analyze(input(), owner));
  assert.equal(attempts, 2);
});

test('严格底稿修复保留前次回复并提供安全模板，拒绝将通用示例补作事实', async () => {
  let calls = 0;
  let rejectedContent;
  const flow = createAnalysisWorkflow({ async complete(messages) {
    const context = JSON.parse(messages[1].content);
    if (context.candidates) return completion({ items: [], questions: [], conflicts: [] });
    calls++;
    assert(context.draftTemplate.includes(context.approvedItems[0].quote));
    assert(!context.draftTemplate.includes('贪玩'));
    const output = outputFixture();
    if (calls === 1) {
      output.draft = context.draftTemplate + '今天联系您，家长认为是贪玩。';
      rejectedContent = JSON.stringify(output);
    } else {
      assert.equal(messages.at(-2).role, 'assistant');
      assert.equal(messages.at(-2).content, rejectedContent);
      assert.match(messages.at(-1).content, /draftTemplate/);
      output.draft = context.draftTemplate;
    }
    return completion(output);
  } });
  const analysis = await flow.analyze(input(), owner);
  const result = await flow.prepare(request(analysis, reviews(analysis, item => item.kind === 'record')), owner);
  assert.equal(result.generation.attempts, 2);
  assert(!result.draft.includes('贪玩'));
  assert(!result.draft.includes('今天'));
});

test('严格底稿连续失败保留可公开规则与调用统计，不退回离线示例', async () => {
  const flow = createAnalysisWorkflow({ async complete(messages) {
    const context = JSON.parse(messages[1].content);
    if (context.candidates) return completion({ items: [], questions: [], conflicts: [] });
    const output = outputFixture();
    output.draft = context.draftTemplate + '昨天因为贪玩导致缺课。';
    return completion(output);
  } });
  const analysis = await flow.analyze(input(), owner);
  await assert.rejects(flow.prepare(request(analysis, reviews(analysis, item => item.kind === 'record')), owner), error => {
    assert.equal(error.rule, 'UNAPPROVED_FACT');
    assert.equal(error.generation.attempts, 2);
    assert.equal(error.validation.length, 2);
    return true;
  });
});

test('相同在途分析合并；迟到的旧输入结果不能成为当前分析', async () => {
  const pending = [];
  let calls = 0;
  const flow = createAnalysisWorkflow({ mock: false, complete() {
    calls++;
    return new Promise(resolve => pending.push(resolve));
  } });
  const first = flow.analyze(input(), owner);
  const duplicate = flow.analyze(input(), owner);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  const newer = flow.analyze(input({ inputRevision: 2, text: '课程平台显示本周没有缺课。' }), owner);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  const oldChecks = [assert.rejects(first, status(409)), assert.rejects(duplicate, status(409))];
  pending[1](completion({ items: [], questions: [], conflicts: [] }));
  const current = await newer;
  pending[0](completion({ items: [], questions: [], conflicts: [] }));
  await Promise.all(oldChecks);
  assert.equal(current.inputRevision, 2);
});

test('相同在途生成只调用一次；生成期间改版会拒绝迟到的底稿', async () => {
  const waiting = [];
  const flow = createAnalysisWorkflow({ mock: false, async complete(messages) {
    const context = JSON.parse(messages[1].content);
    if (context.candidates) return completion({ items: [], questions: [], conflicts: [] });
    const output = outputFixture();
    output.draft = '家长您好。想和您核对一下本次沟通的情况。' + context.approvedItems.map(item => item.quote).join('\n') +
      '您了解到的情况是怎样的？我们可以先核对记录，再共同商量后续支持方式。';
    return new Promise(resolve => waiting.push(() => resolve(completion(output))));
  } });
  const analysis = await flow.analyze(input(), owner);
  const payload = request(analysis, reviews(analysis, item => item.kind === 'record'));
  const first = flow.prepare(payload, owner);
  const duplicate = flow.prepare(payload, owner);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waiting.length, 1);
  waiting.shift()();
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(a.draft, b.draft);
  const delayed = flow.prepare(payload, owner);
  const rejects = assert.rejects(delayed, status(409));
  await new Promise(resolve => setImmediate(resolve));
  await flow.analyze(input({ inputRevision: 2, text: '课程平台显示本周没有缺课。' }), owner);
  waiting.shift()();
  await rejects;
});
