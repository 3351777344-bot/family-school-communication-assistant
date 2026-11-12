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
  const data = body.data;
  const hasDraft = typeof data?.draft === "string" && Boolean(data.draft.trim());
  if (
    !data ||
    data.inputRevision !== inputRevision ||
    !preparationStatuses.includes(data.status) ||
    (data.status === "manual_review" ? data.draft !== null : !hasDraft) ||
    !Array.isArray(data.points) ||
    !Array.isArray(data.steps) ||
    !Array.isArray(data.risks) ||
    !Array.isArray(data.flags) ||
    !Array.isArray(data.faq) ||
    !Array.isArray(data.next)
  )
    throw new Error("服务返回的结果不完整，请重试。");
  return data;
}
