const { findGrounding } = require('./knowledge');

const MISSING_FACTS = {
  event: '这次联系由什么事情触发',
  observations: '有哪些可以核对的具体情况',
  goal: '希望和家长先确认或商量什么',
  disclosure: '哪些信息已经确认可以向家长说明'
};
const ROOT_KEYS = ['moves', 'points', 'draft', 'faq', 'missingFacts', 'usedEvidence'];
// 原型「二、功能边界」：不提供诊断结论；「五、P2」：法律条款、诊断、处分或上报
// 必须有可靠来源并经审核，本版没有已审核来源，所以这类表述直接挡在底稿之外。
const PROHIBITED = [
  { re: /(抑郁症|焦虑症|双相|精神分裂|强迫症|确诊|患有|诊断为)/, why: '不得出现诊断性表述' },
  // 处分、上报、学籍这类话不是不能说，而是只能「承认问题 + 说明要核对后回复」，
  // 不能替学校给出结论。所以这一条只有在同一句或下一句没有转圜表述时才拦。
  { re: /(记过|警告处分|留校察看|开除学籍|退学处理|休学|档案|上报学校|报送学校)/, why: '不得替学校给出处分、上报或学籍处置结论', guarded: true }
];
const DEFERRAL = new RegExp([
  '(核对|确认|核实|查证|问清)[^。！？!?；;\\n]{0,10}回复',
  '不能当场|无法当场|没法当场|不能凭印象',
  '涉及[^。！？!?；;\\n]{0,8}规定',
  '以[^。！？!?；;\\n]{0,6}为准',
  '校内口径|按学校|以学校',
  '不替[^。！？!?；;\\n]{0,4}下?结论',
  '没有(现成的?|准确的?)?(校内)?(规定|依据|口径)'
].join('|'));
const LIMITS = { title: 40, why: 160, reply: 200, q: 60, a: 320, draftMin: 40, draftMax: 1800 };

class OutputError extends Error {
  constructor(field, expectation) {
    super(field + ' ' + expectation);
    this.code = 'MODEL_OUTPUT_INVALID';
    this.status = 502;
  }
}

function objectWithKeys(value, field, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OutputError(field, '须为对象');
  const missing = required.filter(key => !Object.hasOwn(value, key));
  if (missing.length) throw new OutputError(field, '缺少字段 ' + missing.join('、'));
  const allowed = [...required, ...optional];
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) {
    throw new OutputError(field, '只允许约定字段 ' + allowed.join('、') + '，多了 ' + extra.join('、'));
  }
}

function checkList(value, field, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new OutputError(field, '须为 ' + min + ' 至 ' + max + ' 个条目');
  }
  return value;
}

function text(value, field, limit) {
  if (typeof value !== 'string' || !value.trim()) throw new OutputError(field, '须为非空字符串');
  if (value.length > limit) throw new OutputError(field, '须在 ' + limit + ' 字以内');
  return value.trim();
}

function pickText(row, keys) {
  for (const key of keys) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key];
  }
  return undefined;
}

function splitSentences(value) {
  return value.split(/(?<=[。！？!?；;\n])/).map(item => item.trim()).filter(Boolean);
}

function scanProhibited(value, field) {
  const sentences = splitSentences(value);
  for (const { re, why, guarded } of PROHIBITED) {
    for (const [index, sentence] of sentences.entries()) {
      const hit = sentence.match(re);
      if (!hit) continue;
      if (guarded && (DEFERRAL.test(sentence) || DEFERRAL.test(sentences[index + 1] ?? ''))) continue;
      throw new OutputError(field, why + '（命中：' + hit[0] + '）');
    }
  }
}

function checkEvidence(rows, evidence) {
  checkList(rows, 'usedEvidence', 0, 8);
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const field = 'usedEvidence[' + index + ']';
    objectWithKeys(row, field, ['id', 'quote']);
    const source = evidence.get(row.id);
    if (!source) throw new OutputError(field + '.id', '须为本次提供的输入编号：' + [...evidence.keys()].join('、'));
    const quote = text(row.quote, field + '.quote', 400);
    if (!source.quote.includes(quote)) {
      throw new OutputError(field + '.quote', '须逐字取自该输入编号的原文，不得改写：' + row.id);
    }
    if (seen.has(quote)) continue;
    seen.add(quote);
  }
  return rows;
}

function checkDigits(draft, inputText) {
  const missing = (draft.match(/\d+/g) || []).filter(run => !inputText.includes(run));
  if (missing.length) {
    throw new OutputError('draft', '出现了输入原文里没有的具体数字（' + [...new Set(missing)].join('、') + '），不得编造次数、日期或时长');
  }
}

function parseJson(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  try {
    return JSON.parse(value);
  } catch {
    // 有的模型会把 JSON 包在 ```json 代码块里，这属于格式噪音，剥掉再试一次。
    const stripped = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (stripped === value) throw new OutputError('根节点', '须为单个 JSON 对象');
    try {
      return JSON.parse(stripped);
    } catch {
      throw new OutputError('根节点', '须为单个 JSON 对象');
    }
  }
}

