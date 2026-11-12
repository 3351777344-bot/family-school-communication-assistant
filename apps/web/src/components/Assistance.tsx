import type { Preparation } from "../types";
import { Dialog } from "./Dialog";

const guidance = {
  manual_review: {
    title: "先按校内流程核实安全情况",
    steps: [
      "请辅导员核实相关情况，按学校现行流程联系心理中心或承担专业研判的校内人员。",
      "涉及是否告知家长或如何处置，请交由有职责的校内人员按流程研判。",
    ],
  },
  disclosure_pending: {
    title: "先核实学生意愿与可告知范围",
    steps: [
      "先和学生核对哪些信息可以说明、哪些需要保密。",
      "披露范围或例外有疑问时，请向院系负责人员或校内心理中心核对适用流程。",
    ],
  },
  needs_information: {
    title: "先补充事实，或请校内同事协助核实",
    steps: [
      "按工作台的缺项提示核对联系目的、具体事件或已有观察。",
      "事实无法确认或超出本人职责时，请向院系负责人员或相应校内专业人员核实。",
    ],
  },
  ready: {
    title: "沟通卡住或需要专业判断时",
    steps: [
      "先暂停拟稿，梳理卡在哪一步、哪些情况仍待核实。",
      "按学校现行流程找院系负责人员协助。涉及心理健康或安全判断时，请联系心理中心或相应校内专业人员。",
    ],
  },
};

export function Assistance({ status, onClose }: {
  status: Preparation["status"];
  onClose: () => void;
}) {
  const { title, steps } = guidance[status];
  return (
    <Dialog title="人工协助" onClose={onClose}>
      <div className="detail-body">
        <h3>{title}</h3>
        <ol className="assistance-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol>
      </div>
      <p>具体联系人、入口与响应要求待学校确认。请从学校现有渠道联系。打开本提示不会发起或完成转介。</p>
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>返回工作台</button>
      </div>
    </Dialog>
  );
}
