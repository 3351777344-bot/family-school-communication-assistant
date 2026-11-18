const test = require('node:test');
const assert = require('node:assert/strict');
const { createPracticeWorkflow, MAX_COUNSELOR_TURNS } = require('../../app/practice');
const { ModelError } = require('../../app/model-client');
const { OutputError } = require('../../app/prepare-output');

const owner = 'fictional-owner-a';
const make = options => createPracticeWorkflow({ mock: true, ...options });
const start = (flow, requestId = 'start-one', caseId = 'academic-denial') => flow.start({ caseId, requestId }, owner);
const input = (session, requestId, patch = {}) => ({ sessionId: session.sessionId,
  expectedVersion: session.version, requestId, ...patch });
const send = (flow, session, requestId = 'turn-one', message = '我理解您担心被误解，我们先核对平台记录。') => flow.turn(input(session, requestId, { message }), owner);
const code = expected => error => error.code === expected;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const completion = value => ({ content: JSON.stringify(value), usage: { prompt_tokens: 10, completion_tokens: 5 } });
function reviewValue(catalog, turns, patch = {}) {
  return { rubricVersion: catalog.rubricVersion, summary: '根据本次虚构演练给出学习建议。',
    items: catalog.criteria.map(item => ({ criterionId: item.id, score: null,
      feedback: '本次相关依据不足，暂无法评价。', evidence: [],
      alternative: '我们先核对已知情况，再商量下一步。', practice: '下轮尝试说明核对办法。' })),
    nextExercise: '下轮练习具体回应家长的担心。', ...patch };
}

test('演练目录为可审查的虚构草案，返回副本不改变静态案例或评价规则', () => {
  const flow = make();
  const first = flow.catalog();
  assert(first.cases.length >= 3);
  assert(first.reviewStatus.includes('待') && first.reviewStatus.includes('审核'));
  assert.deepEqual(first.criteria.map(item => item.id), ['listening', 'facts', 'boundaries', 'collaboration', 'closure']);
  assert(first.criteria.every(item => item.anchors.length === 4));
  assert(first.cases.every(item => item.scene !== 'weiji' && item.roleCard.knownFacts.length > 0));
  first.cases[0].roleCard.knownFacts.length = 0;
  first.criteria.length = 0;
  assert(flow.catalog().cases[0].roleCard.knownFacts.length > 0);
  assert.equal(flow.catalog().criteria.length, 5);
});

test('开始、轮次、显式结束和主动复盘状态严格分开；依据能逐字定位', async () => {
  const flow = make();
  let session = await start(flow);
  assert.equal(session.status, 'active'); assert.equal(session.version, 0);
  assert.equal(session.turns.length, 1); assert.equal(session.turns[0].role, 'parent');
  await assert.rejects(flow.review(input(session, 'premature-review'), owner), code('PRACTICE_REVIEW_NOT_READY'));
  session = await send(flow, session);
  assert.equal(session.version, 1); assert.equal(session.turns.length, 3);
  const ended = await flow.end(input(session, 'end-one'), owner);
  assert.equal(ended.status, 'ended'); assert.equal(ended.version, 2); assert.equal(ended.review, undefined);
  const reviewed = await flow.review(input(ended, 'review-one'), owner);
  assert.equal(reviewed.version, 2); assert.equal(reviewed.status, 'ended');
  assert(reviewed.review.summary.includes('离线'));
  for (const item of reviewed.review.items) {
    if (!item.evidence.length) { assert.equal(item.score, null); continue; }
    for (const source of item.evidence) {
      const turn = reviewed.turns.find(turn => turn.id === source.turnId);
      assert.equal(turn.role, 'counselor'); assert(turn.content.includes(source.quote));
    }
  }
  await assert.rejects(send(flow, ended, 'after-end'), code('PRACTICE_ENDED'));
});

