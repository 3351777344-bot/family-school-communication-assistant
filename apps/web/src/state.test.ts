import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKLIST,
  canConfirmDraft,
  canCopyDraft,
  canEditDraft,
  hasDraft,
  initialState,
  isStale,
  reducer,
  type State,
} from "./state";
import type { Preparation } from "./types";

const data: Preparation = {
  status: "ready",
  inputRevision: 0,
  sceneName: "一般沟通",
  points: [],
  steps: [],
  risks: [],
  draft: "生成稿",
  faq: [],
  next: [],
  crisis: false,
  notes: "",
  flags: [],
};
const loaded = () =>
  reducer(reducer(initialState, { type: "start", id: 1 }), {
    type: "success",
    id: 1,
    data,
  });
const reviewed = (state: State) =>
  CHECKLIST.map((_, index) => index).reduce(
    (s, index) => reducer(s, { type: "check", index, value: true }),
    state,
  );
const confirmed = (state: State) => reducer(reviewed(state), { type: "confirm" });
const unchecked = CHECKLIST.map(() => false);

test("folding preserves edited draft and confirmed review; editing invalidates the review", () => {
  let s = reducer(loaded(), { type: "draft", value: "人工核对稿" });
  s = confirmed(s);
  s = reducer(reducer(s, { type: "toggle", panel: "draft" }), {
    type: "toggle",
    panel: "draft",
  });
  assert.equal(s.draft, "人工核对稿");
  assert.equal(canCopyDraft(s), true);
  assert.deepEqual(s.confirmation, { inputRevision: 0, generation: 1, draftRevision: 1 });
  s = reducer(s, { type: "draft", value: "再次编辑" });
  assert.equal(canCopyDraft(s), false);
  assert.deepEqual(s.checks, unchecked);
});

test("failure and cancellation preserve edits; late responses cannot replace retained content", () => {
  let s = reducer(loaded(), { type: "draft", value: "不能丢失的编辑" });
  s = reducer(reducer(s, { type: "start", id: 2 }), {
    type: "failure",
    id: 2,
    message: "额度不足",
  });
  assert.equal(s.draft, "不能丢失的编辑");
  assert.equal(s.result?.draft, "生成稿");
  s = reducer(reducer(s, { type: "start", id: 3 }), { type: "cancel", id: 3 });
  s = reducer(s, {
    type: "success",
    id: 3,
    data: { ...data, draft: "过期响应" },
  });
  assert.equal(s.draft, "不能丢失的编辑");
  assert.equal(s.generation, 1);
});

test("a newer generation resets review and old responses cannot clear its pending state", () => {
  let s = reducer(confirmed(loaded()), { type: "start", id: 2 });
  assert.equal(canCopyDraft(s), false);
  s = reducer(s, { type: "failure", id: 1, message: "旧请求失败" });
  assert.equal(s.request?.id, 2);
  assert.equal(reducer(s, { type: "success", id: 1, data }), s);
  assert.equal(s.error, "");
  s = reducer(s, {
    type: "success",
    id: 2,
    data: { ...data, draft: "新稿" },
  });
  assert.equal(s.draft, "新稿");
  assert.equal(canCopyDraft(s), false);
  assert.deepEqual(s.collapsed, []);
  assert.deepEqual(s.checks, unchecked);
});

test("confirmation cannot be forged through an incomplete checklist or empty draft", () => {
  assert.equal(reducer(loaded(), { type: "confirm" }).confirmation, null);
  assert.equal(confirmed(reducer(loaded(), { type: "draft", value: "  " })).confirmation, null);
  const partial = reducer(loaded(), { type: "check", index: 0, value: true });
  assert.equal(canConfirmDraft(partial), false);
});

