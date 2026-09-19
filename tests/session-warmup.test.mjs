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
const SID = 'b'.repeat(36);

/** 假教务：记录每个路径被打了几次，服务学期列表 / 课表（20 周）/ 教学任务 / 进度班级列表 */
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
      bump('terms');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify([{ code: '20241', name: '2024-2025 学年第一学期' }]));
      return;
    }
    if (url.pathname === '/ahsljw/frame/desk/showLessonScheduleInfosV14.action') {
      bump('schedule');
      html(fixture('schedule.html'));
      return;
    }
    if (url.pathname === '/ahsljw/wjstgdfw/jxrw.cdkc_rpt.jsp') {
      bump('tasks');
      html(fixture('tasks.html'));
      return;
    }
    if (url.pathname === '/ahsljw/wjstgdfw/jxap.ckjxjdb_data.jsp') {
      bump('progressClasses');
      html(fixture('progress-classes.html'));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, hits, base: `http://127.0.0.1:${server.address().port}`, hit: (k) => hits.get(k) || 0 };
}

async function boot(env = {}) {
  const fake = await startFakeJwxt();
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-warmup-test-'));
  const sessionDir = join(dir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const persisted = new JwxtSession(fake.base);
  persisted.username = 'teacher';
  writeFileSync(join(sessionDir, `${SID}.json`), persisted.serialize(), { encoding: 'utf8', mode: 0o600 });
  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: sessionDir, JWXT_BASE: fake.base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r, j) => {
    child.stdout.once('data', r);
    child.once('error', j);
    child.once('exit', (code) => j(new Error(`early exit ${code}`)));
  });
  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie: `td_sid=${SID}` } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const stop = async () => {
    if (child.exitCode === null) {
      const stopped = new Promise((r) => child.once('exit', r));
      child.kill();
      await stopped;
    }
    await new Promise((r) => fake.server.close(r));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  };
  return { fake, get, stop };
}

const waitFor = async (fn, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

test('登录后自动预热：切 tab 直接命中缓存，且存活探测不再每请求打一次上游', async () => {
  const { fake, get, stop } = await boot();
  try {
    // 一次请求就把登录态带起来（/api/session 会探测一次并触发后台预热）
    const session = await get('/api/session');
    assert.equal(session.status, 200);
    assert.equal(session.body.loggedIn, true);
    assert.equal(fake.hit('probe'), 1, '首次请求探测一次');

    // 预热在后台跑：客户端没请求课表/教学任务，上游却已经被拉过
    assert.ok(await waitFor(() => fake.hit('schedule') >= 20, 9000), `预热应拉课表（实际 ${fake.hit('schedule')} 次周请求）`);
    assert.ok(fake.hit('tasks') >= 1, '预热应拉教学任务');

    // 切 tab：命中预热好的缓存，不再打上游
    // 服务端把学期 code 20241 归一成 value '2024,1'，缓存键用的是归一后的值
    const term = encodeURIComponent((await get('/api/terms')).body.terms[0].value);
    const scheduleHits = fake.hit('schedule');
    const tasksHits = fake.hit('tasks');
    const schedule = await get(`/api/schedule?term=${term}`);
    assert.equal(schedule.status, 200);
    assert.ok(Array.isArray(schedule.body.courses), '课表数据可用');
    const tasks = await get(`/api/tasks?term=${term}`);
    assert.equal(tasks.status, 200);
    assert.equal(fake.hit('schedule'), scheduleHits, '切周课表不应再回源');
    assert.equal(fake.hit('tasks'), tasksHits, '切教学任务不应再回源');

    // 多次请求只探测一次上游（存活结论 45 秒内复用）
    await get(`/api/schedule?term=${term}`);
    await get('/api/terms');
    assert.equal(fake.hit('probe'), 1, '存活探测应被复用，而不是每个请求都打一次上游');

    // ?refresh=1 仍要真的回源
    await get(`/api/tasks?term=${term}&refresh=1`);
    assert.equal(fake.hit('tasks'), tasksHits + 1, '?refresh=1 必须回源');
  } finally {
    await stop();
  }
});

test('JWXT_SESSION_PROBE_TTL_MS=0 时保持旧行为：每个请求都探测', async () => {
  const { fake, get, stop } = await boot({ JWXT_SESSION_PROBE_TTL_MS: '0' });
  try {
    await get('/api/terms');
    await get('/api/terms');
    await get('/api/terms');
    assert.equal(fake.hit('probe'), 3, '关掉记忆后每个请求探测一次');
  } finally {
    await stop();
  }
});

test('JWXT_WARMUP=0 时不做预热，也不影响正常取数', async () => {
  const { fake, get, stop } = await boot({ JWXT_WARMUP: '0' });
  try {
    const session = await get('/api/session');
    assert.equal(session.body.loggedIn, true);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(fake.hit('schedule'), 0, '关掉预热后后台不应拉课表');
    const schedule = await get('/api/schedule?term=2024%2C1');
    assert.equal(schedule.status, 200);
    assert.ok(fake.hit('schedule') >= 20, '按需请求照常回源');
  } finally {
    await stop();
  }
});
