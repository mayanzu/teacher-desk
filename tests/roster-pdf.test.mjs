import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { JwxtSession } from '../server/session.mjs';
import { buildRosterPdf, resolveRosterFont } from '../server/jwxt/rosterPdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');
const SID = 'f'.repeat(36);
const pagesOf = (buffer) => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

const rosterItems = (count) =>
  Array.from({ length: count }, (_, index) => ({
    index: String(index + 1),
    studentId: `20241000${String(100 + index)}`,
    name: `学生${index + 1}`,
    gender: index % 2 ? '女' : '男',
    type: '正常修读',
    major: '数据科学与大数据技术',
    remark: '',
  }));

test('点名册 PDF 在本机排版：中文与数字都画得出来，超长名单自动翻页并重复表头', async (t) => {
  const fontPath = resolveRosterFont();
  if (!fontPath) {
    t.skip('本机没有可用中文字体，跳过（部署环境需装 fonts-arphic-gbsn00lp 或指定 ROSTER_PDF_FONT）');
    return;
  }
  const meta = {
    term: '2024,1',
    termLabel: '2024-2025学年 第2学期',
    kcdm: 'CS101',
    skbjdm: 'CS202401',
    courseName: '[CS101]数据结构',
    className: '2024计算机1班',
    teacherName: '马彦祖',
    fontPath,
  };

  const many = await buildRosterPdf({ ...meta, items: rosterItems(60) });
  assert.equal(many.subarray(0, 5).toString('latin1'), '%PDF-', '必须是 PDF 文件');
  assert.ok(many.length > 5000, `PDF 体积应有内容（实际 ${many.length}B）`);
  assert.ok(pagesOf(many) >= 2, `60 人应翻页（实际 ${pagesOf(many)} 页）`);

  const few = await buildRosterPdf({ ...meta, items: rosterItems(3) });
  assert.equal(pagesOf(few), 1, '3 人应只占一页');

  const empty = await buildRosterPdf({ ...meta, items: [] });
  assert.equal(empty.subarray(0, 5).toString('latin1'), '%PDF-', '空名单也要出文件（表头 + 共 0 人）');
});

/** 假教务：会话探针 + 学期列表 + 点名册数据（直接用脱敏 fixture） */
async function startFakeJwxt() {
  const hits = new Map();
  const bump = (key) => hits.set(key, (hits.get(key) || 0) + 1);
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/ahsljw/frame/home/js/SetMainInfo.jsp') {
      bump('probe');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end("_loginid='teacher'");
      return;
    }
    if (url.pathname === '/ahsljw/frame/droplist/getDropLists.action') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify([{ code: '20241', name: '2024-2025学年 第2学期' }]));
      return;
    }
    if (url.pathname === '/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt_data.jsp') {
      bump('roster');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fixture('roster-report.html'));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, hit: (key) => hits.get(key) || 0 };
}

async function bootRosterServer(env = {}) {
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
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: sessionDir, JWXT_BASE: fake.base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r, j) => {
    child.stdout.once('data', r);
    child.once('error', j);
    child.once('exit', (code) => j(new Error(`early exit ${code}`)));
  });
  const get = async (qs) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/roster/export/pdf?${qs}`, {
      headers: { cookie: `td_sid=${SID}`, accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    return {
      status: response.status,
      filename: payload?.filename || '',
      bytes: typeof payload?.base64 === 'string' ? Buffer.from(payload.base64, 'base64') : Buffer.alloc(0),
      error: payload?.error || '',
    };
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

test('GET /api/roster/export/pdf：出完整名单 PDF、重复下载走缓存、缺参数或字体有明确报错', async (t) => {
  if (!resolveRosterFont()) {
    t.skip('本机没有可用中文字体');
    return;
  }
  const { fake, get, stop } = await bootRosterServer();
  try {
    const query = 'term=2024,1&kcdm=CS101&skbjdm=CS1';
    const first = await get(query);
    assert.equal(first.status, 200, first.error);
    assert.equal(first.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(first.filename, '点名册-CS1.pdf');
    assert.ok(fake.hit('roster') >= 1, '要真的去取点名册数据');

    const second = await get(query);
    assert.equal(second.status, 200);
    assert.ok(second.bytes.equals(first.bytes), '同一份重复下载应逐字节一致（导出缓存命中）');

    const missing = await get('term=2024,1');
    assert.equal(missing.status, 400);
  } finally {
    await stop();
  }
});

test('没有可用中文字体时明确报错，而不是画出方框', async (t) => {
  if (!resolveRosterFont()) {
    t.skip('本机没有可用中文字体');
    return;
  }
  const { get, stop } = await bootRosterServer({ ROSTER_PDF_FONT: '/nonexistent/font.ttf' });
  try {
    const result = await get('term=2024,1&kcdm=CS101&skbjdm=CS1');
    assert.equal(result.status, 500);
    assert.match(result.error, /字体/);
  } finally {
    await stop();
  }
});
