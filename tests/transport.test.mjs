import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { JwxtSession } from '../server/session.mjs';

const SID = 'e'.repeat(36);

async function boot({ dist }) {
  const fake = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/ahsljw/frame/home/js/SetMainInfo.jsp') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("_loginid='teacher'");
      return;
    }
    if (url.pathname === '/ahsljw/frame/droplist/getDropLists.action') {
      const terms = Array.from({ length: 80 }, (_, index) => ({
        code: `2024${index % 2}`,
        name: `2024-2025学年 第${index % 2 === 0 ? '一' : '二'}学期 ${'很长的学期名称'.repeat(3)}${index}`,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(terms));
      return;
    }
    if (url.pathname === '/ahsljw/jw/common/showYearTerm.action') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ xn: '2024', xqM: '1' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));

  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-transport-'));
  const sessionDir = join(dir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const persisted = new JwxtSession(`http://127.0.0.1:${fake.address().port}`);
  persisted.username = 'teacher';
  writeFileSync(join(sessionDir, `${SID}.json`), persisted.serialize(), { encoding: 'utf8', mode: 0o600 });

  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_ROOT: dir,
      SESSION_DIR: sessionDir,
      JWXT_BASE: `http://127.0.0.1:${fake.address().port}`,
      JWXT_WARMUP: '0',
      WEB_DIST: dist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r, j) => {
    child.stdout.once('data', r);
    child.once('error', j);
    child.once('exit', (code) => j(new Error(`early exit ${code}`)));
  });
  const stop = async () => {
    if (child.exitCode === null) {
      const stopped = new Promise((r) => child.once('exit', r));
      child.kill();
      await stopped;
    }
    await new Promise((r) => fake.close(r));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  };
  return { base: `http://127.0.0.1:${port}`, stop };
}

test('静态资源优先返回预压缩 .gz，未预压缩的文本仍会实时压缩（R12）', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'teacher-desk-dist-'));
  const html = `<!doctype html><html><body>${'预压缩内容'.repeat(500)}</body></html>`;
  const css = `body { color: #123; } ${'/* padding */ '.repeat(300)}`;
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), html);
  writeFileSync(join(dist, 'index.html.gz'), gzipSync(Buffer.from(html), { level: 9 }));
  writeFileSync(join(dist, 'assets', 'app.css'), css);

  const { base, stop } = await boot({ dist });
  try {
    const precompressed = await fetch(`${base}/index.html`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(precompressed.status, 200);
    assert.equal(precompressed.headers.get('content-encoding'), 'gzip');
    assert.equal(await precompressed.text(), html);
    assert.match(String(precompressed.headers.get('vary')), /Accept-Encoding/);

    const etag = precompressed.headers.get('etag');
    const cached = await fetch(`${base}/index.html`, { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);

    const plain = await fetch(`${base}/index.html`, { headers: { 'Accept-Encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), html);

    // 没有 .gz 的文件走实时 gzip（review R12 的回退路径）。
    // Node fetch 会自动解压响应体，这里断言 Content-Encoding 与解压后的内容。
    const onTheFly = await fetch(`${base}/assets/app.css`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(onTheFly.headers.get('content-encoding'), 'gzip');
    assert.equal(await onTheFly.text(), css);
  } finally {
    await stop();
    rmSync(dist, { recursive: true, force: true });
  }
});

test('普通 JSON API 支持 gzip；不接受压缩时原样返回（R11）', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'teacher-desk-dist-empty-'));
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html>ok</html>');
  const { base, stop } = await boot({ dist });
  try {
    const compressed = await fetch(`${base}/api/terms`, {
      headers: { cookie: `td_sid=${SID}`, 'Accept-Encoding': 'gzip' },
    });
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers.get('content-encoding'), 'gzip');
    const body = await compressed.json();
    assert.equal(body.terms.length, 80);

    const plain = await fetch(`${base}/api/terms`, {
      headers: { cookie: `td_sid=${SID}`, 'Accept-Encoding': 'identity' },
    });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('content-encoding'), null);
    const plainBody = await plain.json();
    assert.equal(plainBody.terms.length, 80);
    assert.deepEqual(plainBody.terms[0], body.terms[0], '压缩与未压缩内容一致');
  } finally {
    await stop();
    rmSync(dist, { recursive: true, force: true });
  }
});
