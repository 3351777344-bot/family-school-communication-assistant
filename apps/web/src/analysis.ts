export interface AnalysisItem {
  id: string;
  start: number;
  end: number;
  quote: string;
  source: string;
  kind: string;
  uncertain: boolean;
  reviewStatus: "pending" | "confirmed";
  disclosable: boolean;
}
export interface Analysis {
  status: "review" | "manual_review";
  analysisId: string;
  inputRevision: number;
  items: AnalysisItem[];
  questions: string[];
  conflicts: { itemIds: string[]; reason: string }[];
  flags: string[];
  notes?: string;
}
export interface ItemReview {
  id: string;
  reviewStatus: "pending" | "confirmed";
  disclosable: boolean;
  correction?: string;
}
export function initialReviews(items: AnalysisItem[]): ItemReview[] {
  return items.map(({ id }) => ({ id, reviewStatus: "pending", disclosable: false }));
}
export function approvedReviews(reviews: ItemReview[]) {
  return reviews.filter(item => item.reviewStatus === "confirmed" && item.disclosable);
}
export function validateAnalysis(data: unknown, text: string, revision: number): Analysis {
  const value = data as Analysis;
  if (!value || !["review", "manual_review"].includes(value.status) ||
      typeof value.analysisId !== "string" || value.inputRevision !== revision ||
      !Array.isArray(value.items) || !Array.isArray(value.questions) ||
      !Array.isArray(value.conflicts) || !Array.isArray(value.flags) ||
      !value.flags.every(x => typeof x === "string") ||
      !value.questions.every(x => typeof x === "string") || !value.conflicts.every(x => Array.isArray(x.itemIds) && x.itemIds.every(id => typeof id === "string" && value.items.some(item => item.id === id)) && typeof x.reason === "string") ||
      new Set(value.items.map(x => x.id)).size !== value.items.length ||
      !value.items.every(item => typeof item.id === "string" && typeof item.source === "string" &&
        typeof item.kind === "string" && Number.isInteger(item.start) && Number.isInteger(item.end) &&
        item.start >= 0 && item.end > item.start && text.slice(item.start, item.end) === item.quote))
    throw new Error("分析结果与本次记录不匹配，请重试。");
  return value;
}
