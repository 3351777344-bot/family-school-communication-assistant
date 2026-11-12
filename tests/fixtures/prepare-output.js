const DRAFT =
  '家长您好。本周课程平台显示有一次作业未交，学生说已经上传，这条记录还在核对中。' +
  '我想先听听您那边了解到的情况，也想了解您最关心的是什么。等情况核对清楚后，我们再一起商量下一步怎么配合。' +
  '您看什么时候方便通个电话？';

const TITLES = ['先核对作业记录', '听听家长的观察和顾虑', '商量双方方便的联系时间'];
const WHYS = [
  '从可核对的记录开始，给双方留出补充和纠正的空间。',
  '先给家长说清顾虑的机会，再确定这次要核对的问题。',
  '具体时间由双方商量，给需要确认的事项留出空间。',
];
const REPLIES = [
  '我想和您一起核对近期的作业提交记录，您方便时可以先说说您了解到的情况。',
  '您最近留意到什么情况？有没有哪一点想先和我核对？',
  '您看什么时候方便？我们可以一起商量下一次联系的时间。',
];

function outputFixture(scene = 'xueye') {
  const first =
    scene === 'xueye'
      ? {
          id: 'review-records',
          factIds: ['situation'],
          sourceId: 'method-academic-facts',
          sourceVersion: 1,
          sourceQuote: '开场只讲三类可核对的事实：缺课次数、未交作业次数、任课老师反映的课堂表现',
        }
      : {
          id: 'review-observations',
          factIds: ['situation'],
          sourceId: 'method-observations',
          sourceVersion: 1,
          sourceQuote: '用具体行为代替评价词',
        };
  const moves = [
    first,
    { id: 'hear-parent', factIds: [], sourceId: null, sourceVersion: null, sourceQuote: null },
    {
      id: 'contact-time',
      factIds: ['situation'],
      sourceId: 'method-specific-request',
      sourceVersion: 1,
      sourceQuote: '请求要具体到可执行',
    },
  ];
  return {
    moves,
    points: moves.map((move, index) => ({
      moveId: move.id,
      title: TITLES[index],
      why: WHYS[index],
      reply: REPLIES[index],
    })),
    draft: DRAFT,
    faq: [{ q: '这次会怎么处理？', a: '这次先核对记录，处理方式我再向您说明。' }],
    missingFacts: [],
    usedEvidence: [],
  };
}

module.exports = { outputFixture, DRAFT };
