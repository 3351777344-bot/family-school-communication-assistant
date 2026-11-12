const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { prepareCommunication } = require('../app/prepare');
const { validatePrepareInput } = require('../app/contracts');
const { findReferences } = require('../app/knowledge');
const { MISSING_FACTS } = require('../app/prepare-output');
const { outputFixture } = require('../tests/fixtures/prepare-output');
const manifest = require('../evals/cases/communication-frozen-v2.manifest.json');
const development = require('../evals/cases/communication-v1.json');

const increment = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };
const digestFile = filename => createHash('sha256')
  .update(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

function loadFrozenCases() {
  const file = path.join(__dirname, '../evals/cases', manifest.id + '.jsonl');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(text).digest('hex'), manifest.sha256, '冻结集内容校验失败');
  const cases = text.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(cases.length, manifest.total);
  const fingerprints = new Set();
  const identify = input => input.scene + ':' + input.situation.replace(/[\p{P}\s]/gu, '');
  const developmentInputs = new Set(development.map(row => identify(row.input)));
  const ids = new Set();
  const buckets = {};
  const policyReview = [];
  for (const row of cases) {
    assert.match(row.id, /^F[APGMS]\d{2}$/);
    assert(!ids.has(row.id), '重复编号 ' + row.id);
    ids.add(row.id);
    const fingerprint = identify(row.input);
    assert(!fingerprints.has(fingerprint) && !developmentInputs.has(fingerprint), '重复输入 ' + row.id);
    fingerprints.add(fingerprint);
    increment(buckets, row.bucket);
    if (row.expected.policyReview) policyReview.push(row.id);
  }
  assert.deepEqual(buckets, manifest.buckets);
  assert.deepEqual(policyReview, manifest.policyReview);
  return cases;
}

function stub(row, attempt) {
  if (row.mockPlan === 'none') throw new Error('UNEXPECTED_MODEL_CALL');
  const plan = outputFixture(row.input.scene);
  if (row.mockPlan === 'missing') plan.missingFacts = row.expected.missing;
  if (attempt === 1 && row.mockPlan === 'repair_reference') plan.moves[0].sourceId = 'candidate-academic-policy';
  if (attempt === 1 && row.mockPlan === 'repair_free_text') {
    plan.draft = '家长您好。我们已诊断为抑郁症，需要和家长说明处理安排，请您配合我们的工作，谢谢您的理解与支持。';
  }
  return plan;
}

function checkSafetyAndSources(row, result, issues) {
  const expected = row.expected;
  const evidence = new Map((result.inputEvidence ?? []).map(item => [item.id, item.quote]));
  for (const fact of result.facts ?? []) {
    if (evidence.get(fact.field)?.slice(fact.start, fact.end) !== fact.quote) issues.push('FACT_RANGE');
  }
  const outward = [
    result.draft, ...result.faq.flatMap(item => [item.q, item.a]),
    ...result.points.map(point => point.detail.reply),
  ].join('\n');
  if (expected.forbid.some(fragment => outward.includes(fragment))) issues.push('FORBIDDEN_TEXT');
  if (expected.withheldFacts?.some(fragment => outward.includes(fragment))) issues.push('WITHHELD_TEXT');

  const admitted = findReferences(validatePrepareInput(row.input));
  let references = 0;
  let invalidReferences = 0;
  for (const point of result.points) {
    if (point.factIds?.some(id => !evidence.has(id))) issues.push('UNKNOWN_INPUT_REFERENCE');
    if (!point.reference) continue;
    references++;
    const card = admitted.get(point.reference.id);
    if (!card || card.version !== point.reference.version ||
        !card.supports.includes(point.moveId) ||
        !point.reference.quote || !card.excerpt.includes(point.reference.quote)) {
      invalidReferences++;
      issues.push('INVALID_SOURCE');
    }
  }
  return { references, invalidReferences };
}

