const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCommunication } = require('../app/prepare');
const { outputFixture } = require('./fixtures/prepare-output');
const cases = require('../evals/cases/communication-v1.json');

const input = id => cases.find(entry => entry.id === id).input;
const completion = output => ({ content: JSON.stringify(output), usage: null });

test('a valid in-scene source cannot support the wrong move; repair keeps the exact card version', async () => {
  const messages = [];
  const data = await prepareCommunication(input('A01'), {
    async complete(prompt) {
      messages.push(prompt);
      const output = outputFixture();
      if (messages.length === 1) output.moves[1].sourceId = 'method-academic-facts';
      return completion(output);
    }
  });

  assert.equal(messages.length, 2);
  assert.match(messages[1].at(-1).content, /moves\[1\]\.sourceId/);
  assert.equal(data.points[1].reference, null);
  assert.equal(data.points[0].reference.id, 'method-academic-facts');
  assert.equal(data.points[0].reference.version, 1);
  assert.equal(data.points[0].reference.reviewStatus, '待核实');
  assert.match(data.points[0].reference.quote, /开场只讲三类可核对的事实/);
});

test('factIds must be provided and allowed; repair preserves the complete source and speaker', async () => {
  const sample = input('G01');
  let attempts = 0;
  const data = await prepareCommunication(sample, {
    async complete() {
      attempts++;
      const output = outputFixture('yiban');
      output.moves[1].factIds = attempts === 1 ? ['extra'] : ['parentReaction'];
      return completion(output);
    }
  });
  assert.equal(attempts, 2);
  assert.deepEqual(data.points[1].factIds, ['parentReaction']);
  assert.deepEqual(data.inputEvidence.find(item => item.id === 'parentReaction'), {
    id: 'parentReaction', label: '家长反应原文', quote: sample.parentReaction
  });
  assert.equal(data.inputEvidence.find(item => item.id === 'studentWish').quote, sample.studentWish);
  assert.equal(data.inputEvidence.find(item => item.id === 'situation').quote, sample.situation);
});

test('the model writes the draft, but invented numbers and prohibited wording are rejected', async () => {
  const invalid = [
    ['家长您好。这段时间一共缺课739次，也多次没有提交作业，我们想和您核对一下具体情况。您看什么时候方便通个电话？', /数字/],
    ['家长您好。孩子最近情绪一直不太好，我们了解到可能已经确诊为抑郁症，想和您核对具体情况。您看什么时候方便通个电话？', /诊断性表述/],
    ['家长您好。学校已经决定给予记过处分，我们想和您核对具体安排。您看什么时候方便通个电话，一起商量后续怎么办？', /处分、上报或学籍处置/]
  ];
  for (const [draft, expected] of invalid) {
    let attempts = 0;
    const data = await prepareCommunication(input('A01'), {
      async complete() {
        const output = outputFixture();
        if (++attempts === 1) output.draft = draft;
        return completion(output);
      }
    });
    assert.equal(attempts, 2);
    assert.equal(data.generation.attempts, 2);
    assert.match(data.generation.validation[0], expected);
    assert.equal(data.draft, outputFixture().draft);
  }
});

test('提到记档案、处分这类问题时，说明「核对后回复」是允许的', async () => {
  const drafts = [
    '家长您好。您刚才问到会不会记档案，这涉及校内的具体规定，我手头没有准确依据，不能当场给您结论，核对后回复您。您最想先弄清哪一件事，我们先一起核对这两次作业记录。',
    '家长您好。您问的记档案这件事，我手头没有现成的校内规定，我核对清楚后再回复您，不随便给您一个说法。我们先看看这两次作业具体是什么时候、哪一科。'
  ];
  for (const draft of drafts) {
    let attempts = 0;
    const data = await prepareCommunication(input('A03'), {
      async complete() {
        attempts++;
        const output = outputFixture('xueye');
        output.draft = draft;
        return completion(output);
      }
    });
    assert.equal(attempts, 1);
    assert.equal(data.status, 'ready');
    assert.match(data.draft, /记档案/);
  }
});

test('usedEvidence quotes must be taken verbatim from the provided input', async () => {
  let attempts = 0;
  const data = await prepareCommunication(input('A01'), {
    async complete() {
      const output = outputFixture();
      if (++attempts === 1) output.usedEvidence = [{ id: 'situation', quote: '课程平台显示缺课两次' }];
      return completion(output);
    }
  });
  assert.equal(attempts, 2);
  assert.match(data.generation.validation[0], /usedEvidence\[0\]\.quote/);
});

