import { useEffect, useReducer, useRef, useState } from "react";
import { initialState, isStale, reducer } from "../state";
import { approvedReviews, initialReviews, validateAnalysis, type Analysis, type ItemReview } from "../analysis";
import { validatePreparation } from "../api";
import type { Scene, Preparation } from "../types";
import { RecordImport } from "./RecordImport";
import { Results } from "./Results";

const sceneLabels: Record<Scene, string> = { xueye: "学业警示", xinli: "心理健康首次告知", yiban: "一般家校沟通" };
const kinds: Record<string, string> = { record: "记录", observation: "观察", report: "当事人陈述", speculation: "推测", unclassified: "来源待核对", context: "背景与意愿" };
async function post(path: string, input: unknown, signal: AbortSignal) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "服务暂时不可用，请重试。");
  return body.data;
}
export function AnalysisWorkbench({ acknowledged, allowedScenes, onAssistance, assistanceRevision }: {
  acknowledged: boolean; allowedScenes?: Scene[]; onAssistance: (status?: Preparation["status"]) => void; assistanceRevision: number;
}) {
  const [text, setText] = useState("");
  const [scene, setScene] = useState<Scene>(allowedScenes?.[0] || "xueye");
  const [revision, setRevision] = useState(() => Date.now());
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [reviews, setReviews] = useState<ItemReview[]>([]);
  const [pending, setPending] = useState<"analyze" | "prepare" | null>(null);
  const [error, setError] = useState("");
  const [resultState, dispatch] = useReducer(reducer, initialState);
  const active = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const serial = useRef(0);
  const revisionRef = useRef(revision);
  const input = useRef<HTMLTextAreaElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const current = analysis !== null && analysis.inputRevision === revision;
  const permitted = !allowedScenes || allowedScenes.includes(scene);
  const approved = approvedReviews(reviews);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { cancel(); }, [assistanceRevision]);
  useEffect(() => {
    if (allowedScenes?.length && !allowedScenes.includes(scene)) changeInput(text, allowedScenes[0]);
  }, [allowedScenes]);
  function cancel() {
    active.current?.abort(); active.current = null; epoch.current++;
    setPending(null);
    if (resultState.request) dispatch({ type: "cancel", id: resultState.request.id });
  }
  function changeInput(nextText: string, nextScene = scene) {
    cancel();
    setText(nextText); setScene(nextScene);
    revisionRef.current = Math.max(Date.now(), revisionRef.current + 1);
    setRevision(revisionRef.current);
    setError("");
    dispatch({ type: "form", patch: { situation: nextText, scene: nextScene, extra: `input:${revisionRef.current}` } });
  }
  function changeReview(index: number, patch: Partial<ItemReview>) {
    epoch.current++;
    const next = reviews.map((item, i) => i === index ? { ...item, ...patch } : item);
    setReviews(next);
    dispatch({ type: "form", patch: { extra: JSON.stringify(next) } });
    setError("");
  }
  async function run(stage: "analyze" | "prepare") {
    if (active.current || !acknowledged || !permitted || !text.trim() ||
      (stage === "prepare" && (!current || analysis?.status !== "review" || !approved.length))) return;
    const abort = new AbortController(); active.current = abort;
    const token = ++epoch.current;
    const requestId = ++serial.current;
    const version = revisionRef.current;
    const displayVersion = resultState.inputRevision;
    setPending(stage); setError("");
    if (stage === "prepare") dispatch({ type: "start", id: requestId });
    try {
      if (stage === "analyze") {
        const data = validateAnalysis(await post("/api/analyze", { text, scene, inputRevision: version }, abort.signal), text, version);
        if (abort.signal.aborted || token !== epoch.current || version !== revisionRef.current) return;
        setAnalysis(data); setReviews(initialReviews(data.items));
        // A newly analyzed selection requires a fresh draft even if the text did not change.
        dispatch({ type: "form", patch: { extra: `analysis:${data.analysisId}:${requestId}` } });
        requestAnimationFrame(() => reviewHeading.current?.focus());
      } else {
        const data = validatePreparation(await post("/api/prepare-from-analysis", {
          analysisId: analysis!.analysisId, inputRevision: version, scene, reviews: approved,
        }, abort.signal), version);
        if (abort.signal.aborted || token !== epoch.current || version !== revisionRef.current) return;
        dispatch({ type: "success", id: requestId, data: { ...data, inputRevision: displayVersion } });
        requestAnimationFrame(() => resultHeading.current?.focus());
      }
    } catch (e) {
      if (!abort.signal.aborted && token === epoch.current) {
        const message = e instanceof Error ? e.message : "请求失败，请重试。";
        setError(message);
        if (stage === "prepare") dispatch({ type: "failure", id: requestId, message });
      }
    } finally {
      if (active.current === abort) { active.current = null; setPending(null); }
    }
  }
  return <div className="analysis-workbench">
    <section className="card analysis-input" aria-labelledby="analysis-input-heading">
      <h2 id="analysis-input-heading">粘贴或导入记录</h2>
      <p className="muted">粘贴记录或导入文件，整理关键情况与待确认的问题。</p>
      <label className="field">沟通场景<select value={scene} onChange={e => changeInput(text, e.target.value as Scene)}>
        {(Object.keys(sceneLabels) as Scene[]).map(id => <option key={id} value={id} disabled={allowedScenes && !allowedScenes.includes(id)}>{sceneLabels[id]}{allowedScenes && !allowedScenes.includes(id) ? "（暂不可用）" : ""}</option>)}
      </select></label>
      <RecordImport disabled={!acknowledged || !permitted || pending !== null} scene={scene} inputRevision={revision} onApply={value => changeInput(value)} />
      <label className="field">本次记录（最多 1500 字）<textarea ref={input} value={text} maxLength={1500} rows={7} onChange={e => changeInput(e.target.value)} placeholder="例如：课程平台显示本周缺课两次。学生说其中一次请过假。家长认为只是贪玩。" /></label>
      <div className="analysis-actions">
        <button className="primary" disabled={!acknowledged || !permitted || !text.trim() || pending !== null} onClick={() => void run("analyze")}>{pending === "analyze" ? "正在梳理…" : "分析记录"}</button>
        <button disabled={pending !== null} onClick={() => changeInput("课程平台显示本周缺课两次。学生说其中一次请过假。家长认为只是贪玩。")}>试试示例</button>
        {pending && <button onClick={cancel}>取消本次请求</button>}
      </div>
    </section>
    {error && <div className="error-banner" role="alert"><strong>本次未更新结果</strong><p>{error}</p><p>内容已保留，请重试。</p></div>}
    {pending && <p className="loading-banner" role="status"><span className="spinner" />{pending === "analyze" ? "正在分析记录…" : "正在根据获准条目准备底稿…"}</p>}
    {analysis && <section className="card analysis-review" aria-labelledby="analysis-review-heading">
      <div className="output-heading"><h2 id="analysis-review-heading" ref={reviewHeading} tabIndex={-1}>核对记录与可告知范围</h2>{!current && <span className="result-badge old">旧分析</span>}</div>
      {!current && <p className="notice" role="status">输入已修改，以下分析已过期。请重新分析当前记录。</p>}
      {analysis.flags.map(flag => <p className="notice" key={flag}>{flag}</p>)}
      {analysis.status === "manual_review" ? <div className="notice" role="status"><strong>转由人工核实</strong><p>{analysis.notes || "这份记录需要进一步核实，请联系校内专业人员后再准备沟通。"}</p><button onClick={() => { cancel(); onAssistance("manual_review"); }}>查看人工协助</button></div> : <>
        <p className="muted">核对每条来源，再选择可用于家长沟通的内容。</p>
        {analysis.items.length === 0 && <p className="notice">暂无可核对条目，请补充具体记录再分析。</p>}
        <fieldset disabled={!current || pending !== null}>
          <ol className="analysis-items">{analysis.items.map((item, index) => {
            const review = reviews[index];
            if (!review) return null;
            return <li key={item.id} className="analysis-item">
              <div className="analysis-item-meta"><strong>条目 {index + 1}</strong><span>{kinds[item.kind] || item.kind}</span><span>{item.source}</span>{item.uncertain && <span className="result-badge old">待确认</span>}</div>
              <p className="compact">编号：{item.id} · 原文位置 {item.start + 1}–{item.end}</p>
              <blockquote>{item.quote}</blockquote>
              <div className="analysis-checks">
                <label><input type="checkbox" checked={review.reviewStatus === "confirmed"} onChange={e => changeReview(index, { reviewStatus: e.target.checked ? "confirmed" : "pending" })} />已核对来源与表述</label>
                <label><input type="checkbox" checked={review.disclosable} onChange={e => changeReview(index, { disclosable: e.target.checked })} />允许用于本次家长底稿</label>
              </div>
              <label className="field">补充或更正（选填）<textarea rows={2} value={review.correction || ""} maxLength={400} onChange={e => changeReview(index, { correction: e.target.value, reviewStatus: "pending" })} /></label>
              {review.correction?.trim() && <p className="compact">人工补充：请重新核对内容，并保留原文中的归属与限定语。</p>}
            </li>;
          })}</ol>
        </fieldset>
        {analysis.conflicts.length > 0 && <div className="notice"><h3>说法差异，需并列核对</h3><ul>{analysis.conflicts.map((item, i) => <li key={i}>{item.reason}（涉及条目：{item.itemIds.join("、")}）</li>)}</ul></div>}
        {analysis.questions.length > 0 && <div className="notice"><h3>建议追问</h3><ul>{analysis.questions.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
        <div className="analysis-actions"><p role="status">已核对且允许入稿：{approved.length} 条</p><button className="primary" disabled={!acknowledged || !current || !approved.length || pending !== null || !permitted} onClick={() => void run("prepare")}>{pending === "prepare" ? "正在准备…" : "根据已选条目生成底稿"}</button></div>
      </>}
    </section>}
    {resultState.result && <section className="output-panel" aria-label="基于核对记录的沟通准备">
      <div className="output-heading"><h2 ref={resultHeading} tabIndex={-1}>沟通准备结果</h2>{isStale(resultState) && <span className="result-badge old">旧底稿</span>}</div>
      {isStale(resultState) && <p className="notice" role="status">记录已更新，请重新生成底稿。</p>}
      <Results key={resultState.generation} state={resultState} dispatch={dispatch} onAssistance={() => { cancel(); onAssistance(resultState.result?.status); }} onSupplement={() => input.current?.focus()} />
    </section>}
  </div>;
}
