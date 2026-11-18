import type { Scene } from "./types";
export interface ImportedSegment { id: string; label: string; text: string }
export interface ImportedRecord { format: "pdf" | "docx" | "xlsx"; segments: ImportedSegment[]; warnings: string[] }
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export function validateImportFile(file: Pick<File, "name" | "size">) {
  if (!/\.(pdf|docx|xlsx)$/i.test(file.name)) throw new Error("请选择 PDF、Word（.docx）或 Excel（.xlsx）文件；暂不支持旧版 .doc / .xls。");
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error("请选择非空且不超过 5 MiB 的文件。");
}
export function validateImportedRecord(data: unknown): ImportedRecord {
  const value = data as ImportedRecord;
  if (!value || !["pdf", "docx", "xlsx"].includes(value.format) || !Array.isArray(value.segments) ||
      !Array.isArray(value.warnings) || !value.warnings.every(x => typeof x === "string") ||
      !value.segments.every(item => item && typeof item.id === "string" && typeof item.label === "string" && typeof item.text === "string") ||
      new Set(value.segments.map(item => item.id)).size !== value.segments.length)
    throw new Error("文件提取结果不完整，请重试或复制文本粘贴。");
  return value;
}
export function selectedImportText(segments: ImportedSegment[], selected: string[], edits: Record<string, string>, labels: Record<string, string> = {}) {
  return segments.filter(item => selected.includes(item.id)).map(item => ({ ...item, text: edits[item.id] ?? item.text }))
    .filter(item => item.text.trim()).map(item => `【导入来源：${(labels[item.id] ?? item.label).trim() || item.label}】\n${item.text.trim()}`).join("\n\n");
}
export async function importRecord(file: File, scene: Scene, signal: AbortSignal) {
  validateImportFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new DOMException("已取消", "AbortError");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const response = await fetch("/api/import-record", { method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary), scene }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "文件提取失败，请重试或复制文本粘贴。");
  return validateImportedRecord(body.data);
}