test('空演练可以结束，不能请求评价；其他入口的真实材料字段不接收', async () => {
  const flow = make();
  const session = await start(flow);
  const ended = await flow.end(input(session, 'empty-end'), owner);
  await assert.rejects(flow.review(input(ended, 'empty-review'), owner), error => error.status === 400);
  await assert.rejects(flow.start({ caseId: 'academic-denial', requestId: 'raw-start', text: '原记录' }, owner), error => error.status === 400);
  await assert.rejects(flow.start({ caseId: 'weiji', requestId: 'bad-case' }, owner), error => error.status === 400);
});

test('owner与TTL隔离，容量受限；到期清理后可新建', async () => {
  let time = 1000;
  const flow = make({ ttlMs: 100, maxSessions: 1, now: () => time });
  const session = await start(flow);
  await assert.rejects(flow.turn(input(session, 'wrong-owner', { message: '您好' }), 'fictional-owner-b'), error => error.status === 404);
  await assert.rejects(start(flow, 'capacity-start'), code('PRACTICE_CAPACITY'));
  time = 1101;
  await assert.rejects(send(flow, session, 'expired-turn'), code('PRACTICE_EXPIRED'));
  assert((await start(flow, 'after-expiry')).sessionId !== session.sessionId);
});

test('开始和成功轮次可幂等重放，同编号不同内容或操作拒绝，返回快照不可外部修改', async () => {
  const flow = make();
  const session = await start(flow);
  assert.deepEqual(await start(flow), session);
  await assert.rejects(start(flow, 'start-one', 'cooperative-followup'), code('PRACTICE_REQUEST_CONFLICT'));
  const next = await send(flow, session);
  next.turns[1].content = '外部篡改';
  const replay = await send(flow, session);
  assert.notEqual(replay.turns[1].content, '外部篡改'); assert.equal(replay.turns.length, 3);
  await assert.rejects(send(flow, session, 'turn-one', '不同内容'), code('PRACTICE_REQUEST_CONFLICT'));
  await assert.rejects(flow.end(input(session, 'turn-one'), owner), code('PRACTICE_REQUEST_CONFLICT'));
  await assert.rejects(send(flow, session, 'old-version'), code('PRACTICE_STALE'));
});

test('同一在途请求只调模型一次，不同请求同版本互斥；成功后旧版本不能再提交', async () => {
  const wait = deferred(); let calls = 0;
  const flow = make({ mock: false, complete: async () => { calls++; return wait.promise; } });
  const session = await start(flow);
  const first = send(flow, session);
  const duplicate = send(flow, session);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(send(flow, session, 'concurrent-other'), code('PRACTICE_BUSY'));
  await assert.rejects(flow.end(input(session, 'concurrent-end'), owner), code('PRACTICE_BUSY'));
  wait.resolve(completion({ reply: '那请您先说说记录的来源，可以吗？' }));
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(a.turns.length, 3);
  await assert.rejects(send(flow, session, 'concurrent-other'), code('PRACTICE_STALE'));
});

test('网络失败不提交辅导员轮次、保留版本，原请求编号可重试', async () => {
  let calls = 0;
  const flow = make({ mock: false, complete: async () => {
    if (++calls === 1) throw new ModelError('MODEL_UPSTREAM_FAILED', '模型服务暂不可用');
    return completion({ reply: '我想先听清楚记录的来源。' });
  } });
  const session = await start(flow);
  await assert.rejects(send(flow, session), code('MODEL_UPSTREAM_FAILED'));
  const next = await send(flow, session);
  assert.equal(calls, 2); assert.equal(next.version, 1); assert.equal(next.turns.length, 3);
});

