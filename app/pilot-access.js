const fs = require('node:fs');
const { createHash, timingSafeEqual } = require('node:crypto');

const namePattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const scenes = new Set(['xueye', 'xinli', 'yiban']);
const roles = new Set(['counselor', 'observer']);
const policyError = () => new Error('本地试点演练权限配置缺失或无效。');

function loadPilotPolicy(filename) {
  let policy;
  try {
    if (!filename) throw policyError();
    policy = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw policyError();
  }
  if (!policy || typeof policy.revision !== 'string' || !namePattern.test(policy.revision) ||
      !Array.isArray(policy.accounts) || !policy.accounts.length) throw policyError();

  const accounts = new Map();
  const digests = new Set();
  for (const row of policy.accounts) {
    if (!row || typeof row.id !== 'string' || !namePattern.test(row.id) || accounts.has(row.id) ||
        !roles.has(row.role) || typeof row.tokenSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.tokenSha256) ||
        digests.has(row.tokenSha256) ||
        !Array.isArray(row.scenes) || row.scenes.some(scene => !scenes.has(scene)) ||
        new Set(row.scenes).size !== row.scenes.length ||
        (row.role === 'counselor' ? !row.scenes.length : row.scenes.length > 0)) throw policyError();
    accounts.set(row.id, { id: row.id, role: row.role, digest: Buffer.from(row.tokenSha256, 'hex'), scenes: new Set(row.scenes) });
    digests.add(row.tokenSha256);
  }
  return { revision: policy.revision, accounts };
}

function authenticate(policy, header) {
  const match = typeof header === 'string' && /^Basic ([a-z0-9+/]{4,256}={0,2})$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 0) return null;
  const id = decoded.slice(0, split);
  const token = decoded.slice(split + 1);
  if (!namePattern.test(id) || !/^[a-zA-Z0-9_-]{32,96}$/.test(token)) return null;
  const account = policy.accounts.get(id);
  const supplied = createHash('sha256').update(token).digest();
  const expected = account?.digest ?? Buffer.alloc(32);
  return timingSafeEqual(expected, supplied) && account ? account : null;
}

function trustedLocalRequest(req, port) {
  const origin = `http://127.0.0.1:${port}`;
  return req.headers.host === `127.0.0.1:${port}` &&
    req.url.startsWith('/') && !req.url.startsWith('//') &&
    (!req.headers.origin || req.headers.origin === origin) &&
    (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
}

module.exports = { loadPilotPolicy, authenticate, trustedLocalRequest };