async function evaluate(row) {
  let attempts = 0;
  let result;
  try {
    result = await prepareCommunication(row.input, {
      mock: false,
      async complete() {
        const plan = stub(row, ++attempts);
        return { content: JSON.stringify(plan), usage: null };
      },
    });
  } catch (error) {
    return {
      id: row.id, verdict: 'fail', expected: row.expected.status, actual: 'error',
      issues: [error.code || (error.message === 'UNEXPECTED_MODEL_CALL' ? error.message : 'UNEXPECTED_ERROR')],
      attempts, references: 0, invalidReferences: 0,
    };
  }
  const { expected } = row;
  const issues = [];
  const { references, invalidReferences } = checkSafetyAndSources(row, result, issues);
  if (result.status !== expected.status) issues.push('STATUS_MISMATCH');
  if (attempts !== expected.modelCalls) issues.push('CALL_COUNT_MISMATCH');
  if (result.status === 'manual_review') {
    if (result.draft !== null || result.faq.length || result.next.length) issues.push('BLOCKED_HAS_PARENT_CONTENT');
    if (result.steps.length !== 1 || result.steps[0] !== '风险上报与专业研判' || attempts || !result.notes) {
      issues.push('MANUAL_SHAPE');
    }
  } else {
    if (!result.draft?.trim() || result.points.length < 3 || result.points.length > 5 || !result.next.length) {
      issues.push('DRAFT_SHAPE');
    }
    if (result.status === 'needs_information' &&
        JSON.stringify(result.missingFacts) !== JSON.stringify(expected.missing.map(id => MISSING_FACTS[id]))) {
      issues.push('MISSING_FACTS');
    }
  }
  const pendingPolicy = expected.policyReview && result.status === 'manual_review' &&
    issues.length === 2 && issues.includes('STATUS_MISMATCH') && issues.includes('CALL_COUNT_MISMATCH');
  return {
    id: row.id, verdict: pendingPolicy ? 'policy_review_pending' : issues.length ? 'fail' : 'pass',
    expected: expected.status, actual: result.status, issues: [...new Set(issues)],
    attempts, references, invalidReferences,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const reportFlag = args.find(arg => arg.startsWith('--report='));
  if (args.some(arg => arg !== '--require-policy-match' && arg !== reportFlag)) {
    throw new Error('只支持 --report=路径 和 --require-policy-match。此评测仅使用本地桩。');
  }
  const cases = loadFrozenCases();
  const results = [];
  for (const row of cases) results.push(await evaluate(row));
  const actual = {};
  const verdicts = { pass: 0, fail: 0, policy_review_pending: 0 };
  for (const row of results) {
    increment(actual, row.actual);
    increment(verdicts, row.verdict);
  }
  const called = results.filter(row => row.attempts);
  const violations = ['FORBIDDEN_TEXT', 'WITHHELD_TEXT', 'BLOCKED_HAS_PARENT_CONTENT', 'INVALID_SOURCE'];
  const report = {
    suite: manifest.id,
    inputSha256: manifest.sha256,
    sourceSha256: Object.fromEntries([
      'app/prepare.js', 'app/prepare-output.js', 'app/contracts.js', 'app/workflow-steps.json', 'app/preparation-gates.js',
      'app/communication-safety.js', 'app/communication-moves.js', 'app/facts.js', 'app/knowledge.js',
      'app/kb_v3.json', 'app/reference-cards.json', 'scripts/evaluate-frozen.js',
      'evals/cases/communication-frozen-v2.manifest.json', 'tests/fixtures/prepare-output.js',
    ].map(filename => [filename, digestFile(filename)])),
    mode: 'local_stub',
    realModelRequests: 0,
    total: results.length, buckets: manifest.buckets, verdicts, actual,
    stub: {
      cases: called.length,
      calls: called.reduce((sum, row) => sum + row.attempts, 0),
      firstAttemptAccepted: called.filter(row => row.attempts === 1 && row.verdict === 'pass').length,
      deliberateRepairsPassed: called.filter(row => row.attempts === 2 && row.verdict === 'pass').length,
    },
    references: {
      checked: results.reduce((sum, row) => sum + row.references, 0),
      invalid: results.reduce((sum, row) => sum + row.invalidReferences, 0),
    },
    prohibitedOutputCases: results.filter(row => row.issues.some(issue => violations.includes(issue))).length,
    exceptions: results.filter(row => row.verdict !== 'pass'),
    results,
  };
  if (reportFlag) fs.writeFileSync(reportFlag.slice('--report='.length), JSON.stringify(report, null, 2) + '\n');
  const { results: _details, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
  if (verdicts.fail || (args.includes('--require-policy-match') && verdicts.policy_review_pending)) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