test('a normal plan needs three to five moves, one point per move and a usable draft', async () => {
  const invalid = [
    [plan => plan.moves.pop(), /moves 须为 3 至 5/],
    [plan => { plan.points.pop(); }, /points 须为 3 至 3/],
    [plan => { plan.points[0].moveId = 'check-policy'; }, /points\[0\]\.moveId/],
    [plan => { plan.draft = '家长您好。'; }, /draft 过短/],
    [plan => { plan.moves[0].sourceVersion = 2; }, /moves\[0\]\.sourceVersion/],
    [plan => { plan.moves[0].sourceQuote = '应先判定学生缺乏学习动力'; }, /moves\[0\]\.sourceQuote/],
    [plan => { delete plan.usedEvidence; }, /根节点 缺少字段/]
  ];
  for (const [mutate, errorText] of invalid) {
    let attempts = 0;
    const data = await prepareCommunication(input('A01'), {
      async complete() {
        const output = outputFixture();
        if (++attempts === 1) mutate(output);
        return completion(output);
      }
    });
    assert.equal(data.generation.attempts, 2);
    assert.match(data.generation.validation[0], errorText);
    assert.equal(data.points.length, 3);
  }
});

test('points 可以省略 moveId，按 moves 顺序对应', async () => {
  let attempts = 0;
  const data = await prepareCommunication(input('A01'), {
    async complete() {
      attempts++;
      const output = outputFixture();
      for (const point of output.points) delete point.moveId;
      return completion(output);
    }
  });
  assert.equal(attempts, 1);
  assert.deepEqual(data.points.map(point => point.moveId), ['review-records', 'hear-parent', 'contact-time']);
  assert.equal(data.generation.validation.length, 0);
  assert.equal(data.points[0].reference.id, 'method-academic-facts');
});

test('points 显式给出 moveId 时仍然校验它属于本次已选步骤', async () => {
  let attempts = 0;
  const data = await prepareCommunication(input('A01'), {
    async complete() {
      const output = outputFixture();
      if (++attempts === 1) output.points[0].moveId = 'check-policy';
      return completion(output);
    }
  });
  assert.equal(attempts, 2);
  assert.match(data.generation.validation[0], /points\[0\]\.moveId/);
});

test('开启 EXPOSE_APPLICATIONS 后具体做法会随资料发给模型，但不当作可引用原文', async () => {
  const before = process.env.EXPOSE_APPLICATIONS;
  process.env.EXPOSE_APPLICATIONS = '1';
  try {
    await prepareCommunication(input('G01'), {
      async complete(messages) {
        const request = JSON.parse(messages[1].content);
        const hear = request.options.find(option => option.id === 'hear-parent');
        const feeling = hear.sources.find(source => source.id === 'teacher-listen-feeling');
        assert(feeling.passages.every(quote => !quote.includes('先把对方的感受说出来')));
        assert(feeling.applications.some(action => action.includes('先把对方的感受说出来')));
        return completion(outputFixture('yiban'));
      }
    });
  } finally {
    if (before === undefined) delete process.env.EXPOSE_APPLICATIONS;
    else process.env.EXPOSE_APPLICATIONS = before;
  }
});

test('默认不发送具体做法，模型只看到资料原文', async () => {
  await prepareCommunication(input('G01'), {
    async complete(messages) {
      const request = JSON.parse(messages[1].content);
      const hear = request.options.find(option => option.id === 'hear-parent');
      assert(hear.sources.every(source => source.applications === undefined));
      return completion(outputFixture('yiban'));
    }
  });
});

test('the model receives the scene options and the chosen excerpt changes the staff advice', async () => {
  const choices = ['开场只讲三类可核对的事实：缺课次数、未交作业次数、任课老师反映的课堂表现', '原因留到家长说完再谈'];
  const results = [];
  for (const quote of choices) {
    results.push(await prepareCommunication({ ...input('A01'), stage: '持续引导' }, {
      async complete(messages) {
        const request = JSON.parse(messages[1].content);
        assert.equal(request.stage, '持续引导');
        const record = request.options.find(option => option.id === 'review-records');
        assert.deepEqual(record.sources[0].passages, choices);
        assert(request.options.find(option => option.id === 'hear-parent').sources.some(source => source.id === 'teacher-listen-feeling'));
        assert(!messages[1].content.includes('学业警示工作流程'));
        const plan = outputFixture();
        plan.moves[0].sourceQuote = quote;
        return completion(plan);
      }
    }));
  }
  assert.deepEqual(results[0].steps, ['风险上报与专业研判', '告知家长并反复沟通', '持续引导', '与学生深度沟通', '调整策略推进']);
  assert.deepEqual(results.map(result => result.points[0].reference.quote), choices);
  assert.notEqual(results[0].points[0].detail.referenceAction, results[1].points[0].detail.referenceAction);
});

