const SCENES = Object.freeze({ xueye: '学业警示', xinli: '心理健康首次告知', yiban: '一般家校沟通', weiji: '危机前期' });
const WORKFLOW_STEPS = Object.freeze(require('./workflow-steps.json'));
const LEGACY_STAGES = new Map([
  ['已上报，做过研判', WORKFLOW_STEPS[0]],
  ['已经告诉家长', WORKFLOW_STEPS[1]],
  ['还在跟家长磨', WORKFLOW_STEPS[1]],
  ['在跟学生谈', WORKFLOW_STEPS[3]],
  ['在拉双方一起处理', WORKFLOW_STEPS[4]],
]);
// 原型「五、P1」快速标签：学业警示／就医疑虑／家长隐瞒／要求保密。
const CHIPS = new Set(['学业警示', '就医疑虑', '家长隐瞒', '要求保密']);
const CONTEXT_PRESETS = {
  parentReactionPreset: { not_contacted: '未沟通', disagrees: '已沟通但不认可', refuses: '已明确拒绝' },
  studentWishPreset: { not_discussed: '未涉及', willing: '愿意沟通', confidential: '要求对父母保密' }
};
class InputError extends Error {
  constructor(message) { super(message); this.code = 'INPUT_INVALID'; this.status = 400; }
}
function validatePrepareInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('请求必须是一个对象');
  if (typeof value.scene !== 'string' || !Object.hasOwn(SCENES, value.scene)) throw new InputError('请选择有效的沟通场景');
  const output = { scene: value.scene, sceneName: SCENES[value.scene] };
  for (const [field, max] of Object.entries({ situation: 1500, extra: 1000, parentReaction: 200, studentWish: 200, stage: 100 })) {
    if (value[field] !== undefined && typeof value[field] !== 'string') throw new InputError('输入字段格式不正确');
    output[field] = (value[field] || '').trim();
    if (output[field].length > max) throw new InputError('输入过长，请精简后提交，系统不会截断事实');
  }
  if (!output.situation) throw new InputError('请填写本次沟通所需的已知事实');
  output.stage = LEGACY_STAGES.get(output.stage) ?? output.stage;
  if (output.stage && !WORKFLOW_STEPS.includes(output.stage)) throw new InputError('请选择原型定义的沟通环节');
  for (const [field, options] of Object.entries(CONTEXT_PRESETS)) {
    const selected = value[field] === undefined ? '' : value[field];
    if (typeof selected !== 'string' || (selected && !Object.hasOwn(options, selected))) {
      throw new InputError('家长反应或学生意愿选项无效');
    }
    output[field] = selected;
  }
  if (value.chips !== undefined && (!Array.isArray(value.chips) || value.chips.length > 4 || value.chips.some(item => !CHIPS.has(item)))) {
    throw new InputError('快速标签格式不正确');
  }
  output.chips = [...new Set(value.chips || [])];
  if (value.inputRevision !== undefined) {
    if (!Number.isSafeInteger(value.inputRevision) || value.inputRevision < 0) throw new InputError('输入版本格式不正确');
    output.inputRevision = value.inputRevision;
  }
  return output;
}
module.exports = { SCENES, WORKFLOW_STEPS, CONTEXT_PRESETS, CHIPS, InputError, validatePrepareInput };
