const test = require('node:test');
const assert = require('node:assert/strict');
const { findReferences, selectSources, explainSelection } = require('../../app/knowledge');
const { readSourceOptions } = require('../../app/config');

const BASE = { tiering: true, maxPerMove: 8, exposeApplications: false };
const RETRIEVAL = { ...BASE, selection: 'retrieval' };

const card = (id, patch) => ({
  id, version: 1, title: id, excerpt: '占位', supports: ['hear-parent'], tier: 2,
  passages: { 'hear-parent': [{ quote: '六字占位原文', action: '占位动作' }] },
  ...patch
});

test('默认使用检索式选取，order 仍可显式切回', () => {
  assert.equal(readSourceOptions().selection, 'retrieval');
  assert.equal(readSourceOptions({ SOURCE_SELECTION: 'order' }).selection, 'order');
});

test('retrieval 排除与输入矛盾的卡片，输入未填时不排除', () => {
  const refs = findReferences({ scene: 'xinli', chips: [] });
  const ids = (context, options = RETRIEVAL) =>
    selectSources(refs, 'check-disclosure', context, options).map(item => item.id);

  assert(ids({}).includes('teacher-private-information'), '未填学生意愿时不应排除');
  assert(ids({ studentWishPreset: 'confidential' }).includes('teacher-private-information'));
  assert(!ids({ studentWishPreset: 'willing' }).includes('teacher-private-information'));
});

test('家长反应不匹配时不出现针对顾虑的卡', () => {
  const refs = findReferences({ scene: 'xinli', chips: [] });
  const ids = context => selectSources(refs, 'hear-parent', context, RETRIEVAL).map(item => item.id);

  assert(!ids({ parentReactionPreset: 'not_contacted' }).includes('teacher-parent-concerns'));
  assert(ids({ parentReactionPreset: 'refuses' }).includes('teacher-parent-concerns'));
});

test('retrieval 仍受注入预算约束，且至少有 1 张', () => {
  const refs = findReferences({ scene: 'xinli', chips: [] });
  for (const budget of [1, 4, 8]) {
    const size = selectSources(refs, 'hear-parent', {}, { ...RETRIEVAL, maxPerMove: budget }).length;
    assert(size >= 1 && size <= budget, '预算 ' + budget + ' 实际 ' + size);
  }
  assert(selectSources(refs, 'hear-parent', {}, { ...RETRIEVAL, maxPerMove: 0 }).length > 8);
});

test('只返回支持该步骤的资料', () => {
  const refs = findReferences({ scene: 'xinli', chips: [] });
  for (const source of selectSources(refs, 'hear-parent', {}, RETRIEVAL)) {
    assert(source.supports.includes('hear-parent'), source.id);
  }
});

test('矛盾卡片被排除且没有通用卡时回落到全部卡片', () => {
  const refs = new Map([
    ['a', card('a', { when: { parentReaction: ['refuses'] } })],
    ['b', card('b', { when: { parentReaction: ['disagrees'] } })]
  ]);
  const ids = selectSources(refs, 'hear-parent', { parentReactionPreset: 'not_contacted' }, RETRIEVAL)
    .map(item => item.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
});

test('退役卡不参与选择', () => {
  const refs = new Map([['x', card('x', { status: 'retired' })]]);
  assert.equal(selectSources(refs, 'hear-parent', {}, RETRIEVAL).length, 0);
});

test('explainSelection 给出得分和命中原因', () => {
  const refs = findReferences({ scene: 'xinli', chips: [] });
  const hit = explainSelection(refs, 'hear-parent', { parentReactionPreset: 'refuses' }, RETRIEVAL)
    .find(row => row.id === 'teacher-parent-concerns');
  assert(hit && hit.matched === true && hit.selected === true);

  const miss = explainSelection(refs, 'hear-parent', { parentReactionPreset: 'not_contacted' }, RETRIEVAL)
    .find(row => row.id === 'teacher-parent-concerns');
  assert.equal(miss.matched, false);
  assert.equal(miss.selected, false);
});
