import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function freePort() {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-guard-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_ROOT: dir,
      SESSION_DIR: join(dir, 'sessions'),
      JWXT_BASE: 'https://127.0.0.1:1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r, j) => {
    child.stdout.once('data', r);
    child.once('error', j);
    child.once('exit', (code) => j(new Error(`early exit ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const stopped = new Promise((r) => child.once('exit', r));
      child.kill();
      await stopped;
    }
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  };
  return { base, stop };
}

test('cross-origin mutating request is rejected, same-origin and no-origin pass', async () => {
  const { base, stop } = await startServer();
  try {
    const cross = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);

    const same = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Origin: base } });
    assert.equal(same.status, 200);

    const direct = await fetch(`${base}/api/logout`, { method: 'POST' });
    assert.equal(direct.status, 200);
  } finally {
    await stop();
  }
});

test('login start is rate limited per client', async () => {
  const { base, stop } = await startServer();
  try {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await fetch(`${base}/api/login/start`, { method: 'POST' });
      statuses.push(res.status);
    }
    assert.ok(statuses.slice(0, 10).every((status) => status !== 429));
    assert.equal(statuses[10], 429);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    await stop();
  }
});
