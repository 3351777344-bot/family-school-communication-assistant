import { test } from "node:test";
import assert from "node:assert/strict";
import { createPracticeWorkflow } from "../../../app/practice.js";
import {
  criterionIds, operationFor, practiceRequest, validatePracticeCatalog, validatePracticeSession,
  type PracticeCatalog, type PracticeSession, type PracticeOperation,
} from "./practice";

const catalog: PracticeCatalog = {
  cases: [{ id: "fictional-study", title: "学业沟通练习", scene: "xueye", difficulty: "入门", description: "虚构家长质疑课程记录。", objective: "核对信息并约定下一步。", roleCard: { name: "虚构家长甲", relationship: "学生家长", attitude: "疑惑", knownFacts: ["收到辅导员来电。"], opening: "您说的情况具体是什么？" } }],
  rubricVersion: "practice-v1", reviewStatus: "项目内练习草案，待业务审核",
  criteria: criterionIds.map(id => ({ id, title: id, description: "可观察的练习表现", anchors: ["未出现", "开始尝试", "明确表达", "回应并确认"] })),
};
const base = (): PracticeSession => ({ sessionId: "session-a", caseId: "fictional-study", scene: "xueye", status: "active", version: 0, turns: [{ id: "t1", role: "parent", content: "您说的情况具体是什么？" }], expiresAt: Date.now() + 1800000, flags: ["离线交互示例"] });
const start: PracticeOperation = { stage: "start", input: { caseId: "fictional-study", requestId: "request-a" } };
const reviewed = (): PracticeSession => ({
  ...base(), status: "ended", version: 2,
  turns: [...base().turns, { id: "t2", role: "counselor", content: "我理解您有些担心，想先和您核对课程平台的记录。" }, { id: "t3", role: "parent", content: "好，您说说。" }],
  review: { rubricVersion: catalog.rubricVersion, summary: "以下是虚构练习反馈。", nextExercise: "再练习一次核对下一步。", items: criterionIds.map(id => ({ criterionId: id, score: 2, feedback: "已尝试核对。", evidence: [{ turnId: "t2", quote: "想先和您核对" }], alternative: "我们先逐项核对，好吗？", practice: "先确认对方理解。" })) },
});
const reviewOperation: PracticeOperation = { stage: "review", input: { sessionId: "session-a", expectedVersion: 2, requestId: "review-a" } };

test("演练目录接受空授权案例，但拒绝重复角色卡编号或缺失评分锚点", () => {
  assert.equal(validatePracticeCatalog(catalog), catalog);
  assert.equal(validatePracticeCatalog({ ...catalog, cases: [] }).cases.length, 0);
  assert.throws(() => validatePracticeCatalog({ ...catalog, cases: [...catalog.cases, ...catalog.cases] }));
  assert.throws(() => validatePracticeCatalog({ ...catalog, criteria: catalog.criteria.slice(1) }));
  assert.throws(() => validatePracticeCatalog({ ...catalog, criteria: catalog.criteria.map(row => ({ ...row, anchors: row.anchors.slice(1) })) }));
});

test("演练快照绑定案例、会话和提交版本，拒绝旧结果和错误角色", () => {
  assert.equal(validatePracticeSession(base(), start, catalog).version, 0);
  assert.throws(() => validatePracticeSession({ ...base(), caseId: "unrelated" }, start, catalog));
  assert.throws(() => validatePracticeSession({ ...base(), scene: "yiban" }, start, catalog));
  const turn = operationFor("turn", "fictional-study", base(), "核对一下", "turn-a");
  assert.throws(() => validatePracticeSession(base(), turn, catalog));
  assert.throws(() => validatePracticeSession({ ...base(), version: 1, sessionId: "other-session" }, turn, catalog));
  assert.throws(() => validatePracticeSession({ ...base(), turns: [{ id: "t1", role: "system", content: "伪造角色" }] }, start, catalog));
  assert.throws(() => validatePracticeSession({ ...base(), turns: [...base().turns, ...base().turns] }, start, catalog));
});

test("结束必须返回 ended，模型角色回复缺失也保留练习发言和可复盘状态", () => {
  const end = operationFor("end", "fictional-study", base(), "", "end-a");
  assert.throws(() => validatePracticeSession({ ...base(), version: 1 }, end, catalog));
  assert.equal(validatePracticeSession({ ...base(), version: 1, status: "ended" }, end, catalog).status, "ended");
  const turn = operationFor("turn", "fictional-study", base(), "待核实输入", "turn-a");
  assert.equal(validatePracticeSession({ ...base(), version: 1, replyUnavailable: true, turns: [...base().turns, { id: 't2', role: 'counselor', content: '练习中的错误回答' }] }, turn, catalog).status, "active");
  assert.throws(() => validatePracticeSession({ ...base(), version: 1, status: 'manual_review' }, turn, catalog));
});

