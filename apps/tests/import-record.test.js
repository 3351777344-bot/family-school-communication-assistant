const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { importRecord, validateImportInput, inspectZip } = require('../../app/import-record');
const { createAnalysisWorkflow } = require('../../app/analysis');

const fixtureRoot = path.join(__dirname, 'fixtures/import-record');
const bytes = filename => fs.readFileSync(path.join(fixtureRoot, filename));
const input = (filename, content = bytes(filename)) => ({ filename, contentBase64: content.toString('base64'), scene: 'xueye' });
const errorCode = code => error => error.code === code;
const combined = result => result.segments.map(row => row.text).join('\n');

test('真实Word段落与表格可导入，段落有唯一编号及来源标签', async () => {
  const result = await importRecord(input('records.docx'));
  assert.equal(result.format, 'docx');
  assert(combined(result).includes('课程平台显示本周缺课两次。'));
  assert(combined(result).includes('学生说其中一次请过假。'));
  assert(combined(result).includes('记录来源'));
  assert(result.segments.every(row => row.id && row.label && row.text));
  assert.equal(new Set(result.segments.map(row => row.id)).size, result.segments.length);
  assert(Array.isArray(result.warnings));
});

test('真实两页PDF提取可检索文本并保留页来源', async () => {
  const result = await importRecord(input('records.pdf'));
  assert.equal(result.format, 'pdf');
  assert(combined(result).includes('two absences this week'));
  assert(combined(result).includes('one absence may have approved leave'));
  assert(result.segments.some(row => /1/.test(row.label)));
  assert(result.segments.some(row => /2/.test(row.label)));
});

test('真实Excel导入可见行列与数值，隐藏内容和公式不会被作为记录导入', async () => {
  const result = await importRecord(input('records.xlsx'));
  assert.equal(result.format, 'xlsx');
  assert(combined(result).includes('本周缺课两次'));
  assert(combined(result).includes('次数'));
  assert(combined(result).includes('2'));
  assert(result.segments.some(row => row.label.includes('课程记录')));
  for (const omitted of ['HIDDEN_COLUMN_SYNTHETIC', 'HIDDEN_ROW_SYNTHETIC', 'HIDDEN_SHEET_SYNTHETIC', 'FORMULA_SYNTHETIC', 'HYPERLINK', 'never-call']) {
    assert(!combined(result).includes(omitted), omitted);
  }
});

test('真实Excel行经预览来源标签交接给分析后保持单条，A2来源和B2内容仍在同一条目', async () => {
  const imported = await importRecord(input('records.xlsx'));
  const row = imported.segments.find(segment => segment.text.includes('A2=课程平台'));
  assert(row, 'synthetic second row was extracted');
  assert(row.text.includes('B2=本周缺课两次'));
  const text = `【导入来源：${row.label}】\n${row.text}`;
  const workflow = createAnalysisWorkflow({ mock: true });
  const analyzed = await workflow.analyze({ text, scene: 'xueye', inputRevision: 1 }, 'synthetic-excel-row');
  assert.equal(analyzed.items.length, 1, 'one Excel row must stay one candidate');
  const [item] = analyzed.items;
  assert.equal(item.quote, row.text);
  assert(item.quote.includes('A2=课程平台'));
  assert(item.quote.includes('B2=本周缺课两次'));
  assert(item.source.includes(row.label));
  assert.equal(text.slice(item.start, item.end), item.quote);
});

test('旧版doc/xls及伪装扩展名明确拒绝', async () => {
  for (const filename of ['records.doc', 'records.xls', 'records.xlsm', 'records.exe']) {
    await assert.rejects(importRecord(input(filename, Buffer.from('synthetic'))), errorCode('IMPORT_UNSUPPORTED'));
  }
  await assert.rejects(importRecord(input('records.pdf', bytes('records.xlsx'))), errorCode('IMPORT_INVALID'));
  await assert.rejects(importRecord(input('records.docx', bytes('records.pdf'))), errorCode('IMPORT_INVALID'));
});

test('空白或扫描式无文本文件提示人工粘贴，不生成虚构记录', async () => {
  for (const filename of ['empty.docx', 'empty.xlsx', 'empty.pdf', 'scanned.pdf']) {
    await assert.rejects(importRecord(input(filename)), errorCode('IMPORT_NO_TEXT'));
  }
});

test('损坏PDF/Word/Excel均返回受控错误，不暴露解析库内部信息', async () => {
  for (const filename of ['records.docx', 'records.xlsx', 'records.pdf']) {
    const content = bytes(filename).subarray(0, 32);
    await assert.rejects(importRecord(input(filename, content)), error => {
      assert.equal(error.code, 'IMPORT_INVALID');
      assert(!error.message.includes('node_modules'));
      assert(!error.message.includes('Synthetic course record'));
      return true;
    });
  }
  for (const filename of ['short.docx', 'short.xlsx']) {
    await assert.rejects(importRecord(input(filename, Buffer.from('A'))), errorCode('IMPORT_INVALID'));
  }
});

test('加密PDF及加密ZIP标记在解析前拒绝', async () => {
  await assert.rejects(importRecord(input('encrypted.pdf')), errorCode('IMPORT_ENCRYPTED'));
  await assert.rejects(importRecord(input('encrypted-flag.docx')), errorCode('IMPORT_ENCRYPTED'));
});

test('超过5MiB和ZIP解压预算均拒绝，避免无界内存占用', async () => {
  await assert.rejects(importRecord(input('records.pdf', Buffer.alloc(5 * 1024 * 1024 + 1))), errorCode('IMPORT_TOO_LARGE'));
  for (const filename of ['expanded-budget.docx', 'total-budget.docx', 'entries-budget.xlsx']) {
    assert.throws(() => inspectZip(bytes(filename), path.extname(filename).slice(1)), errorCode('IMPORT_TOO_LARGE'));
    await assert.rejects(importRecord(input(filename)), errorCode('IMPORT_TOO_LARGE'));
  }
  const forgedSize = Buffer.from(bytes('expanded-budget.docx'));
  const centralDirectory = forgedSize.indexOf(Buffer.from('504b0102', 'hex'));
  assert(centralDirectory >= 0);
  forgedSize.writeUInt32LE(1, centralDirectory + 24);
  assert.throws(() => inspectZip(forgedSize, 'docx'), errorCode('IMPORT_TOO_LARGE'), 'actual inflation must remain bounded even when declared size lies');
});

test('非法base64、缺失字段和无效场景不进入文件解析', async () => {
  for (const value of [null, {}, { filename: 'x.pdf', scene: 'xueye', contentBase64: '%%%not-base64%%%' },
    { ...input('records.pdf'), scene: 'unapproved' }, { ...input('records.pdf'), contentBase64: '' }]) {
    assert.throws(() => validateImportInput(value), errorCode('IMPORT_INVALID'));
  }
});

test('worker超时可终止并允许后续有效文件重试', async () => {
  await assert.rejects(importRecord(input('records.docx'), { timeoutMs: 1 }), errorCode('IMPORT_TIMEOUT'));
  const result = await importRecord(input('records.docx'));
  assert(combined(result).includes('课程平台'));
});
