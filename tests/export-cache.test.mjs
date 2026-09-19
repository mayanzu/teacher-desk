import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { JwxtSession } from '../server/session.mjs';

const SID = 'c'.repeat(36);

/** 假教务：只实现会话探针、PDF 生成/下载这两条链路，并统计各被调用次数 */
async function startFakeJwxt() {
  const state = { topdf: 0, download: 0, save: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/ahsljw/frame/home/js/SetMainInfo.jsp') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("_loginid='teacher'");
      return;
    }
    if (url.pathname === '/ahsljw/TeachingTaskingJxjcbAction.do') {
      state.save += 1;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<script>_callBack("{\\"message\\":\\"保存成功\\"}")</script>`);
      return;
    }
    if (url.pathname === '/ahsljw/frame/pdf') {
      const method = url.searchParams.get('method');
      if (method === 'topdf') {
        state.topdf += 1;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: '200', result: `教学进度表.pdf;;/tmp/teacher-desk-test-${state.topdf}.pdf` }));
        return;
      }
      if (method === 'download') {
        state.download += 1;
        const round = (url.searchParams.get('fileSavePath') || '').match(/(\d+)\.pdf$/)?.[1] || '?';
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(Buffer.from(`%PDF-1.4\nPDF-ROUND-${round}-` + 'x'.repeat(2048)));
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, state, base: `http://127.0.0.1:${server.address().port}` };
}

test('PDF 导出缓存：重复下载不回源、?refresh=1 强制重生成、保存后失效', async () => {
  const fake = await startFakeJwxt();
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-export-test-'));
  const sessionDir = join(dir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const persisted = new JwxtSession(fake.base);
  persisted.username = 'teacher';
  writeFileSync(join(sessionDir, `${SID}.json`), persisted.serialize(), { encoding: 'utf8', mode: 0o600 });

  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: sessionDir, JWXT_BASE: fake.base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const download = async (query, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/progress/export/pdf?${query}`, {
      headers: { cookie: `td_sid=${SID}`, accept: 'application/json', ...options.headers },
      method: options.method || 'GET',
      body: options.body,
    });
    const payload = await response.json().catch(() => null);
    const bytes = payload?.base64 ? Buffer.from(payload.base64, 'base64').toString('utf8') : '';
    return { status: response.status, filename: payload?.filename || '', bytes, payload };
  };

  const query = 'term=2024,1&kcdm=CS101&bjdm=CS1&skbjdm=CS1&teacher=张三&courseName=数据结构&className=计算机1班';

  try {
    await new Promise((r, j) => {
      child.stdout.once('data', r);
      child.once('error', j);
      child.once('exit', (code) => j(new Error(`early exit ${code}`)));
    });

    // 1) 首次下载：走两次上游（生成 + 下载）
    const first = await download(query);
    assert.equal(first.status, 200);
    assert.match(first.bytes, /PDF-ROUND-1-/, '首次下载拿到上游生成的 PDF');
    assert.equal(fake.state.topdf, 1);
    assert.equal(fake.state.download, 1);

    // 2) 重复下载同一份：命中导出缓存，不再打上游
    const second = await download(query);
    assert.equal(second.status, 200);
    assert.equal(second.bytes, first.bytes, '同一份 PDF 逐字节一致');
    assert.equal(second.filename, first.filename);
    assert.equal(fake.state.topdf, 1, '重复下载不应重新生成');
    assert.equal(fake.state.download, 1, '重复下载不应重新取文件');

    // 3) 换参数（另一个班）要重新生成，说明缓存键包含参数
    const other = await download('term=2024,1&kcdm=CS101&bjdm=CS2&skbjdm=CS2');
    assert.match(other.bytes, /PDF-ROUND-2-/);
    assert.equal(fake.state.topdf, 2);

    // 4) ?refresh=1：跳过缓存重新生成
    const forced = await download(`${query}&refresh=1`);
    assert.match(forced.bytes, /PDF-ROUND-3-/, '强制刷新要重新生成');
    assert.equal(fake.state.topdf, 3);

    // 5) 保存教学进度后，导出缓存失效（避免下载到保存前的 PDF）
    const savedBytes = forced.bytes;
    const save = await fetch(`http://127.0.0.1:${port}/api/progress/entry`, {
      method: 'POST',
      headers: { cookie: `td_sid=${SID}`, 'content-type': 'application/json' },
      body: JSON.stringify({ term: '2024,1', meta: { kcdm: 'CS101', bjdm: 'CS1' }, rows: [], confirm: true }),
    });
    assert.equal(save.status, 200);
    assert.equal(fake.state.save, 1);

    const afterSave = await download(query);
    assert.match(afterSave.bytes, /PDF-ROUND-4-/, '保存后必须重新生成，不能返回保存前的 PDF');
    assert.notEqual(afterSave.bytes, savedBytes);
    assert.equal(fake.state.topdf, 4);
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
