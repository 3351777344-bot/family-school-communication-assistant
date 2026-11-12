import type { Dispatch, RefObject } from "react";
import type { Action, State } from "../state";
import type { Scene } from "../types";
import workflowSteps from "../../../../app/workflow-steps.json";

const tags = ["学业警示", "就医疑虑", "家长隐瞒", "要求保密"];
const scenes = [
  ["xueye", "学业警示"],
  ["xinli", "心理健康首次告知"],
  ["yiban", "一般家校沟通"],
] as const;
const examples: Record<Scene, string> = {
  xueye:
    "课程平台显示一次作业未交，学生说已上传，记录尚待核实。想和家长一起核对提交情况。",
  xinli:
    "辅导员观察到学生本周两次在早课上打瞌睡。希望先听听家长的观察，再商量下次联系时间。",
  yiban: "学生说上课时接电话不方便。想和家长商量一个双方方便的联系时间。",
};
export function InputPanel({
  state,
  dispatch,
  onGenerate,
  onCancel,
  headingRef,
  factsRef,
  allowedScenes,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  onGenerate: () => void;
  onCancel: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  factsRef: RefObject<HTMLTextAreaElement | null>;
  allowedScenes?: Scene[];
}) {
  const { form, request } = state;
  const sceneAllowed = !allowedScenes || allowedScenes.includes(form.scene);
  const hasFacts = Boolean(form.situation.trim());
  const hasBackground = Boolean(
    form.parentReactionPreset ||
      form.parentReaction.trim() ||
      form.studentWishPreset ||
      form.studentWish.trim() ||
      form.stage ||
      form.chips.length ||
      form.extra.trim(),
  );
  const confidentiality =
    form.studentWishPreset === "confidential" || form.chips.includes("要求保密");
  return (
    <aside className="input-panel card" aria-label="沟通情况">
      <div className="section-heading">
        <h2 ref={headingRef} tabIndex={-1}>
          填写沟通情况
        </h2>
        <p>写清发生了什么，以及这次想和家长确认什么。</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (request === null && sceneAllowed && form.situation.trim())
            onGenerate();
        }}
      >
        <fieldset disabled={request !== null}>
          <label className="field">
            沟通场景
            <select
              value={form.scene}
              onChange={(e) =>
                dispatch({
                  type: "form",
                  patch: { scene: e.target.value as typeof form.scene },
                })
              }
            >
              {scenes.map(([id, label]) => (
                <option
                  key={id}
                  value={id}
                  disabled={allowedScenes && !allowedScenes.includes(id)}
                >
                  {label}
                  {allowedScenes && !allowedScenes.includes(id)
                    ? "（未授权）"
                    : ""}
                </option>
              ))}
              <option disabled>危机前期（待校内审核）</option>
            </select>
          </label>
          <div className="field">
            <div className="field-heading">
              <label htmlFor="situation">
                已知事实 <span className="required">必填</span>
              </label>
              {!hasFacts && (
                <button
                  type="button"
                  className="text-button"
                  disabled={!sceneAllowed}
                  onClick={() => {
                    if (form.situation.trim()) return;
                    dispatch({
                      type: "form",
                      patch: { situation: examples[form.scene] },
                    });
                    factsRef.current?.focus();
                  }}
                >
                  填入虚构示例
                </button>
              )}
            </div>
            <textarea
              id="situation"
              ref={factsRef}
              required
              maxLength={1500}
              rows={4}
              value={form.situation}
              onChange={(e) =>
                dispatch({ type: "form", patch: { situation: e.target.value } })
              }
              placeholder="例如：本周有一次作业记录待核对。想听听家长了解到的情况。"
              aria-describedby="situation-hint"
            />
            <span id="situation-hint" className="field-meta">
              试用时请只填虚构信息
              <span>{form.situation.length}/1500</span>
            </span>
          </div>
          {confidentiality && (
            <div className="notice" role="status">
              <strong>学生要求对家长保密</strong>
              <p>
                底稿仍会生成，但是否告知家长由你判断。系统不替你确认可告知范围，也不认为生成内容等于可以对外披露。
              </p>
            </div>
          )}
          <details className="optional-fields">
            <summary>
              补充背景{" "}
              <span>
                {hasBackground
                  ? "已填写，可展开查看"
                  : "家长反应、学生意愿等 · 选填"}
              </span>
            </summary>
            <div className="optional-fields-body">
              <label className="field">
                家长反应预设
                <select
                  value={form.parentReactionPreset}
                  onChange={(event) =>
                    dispatch({
                      type: "form",
                      patch: {
                        parentReactionPreset: event.target
                          .value as typeof form.parentReactionPreset,
                      },
                    })
                  }
                >
                  <option value="">暂不选择</option>
                  <option value="not_contacted">未沟通</option>
                  <option value="disagrees">已沟通但不认可</option>
                  <option value="refuses">已明确拒绝</option>
                </select>
              </label>
              <label className="field">
                家长目前的反应
                <input
                  maxLength={100}
                  value={form.parentReaction}
                  onChange={(e) =>
                    dispatch({
                      type: "form",
                      patch: { parentReaction: e.target.value },
                    })
                  }
                  placeholder="如：尚未联系 / 着急 / 有疑问"
                />
              </label>
              <label className="field">
                学生意愿预设
                <select
                  value={form.studentWishPreset}
                  onChange={(event) =>
                    dispatch({
                      type: "form",
                      patch: {
                        studentWishPreset: event.target
                          .value as typeof form.studentWishPreset,
                      },
                    })
                  }
                >
                  <option value="">暂不选择</option>
                  <option value="not_discussed">未涉及</option>
                  <option value="willing">愿意沟通</option>
                  <option value="confidential">要求对父母保密</option>
                </select>
              </label>
              <label className="field">
                学生的意愿
                <input
                  maxLength={100}
                  value={form.studentWish}
                  onChange={(e) =>
                    dispatch({
                      type: "form",
                      patch: { studentWish: e.target.value },
                    })
                  }
                  placeholder="如：愿意一起沟通 / 尚未了解"
                />
              </label>
              <label className="field">
                当前所处环节
                <select
                  value={form.stage}
                  onChange={(e) =>
                    dispatch({ type: "form", patch: { stage: e.target.value } })
                  }
                >
                  <option value="">暂不选择</option>
                  {workflowSteps.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>
                  补充标签 <small>可多选</small>
                </span>
                <div className="chips">
                  {tags.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      aria-pressed={form.chips.includes(tag)}
                      onClick={() =>
                        dispatch({
                          type: "form",
                          patch: {
                            chips: form.chips.includes(tag)
                              ? form.chips.filter((t) => t !== tag)
                              : [...form.chips, tag],
                          },
                        })
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                其他需要说明的情况
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={form.extra}
                  onChange={(e) =>
                    dispatch({ type: "form", patch: { extra: e.target.value } })
                  }
                  placeholder="可补充已经核实的沟通经过"
                />
              </label>
            </div>
          </details>
          <button
            className="primary generate"
            type="submit"
            disabled={!hasFacts || !sceneAllowed}
          >
            {request !== null
              ? "正在整理沟通准备…"
              : state.result
                ? "重新生成沟通准备"
                : "生成沟通准备"}
            <span aria-hidden>→</span>
          </button>
          {!hasFacts && (
            <p className="generate-hint">填入已知事实后即可生成。</p>
          )}
        </fieldset>
        {request !== null && (
          <button type="button" className="cancel-request" onClick={onCancel}>
            取消本次生成
          </button>
        )}
      </form>
    </aside>
  );
}
