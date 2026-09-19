/*
 * 登录页「云服务器延迟提示」契约：
 * 仅当部署方设置了 DEMO_LATENCY_HINT 时才随 /api/session 下发给前端，
 * 本地部署 / Windows 版不设该变量，登录页不应出现任何提示。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join, resolve, sep } from 'node:path';

const SID = 'c'.repeat(36);

/** 最小假教务：只回答会话存活探测，够 /api/session 走完流程 */
async function startFakeJwxt() {
  const server = createServer((req, res) => {
    if ((req.url || '').startsWith('/ahsljw/frame/home/js/SetMainInfo.jsp')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("_loginid=''");
      return;
    }
    res.writeHead(404);
    res.end('');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function boot(env = {}) {
  const fake = await startFakeJwxt();
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-demo-hint-test-'));
  const sessionDir = join(dir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
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
  const session = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/session`, { headers: { cookie: `td_sid=${SID}` } });
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
  return { session, stop };
}

test('设置了 DEMO_LATENCY_HINT 时，/api/session 下发提示文本', async () => {
  const hint = '本演示站部署在云服务器，到教务系统每次请求多等约 0.4 秒，建议本地部署。';
  const { session, stop } = await boot({ DEMO_LATENCY_HINT: hint });
  try {
    const first = await session();
    assert.equal(first.status, 200);
    assert.equal(first.body.latencyHint, hint);
  } finally {
    await stop();
  }
});

test('未设置 DEMO_LATENCY_HINT 时，登录页拿不到提示（本地部署不显示）', async () => {
  const { session, stop } = await boot();
  try {
    const first = await session();
    assert.equal(first.status, 200);
    assert.equal(first.body.latencyHint, '');
  } finally {
    await stop();
  }
});

test('提示文本两端空白会被裁掉，纯空格等于不设置', async () => {
  const { session, stop } = await boot({ DEMO_LATENCY_HINT: '   仅云服务器可见   ' });
  try {
    const first = await session();
    assert.equal(first.body.latencyHint, '仅云服务器可见');
  } finally {
    await stop();
  }
  const blank = await boot({ DEMO_LATENCY_HINT: '   ' });
  try {
    const second = await blank.session();
    assert.equal(second.body.latencyHint, '');
  } finally {
    await blank.stop();
  }
});