test("scene and fact changes keep the old draft readable and block confirmation and copy", () => {
  const edited = confirmed(reducer(loaded(), { type: "draft", value: "保留这份编辑" }));
  for (const patch of [
    { scene: "xinli" },
    { situation: "新事实" },
    { studentWish: "学生说不想活" },
    { chips: ["要求保密"] },
  ] as const) {
    const changed = reducer(edited, { type: "form", patch });
    assert.equal(changed.draft, edited.draft);
    assert.equal(isStale(changed), true);
    assert.equal(canConfirmDraft(reviewed(changed)), false);
    assert.equal(canCopyDraft(confirmed(changed)), false);
    assert.equal(reducer(changed, { type: "draft", value: "新编辑" }), changed);
    const reverted = reducer(changed, { type: "form", patch: edited.form });
    assert.deepEqual(reverted.form, edited.form);
    assert.equal(isStale(reverted), true);
    assert.equal(canCopyDraft(reverted), false);
  }
});

test("a changed input or mismatched response revision cannot replace existing content", () => {
  const edited = reducer(loaded(), { type: "draft", value: "旧稿编辑" });
  const started = reducer(edited, { type: "start", id: 2 });
  const changed = reducer(started, { type: "form", patch: { situation: "请求后变更的事实" } });
  const late = reducer(changed, { type: "success", id: 2, data: { ...data, draft: "迟到的稿件" } });
  assert.equal(late.request, null);
  assert.equal(late.draft, edited.draft);
  assert.equal(isStale(late), true);
  const retry = reducer(late, { type: "start", id: 3 });
  const mismatched = reducer(retry, { type: "success", id: 3, data });
  assert.equal(mismatched.draft, edited.draft);
  assert.match(mismatched.error, /不匹配/);
  const current = reducer(retry, {
    type: "success",
    id: 3,
    data: { ...data, inputRevision: changed.inputRevision, draft: "当前稿件" },
  });
  assert.equal(current.draft, "当前稿件");
  assert.equal(isStale(current), false);
  assert.equal(canCopyDraft(confirmed(current)), true);
});

test("manual review never accepts draft or confirmation actions", () => {
  const s = reducer(reducer(initialState, { type: "start", id: 1 }), {
    type: "success",
    id: 1,
    data: { ...data, draft: null, status: "manual_review" },
  });
  assert.equal(hasDraft(s), false);
  assert.equal(reducer(s, { type: "draft", value: "不能接受的稿件" }), s);
  assert.equal(confirmed(s).confirmation, null);
  assert.equal(canCopyDraft(s), false);
});

test("信息不足时底稿仍可编辑和确认，只是标记为通用参考", () => {
  const s = reducer(reducer(initialState, { type: "start", id: 1 }), {
    type: "success",
    id: 1,
    data: { ...data, status: "needs_information", missingFacts: ["希望和家长先确认或商量什么"] },
  });
  assert.equal(hasDraft(s), true);
  assert.equal(canEditDraft(s), true);
  assert.equal(canCopyDraft(confirmed(s)), true);
});

test("follow-up checks stay on the current result across failure and reset on replacement", () => {
  const result = { ...data, next: ["约定下次沟通"] };
  const submit = reducer(initialState, { type: "start", id: 1 });
  let s = reducer(submit, { type: "success", id: 1, data: result });
  const next = { type: "next", item: "约定下次沟通" } as const;
  assert.equal(reducer(s, { type: "next", item: "不在列表中" }), s);
  s = reducer(s, next);
  assert.deepEqual(s.nextChecks, [next.item]);
  const pending = reducer(s, { type: "start", id: 2 });
  assert.equal(reducer(pending, next), pending);
  const failed = reducer(pending, { type: "failure", id: 2, message: "503" });
  assert.deepEqual(failed.nextChecks, [next.item]);
  const stale = reducer(failed, { type: "form", patch: { scene: "xinli" } });
  assert.equal(reducer(stale, next), stale);
  const retry = reducer(stale, { type: "start", id: 3 });
  const fresh = reducer(retry, { type: "success", id: 3, data: { ...result, inputRevision: stale.inputRevision } });
  assert.deepEqual(fresh.nextChecks, []);
});
