const cards = require('./kb_v3.json');
const referenceCards = require('./reference-cards.json');
const teacherMethods = require('./teacher-methods.json');
const { MOVE_IDS } = require('./communication-moves');
const { readSourceOptions } = require('./config');

// Only these excerpts from the versioned, generic summaries go to the model.
// Each excerpt has a staff-facing application for the specific move it supports.
const methodsByVersion = {
  'method-academic-facts': {
    version: 1,
    passages: {
      'review-records': [
        { quote: '开场只讲三类可核对的事实：缺课次数、未交作业次数、任课老师反映的课堂表现', action: '开场只用已经核实的记录。没有核实的次数或课堂表现留待补充。' },
        { quote: '原因留到家长说完再谈', action: '先讲记录显示了什么。听完家长的说法，再商量先核对哪处差异。' }
      ]
    }
  },
  'method-return-to-facts': {
    version: 1,
    passages: {
      'return-to-records': [
        { quote: '先承认这是常见印象，再把话题拉回具体数据', action: '先接住家长的顾虑，再邀请对方一起核对一条具体记录。' },
        { quote: '只谈“这学期发生了什么”', action: '把争议落到一件可查的事，例如哪次记录、什么时候出现、还缺谁的说明。' }
      ]
    }
  },
  'method-observations': {
    version: 1,
    passages: {
      'review-observations': [
        { quote: '把“孩子不听话”换成具体发生了什么', action: '先说什么时候、在哪里观察到了什么。没有核实的原因留到后面讨论。' },
        { quote: '用具体行为代替评价词', action: '把对学生的评价换成已经核实且可告知的行为，给家长留出补充的空间。' }
      ]
    }
  },
  'method-specific-request': {
    version: 1,
    passages: {
      'study-support': [
        { quote: '一次只说一件事', action: '从双方都同意先处理的一件学习困难开始，商量一个近期能尝试的支持方式。' }
      ],
      'contact-time': [
        { quote: '请求要具体到可执行', action: '把「改天再聊」变成可确认的联系安排，例如请双方提出各自方便的时段。' },
        { quote: '双方的需要—具体请求', action: '先问双方希望通过哪种方式继续沟通，再商量合适的时间。' }
      ]
    }
  }
};

const methods = cards.filter(card => card.status === '公开方法' && card.source.type === 'know' && card.id);
const ids = new Set();
for (const card of methods) {
  if (!/^method-[a-z-]+$/.test(card.id) || ids.has(card.id) ||
      !Number.isInteger(card.version) || card.version < 1) {
    throw new Error('通用方法资料卡编号或版本无效');
  }
  ids.add(card.id);
}

// 老师课件卡：加载时就校验出处、步骤和摘录长度，避免坏数据静默进模型。
for (const card of teacherMethods) {
  if (!/^teacher-[a-z0-9-]+$/.test(card.id) || !Number.isInteger(card.version) || card.version < 1) {
    throw new Error('老师课件资料卡编号或版本无效：' + card.id);
  }
  if (!card.title || !card.sourceLocation?.title || !card.sourceLocation?.locator) {
    throw new Error('老师课件资料卡缺少出处：' + card.id);
  }
  if (!Array.isArray(card.supports) || !card.supports.length) {
    throw new Error('老师课件资料卡缺少适用步骤：' + card.id);
  }
  const moves = Object.keys(card.passages ?? {});
  if (!moves.length) throw new Error('老师课件资料卡缺少摘录：' + card.id);
  for (const moveId of moves) {
    if (!MOVE_IDS.has(moveId) || !card.supports.includes(moveId)) {
      throw new Error('老师课件资料卡步骤不匹配：' + card.id + '.' + moveId);
    }
    for (const passage of card.passages[moveId]) {
      if (typeof passage.quote !== 'string' || passage.quote.length < 6 || passage.quote.length > 140) {
        throw new Error('老师课件资料卡摘录长度不合规：' + card.id + '.' + moveId);
      }
      if (typeof passage.action !== 'string' || !passage.action.trim()) {
        throw new Error('老师课件资料卡缺少可执行动作：' + card.id + '.' + moveId);
      }
    }
  }
}

