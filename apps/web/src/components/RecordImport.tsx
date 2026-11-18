import { useEffect, useRef, useState } from "react";
import type { Scene } from "../types";
import { importRecord, selectedImportText, validateImportFile, type ImportedRecord } from "../record-import";

export function RecordImport({ disabled, scene, inputRevision, onApply }: {
  disabled: boolean; scene: Scene; inputRevision: number; onApply: (text: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportedRecord | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const context = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  context.current = `${scene}:${inputRevision}`;
  const preview = selectedImportText(result?.segments || [], selected, edits, labels);
  function cancel() {
    serial.current++; request.current?.abort(); request.current = null; setPending(false);
  }
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    cancel(); setResult(null); setSelected([]); setEdits({}); setLabels({}); setError("");
  }, [scene, inputRevision]);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  function choose(next: File | null) {
    cancel(); setFile(next); setResult(null); setSelected([]); setEdits({}); setLabels({}); setMessage(""); setError("");
    if (next) try { validateImportFile(next); } catch (e) { setError((e as Error).message); }
  }
  async function extract() {
    if (!file || disabled || request.current) return;
    try { validateImportFile(file); } catch (e) { setError((e as Error).message); return; }
    const abort = new AbortController(); request.current = abort;
    const id = ++serial.current;
    const captured = context.current;
    setPending(true); setError(""); setMessage("");
    try {
      const data = await importRecord(file, scene, abort.signal);
      if (abort.signal.aborted || id !== serial.current || captured !== context.current) return;
      setResult(data); setSelected([]); setEdits({}); setLabels({});
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      if (!abort.signal.aborted && id === serial.current && captured === context.current)
        setError(e instanceof Error ? e.message : "文件提取失败，请重试。");
    } finally {
      if (request.current === abort) { request.current = null; setPending(false); }
    }
  }
  return <details className="record-import">
    <summary>从 PDF、Word 或 Excel 导入记录</summary>
    <p className="muted">支持文字版 PDF、DOCX 和 XLSX，文件大小不超过 5 MB。</p>
    <label className="field">选择文件（PDF / .docx / .xlsx，最多 5 MiB）<input ref={fileInput} type="file" accept=".pdf,.docx,.xlsx" disabled={disabled} onChange={e => choose(e.target.files?.[0] || null)} /></label>
    {file && <p className="compact">{file.name} · {(file.size / 1024).toFixed(1)} KiB</p>}
    <div className="analysis-actions"><button disabled={disabled || !file || pending} onClick={() => void extract()}>{pending ? "正在本地提取…" : "提取并预览"}</button>{pending && <button onClick={() => { cancel(); setMessage("已取消提取，当前记录与人工核对未改变。"); }}>取消提取</button>}{file && <button disabled={disabled} onClick={() => { choose(null); if (fileInput.current) fileInput.current.value = ""; }}>清除文件预览</button>}</div>
    {pending && <p role="status" className="muted">正在读取文件，完成后需选择片段并确认填入。</p>}
    {error && <div role="alert" className="error-banner"><p>{error}</p><p>当前内容已保留。</p></div>}
    {message && <p role="status" className="notice">{message}</p>}
    {result && <section className="import-preview" aria-labelledby="import-preview-heading">
      <h3 id="import-preview-heading" ref={heading} tabIndex={-1}>提取原文预览</h3>
      <p className="muted">选择需要的片段，核对文字顺序和来源后填入记录。</p>
      {result.warnings.map((warning, i) => <p className="notice" key={i}>{warning}</p>)}
      {!result.segments.length && <p className="notice">未找到可提取的文字，请粘贴文字记录。</p>}
      <fieldset disabled={disabled || pending}><ol className="import-segments">{result.segments.map(segment => <li key={segment.id}>
        <label className="import-select"><input type="checkbox" checked={selected.includes(segment.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, segment.id] : previous.filter(id => id !== segment.id))} /><strong>{segment.label}</strong></label>
        <pre>{segment.text}</pre>
        {selected.includes(segment.id) && <><label className="field">本次来源标签（可编辑）<input value={labels[segment.id] ?? segment.label} maxLength={160} onChange={e => setLabels(previous => ({ ...previous, [segment.id]: e.target.value }))} /></label><label className="field">本次片段（可编辑）<textarea rows={3} value={edits[segment.id] ?? segment.text} onChange={e => setEdits(previous => ({ ...previous, [segment.id]: e.target.value }))} /></label></>}
      </li>)}</ol></fieldset>
      <label className="field">将填入的完整记录（含来源标签）<textarea readOnly rows={5} value={preview} placeholder="请先选择需要的段落或行" /></label>
      <p className={preview.length > 1500 ? "import-over-limit" : "muted"} role="status">{preview.length} / 1500 字{preview.length > 1500 ? "，已超出本次记录上限，请减少选择或编辑片段；不会截断内容。" : ""}</p>
      <p className="muted">填入会替换当前记录，之后可点击「分析记录」继续。</p>
      <button className="primary" disabled={disabled || pending || !preview.trim() || preview.length > 1500} onClick={() => {
        if (disabled || pending || !preview.trim() || preview.length > 1500) return;
        onApply(preview); setMessage("已替换填入本次记录，请核对后点击“分析记录”。");
      }}>替换并填入本次记录</button>
    </section>}
  </details>;
}
