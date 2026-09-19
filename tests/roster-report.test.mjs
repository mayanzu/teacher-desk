import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { JwxtSession } from '../server/session.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');
const SID = 'd'.repeat(36);

/** 假教务：教学班带完整教师字段；课表接口故意很慢，用来证明报表不再等它 */
async function startFakeJwxt() {
  const hits = new Map();
  const bump = (key) => hits.set(key, (hits.get(key) || 0) + 1);
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const html = (body) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    if (url.pathname === '/ahsljw/frame/home/js/SetMainInfo.jsp') {
      bump('probe');
      html("_loginid='teacher'");
      return;
    }
    if (url.pathname === '/ahsljw/frame/droplist/getDropLists.action') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify([{ code: '20241', name: '2024-2025学年 第2学期' }]));
      return;
    }
    if (url.pathname === '/ahsljw/jw/common/showYearTerm.action') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ xn: '2024', xqM: '1' }));
      return;
    }
    if (url.pathname === '/ahsljw/taglib/DataTable.jsp') {
      bump('classes');
      html(fixture('progress-classes.html'));
      return;
    }
    if (url.pathname === '/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt_data.jsp') {
      bump('roster');
      html(fixture('roster-report.html'));
      return;
    }
    if (url.pathname === '/ahsljw/frame/desk/showLessonScheduleInfosV14.action') {
      bump('schedule');
      setTimeout(() => html(fixture('schedule.html')), 3000);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, hits, hit: (key) => hits.get(key) || 0 };
}

test('点名册报表：教学班已有教师信息时不请求整学期课表，慢课表不阻塞报表（R18）', async () => {
  const fake = await startFakeJwxt();
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-roster-report-'));
  const sessionDir = join(dir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const persisted = new JwxtSession(fake.base);
  persisted.username = 'teacher';
  writeFileSync(join(sessionDir, `${SID}.json`), persisted.serialize(), { encoding: 'utf8', mode: 0o600 });
  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: sessionDir, JWXT_BASE: fake.base, JWXT_WARMUP: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((r, j) => {
      child.stdout.once('data', r);
      child.once('error', j);
      child.once('exit', (code) => j(new Error(`early exit ${code}`)));
    });
    const started = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/roster/report?term=2024,1&kcdm=CS101&skbjdm=2024CS1&format=html`,
      { headers: { cookie: `td_sid=${SID}`, accept: 'application/json' } },
    );
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    const payload = await response.json();
    const html = Buffer.from(payload.base64, 'base64').toString('utf8');
    assert.match(html, /张三/, '教师姓名取自教学班字段');
    assert.equal(fake.hit('schedule'), 0, '不得为了报表页眉请求整学期课表');
    assert.ok(elapsed < 2000, `报表不应被慢课表阻塞（实际 ${elapsed}ms）`);
    assert.ok(fake.hit('roster') >= 1, '名单数据要真的回源');
    assert.ok(fake.hit('classes') >= 1, '教学班信息用于页眉元数据');
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise((r) => child.once('exit', r));
      child.kill();
      await stopped;
    }
    await new Promise((r) => fake.server.close(r));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
