// 原型没有把「可告知范围」列为输入或阻断条件，所以这里只产生提示，不再暂停生成。
// 是否告知家长由辅导员判断（原型「二、使用者与系统边界」「八、设计原则 3」）。
const studentRequest = /^(?:学生(?:明确)?(?:表示|说|提出|要求|希望)?[：:，,“「『"\s]*)?(?:我)?(?:希望|要求|请)?(?:暂时|暂|先)?(?:不要|不愿意?|不同意|不希望|不想|不能|别|不)(?:向|让)?(?:告知|告诉|联系|通知)?(?:家长|父母)/;
const familyMustNotKnow = /^(?:学生(?:明确)?(?:表示|说|提出|要求|希望)?[：:，,“「『"\s]*)?(?:家长|父母)(?:暂时|先)?(?:别|不要|不能)知道/;
const confidentiality = /^学生(?:明确)?(?:要求|希望|请辅导员)(?:暂时)?保密/;
const studentOnly = /^(?:目前|这次|本次)?只(?:想|准备|打算)?(?:先)?(?:和|与|向|跟)学生(?:确定|确认|核对|了解)/;

const CONFIDENTIAL_NOTE = '输入里有学生要求保密或只向学生核对的表述。原型 P4 把是否告知交给辅导员判断，因此本次仍生成底稿；发给家长前请自行核实可告知范围，系统不替你确认。';
const STUDENT_ONLY_NOTE = '本次似乎只想先和学生核对。底稿是按“可能要和家长沟通”准备的，若本次不联系家长，可忽略底稿部分。';

function disclosureNotes(input) {
  const clauses = [input.situation, input.studentWish, input.extra]
    .flatMap(value => value.split(/[。！？；\n]/)).map(value => value.trim());
  if (input.studentWishPreset === 'confidential' || input.chips.includes('要求保密') ||
      clauses.some(value => studentRequest.test(value) || familyMustNotKnow.test(value) || confidentiality.test(value))) {
    return [CONFIDENTIAL_NOTE];
  }
  if (clauses.some(value => studentOnly.test(value))) return [STUDENT_ONLY_NOTE];
  return [];
}

function obviousMissingFacts(input) {
  // 只识别单独成句的占位表述；其它情况交给模型判断（原型 E1 不阻断使用）。
  if (input.extra || input.studentWish || input.parentReaction) return [];
  const situation = input.situation.replace(/[。！？!?]+$/, '');
  if (/^家长(?:想|希望|需要)联系(?:任课)?老师$/.test(situation)) return ['goal'];
  if (/^(?:学生)?(?:成绩|学习情况)(?:不佳|不好|不理想)$/.test(situation)) return ['observations'];
  return [];
}

module.exports = { disclosureNotes, obviousMissingFacts };
