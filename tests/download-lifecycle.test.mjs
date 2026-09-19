import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['web/src/lib/download.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  plugins: [{
    name: 'stub-api',
    setup(b) {
      b.onResolve({ filter: /(?:^|\/)api$/ }, () => ({ path: 'api', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: "export class ApiError extends Error { constructor(message, status) { super(message); this.name='ApiError'; this.status=status; } }",
      }));
    },
  }],
});
const { downloadFile } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const oldFetch = globalThis.fetch;
const oldURL = { createObjectURL: globalThis.URL.createObjectURL, revokeObjectURL: globalThis.URL.revokeObjectURL };
const oldDocument = globalThis.document;
const oldWindow = globalThis.window;

let clicks = 0;
const anchor = { href: '', download: '', style: {}, click: () => { clicks += 1; }, remove() {} };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  createElement: () => anchor,
  body: { appendChild() {}, removeChild() {} },
};
globalThis.window = { setTimeout: () => 0 };

test.after(() => {
  globalThis.fetch = oldFetch;
  globalThis.URL.createObjectURL = oldURL.createObjectURL;
  globalThis.URL.revokeObjectURL = oldURL.revokeObjectURL;
  globalThis.document = oldDocument;
  globalThis.window = oldWindow;
});

const payload = () => new Response(
  JSON.stringify({ filename: '成绩.pdf', contentType: 'application/pdf', base64: Buffer.from('PDF-DATA').toString('base64') }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

test('同一文件并发下载只生成/传输/保存一次；完成后可再次下载', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return payload(); };
  const url = '/api/course-grades/export/pdf?term=A&kcdm=1';
  const phases = [];
  clicks = 0;
  await Promise.all([
    downloadFile(url, '成绩.pdf', { onPhase: (phase) => phases.push(phase) }),
    downloadFile(url, '成绩.pdf'),
    downloadFile(url, '成绩.pdf'),
  ]);
  assert.equal(calls, 1, '三个按钮/连点共享同一次生成与传输');
  assert.equal(clicks, 1, '只保存一次文件');
  assert.deepEqual(phases, ['generating', 'downloading', 'saving'], '阶段顺序：生成 → 下载 → 保存');

  await downloadFile(url, '成绩.pdf');
  assert.equal(calls, 2, '完成后的再次下载是新的任务');
  assert.equal(clicks, 2);
});

test('服务端错误原样抛出 ApiError，不触发保存', async () => {
  clicks = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '登录已过期，请重新扫码' }), { status: 401 });
  await assert.rejects(downloadFile('/api/fail-1', 'x.pdf'), (error) => error.status === 401 && /登录已过期/.test(error.message));
  assert.equal(clicks, 0);
});

test('下载有明确超时并且可取消', async () => {
  clicks = 0;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
  });
  await assert.rejects(
    downloadFile('/api/slow-1', 'x.pdf', { timeoutMs: 30 }),
    (error) => error.status === 408 && /超时/.test(error.message),
  );
  assert.equal(clicks, 0);
});
