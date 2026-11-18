const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { inflateRawSync } = require('node:zlib');
const { InputError, SCENES } = require('./contracts');

const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, characters: 50000, segments: 1000, pages: 100,
  zipBytes: 32 * 1024 * 1024, entryBytes: 16 * 1024 * 1024, entries: 2000, timeoutMs: 15000 });
function importError(code, message, status = 400) {
  return Object.assign(new InputError(message), { code, status });
}
function validateImportInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.filename !== 'string'
      || input.filename.length > 200 || !input.filename.trim() || !Object.hasOwn(SCENES, input.scene)) {
    throw importError('IMPORT_INVALID', '请选择有效场景及文件');
  }
  const format = path.extname(input.filename).slice(1).toLowerCase();
  if (!['pdf', 'docx', 'xlsx'].includes(format)) throw importError('IMPORT_UNSUPPORTED', '仅支持 PDF、DOCX、XLSX；旧版 DOC/XLS 请先另存为新版格式', 415);
  const encoded = input.contentBase64;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw importError('IMPORT_INVALID', '文件内容不是有效的 Base64 编码');
  }
  if (encoded.length > Math.ceil(LIMITS.bytes / 3) * 4) throw importError('IMPORT_TOO_LARGE', '文件超过 5 MiB，请先拆分', 413);
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > LIMITS.bytes) throw importError('IMPORT_TOO_LARGE', '文件为空或超过 5 MiB，请先拆分', 413);
  if (buffer.toString('base64') !== encoded) throw importError('IMPORT_INVALID', '文件编码不完整');
  const ole = buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (ole) throw importError('IMPORT_ENCRYPTED', '该文件为加密文件或旧版 Office 格式，请解除加密并另存为 DOCX/XLSX', 422);
  if (buffer.length < 8 || (format === 'pdf' ? !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')) : buffer.readUInt16LE(0) !== 0x4b50)) {
    throw importError('IMPORT_INVALID', '文件内容与扩展名不符或已损坏');
  }
  return { format, buffer };
}

// Inspect and actually inflate every ZIP entry before handing the archive to a parser.
// Declared sizes alone do not protect against forged ZIP directories or compressed bombs.
// This function runs inside the parsing worker in production.
function inspectZip(buffer, format) {
  const invalid = () => { throw importError('IMPORT_INVALID', 'Office 文件结构损坏或不受支持'); };
  const tooLarge = () => { throw importError('IMPORT_TOO_LARGE', 'Office 解压内容超过处理预算，请先拆分文件', 413); };
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) invalid();
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let at = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || at + directorySize !== end) invalid();
  if (!count || count > LIMITS.entries) tooLarge();
  const names = new Set();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) invalid();
    const flags = buffer.readUInt16LE(at + 8), method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24);
    const nameSize = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    if (at + 46 + nameSize + extra + comment > end) invalid();
    const name = buffer.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    if (flags & 1) throw importError('IMPORT_ENCRYPTED', 'Office 文件已加密，请解除加密后重试', 422);
    if (![0, 8].includes(method) || names.has(name) || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|\0/.test(name)) invalid();
    names.add(name);
    if (size > LIMITS.entryBytes || total + size > LIMITS.zipBytes) tooLarge();
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) invalid();
    const contentAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (contentAt + compressed > buffer.readUInt32LE(end + 16)) invalid();
    let inflated;
    try { inflated = method === 0 ? buffer.subarray(contentAt, contentAt + compressed) : inflateRawSync(buffer.subarray(contentAt, contentAt + compressed), { maxOutputLength: LIMITS.entryBytes }); }
    catch (error) { if (error.code === 'ERR_BUFFER_TOO_LARGE') tooLarge(); invalid(); }
    if (inflated.length !== size) invalid();
    total += inflated.length;
    at += 46 + nameSize + extra + comment;
  }
  if (at !== end || !names.has('[Content_Types].xml') || !names.has(format === 'docx' ? 'word/document.xml' : 'xl/workbook.xml')) invalid();
  return { entries: names.size, bytes: total };
}

let active = 0;
async function importRecord(input, { timeoutMs = LIMITS.timeoutMs, WorkerClass = Worker } = {}) {
  const { format, buffer } = validateImportInput(input);
  if (active >= 2) throw importError('IMPORT_BUSY', '已有文件正在提取，请稍后重试', 503);
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new WorkerClass(path.join(__dirname, 'import-record-worker.js'), {
        workerData: { format, bytes: new Uint8Array(buffer) },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        // Library diagnostics may include document content. Never forward worker output to logs.
        stdout: true, stderr: true,
      });
      worker.stdout?.resume(); worker.stderr?.resume();
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        void worker.terminate().then(() => error ? reject(error) : resolve(data));
      };
      const timer = setTimeout(() => finish(importError('IMPORT_TIMEOUT', '文件提取超时，请拆分后重试', 408)), timeoutMs);
      worker.once('message', message => message.ok ? finish(null, message.data)
        : finish(importError(message.code || 'IMPORT_INVALID', message.error || '文件无法提取', message.status || 400)));
      worker.once('error', () => finish(importError('IMPORT_INVALID', '文件解析失败或超过内存预算，请拆分后重试')));
      worker.once('exit', () => { if (!settled) finish(importError('IMPORT_INVALID', '文件解析未完成')); });
    });
  } finally { active--; }
}

module.exports = { importRecord, validateImportInput, inspectZip, importError, LIMITS };
