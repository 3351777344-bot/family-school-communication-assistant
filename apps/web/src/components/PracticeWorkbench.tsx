import { useEffect, useRef, useState, type FormEvent } from "react";
import { operationFor, practiceCatalog, practiceRequest, type PracticeCatalog, type PracticeOperation, type PracticeSession } from "../practice";
import { Dialog } from "./Dialog";

const stageLabels = { start: "开始演练", turn: "发送并等待家长回应", end: "结束本次演练", review: "生成本次复盘" };
const turnAnchor = (id: string) => `practice-turn-${encodeURIComponent(id)}`;

export function PracticeWorkbench({ active, acknowledged, assistanceRevision, view, onNavigate }: {
  active: boolean; acknowledged: boolean; assistanceRevision: number; view: "practice" | "review"; onNavigate: (page: "practice" | "review") => void;
}) {
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [locateTarget, setLocateTarget] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("");
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState<PracticeOperation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"reset" | "end" | null>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const conversationHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const selected = catalog?.cases.find(row => row.id === caseId);
  const counselorTurns = session?.turns.filter(turn => turn.role === "counselor").length ?? 0;
  const locked = pending || operation !== null;

  useEffect(() => {
    if (!active || !acknowledged || catalog) return;
    const abort = new AbortController();
    setCatalogLoading(true); setCatalogError("");
    practiceCatalog(abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setCatalog(value); setCaseId(value.cases[0]?.id || "");
    }).catch(e => {
      if (!abort.signal.aborted) setCatalogError(e instanceof Error ? e.message : "案例加载失败，请重试。");
    }).finally(() => { if (!abort.signal.aborted) setCatalogLoading(false); });
    return () => abort.abort();
  }, [active, acknowledged, catalog, catalogRevision]);
  useEffect(() => { if (!active) pause(); }, [active]);
  useEffect(() => { pause(); }, [assistanceRevision]);
  useEffect(() => () => { epoch.current++; controller.current?.abort(); }, []);

  function pause() {
    if (!controller.current) return;
    epoch.current++; controller.current.abort(); controller.current = null; setPending(false);
    setError("等待已暂停，点击重试可继续。");
  }
  async function run(next: PracticeOperation) {
    if (controller.current || !activeRef.current || !acknowledged || !catalog) return;
    const abort = new AbortController();
    controller.current = abort;
    setOperation(next); setPending(true); setError(""); setDialog(null);
    const token = ++epoch.current;
    try {
      const result = await practiceRequest(next, catalog, abort.signal);
      if (abort.signal.aborted || token !== epoch.current || !activeRef.current) return;
      setSession(result); setOperation(null);
      if (next.stage === "turn") setMessage("");
      requestAnimationFrame(() => {
        if (!activeRef.current) return;
        if (next.stage === "review") reviewHeading.current?.focus();
        else if (next.stage === "start" || result.status !== "active") conversationHeading.current?.focus();
        else composer.current?.focus();
      });
    } catch (e) {
      if (!abort.signal.aborted && token === epoch.current) setError(e instanceof Error ? e.message : "请求未完成，请重试。");
    } finally {
      if (controller.current === abort) { controller.current = null; setPending(false); }
    }
  }
  function begin(stage: PracticeOperation["stage"]) {
    if (locked || !caseId || (stage === "turn" && (!message.trim() || message.length > 1000 || counselorTurns >= 20))) return;
    void run(operationFor(stage, caseId, session, message, crypto.randomUUID()));
  }
  function reset() {
    epoch.current++; controller.current?.abort(); controller.current = null;
    setSession(null); setOperation(null); setPending(false); setMessage(""); setError(""); setDialog(null);
  }
  function send(event: FormEvent) { event.preventDefault(); begin("turn"); }
  function locate(id: string) {
    setLocateTarget(id);
    onNavigate("practice");
  }
  useEffect(() => {
    if (view !== "practice" || !locateTarget) return;
    // Focus the cited turn after the page navigation has focused its heading.
    let focusFrame = 0;
    const frame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        const target = document.getElementById(turnAnchor(locateTarget));
        target?.scrollIntoView({ block: "center" });
        target?.focus({ preventScroll: true });
        setLocateTarget(null);
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); };
  }, [view, locateTarget]);

  return <div className="practice-workbench">
    {view === "review" && <section className="card review-entry">
      <span className="review-symbol" aria-hidden="true">✦</span>
      <div><h2>{session?.review ? "每一次回看，都是下一次的进步" : session?.status === "ended" ? "对话已结束，来看看这次的收获" : session ? "先完成对话，再一起回看" : "从一段练习，发现更好的表达"}</h2>
      <p>{session?.status === "ended" ? `本次已完成 ${counselorTurns} 回合回应。复盘会结合具体对话，给出表达建议。` : "完成一次场景模拟后，在这里查看沟通反馈与改进建议。"}</p>
      <div className="practice-actions">{session?.status === "ended" && !session.review ? <><button className="primary" disabled={!acknowledged || locked || counselorTurns === 0} onClick={() => begin("review")}>生成沟通复盘</button><button onClick={() => onNavigate("practice")}>回看对话</button>{counselorTurns === 0 && <p className="muted">本次尚无回应，请先完成一次练习。</p>}</> : <button className={session?.review ? undefined : "primary"} onClick={() => onNavigate("practice")}>{session ? "返回场景模拟" : "开始一次场景模拟"}<span aria-hidden="true"> →</span></button>}</div></div>
    </section>}
    {catalogLoading && !catalog && <p className="loading-banner" role="status"><span className="spinner" />正在加载案例与练习标准…</p>}
    {catalogError && <div className="error-banner" role="alert"><p>{catalogError}</p><button onClick={() => setCatalogRevision(value => value + 1)}>重新加载案例</button></div>}
    {catalog && <>
      <div className={`practice-layout ${view === "review" ? "review-layout" : ""}`}>
        <aside className="practice-sidebar" hidden={view === "review"}>
          <section className="card practice-card" aria-labelledby="practice-case-heading">
            <div className="output-heading"><h2 id="practice-case-heading">选择演练案例</h2><span className="result-badge">虚构案例</span></div>
            {!catalog.cases.length ? <p className="notice">当前账号暂无可用案例，请使用获准场景的演练账号。</p> : <label className="field practice-field">练习情境<select value={caseId} disabled={session !== null || locked} onChange={e => { setCaseId(e.target.value); setError(""); }}>
              {catalog.cases.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
            </select></label>}
            {selected && <div className="practice-role">
              <p className="compact">{selected.difficulty}</p><p>{selected.description}</p>
              <h3>本次练习目标</h3><p>{selected.objective}</p>
              <h3>家长角色卡</h3><dl><dt>角色</dt><dd>{selected.roleCard.name} · {selected.roleCard.relationship}</dd><dt>沟通态度</dt><dd>{selected.roleCard.attitude}</dd></dl>
              <h4>角色已知的信息</h4><ul>{selected.roleCard.knownFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
            </div>}
            <div className="practice-actions">
              {!session && !operation && <button className="primary" disabled={!selected || !acknowledged || pending} onClick={() => begin("start")}>开始演练</button>}
              {(session || operation) && <button disabled={pending} onClick={() => setDialog("reset")}>重新选案例</button>}
            </div>
          </section>
          <details className="card practice-card practice-rubric">
            <summary>查看练习维度</summary>

            <p className="muted">从以下维度回看表达，反馈会附上对话依据。</p>
            {catalog.criteria.map(criterion => <div className="practice-criterion" key={criterion.id}><h3>{criterion.title}</h3><p>{criterion.description}</p><ol>{criterion.anchors.map((anchor, index) => <li key={index}>{anchor}</li>)}</ol></div>)}
          </details>
        </aside>
        <div className="practice-main">
          {error && <div className="error-banner" role="alert"><strong>当前步骤尚未确认</strong><p>{error}</p><p>输入、对话和已有复盘均已保留。</p>{operation && !pending && <button className="primary" onClick={() => void run(operation)}>重试：{stageLabels[operation.stage]}</button>}</div>}
          {pending && <div className="loading-banner" role="status"><span className="spinner" />{operation ? stageLabels[operation.stage] : "正在处理"}…<button onClick={pause}>暂停等待</button></div>}
          <section className="card practice-card practice-conversation" hidden={view === "review"} aria-labelledby="practice-conversation-heading" aria-busy={pending && operation?.stage !== "review"}>
            <div className="output-heading"><h2 id="practice-conversation-heading" ref={conversationHeading} tabIndex={-1}>家长角色演练</h2>{session && <span className="result-badge">{session.status === "active" ? `已练习 ${counselorTurns} / 20 回合` : "本次演练已结束"}</span>}</div>
            {!session ? <div className="practice-empty"><span aria-hidden>「 」</span><h3>先选一个情境，试着回应家长</h3><p>由家长开场，你来回应。按照自己的节奏练习，结束后可以查看复盘。</p></div> : <>
              {session.flags.length > 0 && <div className="practice-flags">{session.flags.map(flag => <p className="notice" key={flag}>{flag}</p>)}</div>}
              {session.replyUnavailable && <p className="notice" role="status">本轮家长回复未能生成，你的练习发言已记录，可以继续练习或结束后复盘。</p>}
              <ol className="practice-turns" aria-label="本次演练对话" aria-live="polite" aria-relevant="additions">
                {session.turns.map((turn, index) => <li key={turn.id} id={turnAnchor(turn.id)} tabIndex={-1} className={`practice-turn ${turn.role}`}><div className="practice-turn-meta"><strong>{turn.role === "parent" ? selected?.roleCard.name || "家长" : "我（辅导员）"}</strong><span>第 {index + 1} 条</span></div><p>{turn.content}</p></li>)}
              </ol>
              {session.status === "active" && <>
                {counselorTurns >= 20 && <p className="notice" role="status">已达到本次 20 回合上限。请结束演练，再选择是否复盘。</p>}
                <form onSubmit={send} className="practice-composer">
                  <label className="field practice-field" htmlFor="practice-message">你的回应<textarea id="practice-message" ref={composer} rows={4} maxLength={1000} value={message} readOnly={locked || counselorTurns >= 20} onChange={e => setMessage(e.target.value)} placeholder="按你的判断回应这位家长，不必套用固定句式。" aria-describedby="practice-message-help" /></label>
                  <p id="practice-message-help" className="muted">{message.length} / 1000 字 · 点击发送后，家长会依据角色卡回应。</p>
                  <div className="practice-actions"><button className="primary" type="submit" disabled={!acknowledged || locked || !message.trim() || counselorTurns >= 20}>发送回应</button><button type="button" disabled={!acknowledged || locked} onClick={() => setDialog("end")}>结束演练</button></div>
                </form>
              </>}
              {session.status === "ended" && <div className="practice-ended"><p>本次演练已完成，可以回看对话或进入沟通复盘。</p><button className="primary" onClick={() => onNavigate("review")}>{session.review ? "查看沟通复盘" : "前往沟通复盘"}<span aria-hidden="true"> →</span></button>{counselorTurns === 0 && <p className="muted">尚无辅导员回应，本次没有可供复盘的对话依据。可重新选择案例练习。</p>}</div>}
            </>}
          </section>
          {session?.review && <section className="card practice-card practice-review" hidden={view !== "review"} aria-labelledby="practice-review-heading">
            <div className="output-heading"><h2 id="practice-review-heading" ref={reviewHeading} tabIndex={-1}>本次练习复盘</h2><span className="result-badge">{session.flags.some(flag => flag.includes("离线")) ? "离线复盘示例" : "学习反馈"}</span></div>
            <p className="muted">结合本次对话，发现表达中的亮点与改进方向。</p>
            <p className="practice-review-summary">{session.review.summary}</p>
            {session.review.items.map(item => {
              const criterion = catalog.criteria.find(row => row.id === item.criterionId)!;
              return <article className="practice-feedback" key={item.criterionId}><div className="output-heading"><h3>{criterion.title}</h3><span className="result-badge">{item.score === null ? "暂无适用证据" : `${item.score} / 4 分`}</span></div><p>{item.feedback}</p>
                {item.evidence.length > 0 && <div className="practice-evidence"><h4>对话依据</h4>{item.evidence.map((evidence, index) => <div key={index}><blockquote>{evidence.quote}</blockquote><button className="text-button" onClick={() => locate(evidence.turnId)}>定位到第 {session.turns.findIndex(turn => turn.id === evidence.turnId) + 1} 条对话 ↑</button></div>)}</div>}
                <h4>可替换的表达</h4><p className="practice-alternative">{item.alternative}</p><h4>下一次可以练习</h4><p>{item.practice}</p>
              </article>;
            })}
            <div className="notice"><strong>下一项练习</strong><p>{session.review.nextExercise}</p></div>
          </section>}
        </div>
      </div>
    </>}
    {dialog === "end" && <Dialog title="结束本次演练？" onClose={() => setDialog(null)}><p>结束后可回看对话，并前往沟通复盘。</p>{message.trim() && <p>输入框中尚未发送的文字不会纳入复盘。</p>}<div className="dialog-actions"><button onClick={() => setDialog(null)}>继续练习</button><button className="primary" onClick={() => begin("end")}>确认结束演练</button></div></Dialog>}
    {dialog === "reset" && <Dialog title="重新选择演练案例？" onClose={() => setDialog(null)}><p>本次对话和复盘将清除，开始新的练习。</p><div className="dialog-actions"><button onClick={() => setDialog(null)}>保留本次演练</button><button className="primary" onClick={reset}>重新选案例</button></div></Dialog>}
  </div>;
}
