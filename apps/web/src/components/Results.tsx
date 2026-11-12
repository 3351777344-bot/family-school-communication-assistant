import {
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CHECKLIST,
  canConfirmDraft,
  canCopyDraft,
  canEditDraft,
  hasDraft,
  isStale,
  type State,
  type Action,
} from "../state";
import type { Point } from "../types";
import { Dialog } from "./Dialog";
import { FactList } from "./FactList";
import { PointDetail, sourceLabels } from "./PointDetail";

function Section({
  id,
  title,
  state,
  dispatch,
  children,
}: {
  id: string;
  title: string;
  state: State;
  dispatch: Dispatch<Action>;
  children: ReactNode;
}) {
  const closed = state.collapsed.includes(id);
  return (
    <section className={`card result-card panel-${id}`} aria-labelledby={`section-${id}`}>
      <h3 className="result-section-heading" id={`section-${id}`}>
        <button
          className="section-toggle"
          onClick={() => dispatch({ type: "toggle", panel: id })}
          aria-expanded={!closed}
          aria-controls={`panel-${id}`}
        >
          <span className="section-title">{title}</span>
          <span aria-hidden>{closed ? "+" : "−"}</span>
        </button>
      </h3>
      <div id={`panel-${id}`} hidden={closed}>
        {children}
      </div>
    </section>
  );
}
const views = [
  ["points", "沟通要点"],
  ["reference", "流程与提醒"],
  ["facts", "核对事实"],
  ["draft", "家长底稿"],
] as const;
type View = (typeof views)[number][0];

function ResultPane({
  name,
  selected,
  children,
}: {
  name: View;
  selected: View;
  children: ReactNode;
}) {
  return (
    <div
      id={`result-${name}`}
      role="tabpanel"
      aria-labelledby={`tab-${name}`}
      hidden={selected !== name}
      tabIndex={0}
      className="result-pane"
    >
      {children}
    </div>
  );
}

