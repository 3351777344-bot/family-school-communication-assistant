import type { Scene } from "./types";

export const criterionIds = ["listening", "facts", "boundaries", "collaboration", "closure"] as const;
export type CriterionId = (typeof criterionIds)[number];
export interface PracticeCase {
  id: string; title: string; scene: Scene; difficulty: string; description: string; objective: string;
  roleCard: { name: string; relationship: string; attitude: string; knownFacts: string[]; opening: string };
}
export interface PracticeCriterion { id: CriterionId; title: string; description: string; anchors: string[] }
export interface PracticeCatalog { cases: PracticeCase[]; rubricVersion: string; criteria: PracticeCriterion[]; reviewStatus: string }
export interface PracticeTurn { id: string; role: "parent" | "counselor"; content: string }
export interface PracticeReviewItem {
  criterionId: CriterionId; score: number | null; feedback: string;
  evidence: { turnId: string; quote: string }[]; alternative: string; practice: string;
}
export interface PracticeReview { rubricVersion: string; summary: string; items: PracticeReviewItem[]; nextExercise: string }
export interface PracticeSession {
  sessionId: string; caseId: string; scene: Scene; status: "active" | "ended";
  version: number; turns: PracticeTurn[]; expiresAt: number | string; flags: string[]; notes?: string; review?: PracticeReview; replyUnavailable?: boolean;
}
export type PracticeOperation =
  | { stage: "start"; input: { caseId: string; requestId: string } }
  | { stage: "turn"; input: { sessionId: string; expectedVersion: number; requestId: string; message: string } }
  | { stage: "end" | "review"; input: { sessionId: string; expectedVersion: number; requestId: string } };

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(text); }
function scene(value: unknown): value is Scene { return value === "xueye" || value === "xinli" || value === "yiban"; }
function invalid(): never { throw new Error("演练服务返回的结果不完整，已有内容已保留，请重试当前步骤。"); }

export function validatePracticeCatalog(value: unknown): PracticeCatalog {
  if (!object(value) || !Array.isArray(value.cases) || !Array.isArray(value.criteria) || !text(value.rubricVersion) || !text(value.reviewStatus)) invalid();
  const caseIds = new Set();
  for (const row of value.cases) {
    if (!object(row) || ![row.id, row.title, row.difficulty, row.description, row.objective].every(text) || !scene(row.scene) || !object(row.roleCard)) invalid();
    if (caseIds.has(row.id)) invalid();
    caseIds.add(row.id);
    const card = row.roleCard;
    if (![card.name, card.relationship, card.attitude, card.opening].every(text) || !strings(card.knownFacts) || !card.knownFacts.length) invalid();
  }
  const ids = new Set();
  for (const criterion of value.criteria) {
    if (!object(criterion) || !criterionIds.includes(criterion.id as CriterionId) || ids.has(criterion.id) || !text(criterion.title) || !text(criterion.description) || !strings(criterion.anchors) || criterion.anchors.length !== 4) invalid();
    ids.add(criterion.id);
  }
  if (ids.size !== criterionIds.length) invalid();
  return value as unknown as PracticeCatalog;
}

export function validatePracticeSession(value: unknown, operation: PracticeOperation, catalog: PracticeCatalog): PracticeSession {
  if (!object(value) || !text(value.sessionId) || !text(value.caseId) || !scene(value.scene) || !["active", "ended"].includes(String(value.status)) || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || !Array.isArray(value.turns) || !strings(value.flags)) invalid();
  const expiry = typeof value.expiresAt === "number" ? value.expiresAt : typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || (value.notes !== undefined && typeof value.notes !== "string") || (value.replyUnavailable !== undefined && typeof value.replyUnavailable !== "boolean")) invalid();
  const selected = catalog.cases.find(row => row.id === value.caseId);
  if (!selected || selected.scene !== value.scene) invalid();
  if (operation.stage === "start") {
    if (value.caseId !== operation.input.caseId || value.version !== 0 || value.status !== "active") invalid();
  } else {
    if (value.sessionId !== operation.input.sessionId) invalid();
    const version = operation.input.expectedVersion + (operation.stage === "review" ? 0 : 1);
    if (value.version !== version || (operation.stage === "end" || operation.stage === "review") && value.status !== "ended") invalid();
  }
  const ids = new Set();
  if (!value.turns.length || value.turns.length > 41) invalid();
  for (const turn of value.turns) {
    if (!object(turn) || !text(turn.id) || ids.has(turn.id) || !["parent", "counselor"].includes(String(turn.role)) || !text(turn.content)) invalid();
    ids.add(turn.id);
  }
  if (value.review !== undefined) {
    if (value.status !== "ended" || !object(value.review)) invalid();
    const review = value.review;
    if (review.rubricVersion !== catalog.rubricVersion || !text(review.summary) || !text(review.nextExercise) || !Array.isArray(review.items) || review.items.length !== criterionIds.length) invalid();
    const reviewed = new Set();
    for (const item of review.items) {
      if (!object(item) || !criterionIds.includes(item.criterionId as CriterionId) || reviewed.has(item.criterionId) || ![item.feedback, item.alternative, item.practice].every(text) || !Array.isArray(item.evidence)) invalid();
      reviewed.add(item.criterionId);
      if (item.score !== null && (!Number.isInteger(item.score) || Number(item.score) < 1 || Number(item.score) > 4 || !item.evidence.length)) invalid();
      for (const evidence of item.evidence) {
        if (!object(evidence) || !text(evidence.turnId) || !text(evidence.quote)) invalid();
        const source = value.turns.find(turn => turn.id === evidence.turnId);
        if (!source || source.role !== "counselor" || !source.content.includes(evidence.quote)) invalid();
      }
    }
  }
  if (operation.stage === "review" && !value.review) invalid();
  return value as unknown as PracticeSession;
}

export async function practiceCatalog(signal: AbortSignal): Promise<PracticeCatalog> {
  const response = await fetch("/api/practice/catalog", { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "暂时无法加载演练案例，请重试。");
  return validatePracticeCatalog(body.data);
}
export async function practiceRequest(operation: PracticeOperation, catalog: PracticeCatalog, signal: AbortSignal): Promise<PracticeSession> {
  const response = await fetch(`/api/practice/${operation.stage}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation.input), signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "演练请求未完成，请重试当前步骤。");
  return validatePracticeSession(body.data, operation, catalog);
}

export function operationFor(stage: PracticeOperation["stage"], caseId: string, session: PracticeSession | null, message: string, requestId: string): PracticeOperation {
  if (stage === "start") return { stage, input: { caseId, requestId } };
  if (!session) throw new Error("请先选择案例开始演练。");
  const base = { sessionId: session.sessionId, expectedVersion: session.version, requestId };
  return stage === "turn" ? { stage, input: { ...base, message: message.trim() } } : { stage, input: base };
}
