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
    <Dialog title={firstVisit ? "开始之前，了解两件小事" : "使用帮助"} onClose={firstVisit ? undefined : onContinue}>
      <div className="usage-sections">
        <section><span className="usage-number">01</span><div><h3>只提供必要的信息</h3><p>请先隐去姓名、学号等身份信息，再填写记录。沟通底稿由你核对、编辑后自行发送。</p></div></section>
        <section><span className="usage-number">02</span><div><h3>及时保存需要的内容</h3><p>当前输入、对话和底稿保留在本次页面中，刷新或关闭页面会清除。</p></div></section>
      </div>
      <details className="usage-details"><summary>数据处理与服务说明</summary>
        <p>{health?.mode === "pilot-local" || health?.mock ? "当前为离线示例，分析和生成不调用模型。"
          : health ? `分析与生成使用 ${health.provider} 提供的模型服务。分析会提交本次记录，按核对清单生成仅提交已选条目，表单生成会提交所填内容。`
          : healthError ? "服务暂时无法连接，请稍后重试。" : "正在连接服务…"}</p>
        <p>导入文件由本地服务提取文字。涉及专业判断时，可通过「人工协助」查看校内支持建议。</p>
      </details>
      <div className="dialog-actions"><button className="primary" onClick={onContinue}>{firstVisit ? "了解了，开始使用" : "返回页面"}</button></div>
    </Dialog>
  );
}