// 原型只要求资料「有可靠来源并经相关人员审核」，没有规定审核状态门禁。
// 因此候选卡按最新版本参与生成，审核状态如实标注，由辅导员看到并自行判断。
function admittedReferences(records, scene) {
  const latest = new Map();
  for (const card of records) {
    if (!card || typeof card.id !== 'string' || !/^candidate-[a-z-]+$/.test(card.id) ||
        !Number.isSafeInteger(card.version) || card.version < 1) continue;
    const previous = latest.get(card.id);
    if (!previous || card.version > previous.card.version) latest.set(card.id, { card, duplicate: false });
    else if (card.version === previous.card.version) previous.duplicate = true;
  }
  const references = new Map();
  for (const { card, duplicate } of latest.values()) {
    const { review, source } = card;
    if (duplicate) continue;
    if (!Array.isArray(card.scenes) || !card.scenes.includes(scene) ||
        !Array.isArray(card.supports) || !card.supports.length ||
        !source?.title || !source.locator || !card.excludedUse || !card.title || !card.excerpt) continue;
    references.set(card.id, {
      id: card.id, version: card.version, title: card.title, excerpt: card.excerpt,
      reviewStatus: review?.status === 'approved' ? '已审核' : '待核对',
      reviewer: review?.reviewer ?? null,
      supports: card.supports,
      sourceLocation: source, excludedUse: card.excludedUse,
      tier: 3
    });
  }
  return references;
}

function findReferences(input) {
  const methodsForScene = methods
    .filter(card => card.scene.includes('*') || card.scene.includes(input.scene))
    .filter(card => !card.trigger || card.trigger.some(tag => input.chips.includes(tag)))
    .filter(card => {
      const method = methodsByVersion[card.id];
      return method?.version === card.version && Object.values(method.passages).flat()
        .every(passage => card.point.includes(passage.quote));
    })
    .map(card => [card.id, {
      id: card.id,
      version: card.version,
      title: card.title,
      excerpt: card.point,
      reviewStatus: '待核实',
      sourceLocation: { title: card.source.cite, locator: `app/kb_v3.json · ${card.id}` },
      supports: Object.keys(methodsByVersion[card.id].passages),
      passages: methodsByVersion[card.id].passages,
      tier: 1
    }]);
  const teacherReferences = teacherMethods
    .filter(card => !Array.isArray(card.scenes) || card.scenes.includes('*') || card.scenes.includes(input.scene))
    .map(card => [card.id, {
      ...card,
      excerpt: [...new Set(Object.values(card.passages).flat().map(passage => passage.quote))].join('；'),
      tier: 2
    }]);
  return new Map([...methodsForScene, ...teacherReferences, ...admittedReferences(referenceCards, input.scene)]);
}

// 资料权威度：1 通用方法卡（公开方法）、2 老师课件卡（待老师核对）、3 候选卡（项目自写、待核对）。
// 候选卡只在没有更高一级的资料覆盖该步骤时才进入选项，避免「最没背书的资料被引用最多」。
// 三个开关的名称、默认值和校验集中在 app/config.js 的 readSourceOptions()。
function sourcesForMove(references, moveId) {
  const { tiering, maxPerMove, exposeApplications } = readSourceOptions();
  const all = [...references.values()].filter(card => card.supports.includes(moveId));
  const reviewed = all.filter(card => (card.tier ?? 3) <= 2);
  let pool = tiering && reviewed.length ? reviewed : all;
  if (maxPerMove > 0 && pool.length > maxPerMove) pool = pool.slice(0, maxPerMove);
  // 顺序沿用资料库自身顺序（通用方法卡 → 老师课件卡 → 候选卡）；上限只是防选项爆炸，
  // 不做相关性猜测，卡片优先级应该由资料库顺序表达，而不是这里临时排序。
  return pool.map(card => {
    const curated = card.passages?.[moveId];
    return {
      id: card.id, version: card.version, title: card.title,
      passages: curated ? curated.map(item => item.quote) : [card.excerpt],
      ...(exposeApplications && curated ? { applications: curated.map(item => item.action) } : {}),
      ...(card.excludedUse ? { excludedUse: card.excludedUse } : {}),
    };
  });
}

function findGrounding(reference, moveId, quote) {
  if (typeof quote !== 'string' || quote.length < 6 || quote.length > 140 || quote.trim() !== quote) return null;
  const curated = reference.passages?.[moveId];
  if (curated) return curated.find(item => item.quote === quote) ?? null;
  return reference.excerpt.includes(quote) ? { quote, action: null } : null;
}

module.exports = { findReferences, admittedReferences, sourcesForMove, findGrounding, cardCount: cards.length };