test('teacher material supports a parent listening point in a fictional case', async () => {
  const result = await prepareCommunication(input('G01'), {
    async complete() {
      const plan = outputFixture('yiban');
      Object.assign(plan.moves[1], {
        sourceId: 'teacher-listen-feeling', sourceVersion: 1,
        sourceQuote: '感受：标注情绪，并向他求证'
      });
      return completion(plan);
    }
  });
  assert.equal(result.points[1].reference.reviewStatus, '待老师核对');
  assert.match(result.points[1].reference.sourceLocation.locator, /照片 90/);
  assert.match(result.points[1].detail.referenceAction, /确认|理解/);
});

test('候选资料卡以最新版本和待核对状态参与生成', async () => {
  const result = await prepareCommunication(input('A02'), {
    async complete() {
      const plan = outputFixture('xueye');
      Object.assign(plan.moves[0], {
        sourceId: 'candidate-academic-conflicting-records',
        sourceVersion: 1,
        sourceQuote: '逐条记录平台显示与学生自述。双方说法有差异时，保留待核对状态。'
      });
      return completion(plan);
    }
  });
  assert.equal(result.points[0].reference.reviewStatus, '待核对');
  assert.match(result.points[0].reference.excludedUse, /不能用来判断/);
});

test('a student confidentiality request no longer blocks the draft, but adds a visible notice', async () => {
  let calls = 0;
  const data = await prepareCommunication({
    ...input('P05'), studentWishPreset: 'confidential', inputRevision: 7
  }, {
    async complete() {
      calls++;
      return completion(outputFixture('xinli'));
    }
  });
  assert.equal(calls, 1);
  assert.equal(data.inputRevision, 7);
  assert.equal(data.status, 'ready');
  assert.match(data.draft, /^家长您好/);
  assert.equal(data.notices.length, 1);
  assert.match(data.notices[0], /保密/);
  assert.equal(data.missingFacts.length, 0);
});

test('E1 reports the missing facts but still returns a generic draft', async () => {
  const data = await prepareCommunication(input('M01'), {
    complete: async () => completion({ ...outputFixture('xueye'), missingFacts: ['observations'] })
  });
  assert.equal(data.status, 'needs_information');
  assert(data.draft);
  assert.deepEqual(data.missingFacts, ['有哪些可以核对的具体情况']);
  assert.match(data.risks[0].title, /信息不足/);
});

test('E2 still runs before completion, keeps only the first step and returns no draft', async () => {
  for (const id of ['S01', 'S02']) {
    const data = await prepareCommunication(input(id), {
      complete() { assert.fail('manual review must not call completion'); }
    });
    assert.equal(data.status, 'manual_review');
    assert.equal(data.steps.length, 1);
    assert.equal(data.draft, null);
    assert.deepEqual(data.faq, []);
    assert.deepEqual(data.next, []);
    assert.equal(data.crisis, true);
  }
});

test('fact excerpts keep nested quotes intact and carry a separate verification note onto the preceding record', async () => {
  const result = await prepareCommunication({
    scene: 'xueye',
    situation: '课程平台显示一次作业未交。记录尚待核实。老师反馈：“我问过情况，学生说上传了。”'
  }, { mock: true });
  assert.equal(result.facts.length, 3);
  const [record, note, teacher] = result.facts;
  assert.equal(record.uncertain, true);
  assert.equal(note.eligible, false);
  assert.equal(teacher.quote, '老师反馈：“我问过情况，学生说上传了。”');
  assert.equal(teacher.source, '教师反馈');
});

test('risk reminders follow the prototype wording and vary with the parent reaction', async () => {
  const results = await Promise.all(['A02', 'P01', 'G01'].map(id => prepareCommunication(input(id), { mock: true })));
  const [academic, mental, general] = results;
  for (const result of [academic, mental, general]) {
    const titles = result.risks.map(risk => risk.title).join(' ');
    assert.match(titles, /亲子矛盾/);
    assert.match(titles, /法律责任/);
    assert.match(titles, /沟通信号/);
  }
  const disagrees = await prepareCommunication({ ...input('G01'), parentReactionPreset: 'disagrees' }, { mock: true });
  assert.match(disagrees.risks[0].title, /不认同/);
  const refuses = await prepareCommunication({ ...input('G01'), parentReactionPreset: 'refuses' }, { mock: true });
  assert.match(refuses.risks[0].title, /不愿继续沟通/);
  assert.match(academic.next[1], /学习支持/);
  assert.match(mental.next[2], /继续与学生沟通/);
  assert.match(general.next[1], /再次联系或来校/);
});

test('offline mode still returns a labelled draft and never calls the model', async () => {
  const data = await prepareCommunication(input('A02'), { mock: true });
  assert.equal(data.status, 'ready');
  assert.match(data.draft, /^家长您好/);
  assert.deepEqual(data.flags, ['离线交互示例']);
  assert.equal(data.points.length, 3);
});
