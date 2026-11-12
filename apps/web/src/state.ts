import type { Preparation, PrepareInput } from "./types";

export const initialForm: PrepareInput = {
  scene: "xueye",
  situation: "",
  parentReaction: "",
  parentReactionPreset: "",
  studentWish: "",
  studentWishPreset: "",
  stage: "",
  extra: "",
  chips: [],
};
// 原型「五、P4 底稿编辑与确认」的四项核对。
export const CHECKLIST = [
  "已核实事实是否准确，未补写输入里没有的情况",
  "已核对是否包含推测或未经核实的判断",
  "已去除不必要的身份信息",
  "内容符合我自己的专业判断",
] as const;
const unchecked = CHECKLIST.map(() => false);

interface RequestVersion {
  id: number;
  inputRevision: number;
  stage: string;
}
interface Confirmation {
  inputRevision: number;
  generation: number;
  draftRevision: number;
}
export interface State {
  form: PrepareInput;
  inputRevision: number;
  result: Preparation | null;
  resultStage: string;
  draft: string;
  draftRevision: number;
  checks: boolean[];
  confirmation: Confirmation | null;
  collapsed: string[];
  request: RequestVersion | null;
  generation: number;
  error: string;
  nextChecks: string[];
}
export const initialState: State = {
  form: initialForm,
  inputRevision: 0,
  result: null,
  resultStage: "",
  draft: "",
  draftRevision: 0,
  checks: unchecked,
  confirmation: null,
  collapsed: [],
  request: null,
  generation: 0,
  error: "",
  nextChecks: [],
};
export type Action =
  | { type: "form"; patch: Partial<PrepareInput> }
  | { type: "start"; id: number }
  | { type: "success"; id: number; data: Preparation }
  | { type: "failure"; id: number; message: string }
  | { type: "cancel"; id: number }
  | { type: "draft"; value: string }
  | { type: "check"; index: number; value: boolean }
  | { type: "confirm" }
  | { type: "toggle"; panel: string }
  | { type: "next"; item: string };

export function isStale(state: State) {
  return state.result !== null && state.result.inputRevision !== state.inputRevision;
}

export function hasDraft(state: State) {
  return state.result !== null && state.result.status !== "manual_review" &&
    typeof state.result.draft === "string" && Boolean(state.result.draft.trim());
}

export function canEditDraft(state: State) {
  return state.request === null && !isStale(state) && hasDraft(state);
}

export function canConfirmDraft(state: State) {
  return canEditDraft(state) && !!state.draft.trim() && state.checks.every(Boolean);
}

export function canCopyDraft(state: State) {
  const confirmed = state.confirmation;
  return canConfirmDraft(state) && confirmed !== null &&
    confirmed.inputRevision === state.inputRevision &&
    confirmed.generation === state.generation &&
    confirmed.draftRevision === state.draftRevision;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "form": {
      const changed = <K extends keyof PrepareInput>(key: K) => {
        const current = state.form[key];
        const next = action.patch[key];
        if (next === undefined) return false;
        if (Array.isArray(current) && Array.isArray(next)) {
          return current.length !== next.length || current.some((value, i) => value !== next[i]);
        }
        return current !== next;
      };
      const keys = (Object.keys(action.patch) as (keyof PrepareInput)[]).filter(changed);
      if (!keys.length) return state;
      return {
        ...state,
        form: { ...state.form, ...action.patch },
        inputRevision: state.inputRevision + 1,
        confirmation: null,
        checks: unchecked,
      };
    }
    case "start":
      if (state.request !== null) return state;
      return { ...state, request: { id: action.id, inputRevision: state.inputRevision, stage: state.form.stage }, error: "" };
    case "success":
      if (state.request?.id !== action.id) return state;
      if (state.request.inputRevision !== state.inputRevision) return { ...state, request: null };
      if (action.data.inputRevision !== state.request.inputRevision) {
        return { ...state, request: null, error: "结果与本次输入不匹配，请重新生成。" };
      }
      return {
        ...state,
        request: null,
        generation: action.id,
        result: action.data,
        resultStage: state.request.stage,
        draft: action.data.draft || "",
        draftRevision: 0,
        checks: unchecked,
        confirmation: null,
        collapsed: [],
        error: "",
        nextChecks: [],
      };
    case "failure":
      return state.request?.id === action.id
        ? { ...state, request: null, error: state.request.inputRevision === state.inputRevision ? action.message : "" }
        : state;
    case "cancel":
      return state.request?.id === action.id
        ? {
            ...state,
            request: null,
            error: "已取消本次生成，输入和已有结果已保留。",
          }
        : state;
    case "draft":
      return !canEditDraft(state) || action.value === state.draft
        ? state
        : {
            ...state,
            draft: action.value,
            draftRevision: state.draftRevision + 1,
            confirmation: null,
            checks: unchecked,
          };
    case "check":
      if (!canEditDraft(state) || state.checks[action.index] === undefined ||
          state.checks[action.index] === action.value) return state;
      return {
        ...state,
        checks: state.checks.map((v, i) =>
          i === action.index ? action.value : v,
        ),
        confirmation: null,
      };
    case "confirm":
      return canConfirmDraft(state)
        ? { ...state, confirmation: {
            inputRevision: state.inputRevision,
            generation: state.generation,
            draftRevision: state.draftRevision,
          } }
        : state;
    case "toggle":
      return {
        ...state,
        collapsed: state.collapsed.includes(action.panel)
          ? state.collapsed.filter((p) => p !== action.panel)
          : [...state.collapsed, action.panel],
      };
    case "next":
      if (state.request !== null || isStale(state) || !state.result?.next.includes(action.item)) return state;
      return {
        ...state,
        nextChecks: state.nextChecks.includes(action.item)
          ? state.nextChecks.filter((p) => p !== action.item)
          : [...state.nextChecks, action.item],
      };
  }
}