test('模拟模型格式错误最多修复一次，连续失败保留练习发言且不展示不合格回复', async () => {
  let calls = 0;
  const prompts = [];
  const flow = make({ mock: false, complete: async messages => {
    calls++; prompts.push(structuredClone(messages));
    return calls === 1 ? { content: 'private-model-output', usage: null } : completion({ reply: '那我们先核对一下好吗？' });
  } });
  const session = await start(flow);
  const next = await send(flow, session);
  assert.equal(calls, 2); assert.equal(next.generation.attempts, 2);
  assert.equal(prompts[1][2].role, 'assistant');
  assert.equal(JSON.parse(prompts[1][3].content).reason, 'practice 须为 JSON 对象');
  assert(!JSON.stringify(next).includes('private-model-output'));
  const bad = make({ mock: false, complete: async () => ({ content: 'private-model-output' }) });
  const initial = await start(bad);
  const retained = await send(bad, initial);
  assert.equal(retained.replyUnavailable, true);
  assert.equal(retained.generation.attempts, 2);
  assert(!JSON.stringify(retained).includes('private-model-output'));
  const ended = await bad.end(input(retained, 'after-bad-end'), owner);
  assert.equal(ended.turns.length, 2);
  assert.equal(ended.turns.at(-1).role, 'counselor');
});

test('练习者的风险词和错误表达不暂停演练，仍可引用原话复盘；输入与外发上下文均脱敏', async () => {
  const bodies = [];
  const flow = make({ mock: false, complete: async messages => {
    bodies.push(structuredClone(messages));
    const payload = JSON.parse(messages[1].content);
    if (payload.rubricVersion) {
      const value = reviewValue(flow.catalog(), payload.transcript);
      const last = payload.transcript.filter(turn => turn.role === 'counselor').at(-1);
      value.items[2] = { ...value.items[2], score: 1, evidence: [{ turnId: last.id, quote: last.content }], feedback: '这段原话淡化风险并作出无依据的保证，可能使家长失去信任。' };
      return completion(value);
    }
    return completion({ reply: '听到您这样下结论，我更担心了，能先说明依据吗？' });
  } });
  let session = await start(flow);
  session = await send(flow, session, 'pii-turn', '我的电话13800138000，邮箱person@example.com，请先核对记录。');
  assert(!JSON.stringify(session).includes('13800138000'));
  assert(!JSON.stringify(bodies).includes('13800138000'));
  assert(!JSON.stringify(bodies).includes('person@example.com'));
  assert(session.flags.some(flag => flag.includes('替换')));
  const continued = await send(flow, session, 'safety-turn', '学生说不想活也别担心，我保证没事，联系电话13900139000');
  assert.equal(bodies.length, 2); assert.equal(continued.status, 'active');
  assert.equal(continued.turns.at(-1).role, 'parent');
  assert.equal(continued.turns.length, session.turns.length + 2);
  assert(!JSON.stringify(continued).includes('13900139000'));
  assert(continued.flags.some(flag => flag.includes('替换')));
  const ended = await flow.end(input(continued, 'safety-end'), owner);
  const reviewed = await flow.review(input(ended, 'safety-review'), owner);
  assert.equal(reviewed.review.items[2].score, 1);
  assert(reviewed.review.items[2].evidence[0].quote.includes('不想活'));
  assert(bodies.at(-1)[0].content.includes('不检查是否套用固定句式'));
});

test('家长模拟不得新增数字或完整日期，可保留已知数字；一次修复后通过', async () => {
  let calls = 0;
  const flow = make({ mock: false, complete: async () => {
    calls++;
    return completion({ reply: calls === 1 ? '您刚才说有99次未到课吗？' : '您刚才说平台显示2次，我想先核对来源。' });
  } });
  const session = await start(flow);
  const next = await send(flow, session, 'numbers-turn', '平台显示2次，记录需要核对。');
  assert.equal(calls, 2); assert.equal(next.generation.attempts, 2);
  assert(next.turns.at(-1).content.includes('2次'));
  const { parseReply } = require('../../app/practice');
  assert.throws(() => parseReply(JSON.stringify({ reply: '我们12月2日联系吧。' }), '12月1日和11月2日'), error => error.rule === 'PRACTICE_FACT_INVALID');
  assert.equal(parseReply(JSON.stringify({ reply: '您提到12月1日，请问记录来源是什么？' }), '12月1日'), '您提到12月1日，请问记录来源是什么？');
});