function parsePlan(content, { moves, evidence, references, inputText }) {
  const plan = parseJson(content);
  objectWithKeys(plan, '根节点', ROOT_KEYS);
  const missing = checkList(plan.missingFacts, 'missingFacts', 0, 4);
  if (missing.some(id => typeof id !== 'string' || !Object.hasOwn(MISSING_FACTS, id))) {
    throw new OutputError('missingFacts', '只能使用约定的缺失事实代码');
  }

  const selected = new Map();
  for (const [index, row] of checkList(plan.moves, 'moves', 3, 5).entries()) {
    const field = 'moves[' + index + ']';
    // 没有引用时模型常常直接省略这三个字段，而不是写 null，按 null 处理。
    objectWithKeys(row, field, ['id'], ['factIds', 'sourceId', 'sourceVersion', 'sourceQuote']);
    const move = moves.get(row.id);
    if (!move || selected.has(row.id)) throw new OutputError(field + '.id', '须为本场景中未重复的步骤编号：' + [...moves.keys()].join('、'));
    const factIds = checkList(row.factIds ?? [], field + '.factIds', 0, 2);
    if (factIds.some(id => !evidence.has(id) || !move.fields.includes(id))) {
      throw new OutputError(field + '.factIds', '须为该步骤可用且本次确实提供的输入编号');
    }
    const sourceId = row.sourceId ?? null;
    const sourceQuote = row.sourceQuote ?? null;
    const reference = sourceId === null ? null : references.get(sourceId);
    if (sourceId !== null && !reference?.supports.includes(row.id)) {
      const allowed = [...references.values()].filter(card => card.supports.includes(row.id)).map(card => card.id);
      throw new OutputError(field + '.sourceId', '只能取自该步骤自己的 sources 列表（可用：' + (allowed.join('、') || '无') + '）或 null，不能跨步骤取用');
    }
    if (reference ? (row.sourceVersion ?? null) !== reference.version : (row.sourceVersion ?? null) !== null) {
      throw new OutputError(field + '.sourceVersion', '须使用对应资料的当前版本，无引用时为 null');
    }
    const grounding = reference ? findGrounding(reference, row.id, sourceQuote) : null;
    if (reference ? !grounding : sourceQuote !== null) {
      throw new OutputError(field + '.sourceQuote', '须使用该步骤提供的资料原文摘录，无引用时为 null');
    }
    selected.set(row.id, { factIds, reference, grounding });
  }

  const points = new Map();
  const moveIds = [...selected.keys()];
  for (const [index, row] of checkList(plan.points, 'points', selected.size, selected.size).entries()) {
    const field = 'points[' + index + ']';
    // 模型通常按 moves 顺序给出要点，moveId 可以省略；给了就必须能对上。
    objectWithKeys(row, field, ['title', 'why', 'reply'], ['moveId']);
    const moveId = row.moveId === undefined ? moveIds[index] : row.moveId;
    if (!selected.has(moveId)) throw new OutputError(field + '.moveId', '须为本次已选步骤的编号：' + moveIds.join('、'));
    if (points.has(moveId)) throw new OutputError(field + '.moveId', '每个步骤只能有一个要点');
    const point = {
      title: text(row.title, field + '.title', LIMITS.title),
      why: text(row.why, field + '.why', LIMITS.why),
      reply: text(row.reply, field + '.reply', LIMITS.reply)
    };
    scanProhibited(point.title + point.why + point.reply, field);
    points.set(moveId, point);
  }
  if (points.size !== selected.size) throw new OutputError('points', '须覆盖本次选中的每一个步骤');

  const draft = text(plan.draft, 'draft', LIMITS.draftMax);
  if (draft.length < LIMITS.draftMin) throw new OutputError('draft', '过短，至少 ' + LIMITS.draftMin + ' 字才是一份可用的家长底稿');
  if (/\[[^\]]*\]/.test(draft)) throw new OutputError('draft', '不得保留方括号占位符，请写出完整句子');
  scanProhibited(draft, 'draft');
  checkDigits(draft, inputText);

  const faq = checkList(plan.faq, 'faq', 0, 3).map((row, index) => {
    const field = 'faq[' + index + ']';
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new OutputError(field, '须为对象');
    // 字段名在不同模型上常写成 question/answer，按别名取值，多余的键忽略。
    const q = text(pickText(row, ['q', 'question', '问']), field + '.q', LIMITS.q);
    const a = text(pickText(row, ['a', 'answer', '答']), field + '.a', LIMITS.a);
    scanProhibited(q + a, field);
    return { q, a };
  });

  checkEvidence(plan.usedEvidence, evidence);
  return { selected, points, draft, faq, missingFacts: missing.map(id => MISSING_FACTS[id]) };
}

module.exports = { MISSING_FACTS, PROHIBITED, OutputError, parsePlan };
