const { parentPort, workerData } = require('node:worker_threads');
const { inspectZip, importError, LIMITS } = require('./import-record');

async function extract(format, bytes) {
  const buffer = Buffer.from(bytes);
  if (format !== 'pdf') inspectZip(buffer, format);
  const segments = [];
  const warnings = [];
  let characters = 0;
  function add(label, value) {
    const text = value.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
    if (!text) return;
    characters += text.length;
    if (characters > LIMITS.characters || segments.length >= LIMITS.segments) throw importError('IMPORT_TOO_LARGE', '提取内容超过 50000 字或 1000 个片段，请先拆分文件；未返回截断结果', 413);
    segments.push({ id: `${format}-${segments.length + 1}`, label, text });
  }
  if (format === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useWorkerFetch: false,
      disableFontFace: true, useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
    let document;
    try {
      document = await task.promise;
      // Empty-password encryption can otherwise open without PasswordException.
      if (await document.getPermissions() !== null) throw importError('IMPORT_ENCRYPTED', 'PDF 已加密，请解除加密后重试', 422);
      if (document.numPages > LIMITS.pages) throw importError('IMPORT_TOO_LARGE', 'PDF 超过 100 页，请先拆分', 413);
      let empty = 0;
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
        if (!text.trim()) empty++;
        add(`PDF 第 ${number} 页`, text);
        page.cleanup();
      }
      if (!segments.length) throw importError('IMPORT_NO_TEXT', 'PDF 没有可提取文本，可能是扫描件；当前不支持 OCR，请先转换为可选中文本的 PDF', 422);
      warnings.push('PDF 按页提取文本，分栏、表格及阅读顺序可能改变，请对照原文件核对。');
      if (empty) warnings.push(`有 ${empty} 页没有可提取文本，可能为空白或扫描页；这些页未导入，当前不支持 OCR。`);
    } catch (error) {
      if (error.name === 'PasswordException' || document?.isEncrypted) throw importError('IMPORT_ENCRYPTED', 'PDF 已加密，请解除加密后重试', 422);
      throw error;
    } finally { await task.destroy(); }
  } else if (format === 'docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    result.value.split(/\n\s*\n/).forEach((text, index) => add(`Word 第 ${index + 1} 段`, text));
    warnings.push('DOCX 按正文段落顺序提取；表格按单元格阅读顺序展开，不保留版式、页码、图片和批注，请核对原文件。');
    if (result.messages.length) warnings.push('文档含解析器提示，部分复杂结构可能未能完整提取，请核对原文件。');
  } else {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer, { ignoreNodes: ['drawing', 'picture', 'dataValidations', 'conditionalFormatting', 'extLst'] });
    let hidden = false, formulas = false;
    function cellText(value) {
      if (value === undefined || value === null) return '';
      if (value instanceof Date) return value.toISOString();
      if (typeof value !== 'object') return String(value);
      if ('formula' in value || 'sharedFormula' in value) { formulas = true; return cellText(value.result); }
      if (Array.isArray(value.richText)) return value.richText.map(item => item.text).join('');
      if (typeof value.text === 'string') return value.text;
      if (value.error) return String(value.error);
      return '';
    }
    workbook.eachSheet(sheet => {
      if (sheet.state !== 'visible') { hidden = true; return; }
      sheet.eachRow((row, rowNumber) => {
        if (row.hidden) { hidden = true; return; }
        const cells = [];
        row.eachCell((cell, columnNumber) => {
          if (sheet.getColumn(columnNumber).hidden) { hidden = true; return; }
          if (cell.type === ExcelJS.ValueType.Merge) return;
          const text = cellText(cell.value);
          if (text.trim()) cells.push({ address: cell.address, text });
        });
        if (cells.length) add(`${sheet.name} · 第 ${rowNumber} 行（${cells[0].address}:${cells.at(-1).address}）`, cells.map(cell => `${cell.address}=${cell.text}`).join(' ｜ '));
      });
    });
    warnings.push('XLSX 仅提取可见工作表、可见行和可见列的单元格；不执行公式、宏或外部链接。请核对日期、合并单元格及行内字段关系。');
    if (hidden) warnings.push('已跳过隐藏工作表、隐藏行或隐藏列。');
    if (formulas) warnings.push('公式仅使用文件中已有的缓存结果；没有缓存的公式单元格未导入，缓存可能不是最新值。');
  }
  if (!segments.length) throw importError('IMPORT_NO_TEXT', '文件没有可提取的可见文本', 422);
  return { format, segments, warnings };
}

extract(workerData.format, workerData.bytes).then(data => parentPort.postMessage({ ok: true, data })).catch(error => {
  // Do not return arbitrary parser errors: these may contain text, XML or file paths.
  const known = /^IMPORT_/.test(error.code || '');
  parentPort.postMessage({ ok: false, code: known ? error.code : 'IMPORT_INVALID',
    status: known ? error.status : 400, error: known ? error.message : '文件损坏、加密或结构不受支持，请检查后重试' });
});
