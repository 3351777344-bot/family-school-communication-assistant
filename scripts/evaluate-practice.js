// Repeatable, fictional-only exercise. External model calls require --real.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const messages = {
  'academic-denial': [
    '听起来您担心学校误会孩子，我理解得对吗？课程平台显示本周有两次未到课，学生说其中一次已请假，请假结果还需要核实。我想先了解您听到的情况。',
    '我们先不对原因下结论。我来核对平台和请假记录，也邀请学生一起确认；您愿意先听听孩子的说法吗？核实后我们再商量下一次联系时间，这样安排您觉得可以吗？',
  ],
  'anxious-parent': [
    '听到孩子睡眠不规律，您很担心，也希望尽快知道原因，我理解得对吗？目前是学生的自述，还没有核实原因或专业评估结论，我不能据此给出诊断。您愿意说说近期观察吗？',
    '学生愿意了解校内支持资源，我可以先和学生核对希望获得哪些支持，再按校内流程了解可用入口。我们先各自整理观察，核实后再商量下一次联系，可以吗？',
  ],
  'cooperative-followup': [
    '您希望配合，也担心问得太急给孩子压力，我理解得对吗？目前只知道学生没有参加一次活动，原因还没核实，您愿意先谈谈近期的观察吗？',
    '我们先不给原因下结论。我来邀请学生谈谈当时的情况，您可以先听听孩子想法，再一起商量合适的小步骤。核对后我们再约下一次联系，您觉得这样可行吗？',
  ],
};
const challengingMessages = {
  'academic-denial': [
    '你们家长别找借口，孩子就是贪玩，不用核实，我说了算。',
    '必须照我说的做，不用商量，我保证这次不会记旷课。别再问了，到此为止。',
  ],
  'anxious-parent': [
    '睡不好就是抑郁症，不需要专业评估，我已经确诊了。',
    '孩子说不想活也别担心，我保证没事，你们听话就行，不用再联系。',
  ],
  'cooperative-followup': [
    '你们家长少废话，没必要听孩子解释，就是不懂事。',
    '不用商量，必须照我说的做，我保证马上解决，不要再联系。',
  ],
};

async function main() {
  const args = process.argv.slice(2);
  const reportArg = args.find(arg => arg.startsWith('--report='));
  if (args.some(arg => arg !== '--real' && arg !== '--challenging' && arg !== reportArg)) throw new Error('只支持 --real、--challenging 与 --report=路径');
  const real = args.includes('--real');
  const challenging = args.includes('--challenging');
  const inputs = challenging ? challengingMessages : messages;
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const childEnv = { ...process.env, PORT: String(port), MOCK: real ? '0' : '1', PRACTICE_ENABLED: '1' };
  delete childEnv.LOCAL_PILOT_REHEARSAL;
  delete childEnv.LOCAL_PILOT_POLICY_FILE;
  const child = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
  child.stdout.resume();
  child.stderr.resume();
  child.once('error', () => {});
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const results = [];
  try {
    let health;
    for (let attempt = 0; attempt < 100 && !exited; attempt++) {
      try {
        const response = await fetch(base + '/api/health');
        if (response.ok) { health = await response.json(); break; }
      } catch {}
      await delay(50);
    }
    assert(health, '评测服务未启动');
    async function post(action, input) {
      const response = await fetch(base + '/api/practice/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({ ...input, requestId: randomUUID() }),
      });
      const receivedCookie = response.headers.get('set-cookie');
      if (receivedCookie) cookie = receivedCookie.split(';')[0];
      const value = await response.json();
      if (!response.ok || !value.ok) {
        const error = new Error('演练步骤未完成');
        Object.assign(error, { code: value.code || 'PRACTICE_EVAL_FAILED', rule: value.rule, status: response.status });
        throw error;
      }
      return value.data;
    }
    const catalog = (await (await fetch(base + '/api/practice/catalog')).json()).data;
    for (const scenario of catalog.cases) {
      const startedAt = Date.now();
      const generations = [];
      let snapshot;
      try {
        assert(inputs[scenario.id], '固定用例缺少案例输入');
        snapshot = await post('start', { caseId: scenario.id });
        for (const message of inputs[scenario.id]) {
          snapshot = await post('turn', { sessionId: snapshot.sessionId, expectedVersion: snapshot.version, message });
          assert.equal(snapshot.status, 'active');
          if (snapshot.generation) generations.push(snapshot.generation);
        }
        snapshot = await post('end', { sessionId: snapshot.sessionId, expectedVersion: snapshot.version });
        assert.equal(snapshot.status, 'ended');
        snapshot = await post('review', { sessionId: snapshot.sessionId, expectedVersion: snapshot.version });
        if (snapshot.generation) generations.push(snapshot.generation);
        assert.equal(snapshot.review.rubricVersion, catalog.rubricVersion);
        assert.equal(snapshot.review.items.length, catalog.criteria.length);
        const ids = new Set();
        for (const item of snapshot.review.items) {
          assert(catalog.criteria.some(criterion => criterion.id === item.criterionId));
          assert(!ids.has(item.criterionId)); ids.add(item.criterionId);
          assert(item.score === null || Number.isInteger(item.score) && item.score >= 1 && item.score <= 4);
          if (item.score !== null) assert(item.evidence.length);
          for (const evidence of item.evidence) {
            const turn = snapshot.turns.find(turn => turn.id === evidence.turnId);
            assert(turn?.role === 'counselor' && evidence.quote.trim() && turn.content.includes(evidence.quote));
          }
        }
        if (challenging) {
          assert(snapshot.review.items.some(item => item.score !== null && item.score <= 2 && item.evidence.length),
            '明显不当的练习表达应有带原话依据的问题反馈');
        }
        results.push({ caseId: scenario.id, verdict: 'pass', durationMs: Date.now() - startedAt, turns: snapshot.turns, review: snapshot.review, flags: snapshot.flags, generations });
      } catch (error) {
        results.push({ caseId: scenario.id, verdict: 'fail', durationMs: Date.now() - startedAt, code: error.code || 'EVAL_ASSERTION_FAILED', rule: error.rule, turns: snapshot?.turns, generations });
      }
    }
    const report = {
      suite: challenging ? 'fictional-practice-poor-answers-v1' : 'fictional-practice-v1', createdAt: new Date().toISOString(), mode: real ? 'real_model' : 'offline',
      sourceSha256: Object.fromEntries(['app/practice.js', 'app/practice-cases.json', 'app/practice-rubric.json', 'scripts/evaluate-practice.js']
        .map(filename => [filename, createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8').replace(/\r\n/g, '\n')).digest('hex')])),
      provider: health.provider, model: health.model, rubricVersion: catalog.rubricVersion,
      reviewStatus: catalog.reviewStatus,
      limitations: '仅固定虚构案例的接口、结构与引用检查；评分规则待业务审核，不能证明角色一致性、反馈适切性或教学效果。',
      total: results.length, passed: results.filter(row => row.verdict === 'pass').length,
      failed: results.filter(row => row.verdict === 'fail').length,
      modelCalls: results.flatMap(row => row.generations).reduce((sum, row) => sum + row.attempts, 0),
      results,
    };
    if (reportArg) fs.writeFileSync(reportArg.slice('--report='.length), JSON.stringify(report, null, 2) + '\n');
    const { results: _details, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
    if (report.failed) process.exitCode = 1;
  } finally {
    if (!exited) child.kill();
    await closed;
  }
}

main().catch(() => { console.error('演练评测未完成，请检查本地服务配置；未输出模型原文或密钥。'); process.exitCode = 1; });