test('异步模拟过期不得提交，不能重放过期状态', async () => {
  let time = 1000; const wait = deferred();
  const flow = make({ mock: false, ttlMs: 100, now: () => time, complete: () => wait.promise });
  const session = await start(flow);
  const pending = send(flow, session);
  await new Promise(resolve => setImmediate(resolve));
  time = 1101; wait.resolve(completion({ reply: '我们先了解一下。' }));
  await assert.rejects(pending, code('PRACTICE_EXPIRED'));
  await assert.rejects(send(flow, session), code('PRACTICE_EXPIRED'));
});

test('模型复盘逐字引用辅导员回合，五项唯一；无证据不评分且仅调用独立评估', async () => {
  const flow = make({ mock: false, complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    if (!payload.rubricVersion) return completion({ reply: '我愿意先听您说明。' });
    const result = reviewValue(flow.catalog(), payload.transcript);
    const turn = payload.transcript.find(item => item.role === 'counselor');
    result.items[0] = { ...result.items[0], score: 3,
      feedback: '这一回合回应了家长的担心，可再邀请核对理解。',
      evidence: [{ turnId: turn.id, quote: '我理解您担心被误解' }] };
    return completion(result);
  } });
  const session = await start(flow);
  const next = await send(flow, session);
  assert.equal(next.review, undefined);
  const ended = await flow.end(input(next, 'model-end'), owner);
  const reviewed = await flow.review(input(ended, 'model-review'), owner);
  assert.equal(reviewed.generation.attempts, 1);
  assert.equal(reviewed.review.items[0].score, 3);
  assert.equal(reviewed.review.items[1].score, null);
  assert.equal(reviewed.review.items.length, 5);
});

test('复盘伪造引句、父母回合、无证据评分或结论、重复评价项均拒绝；失败后可单独重试', async () => {
  for (const corrupt of ['fabricated', 'parent-turn', 'score-without-evidence', 'unsupported-feedback', 'duplicate']) {
    let phase = 'bad', reviewCalls = 0;
    const flow = make({ mock: false, complete: async messages => {
      const payload = JSON.parse(messages[1].content);
      if (!payload.rubricVersion) return completion({ reply: '您能具体说说吗？' });
      reviewCalls++;
      const result = reviewValue(flow.catalog(), payload.transcript);
      if (phase === 'bad') {
        const counselor = payload.transcript.find(item => item.role === 'counselor');
        if (corrupt === 'fabricated') result.items[0].evidence = [{ turnId: counselor.id, quote: '完全没有说过的内容' }];
        if (corrupt === 'parent-turn') result.items[0].evidence = [{ turnId: payload.transcript[0].id, quote: payload.transcript[0].content }];
        if (corrupt === 'score-without-evidence') result.items[0].score = 4;
        if (corrupt === 'unsupported-feedback') result.items[0].feedback = '本项已经表现得很好。';
        if (corrupt === 'duplicate') result.items[1].criterionId = result.items[0].criterionId;
      }
      return completion(result);
    } });
    const next = await send(flow, await start(flow));
    const ended = await flow.end(input(next, 'bad-review-end'), owner);
    await assert.rejects(flow.review(input(ended, 'bad-review'), owner), error => error instanceof OutputError);
    assert.equal(reviewCalls, 2);
    phase = 'good';
    const reviewed = await flow.review(input(ended, 'bad-review'), owner);
    assert.equal(reviewed.status, 'ended'); assert(reviewed.review);
    assert.equal(reviewCalls, 3);
  }
});

test('20回合上限不隐式评估；主动结束仍可复盘', async () => {
  const flow = make(); let session = await start(flow);
  for (let i = 0; i < MAX_COUNSELOR_TURNS; i++) session = await send(flow, session, `limit-turn-${i}`);
  assert.equal(session.status, 'active'); assert.equal(session.review, undefined);
  await assert.rejects(send(flow, session, 'one-too-many'), code('PRACTICE_TURN_LIMIT'));
  const ended = await flow.end(input(session, 'limit-end'), owner);
  assert((await flow.review(input(ended, 'limit-review'), owner)).review);
});

