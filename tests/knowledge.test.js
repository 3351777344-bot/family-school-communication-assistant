const test = require('node:test');
const assert = require('node:assert/strict');
const { admittedReferences, findReferences, sourcesForMove } = require('../app/knowledge');
const cards = require('../app/reference-cards.json');
const teacherMethods = require('../app/teacher-methods.json');
const { MOVE_IDS } = require('../app/communication-moves');

test('候选资料卡以待核对状态参与生成，并保留禁用范围', () => {
  for (const scene of ['xueye', 'xinli', 'yiban']) {
    const references = findReferences({ scene, chips: [] });
    for (const card of cards.filter(item => item.scenes.includes(scene))) {
      const reference = references.get(card.id);
      assert(reference, card.id + ' 应参与 ' + scene);
      assert.equal(reference.reviewStatus, '待核对');
      assert.equal(reference.excludedUse, card.excludedUse);
      assert.equal(reference.version, card.version);
      assert(reference.sourceLocation.locator);
    }
  }
});

test('admission keeps the newest version, drops duplicates and foreign scenes', () => {
  const sample = { ...cards[0] };
  const accept = (records, scene = 'xueye') => admittedReferences(records, scene).get(sample.id);
  assert.equal(accept([sample]).version, 1);
  assert.equal(accept([sample, { ...sample, version: 2 }]).version, 2);
  assert.equal(accept([sample, sample]), undefined);
  assert.equal(accept([sample], 'xinli'), undefined);
  assert.equal(accept([sample, { ...sample, supports: [] }]), undefined);
});

test('老师课件卡都带可定位出处、合法步骤和 6–140 字摘录', () => {
  assert(teacherMethods.length >= 14);
  for (const card of teacherMethods) {
    assert.match(card.id, /^teacher-[a-z0-9-]+$/);
    assert(card.title);
    assert.match(card.sourceLocation.locator, /照片 \d+|会议摘要/);
    assert(card.supports.length);
    for (const [moveId, passages] of Object.entries(card.passages)) {
      assert(MOVE_IDS.has(moveId), card.id + '.' + moveId);
      assert(card.supports.includes(moveId), card.id + '.' + moveId);
      for (const passage of passages) {
        assert(passage.quote.length >= 6 && passage.quote.length <= 140, card.id + ' 摘录长度');
        assert.equal(passage.quote.trim(), passage.quote);
        assert(passage.action.trim());
      }
    }
  }
});

test('EXPOSE_APPLICATIONS=0 只关闭具体做法，原文和其他字段不变', () => {
  const references = findReferences({ scene: 'yiban', chips: [] });
  const before = process.env.EXPOSE_APPLICATIONS;
  try {
    process.env.EXPOSE_APPLICATIONS = '1';
    const exposed = sourcesForMove(references, 'hear-parent').find(source => source.id === 'teacher-listen-feeling');
    process.env.EXPOSE_APPLICATIONS = '0';
    const hidden = sourcesForMove(references, 'hear-parent').find(source => source.id === 'teacher-listen-feeling');
    assert(exposed.applications.length > 0);
    assert.equal(hidden.applications, undefined);
    assert.deepEqual(hidden.passages, exposed.passages);
    assert.equal(hidden.version, exposed.version);
    assert.equal(hidden.title, exposed.title);
  } finally {
    if (before === undefined) delete process.env.EXPOSE_APPLICATIONS;
    else process.env.EXPOSE_APPLICATIONS = before;
  }
});

function withEnv(patch, run) {
  const before = {};
  for (const key of Object.keys(patch)) {
    before[key] = process.env[key];
    process.env[key] = patch[key];
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(patch)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test('候选卡只在没有已审资料覆盖该步骤时出现', () => {
  const references = findReferences({ scene: 'yiban', chips: [] });
  withEnv({ SOURCE_TIERING: '1' }, () => {
    const covered = sourcesForMove(references, 'contact-time').map(source => source.id);
    assert(!covered.some(id => id.startsWith('candidate-')), '已覆盖的步骤不应再出现候选卡');
    const uncovered = sourcesForMove(references, 'respect-wish').map(source => source.id);
    assert(uncovered.some(id => id.startsWith('candidate-')), '没有已审资料时应保留候选卡');
  });
  withEnv({ SOURCE_TIERING: '0' }, () => {
    const covered = sourcesForMove(references, 'contact-time').map(source => source.id);
    assert(covered.some(id => id.startsWith('candidate-')));
  });
});

test('每步候选数受上限约束，0 表示不限', () => {
  const references = findReferences({ scene: 'xinli', chips: [] });
  withEnv({ MAX_SOURCES_PER_MOVE: '8' }, () => {
    assert.equal(sourcesForMove(references, 'hear-parent').length, 8);
  });
  withEnv({ MAX_SOURCES_PER_MOVE: '4' }, () => {
    assert.equal(sourcesForMove(references, 'hear-parent').length, 4);
  });
  withEnv({ MAX_SOURCES_PER_MOVE: '0' }, () => {
    assert(sourcesForMove(references, 'hear-parent').length > 8);
  });
});

test('资料权威度不会泄漏到接口返回', async () => {
  const { prepareCommunication } = require('../app/prepare');
  const data = await prepareCommunication({
    scene: 'xinli',
    situation: '近两周观察到学生上课时多次打瞌睡，学生说最近睡眠不规律。'
  }, { mock: true });
  for (const point of data.points) {
    if (!point.reference) continue;
    assert.equal(Object.hasOwn(point.reference, 'tier'), false);
    assert.equal(Object.hasOwn(point.reference, 'passages'), false);
    assert(point.reference.id);
    assert(point.reference.reviewStatus);
  }
});

test('声明 scenes 的老师课件卡只在对应场景参与', () => {
  const scoped = teacherMethods.filter(card => Array.isArray(card.scenes));
  assert(scoped.length > 0);
  for (const card of scoped) {
    const inside = card.scenes.includes('*') ? 'xueye' : card.scenes[0];
    const outside = ['xueye', 'xinli', 'yiban'].find(scene => !card.scenes.includes(scene) && !card.scenes.includes('*'));
    assert(findReferences({ scene: inside, chips: [] }).has(card.id), card.id + ' 应在 ' + inside);
    if (outside) assert(!findReferences({ scene: outside, chips: [] }).has(card.id), card.id + ' 不应在 ' + outside);
  }
});
