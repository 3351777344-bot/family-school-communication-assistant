import type { Health } from "../types";
import { Dialog } from "./Dialog";

const noticeKey = "family-school:usage-notice:v1";

export function hasAcknowledgedUsage() {
  try {
    return localStorage.getItem(noticeKey) === "accepted";
  } catch {
    return false;
  }
}

export function rememberUsage() {
  try {
    localStorage.setItem(noticeKey, "accepted");
  } catch {
    // The workbench can still be used when the browser blocks storage.
  }
}

export function UsageNotice({ firstVisit, health, healthError, onContinue }: {
  firstVisit: boolean;
  health: Health | null;
  healthError: boolean;
  onContinue: () => void;
}) {
  return (
    <Dialog title="家校沟通助手使用说明" onClose={firstVisit ? undefined : onContinue}>
      <p>本工作台供高校辅导员准备家校沟通。系统整理沟通要点、流程参考、风险提醒和底稿。辅导员核实事实、决定可告知范围、编辑并确认后，自行通过学校现有渠道联系家长。</p>
      <p>只填写必要的虚构信息。请勿输入姓名、学号、班级、可识别的家庭信息、咨询原话或真实个案。</p>
      <p>需要专业判断时，请按校内流程联系相关人员。助手不诊断、不研判危机、不替辅导员决定是否告知，也不自动发送信息。</p>
      <div className="notice" role="status">
        {health?.mode === "pilot-local" ? "当前为受控本地演练，仅使用虚构信息，生成时不调用模型。"
          : health?.mock ? "当前为离线示例模式，生成时不调用模型。"
          : health ? `当前为模型模式（${health.provider} · ${health.model}）。生成时会将本次准备所需的输入发送至配置的模型服务。`
          : healthError ? "服务连接异常，当前运行模式无法确认。"
          : "正在检查运行模式。模型模式会将本次准备所需的输入发送至配置的模型服务。"}
      </div>
      <p>访问权限、日志及服务方留存规则待校内确认。刷新或关闭页面会清除当前页面的输入、底稿和后续勾选。</p>
      <div className="dialog-actions">
        <button className="primary" onClick={onContinue}>
          {firstVisit ? "我已了解，开始使用" : "返回工作台"}
        </button>
      </div>
    </Dialog>
  );
}