export function Results({
  state,
  dispatch,
  onAssistance,
  onSupplement,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  onAssistance: () => void;
  onSupplement: () => void;
}) {
  const [view, setView] = useState<View>("points");
  const tabBar = useRef<HTMLDivElement>(null);
  const resultStatus = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [preview, setPreview] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const [restore, setRestore] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{
    confirmation: State["confirmation"];
    message: string;
  } | null>(null);
  const data = state.result!;
  const stale = isStale(state);
  const editable = canEditDraft(state);
  const copyable = canCopyDraft(state);
  const draftable = hasDraft(state);
  const evidence = data.inputEvidence ?? [];
  const reviewing = state.request !== null;
  const checkedCount = state.checks.filter(Boolean).length;
  function selectView(next: View, focus = false) {
    setView(next);
    if (next === "draft" && state.collapsed.includes("draft"))
      dispatch({ type: "toggle", panel: "draft" });
    const status = resultStatus.current;
    if (status && status.getBoundingClientRect().bottom < 10) {
      status.scrollIntoView({ block: "start" });
    }
    if (focus) {
      const button = document.getElementById(`tab-${next}`);
      tabBar.current?.scrollIntoView({ block: "nearest" });
      button?.focus({ preventScroll: true });
    }
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === "ArrowRight") target = (index + 1) % views.length;
    else if (event.key === "ArrowLeft")
      target = (index + views.length - 1) % views.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = views.length - 1;
    else return;
    event.preventDefault();
    selectView(views[target][0], true);
  }
  async function copy() {
    if (!canCopyDraft(state)) return;
    const confirmation = state.confirmation;
    try {
      await navigator.clipboard.writeText(state.draft);
      setCopyStatus({ confirmation, message: "已复制当前确认的底稿。" });
    } catch {
      setCopyStatus({
        confirmation,
        message: "复制失败，请在预览中选择完整底稿后手动复制。",
      });
    }
  }
  const originalInput = evidence.length > 0 && (
    <details className="card supporting evidence-list">
      <summary>
        核对本次输入 <span>{evidence.length} 项原文待核实</span>
      </summary>
      <p className="muted compact">保留输入中的说话人和待确认内容。</p>
      {evidence.map((item) => (
        <div className="evidence-item" key={item.id}>
          <h3>{item.label}</h3>
          <p>{item.quote}</p>
        </div>
      ))}
    </details>
  );
  const points = (
    <Section
      id="points"
      title={data.status === "ready" ? "这次先说什么" : "通用准备参考"}
      {...{ state, dispatch }}
    >
      <ol className="point-list">
        {data.points.map((p, i) => (
          <li key={p.moveId || i}>
            <span className="point-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3>{p.title}</h3>
              <p>{p.why}</p>
              {p.detail.referenceAction && (
                <p className="point-reference-action">建议做法：{p.detail.referenceAction}</p>
              )}
              <span className="source">
                {sourceLabels[p.source] || sourceLabels.adv}
                {p.reference && ` · ${p.reference.reviewStatus}`}
              </span>
              <button
                className="text-button detail-link"
                aria-haspopup="dialog"
                onClick={() => setPoint(p)}
              >
                查看怎么说 <span aria-hidden>↗</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
  const references = (
    <div className="reference-stack">
      {data.steps.length > 0 && (
        <Section id="workflow" title="校内流程参考" {...{ state, dispatch }}>
          <p className="muted compact">
            {data.status === "manual_review" ? "安全提醒时仅显示首步，需由校内人员核实。"
              : state.resultStage ? "高亮本次手动选择的环节。流程口径待校内确认。"
                : "本次未选择当前环节。下方按原型顺序列出五步参考。"}
          </p>
          <ol className="workflow">
            {data.steps.map((step, i) => (
              <li
                key={i}
                className={state.resultStage === step ? "active" : ""}
              >
                <span>{i + 1}</span>
                <div>
                  {step}
                  {state.resultStage === step && (
                    <small>生成时选择的环节</small>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section id="risks" title="表达与风险提醒" {...{ state, dispatch }}>
        <ul className="risk-list">
          {data.risks.map((risk, i) => (
            <li key={i}>
              <h3>{risk.title}</h3>
              <p>{risk.detail}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
  const draftPanel = draftable && (
    <Section id="draft" title="给家长的沟通底稿" {...{ state, dispatch }}>
      <div
        onCopy={(e) => {
          if (!copyable) e.preventDefault();
        }}
      >
        <div className="draft-intro">
          <p>
            {stale
              ? "下方保留了上次的稿件与编辑。"
              : "编辑下面的话术，完成核对后即可确认和复制。"}
          </p>
          <button
            className="text-button"
            onClick={() => setRestore(true)}
            disabled={!editable || state.draft === data.draft}
          >
            恢复生成稿
          </button>
        </div>
        {!stale && data.status === "needs_information" && (
          <div className="notice" role="status">
            <strong>信息不足，这份底稿属于通用参考</strong>
            <p>缺项见上方提示。补充后再生成，内容才会贴合本次具体情况。</p>
          </div>
        )}
        <label className="sr-only" htmlFor="draft-text">
          编辑给家长的沟通底稿
        </label>
        <textarea
          ref={draftInput}
          id="draft-text"
          className="draft-text"
          rows={7}
          value={state.draft}
          readOnly={!editable}
          onChange={(e) => dispatch({ type: "draft", value: e.target.value })}
        />
        <div className="review-area">
          <div className="review-heading">
            <h3>确认前核对</h3>
            <span>
              已完成 {checkedCount}/{CHECKLIST.length}
            </span>
          </div>
          <div className="checklist">
            {CHECKLIST.map((text, i) => (
              <label key={text}>
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={state.checks[i]}
                  onChange={(e) => {
                    dispatch({
                      type: "check",
                      index: i,
                      value: e.target.checked,
                    });
                  }}
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
          <div className="draft-actions">
            <button ref={previewButton} onClick={() => setPreview(true)}>
              预览底稿
            </button>
            <button
              className={copyable ? undefined : "primary"}
              disabled={!canConfirmDraft(state) || copyable}
              onClick={() => {
                if (!canConfirmDraft(state)) return;
                dispatch({ type: "confirm" });
                setPreview(true);
              }}
            >
              {copyable ? "已确认当前底稿" : "确认当前底稿"}
            </button>
            <button
              className={copyable ? "primary" : undefined}
              disabled={!copyable}
              onClick={copy}
            >
              复制底稿
            </button>
          </div>
          <p className="status-line" role="status">
            {stale
              ? "旧底稿仅供回看。请根据当前输入重新生成。"
              : !editable
                ? "本次生成结束后可继续处理底稿。"
                : copyable
                  ? copyStatus?.confirmation === state.confirmation
                    ? copyStatus?.message
                    : "当前版本已确认，可复制使用。"
                  : "完成四项核对并确认后，可复制底稿。"}
          </p>
        </div>
      </div>
    </Section>
  );
  return (
    <div className="result-workspace">
      {!!data.notices?.length && (
        <div className="notice" role="status">
          {data.notices.map((notice, i) => (
            <p key={i}>{notice}</p>
          ))}
        </div>
      )}
      {draftable ? (
        <>
          <div
            ref={resultStatus}
            className={`result-status ${stale || reviewing ? "status-muted" : "status-ready"}`}
          >
            <div>
              <h3>
                {stale || reviewing
                  ? "查看上一次准备结果"
                  : copyable
                    ? "底稿已确认，可以复制"
                    : "底稿已生成，待核对"}
              </h3>
              <p>
                {reviewing
                  ? "重新生成结束后可继续处理底稿。"
                  : stale
                    ? "输入变更后需重新生成，才能确认和复制。"
                    : copyable
                      ? "如有修改，需重新确认。"
                      : "可先看沟通要点，也可以直接编辑底稿。"}
              </p>
            </div>
            <button
              className={stale || reviewing ? undefined : "primary"}
              onClick={() => selectView("draft", true)}
            >
              {stale || reviewing ? "查看旧底稿" : "打开家长底稿"}{" "}
              <span aria-hidden>→</span>
            </button>
          </div>
          <div
            ref={tabBar}
            className="result-tabs"
            role="tablist"
            aria-label="结果内容"
          >
            {views.map(([name, label], index) => (
              <button
                key={name}
                id={`tab-${name}`}
                type="button"
                role="tab"
                aria-selected={view === name}
                aria-controls={`result-${name}`}
                tabIndex={view === name ? 0 : -1}
                onClick={() => selectView(name)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
          <ResultPane name="points" selected={view}>
            {points}
          </ResultPane>
          <ResultPane name="facts" selected={view}>
            <FactList facts={data.facts ?? []} evidence={evidence} />
            {originalInput}
            {!data.facts?.length && !evidence.length && (
              <p className="muted compact">这次没有可拆开对照的事实原文。</p>
            )}
          </ResultPane>
          <ResultPane name="draft" selected={view}>
            {draftPanel}
          </ResultPane>
          <ResultPane name="reference" selected={view}>
            {references}
            {data.faq.length > 0 && (
              <details className="card supporting">
                <summary>
                  家长可能会问什么 <span>{data.faq.length} 条参考</span>
                </summary>
                {data.faq.map((f, i) => (
                  <div className="faq" key={i}>
                    <h3>{f.q}</h3>
                    <p>{f.a}</p>
                  </div>
                ))}
              </details>
            )}
            {data.next.length > 0 && (
              <details className="card supporting">
                <summary>
                  沟通后的下一步 <span>可选</span>
                </summary>
                <p className="muted compact">
                  {stale
                    ? "下列勾选属于上一次结果。"
                    : "勾选仅作为本次工作提示，刷新或关闭页面后清除。"}
                </p>
                <div className="checklist next-list">
                  {data.next.map((n) => (
                    <label key={n}>
                      <input
                        type="checkbox"
                        checked={state.nextChecks.includes(n)}
                        disabled={stale || state.request !== null}
                        onChange={() => dispatch({ type: "next", item: n })}
                      />
                      <span>{n}</span>
                    </label>
                  ))}
                </div>
                {!stale && (
                  <button className="text-button" onClick={onAssistance}>
                    查看人工协助
                  </button>
                )}
              </details>
            )}
          </ResultPane>
        </>
      ) : (
        <>
          <div
            className="result-status status-blocked status-safety"
            role={!stale ? "alert" : undefined}
          >
            <div>
              <h3>请转由人工核实</h3>
              <p>
                {data.notes || "请先核实情况，再按校内流程处理。"}
                本次未调用模型，未生成底稿。
              </p>
              {data.status === "needs_information" && (
                <ul>
                  {data.missingFacts?.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              )}
              {!stale && (
                <div className="status-actions">
                  <button className="primary" onClick={onAssistance}>
                    查看人工协助
                  </button>
                  <button disabled={reviewing} onClick={onSupplement}>
                    返回补充已知事实
                  </button>
                </div>
              )}
            </div>
          </div>
          {references}
          {originalInput}
        </>
      )}
      {(data.flags.length > 0 || !!data.redacted?.length) && (
        <div className="footnotes">
          <h3>本次结果的使用说明</h3>
          <ul>
            {data.flags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
          {!!data.redacted?.length && (
            <p>
              已替换检测到的：{data.redacted.join("、")}
              。仍需人工检查其他身份线索。
            </p>
          )}
        </div>
      )}
      {point && (
        <PointDetail
          point={point}
          evidence={evidence}
          ready={data.status === "ready"}
          stale={stale}
          editable={editable}
          draft={state.draft}
          onClose={() => setPoint(null)}
          onAdd={(reply) => {
            if (!canEditDraft(state) || !reply || state.draft.includes(reply))
              return;
            dispatch({
              type: "draft",
              value: [state.draft.trimEnd(), reply]
                .filter(Boolean)
                .join("\n\n"),
            });
            setPoint(null);
            requestAnimationFrame(() => selectView("draft", true));
          }}
        />
      )}
      {preview && (
        <Dialog
          title="底稿预览"
          onClose={() => setPreview(false)}
          returnFocusTo={previewButton}
          wide
        >
          <p className="muted">
            {stale
              ? "旧底稿仅供回看"
              : copyable
                ? "已人工确认的当前版本"
                : "尚未确认，请继续核对"}
          </p>
          <div
            className="draft-preview"
            onCopy={(e) => {
              if (!copyable) e.preventDefault();
            }}
          >
            {state.draft}
          </div>
          {copyable && (
            <p role="status">
              {copyStatus?.confirmation === state.confirmation
                ? copyStatus?.message
                : ""}
            </p>
          )}
          <div className="dialog-actions">
            <button
              onClick={() => {
                setPreview(false);
                if (editable)
                  requestAnimationFrame(() => draftInput.current?.focus());
              }}
            >
              {editable ? "返回修改" : "返回工作台"}
            </button>
            {copyable && (
              <button className="primary" onClick={copy}>
                复制已确认底稿
              </button>
            )}
          </div>
        </Dialog>
      )}
      {restore && (
        <Dialog title="恢复最初生成的底稿？" onClose={() => setRestore(false)}>
          <p>当前编辑会被替换，核对和确认状态将清空。</p>
          <div className="dialog-actions">
            <button onClick={() => setRestore(false)}>保留我的编辑</button>
            <button
              className="primary"
              onClick={() => {
                dispatch({ type: "draft", value: data.draft || "" });
                setRestore(false);
              }}
            >
              恢复生成稿
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
