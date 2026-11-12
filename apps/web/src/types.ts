export type Scene = "xueye" | "xinli" | "yiban";
export const preparationStatuses = [
  "ready",
  "needs_information",
  "manual_review",
] as const;
export interface PrepareInput {
  scene: Scene;
  situation: string;
  parentReaction: string;
  parentReactionPreset: "" | "not_contacted" | "disagrees" | "refuses";
  studentWish: string;
  studentWishPreset: "" | "not_discussed" | "willing" | "confidential";
  stage: string;
  extra: string;
  chips: string[];
}
export interface Point {
  moveId: string;
  title: string;
  why: string;
  source: "rule" | "know" | "adv";
  factIds?: string[];
  reference?: {
    id: string;
    version: number;
    title: string;
    excerpt: string;
    quote?: string;
    reviewStatus: string;
    reviewer?: string | null;
    sourceLocation?: { title: string; locator: string };
    excludedUse?: string;
  } | null;
  detail: {
    aim: string;
    why: string;
    react: string[];
    reply: string;
    referenceAction?: string;
  };
}
export interface InputEvidence {
  id: string;
  label: string;
  quote: string;
}
export interface FactCandidate {
  id: string;
  field: string;
  start: number;
  end: number;
  quote: string;
  source: string;
  time: string | null;
  kind:
    | "record"
    | "observation"
    | "report"
    | "unclassified"
    | "context"
    | "speculation";
  uncertain: boolean;
  group: string | null;
  eligible: boolean;
}
export interface Preparation {
  status: (typeof preparationStatuses)[number];
  inputRevision: number;
  sceneName: string;
  points: Point[];
  steps: string[];
  risks: { title: string; detail: string }[];
  draft: string | null;
  faq: { q: string; a: string }[];
  next: string[];
  crisis: boolean;
  notes: string;
  notices?: string[];
  flags: string[];
  missingFacts?: string[];
  inputEvidence?: InputEvidence[];
  facts?: FactCandidate[];
  redacted?: string[];
}
export interface Health {
  mock: boolean;
  provider: string;
  model: string;
  configured: boolean;
  mode?: "pilot-local";
  allowedScenes?: Scene[];
}
