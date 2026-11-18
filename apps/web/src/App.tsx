import { useEffect, useReducer, useRef, useState } from "react";
import { AgentHome } from "./components/AgentHome";
import { agentPages, pageFromHash, pageHref, type Page } from "./navigation";
import { initialState, isStale, reducer } from "./state";
import { prepare } from "./api";
import type { Health, Preparation } from "./types";
import { AnalysisWorkbench } from "./components/AnalysisWorkbench";
import { PracticeWorkbench } from "./components/PracticeWorkbench";
import { InputPanel } from "./components/InputPanel";
import { Results } from "./components/Results";
import { Dialog } from "./components/Dialog";
import { Assistance } from "./components/Assistance";
import {
  hasAcknowledgedUsage,
  rememberUsage,
  UsageNotice,
} from "./components/UsageNotice";

const steps = ["填写情况", "生成沟通准备", "核对并复制底稿"];

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [assistanceRevision, setAssistanceRevision] = useState(0);
  const [entry, setEntry] = useState<Page>(() => pageFromHash(window.location.hash));
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [acknowledged, setAcknowledged] = useState(hasAcknowledgedUsage);
  const [scope, setScope] = useState(false);
  const [assistance, setAssistance] = useState<Preparation["status"] | null>(
    null,
  );
  const [replace, setReplace] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const inputHeading = useRef<HTMLHeadingElement>(null);
  const factsInput = useRef<HTMLTextAreaElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const allowedScenes = health?.allowedScenes;
  useEffect(() => {
    if (allowedScenes?.length && !allowedScenes.includes(state.form.scene)) {
      dispatch({ type: "form", patch: { scene: allowedScenes[0] } });
    }
  }, [allowedScenes, state.form.scene]);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/health", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setHealth)
      .catch((e) => {
        if (e.name !== "AbortError") setHealthError(true);
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, []);
  const generation = state.generation;
  useEffect(() => {
    const heading = resultHeading.current;
    if (!generation || !heading) return;
    const { top } = heading.getBoundingClientRect();
    if (
      window.matchMedia("(max-width: 730px)").matches ||
      top < 10 ||
      top > window.innerHeight / 2
    ) {
      heading.scrollIntoView({ block: "start" });
    }
    heading.focus({ preventScroll: true });
  }, [generation]);
  async function generate() {
    if (
      !acknowledged ||
      controller.current ||
      !state.form.situation.trim() ||
      (allowedScenes && !allowedScenes.includes(state.form.scene))
    )
      return;
    setReplace(false);
    const id = ++sequence.current;
    const input = structuredClone(state.form);
    const abort = new AbortController();
    controller.current = abort;
    dispatch({ type: "start", id });
    try {
      const data = await prepare(input, state.inputRevision, abort.signal);
      if (!abort.signal.aborted) dispatch({ type: "success", id, data });
    } catch (e) {
      if (!abort.signal.aborted)
        dispatch({
          type: "failure",
          id,
          message: e instanceof Error ? e.message : "生成失败，请重试。",
        });
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    if (state.request !== null)
      dispatch({ type: "cancel", id: state.request.id });
  }
  useEffect(() => {
    function syncPage() {
      const next = pageFromHash(window.location.hash);
      setEntry(next);
    }
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);
  useEffect(() => {
    cancel();
    setAssistanceRevision(value => value + 1);
    setAssistance(null);
    setReplace(false);
    window.scrollTo({ top: 0 });
    document.title = entry === "home" ? "家校工作台 · 家校沟通助手" : `${entry === "form" ? "沟通准备" : agentPages[entry].title} · 家校沟通助手`;
    requestAnimationFrame(() => document.getElementById(entry === "home" ? "home-title" : "page-heading")?.focus({ preventScroll: true }));
  }, [entry]);
  const available = entry === "home" || entry === "form" || (entry === "analysis" ? health?.analysisEnabled : health?.practiceEnabled);
  const practicing = entry === "practice" || entry === "review";
  const stale = isStale(state);
  const step =
    state.result?.status === "ready" && !stale && state.request === null
      ? 2
      : state.form.situation.trim()
        ? 1
        : 0;
  function openAssistance(status?: Preparation["status"]) {
    setAssistanceRevision(value => value + 1);
    if (controller.current) cancel();
    setAssistance(status || (stale ? "ready" : (state.result?.status ?? "ready")));
  }
  function closeUsage() {
    setScope(false);
    if (acknowledged) return;
    rememberUsage();
    setAcknowledged(true);
    requestAnimationFrame(() =>
      inputHeading.current?.focus({ preventScroll: true }),
    );
  }
  return (
    <>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>跳至主要内容</a>
      <header className={entry === "home" ? "site-header home-header" : "site-header"}>
        <div className="header-inner">
          <a className="brand" href={pageHref("home")} aria-label="家校沟通助手首页" aria-current={entry === "home" ? "page" : undefined}>
            <span className="brand-mark" aria-hidden>
              同
            </span>
            <span>
              家校沟通助手{entry !== "home" && <small>让沟通更从容</small>}
            </span>
          </a>
          <div className="header-actions">
            {entry !== "home" && <a className="header-home" href={pageHref("home")}>助手首页</a>}
            {entry !== "home" && (health?.mock || healthError) && <span className={`mode-badge ${health?.mock ? "mock" : ""}`} role="status">{healthError ? "连接异常" : "离线示例"}</span>}
            <button
              className="text-button"
              aria-haspopup="dialog"
              onClick={() => setScope(true)}
            >
              使用帮助
            </button>
            <button
              className="text-button"
              aria-haspopup="dialog"
              onClick={() => openAssistance()}
            >
              人工协助
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={`page ${entry === "home" ? "home-page" : "agent-page"}`}>
        {entry === "home" ? <AgentHome health={health} healthError={healthError} /> : <>
          <nav className="breadcrumb" aria-label="当前位置"><a href={pageHref("home")}>全部助手</a><span aria-hidden="true">/</span><span>{agentPages[entry].title}</span></nav>
          <div className="workbench-intro">
            <p className="eyebrow">{agentPages[entry].label}</p>
            <h1 id="page-heading" tabIndex={-1}>{agentPages[entry].title}</h1>
            <p>{agentPages[entry].description}</p>
            {entry === "form" && <ol className="task-steps" aria-label="准备进度">
              {steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={step > index ? "complete" : undefined}><span aria-hidden>{step > index ? "✓" : index + 1}</span>{label}</li>)}
            </ol>}
          </div>
          {!available && <section className="card unavailable-state"><h2>{health ? "这位助手暂未开放" : healthError ? "暂时无法连接服务" : "正在连接助手…"}</h2><p>{healthError ? "请稍后刷新页面重试。" : "你可以先回到首页，选择其他助手。"}</p><a className="button-link" href={pageHref("home")}>返回首页</a></section>}
        </>}
        {health?.analysisEnabled === true && <div hidden={entry !== "analysis"}><AnalysisWorkbench assistanceRevision={assistanceRevision} acknowledged={acknowledged} allowedScenes={allowedScenes} onAssistance={openAssistance} /></div>}
        {health?.practiceEnabled === true && <div hidden={!practicing}><PracticeWorkbench active={practicing} view={entry === "review" ? "review" : "practice"} onNavigate={page => { window.location.hash = pageHref(page); }} acknowledged={acknowledged} assistanceRevision={assistanceRevision} /></div>}
        <div className="workbench" hidden={entry !== "form"}>
          <InputPanel
            state={state}
            dispatch={dispatch}
            onGenerate={() =>
              state.result ? setReplace(true) : void generate()
            }
            onCancel={cancel}
            headingRef={inputHeading}
            factsRef={factsInput}
            allowedScenes={allowedScenes}
          />
          <div
            className="output-panel"
            aria-label="沟通准备结果"
            aria-busy={state.request !== null}
          >
            <div className="output-heading">
              <h2 ref={resultHeading} tabIndex={-1}>
                {state.result
                  ? `${state.result.sceneName} · 沟通准备`
                  : "沟通准备结果"}
              </h2>
              {stale && <span className="result-badge old">旧结果</span>}
              {health?.mock && state.result && !stale && (
                <span className="result-badge">离线示例</span>
              )}
            </div>
            {state.error && (
              <div className="error-banner" role="alert">
                <strong>本次未更新结果</strong>
                <p>{state.error}</p>
                {state.result && <p>下方仍是上一次结果，你的编辑已保留。</p>}
                <button className="text-button" onClick={() => openAssistance()}>
                  查看人工协助
                </button>
              </div>
            )}
            {state.request !== null && (
              <div className="loading-banner" role="status">
                <span className="spinner" />
                正在整理沟通要点…
              </div>
            )}
            {stale && (
              <div className="notice" role="status">
                情况已更新，请重新生成沟通准备。
              </div>
            )}
            {state.result ? (
              <Results
                key={state.generation}
                state={state}
                dispatch={dispatch}
                onAssistance={openAssistance}
                onSupplement={() => factsInput.current?.focus()}
              />
            ) : (
              <div className="empty-state card">
                <div className="empty-doc" aria-hidden>
                  <i />
                  <i />
                  <i />
                </div>
                <h3>把想说的话，整理得更清楚</h3>
                <p>
                  填写左侧情况，沟通要点和家长底稿就会在这里准备好。
                </p>
                <button
                  type="button"
                  disabled={state.request !== null}
                  onClick={() => factsInput.current?.focus()}
                >
                  开始填写
                </button>
              </div>
            )}
          </div>
        </div>
        {entry !== "home" && <footer>
          <span>家校沟通助手</span><span>{practicing ? "在练习中找到更好的表达。" : "好好沟通，从理解彼此开始。"}</span>
        </footer>}
      </main>
      {((!acknowledged && entry !== "home" && Boolean(available)) || scope) && (
        <UsageNotice
          firstVisit={!acknowledged}
          health={health}
          healthError={healthError}
          onContinue={closeUsage}
        />
      )}
      {assistance && (
        <Assistance status={assistance} onClose={() => setAssistance(null)} />
      )}
      {replace && (
        <Dialog title="重新生成沟通准备？" onClose={() => setReplace(false)}>
          <p>
            新底稿将替换当前编辑，生成后需要重新核对。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setReplace(false)}>保留当前结果</button>
            <button className="primary" onClick={() => void generate()}>
              继续生成
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
