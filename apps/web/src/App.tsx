import { useEffect, useReducer, useRef, useState } from "react";
import { initialState, isStale, reducer } from "./state";
import { prepare } from "./api";
import type { Health, Preparation } from "./types";
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
  const stale = isStale(state);
  const step =
    state.result?.status === "ready" && !stale && state.request === null
      ? 2
      : state.form.situation.trim()
        ? 1
        : 0;
  function openAssistance() {
    if (controller.current) cancel();
    setAssistance(stale ? "ready" : (state.result?.status ?? "ready"));
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
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="家校沟通助手首页">
            <span className="brand-mark" aria-hidden>
              同
            </span>
            <span>
              家校沟通助手<small>辅导员的沟通准备工作台</small>
            </span>
          </a>
          <div className="header-actions">
            <span className={`mode-badge ${health?.mock ? "mock" : ""}`}>
              {health?.mode === "pilot-local"
                ? "受控本地演练 · 离线"
                : health?.mock
                  ? "离线示例 · 不调用模型"
                  : health
                    ? `${health.provider} · ${health.model}`
                    : healthError
                      ? "服务连接异常"
                      : "正在检查服务…"}
            </span>
            <button
              className="text-button"
              aria-haspopup="dialog"
              onClick={() => setScope(true)}
            >
              使用说明
            </button>
            <button
              className="text-button"
              aria-haspopup="dialog"
              onClick={openAssistance}
            >
              人工协助
            </button>
          </div>
        </div>
      </header>
      <main className="page">
        <div className="workbench-intro">
          <h1>家校沟通准备</h1>
          <p>从已知事实开始，整理这次想和家长说什么。</p>
          <ol className="task-steps" aria-label="准备进度">
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={step > index ? "complete" : undefined}
              >
                <span aria-hidden>{step > index ? "✓" : index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        <div className="workbench">
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
                <button className="text-button" onClick={openAssistance}>
                  查看人工协助
                </button>
              </div>
            )}
            {state.request !== null && (
              <div className="loading-banner" role="status">
                <span className="spinner" />
                正在整理，请稍候。已有结果会在成功后替换。
              </div>
            )}
            {stale && (
              <div className="notice" role="status">
                输入已变更。旧结果可回看；旧底稿不能确认或复制。请按当前输入重新生成。
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
                <h3>还没有沟通结果</h3>
                <p>
                  填写已知事实，点击「生成沟通准备」。这里会显示沟通要点、需要留意的情况和可编辑的家长底稿。
                </p>
                <button
                  type="button"
                  disabled={state.request !== null}
                  onClick={() => factsInput.current?.focus()}
                >
                  返回填写情况
                </button>
              </div>
            )}
          </div>
        </div>
        <footer>
          仅用于本次沟通准备。底稿由辅导员核实，系统不会自动发送。
        </footer>
      </main>
      {(!acknowledged || scope) && (
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
            生成成功后，会替换现有结果和底稿编辑，并清空核对状态。取消或生成失败会保留已有内容。
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