test('复盘建议拒绝诊断、制度处置保证和编造联系时限；保留反馈中逐字指出错误的能力', () => {
  const { parseReview } = require('../../app/practice');
  const flow = make();
  const turns = [{ id: 'turn-1', role: 'parent', content: '您能不能立刻保证结果？' },
    { id: 'turn-2', role: 'counselor', content: '我保证孩子没事，两天内就能撤销处分。' }];
  const examples = [
    ['alternative', '孩子已经确诊抑郁症。'],
    ['alternative', '核实结果出来前不会先按旷课记录处理。'],
    ['alternative', '我谈完后两天内和您联系，您看这个时间方便吗？'],
    ['practice', '约好24小时内联系家长。'],
    ['nextExercise', '明天下午3点前联系家长。'],
    ['alternative', '下午两点和您联系。'],
    ['practice', '两点半回复家长。'],
    ['alternative', '我保证孩子肯定没事。'],
    ['practice', '向家长说明孩子一定会恢复正常。'],
    ['nextExercise', '保证不会给予处分。'],
  ];
  for (const [field, unsafe] of examples) {
    const result = reviewValue(flow.catalog(), turns);
    if (field === 'nextExercise') result.nextExercise = unsafe;
    else result.items[0][field] = unsafe;
    assert.throws(() => parseReview(JSON.stringify(result), turns), error => error instanceof OutputError, unsafe);
  }
  const result = reviewValue(flow.catalog(), turns);
  result.items[0] = { ...result.items[0], score: 1,
    feedback: '这一回合“我保证孩子没事，两天内就能撤销处分。”属于未经核实的保证和越权承诺。',
    evidence: [{ turnId: 'turn-2', quote: turns[1].content }],
    alternative: '我不能保证孩子没事，需要先核实已知情况，再共同商量可行安排。',
    practice: '练习说明目前的信息边界，不作保证，邀请双方核对可行安排。' };
  const accepted = parseReview(JSON.stringify(result), turns);
  assert.equal(accepted.items[0].evidence[0].quote, turns[1].content);
  assert(accepted.items[0].feedback.includes('两天内'));
  result.items[0].alternative = '您最担心的是哪一点？还有一点需要核对，我们可以一起商量。';
  result.items[0].practice = '练习列出两点共识，遇到一时不清楚的问题先核对。';
  assert.equal(parseReview(JSON.stringify(result), turns).items[0].alternative, result.items[0].alternative);
});

test('建议含越权时限被拒后单次修复可成功；v2外发说明未知观察和末尾家长回合的评价范围', async () => {
  let reviewCalls = 0; const captured = [];
  const flow = make({ mock: false, complete: async messages => {
    captured.push(structuredClone(messages));
    const payload = JSON.parse(messages[1].content);
    if (!payload.rubricVersion) return completion({ reply: '这部分我还不了解，需要和孩子核对。我们可以先了解什么？' });
    const result = reviewValue(flow.catalog(), payload.transcript);
    if (++reviewCalls === 1) result.items[0].alternative = '我谈完后两天内和您联系。';
    return completion(result);
  } });
  const session = await start(flow, 'v2-start', 'anxious-parent');
  const next = await send(flow, session, 'v2-turn', '您愿意谈谈近期观察吗？');
  assert.equal(next.generation.promptVersion, 'parent-practice-v3');
  assert(captured[0][0].content.includes('家庭观察'));
  assert(captured[0][0].content.includes('只能坦言尚不了解'));
  const ended = await flow.end(input(next, 'v2-end'), owner);
  const reviewed = await flow.review(input(ended, 'v2-review'), owner);
  assert.equal(reviewCalls, 2); assert.equal(reviewed.generation.attempts, 2);
  assert.equal(reviewed.generation.promptVersion, 'practice-review-v4');
  const payload = JSON.parse(captured[1][1].content);
  assert.equal(payload.evaluationScope.counselorTurnCount, 1);
  assert.equal(payload.evaluationScope.awaitingCounselorReply, true);
  assert(captured[1][0].content.includes('不得因此扣分'));
  assert(!reviewed.review.items[0].alternative.includes('两天内'));
});

