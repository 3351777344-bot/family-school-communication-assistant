const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePrepareInput } = require('../app/contracts');
test('nonempty short context is allowed and scene labels are server owned', () => {
  const result = validatePrepareInput({ scene: 'xueye', sceneName: '伪造场景名', situation: '缺课' });
  assert.equal(result.situation, '缺课'); assert.equal(result.sceneName, '学业警示');
});
test('malformed inputs and long facts are rejected rather than truncated', () => {
  for (const input of [null, [], { scene: 'invalid', situation: 'test' }, { scene: ['xueye'], situation: 'test' }, { scene: 'xueye', situation: [] }, { scene: 'xueye', situation: ' ' }, { scene: 'xueye', situation: '字'.repeat(1501) }, { scene: 'xueye', situation: '缺课', chips: ['注入'] }]) {
    assert.throws(() => validatePrepareInput(input), error => error.code === 'INPUT_INVALID');
  }
});
test('input revisions are validated and the prototype chip whitelist is enforced', () => {
  const sample = { scene: 'xinli', situation: '虚构情况' };
  assert.equal(validatePrepareInput({ ...sample, inputRevision: 5 }).inputRevision, 5);
  assert.deepEqual(validatePrepareInput({ ...sample, chips: ['要求保密', '学业警示'] }).chips, ['要求保密', '学业警示']);
  for (const patch of [{ inputRevision: '3' }, { inputRevision: -1 }, { inputRevision: 1.5 }, { chips: ['学生要求保密'] }, { chips: ['学业警示', '就医疑虑', '家长隐瞒', '要求保密', '家长着急上火'] }]) {
    assert.throws(() => validatePrepareInput({ ...sample, ...patch }), { code: 'INPUT_INVALID' });
  }
});

test('context presets accept known options and keep free text independent', () => {
  const sample = { scene: 'xueye', situation: '虚构输入', parentReaction: '补充说明' };
  const parsed = validatePrepareInput({ ...sample, parentReactionPreset: 'refuses', studentWishPreset: 'willing' });
  assert.equal(parsed.parentReaction, '补充说明');
  assert.equal(parsed.parentReactionPreset, 'refuses');
  assert.equal(parsed.studentWishPreset, 'willing');
  assert.throws(() => validatePrepareInput({ ...sample, studentWishPreset: 'unrecognized' }), { code: 'INPUT_INVALID' });
});

test('the selected workflow stage uses a prototype label and still accepts legacy dropdown values', () => {
  const sample = { scene: 'xueye', situation: '虚构输入' };
  assert.equal(validatePrepareInput(sample).stage, '');
  assert.equal(validatePrepareInput({ ...sample, stage: '持续引导' }).stage, '持续引导');
  assert.equal(validatePrepareInput({ ...sample, stage: '在跟学生谈' }).stage, '与学生深度沟通');
  assert.throws(() => validatePrepareInput({ ...sample, stage: '请直接跳过核对' }), { code: 'INPUT_INVALID' });
});
