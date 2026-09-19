import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { JwxtSession } from '../server/session.mjs';

const SID = 'a'.repeat(36);

/**
 * 最小假教务系统：只实现「学期列表」这条链路需要的三个响应。
 * 第一次 droplist 故意慢（120ms），用来构造「强制刷新与在飞请求重叠」的场景。
 */
async function startFakeJwxt() {
  const state = { rounds: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/ahsljw/frame/home/js/SetMainInfo.jsp') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("_loginid='teacher'");
      return;
    }
    if (url.pathname === '/ahsljw/jw/common/showYearTerm.action') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ xn: '2024', xqM: '1' }));
      return;
    }
    if (url.pathname === '/ahsljw/frame/droplist/getDropLists.action') {
      state.rounds += 1;
      const round = state.rounds;
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([{ code: '20241', name: `第 ${round} 次返回` }]));
      }, round === 1 ? 120 : 5);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, state, base: `http://127.0.0.1:${server.address().port}` };
}

test('查询缓存的命中、?refresh=1 强制回源、以及与在飞请求重叠时的取值', async () => {
  const fake = await startFakeJwxt();
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-cache-test-'));
  const sessionDir = join(dir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  // 直接写一份持久化会话文件，省掉扫码登录（服务端按 td_sid 找到它就会当成已登录）
  const persisted = new JwxtSession(fake.base);
  persisted.username = 'teacher';
  writeFileSync(join(sessionDir, `${SID}.json`), persisted.serialize(), { encoding: 'utf8', mode: 0o600 });

  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: sessionDir, JWXT_BASE: fake.base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie: `td_sid=${SID}` } });
    const body = await response.json().catch(() => null);
    return { status: response.status, label: body?.terms?.[0]?.label ?? '', body };
  };

  try {
    await new Promise((r, j) => {
      child.stdout.once('data', r);
      child.once('error', j);
      child.once('exit', (code) => j(new Error(`early exit ${code}`)));
    });

    // 1) 冷启动：普通请求与 ?refresh=1 同时发出，刷新不能复用已在飞的旧请求
    const [plain, forced] = await Promise.all([get('/api/terms'), get('/api/terms?refresh=1')]);
    assert.equal(plain.status, 200);
    assert.equal(forced.status, 200);
    assert.equal(fake.state.rounds, 2, '?refresh=1 必须真的回源，而不是加入在飞请求');
    assert.match(plain.label, /第 1 次返回/, '普通请求拿到的是自己那次上游结果');
    assert.match(forced.label, /第 2 次返回/, '强制刷新拿到的是新一次上游结果');

    // 2) 慢的旧请求（第 1 次）不能在返回后覆盖缓存里的新值（第 2 次）
    const afterRace = await get('/api/terms');
    assert.match(afterRace.label, /第 2 次返回/, '旧的在飞结果不能覆盖强制刷新的结果');
    assert.equal(fake.state.rounds, 2, '缓存命中不应再打上游');

    // 3) 普通重复请求命中缓存
    const again = await get('/api/terms');
    assert.equal(again.label, afterRace.label);
    assert.equal(fake.state.rounds, 2);

    // 4) 单独一次 ?refresh=1：绕过缓存，回源并更新缓存
    const refreshed = await get('/api/terms?refresh=1');
    assert.match(refreshed.label, /第 3 次返回/);
    assert.equal(fake.state.rounds, 3);
    const cachedAfterRefresh = await get('/api/terms');
    assert.match(cachedAfterRefresh.label, /第 3 次返回/, '强制刷新的结果要写进缓存');
    assert.equal(fake.state.rounds, 3);
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