test('复盘建议可以保留案例中的时间背景，不能把事实中的本周误判成联系期限', () => {
  const { parseReview } = require('../../app/practice');
  const flow = make();
  const turns = [{ id: 'turn-2', role: 'counselor', content: '平台显示本周有两次未到课，学生说其中一次请过假。' }];
  const result = reviewValue(flow.catalog(), turns);
  result.items[1].alternative = '平台显示本周有两次未到课，学生说其中一次请过假，这些情况需要先分别核实。';
  result.items[1].practice = '练习区分本周的课程记录与学生说法，再邀请家长补充。';
  assert.equal(parseReview(JSON.stringify(result), turns).items[1].alternative, result.items[1].alternative);
  result.items[1].alternative = '我们本周和您联系。';
  assert.throws(() => parseReview(JSON.stringify(result), turns), error => error.rule === 'PRACTICE_ADVICE_INVALID');
});

test('复盘修复携带前次结果及具体错误字段，连续失败保留可追踪规则而不泄露正文', async () => {
  let count = 0; let repairedMessages;
  const flow = make({ mock: false, complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    if (!payload.rubricVersion) return completion({ reply: '我愿意先核对情况。' });
    const value = reviewValue(flow.catalog(), payload.transcript);
    if (++count === 1) value.items[0].evidence = [{ turnId: 'turn-missing', quote: '虚构错误引句' }];
    else repairedMessages = structuredClone(messages);
    return completion(value);
  } });
  const next = await send(flow, await start(flow));
  const ended = await flow.end(input(next, 'repair-detail-end'), owner);
  const result = await flow.review(input(ended, 'repair-detail-review'), owner);
  assert.equal(result.generation.attempts, 2);
  assert.equal(repairedMessages[2].role, 'assistant');
  assert(repairedMessages[2].content.includes('turn-missing'));
  assert(repairedMessages[3].content.includes('practice.review.evidence'));
  assert(repairedMessages[3].content.includes('PRACTICE_EVIDENCE_INVALID'));
  assert.deepEqual(result.generation.validationFailures, [{ field: 'practice.review.evidence', rule: 'PRACTICE_EVIDENCE_INVALID' }]);
});

test('模型生成不合格时仍保留差回答，结束后能复盘该回答而不回显危险的家长回复', async () => {
  const flow = make({ mock: false, complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    if (!payload.rubricVersion) return completion({ reply: '我们已经确诊抑郁症。' });
    const value = reviewValue(flow.catalog(), payload.transcript);
    const last = payload.transcript.at(-1);
    value.items[0] = { ...value.items[0], score: 1, evidence: [{ turnId: last.id, quote: last.content }], feedback: '否定和命令式表达阻断了家长参与，需要先了解疑问。' };
    return completion(value);
  } });
  const next = await send(flow, await start(flow), 'bad-but-recorded', '你们家长少废话，必须照我说的做。');
  assert.equal(next.status, 'active'); assert.equal(next.replyUnavailable, true);
  assert.equal(next.turns.at(-1).role, 'counselor');
  assert(!JSON.stringify(next).includes('确诊抑郁症'));
  const ended = await flow.end(input(next, 'bad-but-recorded-end'), owner);
  const reviewed = await flow.review(input(ended, 'bad-but-recorded-review'), owner);
  assert.equal(reviewed.review.items[0].score, 1);
  assert.equal(reviewed.review.items[0].evidence[0].quote, '你们家长少废话，必须照我说的做。');
});