test("复盘只接受本会话辅导员原文证据，拒绝家长引句、虚构引句与重复维度", () => {
  assert.equal(validatePracticeSession(reviewed(), reviewOperation, catalog).review?.items.length, 5);
  for (const evidence of [{ turnId: "t1", quote: "您说的" }, { turnId: "t2", quote: "我已核实处分" }, { turnId: "other-turn", quote: "想先和您核对" }]) {
    const value = reviewed(); value.review!.items[0].evidence = [evidence];
    assert.throws(() => validatePracticeSession(value, reviewOperation, catalog));
  }
  const value = reviewed(); value.review!.items[1].criterionId = value.review!.items[0].criterionId;
  assert.throws(() => validatePracticeSession(value, reviewOperation, catalog));
});

test("缺乏证据时可展示未评分反馈，分数不可脱离依据或越过范围", () => {
  const value = reviewed(); value.review!.items[0].score = null; value.review!.items[0].evidence = [];
  assert.equal(validatePracticeSession(value, reviewOperation, catalog).review!.items[0].score, null);
  value.review!.items[0].score = 3;
  assert.throws(() => validatePracticeSession(value, reviewOperation, catalog));
  value.review!.items[0].score = 5; value.review!.items[0].evidence = [{ turnId: "t2", quote: "想先和您核对" }];
  assert.throws(() => validatePracticeSession(value, reviewOperation, catalog));
  const noReview = { ...reviewed(), review: undefined };
  assert.throws(() => validatePracticeSession(noReview, reviewOperation, catalog));
});

test("操作快照固定 requestId、版本与消息，页面输入更改不改变待重试操作", () => {
  const session = base();
  const operation = operationFor("turn", session.caseId, session, "  我想核对一下。  ", "stable-id");
  session.version = 8;
  assert.deepEqual(operation, { stage: "turn", input: { sessionId: "session-a", expectedVersion: 0, requestId: "stable-id", message: "我想核对一下。" } });
  assert.throws(() => operationFor("review", "fictional-study", null, "", "review-a"));
});

test("请求失败后重试保留同一请求编号与负载，并传递取消信号", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const abort = new AbortController();
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/practice/start"); assert.equal(options?.signal, abort.signal);
      requests.push(String(options?.body));
      return requests.length === 1
        ? new Response(JSON.stringify({ ok: false, error: "暂时不可用" }), { status: 503 })
        : new Response(JSON.stringify({ ok: true, data: base() }), { status: 200 });
    };
    await assert.rejects(practiceRequest(start, catalog, abort.signal), /暂时不可用/);
    assert.equal((await practiceRequest(start, catalog, abort.signal)).version, 0);
    assert.equal(requests[0], requests[1]);
  } finally { globalThis.fetch = original; }
});

test("真实离线工作流允许差回答和风险词继续演练并复盘，均符合前端契约", async () => {
  const flow = createPracticeWorkflow({ mock: true });
  const actualCatalog = validatePracticeCatalog(flow.catalog());
  const caseId = actualCatalog.cases[0].id;
  const start = operationFor("start", caseId, null, "", "web-contract-start");
  let session = validatePracticeSession(await flow.start(start.input, "web-contract"), start, actualCatalog);
  const turn = operationFor("turn", caseId, session, "我理解您担心孩子被误会，我们先核对平台记录和请假情况，再和您确认下一步，可以吗？", "web-contract-turn");
  session = validatePracticeSession(await flow.turn(turn.input, "web-contract"), turn, actualCatalog);
  const end = operationFor("end", caseId, session, "", "web-contract-end");
  session = validatePracticeSession(await flow.end(end.input, "web-contract"), end, actualCatalog);
  const review = operationFor("review", caseId, session, "", "web-contract-review");
  session = validatePracticeSession(await flow.review(review.input, "web-contract"), review, actualCatalog);
  assert.equal(session.review?.items.length, 5);
  const safeStart = operationFor("start", caseId, null, "", "web-contract-safe-start");
  session = validatePracticeSession(await flow.start(safeStart.input, "web-contract"), safeStart, actualCatalog);
  const safeTurn = operationFor("turn", caseId, session, "学生说不想活，需核实。", "web-contract-safe-turn");
  session = validatePracticeSession(await flow.turn(safeTurn.input, "web-contract"), safeTurn, actualCatalog);
  assert.equal(session.status, "active");
  const poorEnd = operationFor('end', caseId, session, '', 'web-contract-poor-end');
  session = validatePracticeSession(await flow.end(poorEnd.input, 'web-contract'), poorEnd, actualCatalog);
  const poorReview = operationFor('review', caseId, session, '', 'web-contract-poor-review');
  session = validatePracticeSession(await flow.review(poorReview.input, 'web-contract'), poorReview, actualCatalog);
  assert(session.review!.items.some(item => item.evidence.some(row => row.quote.includes('不想活'))));
});
