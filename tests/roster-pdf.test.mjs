import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { JwxtSession } from '../server/session.mjs';

const SID = 'f'.repeat(36);

/** 假教务：只实现会话探针与「报表页转 PDF」两条链路，并记录 topdf 收到的 body */
async function startFakeJwxt() {
  const state = { topdf: 0, download: 0, body: '' };
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/ahsljw/frame/home/js/SetMainInfo.jsp') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("_loginid='teacher'");
      return;
    }
    if (url.pathname === '/ahsljw/frame/pdf' && url.searchParams.get('method') === 'topdf') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        state.topdf += 1;
        state.body = raw;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: '200', result: `点名册.pdf;;/tmp/teacher-desk-roster-${state.topdf}.pdf` }));
      });
      return;
    }
    if (url.pathname === '/ahsljw/frame/pdf' && url.searchParams.get('method') === 'download') {
      state.download += 1;
      const round = (url.searchParams.get('fileSavePath') || '').match(/(\d+)\.pdf$/)?.[1] || '?';
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(Buffer.from(`%PDF-1.4\nROSTER-ROUND-${round}-` + 'x'.repeat(1024)));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, state, base: `http://127.0.0.1:${server.address().port}` };
}

test('点名册导出默认走教务 PDF 转换，且重复下载命中缓存', async () => {
  const fake = await startFakeJwxt();
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-roster-pdf-'));
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

  const query = 'term=2024,1&kcdm=CS101&skbjdm=CS1&courseName=数据结构&className=计算机1班';
  const getRosterPdf = async (qs) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/roster/export/pdf?${qs}`, {
      headers: { cookie: `td_sid=${SID}`, accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    return {
      status: response.status,
      filename: payload?.filename || '',
      bytes: payload?.base64 ? Buffer.from(payload.base64, 'base64').toString('utf8') : '',
      error: payload?.error || '',
    };
  };

  try {
    await new Promise((r, j) => {
      child.stdout.once('data', r);
      child.once('error', j);
      child.once('exit', (code) => j(new Error(`early exit ${code}`)));
    });

    // 首次：要走教务的 topdf + download
    const first = await getRosterPdf(query);
    assert.equal(first.status, 200);
    assert.match(first.bytes, /^%PDF-1\.4/);
    assert.match(first.filename, /数据结构_计算机1班_点名册\.pdf$/, `文件名应为课程_班级_点名册.pdf（实际 ${first.filename}）`);
    assert.equal(fake.state.topdf, 1);
    assert.equal(fake.state.download, 1);

    // 转换参数必须指向点名册报表页、A4 横向
    assert.match(fake.state.body, /cjlr\.dycddjc\.fkcaskbjdyskdmc_rpt\.jsp/, 'topdf 应指向点名册报表页');
    assert.match(fake.state.body, /orientation=L/, '点名册是宽表，用 A4 横向');
    assert.match(fake.state.body, /pageSize=A4/);
    assert.match(decodeURIComponent(decodeURIComponent(fake.state.body)), /kcdm=CS101/);

    // 重复下载同一份：命中导出缓存
    const second = await getRosterPdf(query);
    assert.equal(second.status, 200);
    assert.equal(second.bytes, first.bytes);
    assert.equal(second.filename, first.filename);
    assert.equal(fake.state.topdf, 1, '重复下载不应重新生成');
    assert.equal(fake.state.download, 1);

    // 缺参数要拦在前面
    const missing = await getRosterPdf('term=2024,1');
    assert.equal(missing.status, 400);
    assert.equal(fake.state.topdf, 1);
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
