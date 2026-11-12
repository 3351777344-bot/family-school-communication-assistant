import { useState } from "react";
import type { InputEvidence, Point } from "../types";
import { Dialog } from "./Dialog";

export const sourceLabels = {
  rule: "制度 / 流程参考 · 待核实",
  know: "通用方法",
  adv: "沟通建议 · 需人工判断",
};

export function PointDetail({ point, evidence, ready, stale, editable, draft, onAdd, onClose }: {
  point: Point;
  evidence: InputEvidence[];
  ready: boolean;
  stale: boolean;
  editable: boolean;
  draft: string;
  onAdd: (reply: string) => void;
  onClose: () => void;
}) {
  const [reply, setReply] = useState(point.detail.reply);
  const related = evidence.filter(item => point.factIds?.includes(item.id));
  return (
    <Dialog title={point.title} onClose={onClose} drawer>
      <div className="detail-body">
        <span className="source">{sourceLabels[point.source]}{point.reference && ` · ${point.reference.reviewStatus}`}</span>
        {stale && <p className="notice">这是上一次结果的详情，仅供回看。</p>}
        <h3>沟通目的</h3>
        <p>{point.detail.aim}</p>
        <h3>{ready ? "沟通理由" : "为什么要先核对"}</h3>
        <p>{point.detail.why || point.why}</p>
        {point.detail.referenceAction && (
          <>
            <h3>资料在这一步怎么用</h3>
            <p>{point.detail.referenceAction}</p>
          </>
        )}
        {ready ? (
          <>
            <h3>家长可能的反应</h3>
            <ul className="detail-reactions">
              {point.detail.react.map((reaction, index) => <li key={index}>{reaction}</li>)}
            </ul>
            {editable && <p className="muted compact">以下回应可按实际情况修改。</p>}
            <label htmlFor="point-reply">参考回应</label>
            <textarea id="point-reply" className="draft-text point-reply" rows={4} value={reply}
              readOnly={!editable} onChange={event => setReply(event.target.value)}
              onCopy={event => { if (stale) event.preventDefault(); }} />
            {editable && (
              <button type="button" className="text-button" onClick={() => onAdd(reply.trim())}
                disabled={!reply.trim() || draft.includes(reply.trim())}>
                加入底稿
              </button>
            )}
          </>
        ) : (
          <>
            <h3>辅导员可以先做什么</h3>
            <blockquote>{point.detail.reply}</blockquote>
          </>
        )}
        <h3>关联原文</h3>
        {related.length ? related.map(item => (
          <div className="evidence-item" key={item.id}>
            <h4>{item.label}</h4>
            <p>{item.quote}</p>
          </div>
        )) : <p>本条为通用提示，无关联原文。</p>}
        <h3>资料出处</h3>
        {point.reference ? (
          <>
            <p>{point.reference.title} · {point.reference.reviewStatus}</p>
            <blockquote>{point.reference.quote || point.reference.excerpt}</blockquote>
            {point.reference.quote && point.reference.quote !== point.reference.excerpt && (
              <details className="fact-source">
                <summary>查看资料卡上下文</summary>
                <p>{point.reference.excerpt}</p>
              </details>
            )}
            <p>{point.reference.id} · 版本 {point.reference.version}</p>
            {point.reference.sourceLocation && <p>{point.reference.sourceLocation.title} · {point.reference.sourceLocation.locator}</p>}
            {point.reference.excludedUse && <p>{point.reference.excludedUse}</p>}
          </>
        ) : <p>本条为沟通建议，暂无关联资料卡。</p>}
      </div>
    </Dialog>
  );
}
