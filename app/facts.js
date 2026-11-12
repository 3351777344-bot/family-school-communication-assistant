const { inputEvidence } = require('./communication-moves');

const attributed = /^\s*(?:学生(?:说|称|自述|表示|反馈)|(?:课程)?平台(?:显示|记录)|(?:任课)?老师(?:说|反馈|记录)|家长(?:说|称|反馈|表示))/;
const uncertainty = /尚待核实|有待核实|待核实|待核对|尚未核实|还[没未]核实|未确认|还需核实|说法不一致|记录不一致|原因未知/;
const speculation = /猜测|推测|疑似|可能|估计|听说/;
const context = /^(?:已(?:和|与)学生确认|学生(?:同意|不同意|希望|要求)|允许|只想|(?:希望|准备|想|打算)(?:先|和|与|向|邀请|约|请)|沟通目的|请(?:忽略|顺便|承诺)|原因(?:未知|不明))/;
const followUp = /^(?:相关)?(?:记录|情况|信息|具体情况|双方说法|这一点)?(?:尚|仍|还)?(?:待|需|需要)(?:进一步)?(?:核实|核对|确认)[。！？；;]?$/;
const timeText = /\d{4}年\d{1,2}月\d{1,2}[日号]|\d{1,2}月\d{1,2}[日号]|(?:近|过去)[一二两三四五六七八九十\d]+(?:天|周|个月)|本学期|上学期|本月|上月|本周|上周|今天|昨天|近期|最近/;
const redacted = /\[(?:手机号|身份证|学号|邮箱|电话)\]/;
const quoteEnds = new Map([['“', '”'], ['「', '」'], ['『', '』'], ['"', '"']]);

function splitSpans(text, boundary) {
  const spans = [];
  const quotes = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === quotes.at(-1)) quotes.pop();
    else if (quoteEnds.has(character)) quotes.push(quoteEnds.get(character));
    else if (!quotes.length) {
      const end = boundary(character, index);
      if (end === null) continue;
      spans.push([start, end]);
      start = index + 1;
    }
  }
  spans.push([start, text.length]);
  return spans;
}

function provenance(field, quote) {
  if (/^(?:课程)?平台(?:显示|记录)|^(?:课程|出勤|作业)记录/.test(quote)) return ['record', '课程记录或平台'];
  if (/^学生(?:说|称|自述|表示|反馈)/.test(quote)) return ['report', '学生自述'];
  if (/^(?:任课)?老师(?:说|反馈|记录)/.test(quote)) return ['report', '教师反馈'];
  if (/^(?:家长(?:说|称|反馈|表示))/.test(quote) || field === 'parentReaction') return ['report', '家长反馈'];
  if (/^辅导员(?:近[^，。]{0,6})?观察到/.test(quote)) return ['observation', '辅导员观察'];
  if (/^(?:近[^，。]{0,6})?观察到/.test(quote)) return ['observation', '观察者待核对'];
  if (field === 'studentWish') return ['context', '学生意愿'];
  return ['unclassified', null];
}

// 供原型 P4「事实核对清单」逐条比对原文，不再作为入稿授权。
function factCandidates(evidence) {
  const facts = [];
  for (const { id: field, label, quote: original } of evidence.values()) {
    let previous = [];
    for (const [sentenceStart, sentenceEnd] of splitSpans(original, (character, index) => {
      if (character === '\n') return index;
      return '。！？；;'.includes(character) ? index + 1 : null;
    })) {
      const text = original.slice(sentenceStart, sentenceEnd);
      // Keep ordinary commas and qualifications. Split when the next clause
      // explicitly changes its speaker or record source.
      const pieces = splitSpans(text, (character, index) =>
        '，,'.includes(character) && attributed.test(text.slice(index + 1)) ? index : null);
      const followUpNote = followUp.test(text.trim());
      if (followUpNote) {
        for (const fact of previous) fact.uncertain = true;
      }
      const qualifiers = uncertainty.test(text);
      const group = pieces.length > 1 && qualifiers ? `${field}:${sentenceStart}` : null;
      const current = [];

      for (const [left, right] of pieces) {
        const part = text.slice(left, right);
        const quote = part.trim();
        if (!quote || /^[。！？；;]+$/.test(quote)) continue;
        const from = sentenceStart + left + part.length - part.trimStart().length;
        const to = from + quote.length;
        const [sourceKind, source] = provenance(field, quote);
        let kind = sourceKind;
        if (followUpNote || context.test(quote)) kind = 'context';
        else if (speculation.test(quote)) kind = 'speculation';
        current.push({
          id: `${field}:${from}:${to}`, field, start: from, end: to, quote,
          source: source || label,
          time: quote.match(timeText)?.[0] ?? null,
          kind, uncertain: followUpNote || uncertainty.test(quote) || Boolean(group), group,
          eligible: kind !== 'context' && kind !== 'speculation' && !redacted.test(quote)
        });
      }
      facts.push(...current);
      if (current.length && !followUpNote) previous = current;
    }
  }
  return facts;
}

module.exports = { factCandidates };
