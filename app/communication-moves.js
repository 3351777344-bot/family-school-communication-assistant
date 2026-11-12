const moves = {
  'check-disclosure': {
    title: '先确认可告知范围',
    why: '沟通前先核对学生意愿和可向家长说明的内容。',
    fields: ['studentWish', 'extra', 'situation'],
    reactions: ['希望先知道这次会谈哪些内容。'],
    reply: '我会先核对适合沟通的范围，再和您约时间。'
  },
  'review-records': {
    title: '先核对课程记录',
    why: '从可核对的记录开始，给双方留出补充和纠正的空间。',
    fields: ['situation'],
    reactions: ['对记录来源或记录时间有疑问。', '了解到的情况可能与课程记录不同。'],
    reply: '我想和您一起核对近期的学习情况，您方便时可以先聊聊您了解到的情况。'
  },
  'review-observations': {
    title: '说清可核对的观察',
    why: '具体的观察更容易核对，也便于家长补充。',
    fields: ['situation'],
    reactions: ['想了解观察发生的时间和具体表现。'],
    reply: '我想和您核对一下近期的具体情况，也听听您的观察。'
  },
  'hear-parent': {
    title: '听听家长的观察和顾虑',
    why: '先给家长说清楚顾虑的机会，再确定要核对的问题。',
    fields: ['parentReaction', 'situation'],
    reactions: ['想先补充自己了解到的情况。'],
    reply: '您最近留意到什么情况？有没有哪一点想先和我核对？'
  },
  'return-to-records': {
    title: '听到原因猜测时回到记录',
    why: '回应家长的顾虑，再回到可核对的情况。',
    fields: ['parentReaction', 'situation'],
    reactions: ['可能先说出自己对原因的理解。'],
    reply: '我们可以先一起核对记录，再了解原因。'
  },
  'respect-wish': {
    title: '给学生留出表达意愿的空间',
    why: '先核对学生愿意参与的方式，便于三方商量。',
    fields: ['studentWish', 'situation'],
    reactions: ['想知道学生愿意以什么方式参与。'],
    reply: '这件事也想听听孩子的想法，再一起商量怎么沟通。'
  },
  'check-policy': {
    title: '另行核对制度问题',
    why: '适用条件与后续安排需要依据校内口径核实。',
    fields: ['extra', 'parentReaction', 'situation'],
    reply: '如果需要了解学校规定，我先核对适用口径，再和您说明。',
    question: '接下来适用什么规定？'
  },
  'study-support': {
    title: '商量一件可行的学习支持',
    why: '先核对情况，再把协助落实到一件具体的事。',
    fields: ['situation', 'studentWish'],
    reactions: ['想知道近期可以怎样配合。'],
    reply: '情况核对后，我们可以和孩子商量一件近期做得到的事。'
  },
  'contact-time': {
    title: '商量双方方便的联系时间',
    why: '具体时间由双方商量，给需要确认的事项留出空间。',
    fields: ['studentWish', 'parentReaction', 'situation'],
    reactions: ['现在不方便详谈，希望另约时间。'],
    reply: '您看什么时候方便？我们可以一起商量下一次联系的时间。'
  }
};

const scenes = {
  xueye: ['review-records', 'hear-parent', 'return-to-records', 'respect-wish', 'check-policy', 'study-support', 'contact-time'],
  xinli: ['check-disclosure', 'review-observations', 'hear-parent', 'respect-wish', 'contact-time'],
  yiban: ['review-observations', 'hear-parent', 'respect-wish', 'contact-time']
};

// These labels identify the speaker or field without interpreting the input.
const fieldLabels = {
  situation: '学生情况原文',
  parentReaction: '家长反应原文',
  studentWish: '学生意愿原文',
  extra: '补充说明原文'
};

function findMoves(scene) {
  return new Map(scenes[scene].map(id => [id, moves[id]]));
}

function inputEvidence(input) {
  return new Map(Object.entries(fieldLabels)
    .filter(([id]) => input[id])
    .map(([id, label]) => [id, { id, label, quote: input[id] }]));
}

module.exports = { findMoves, inputEvidence, MOVE_IDS: new Set(Object.keys(moves)) };
