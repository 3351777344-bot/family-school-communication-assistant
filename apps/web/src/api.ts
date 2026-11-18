import { preparationStatuses, type Preparation, type PrepareInput } from "./types";

export async function prepare(
  input: PrepareInput,
  inputRevision: number,
  signal: AbortSignal,
): Promise<Preparation> {
  const response = await fetch("/api/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, inputRevision }),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok)
    throw new Error(body?.error || "服务暂时不可用，请稍后重试。");
  return validatePreparation(body.data, inputRevision);
}

export function validatePreparation(data: unknown, inputRevision: number): Preparation {
  const value = data as Preparation;
  const hasDraft = typeof value?.draft === "string" && Boolean(value.draft.trim());
  if (
    !value ||
    value.inputRevision !== inputRevision ||
    !preparationStatuses.includes(value.status) ||
    (value.status === "manual_review" ? value.draft !== null : !hasDraft) ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.steps) ||
    !Array.isArray(value.risks) ||
    !Array.isArray(value.flags) ||
    !Array.isArray(value.faq) ||
    !Array.isArray(value.next)
  )
    throw new Error("服务返回的结果不完整，请重试。");
  return value;
}
