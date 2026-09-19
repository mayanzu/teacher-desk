import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { build, transform } from 'esbuild';
import { buildProgressPayload, exportProgressPdf, parseXqskzs } from '../server/jwxt/progress.mjs';
import { requireDownload, clean } from '../server/jwxt/common.mjs';
import { getTasks } from '../server/jwxt/tasks.mjs';
import { getSchedule } from '../server/jwxt/schedule.mjs';
import { getCourseGradesReport } from '../server/jwxt/course-grades.mjs';
import { getRoster, buildRosterListHtml } from '../server/jwxt/roster.mjs';
import { readJson, TOO_LARGE } from '../server/readJson.mjs';
import { sessionAlive } from '../server/sessionHealth.mjs';
import { JwxtSession } from '../server/session.mjs';
import { createLoginFlow } from '../server/login.mjs';
import { contextFor, rotateContext, dropContext } from '../server/sessionStore.mjs';
const importTs = async (path) => {
  const { code } = await transform(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const schedule = await importTs('web/src/lib/schedule.ts');
const progress = await importTs('web/src/lib/progress.ts');

test('progress retains remark, homework and requirement', () => {
  const p = buildProgressPayload({}, [{ content: '内容', remark: '备注', homework: '作业', requirement: '要求' }]);
  assert.equal(p.bzs, '备注@#@'); assert.equal(p.zys, '作业@#@'); assert.equal(p.yqs, '要求@#@');
});

test('both progress PDF routes complete and reject invalid downloads', async () => {
  const bodies = [];
  const mock = {
    base: 'https://example.invalid',
    text: async (_path, opts) => { bodies.push(opts?.body || ''); return { text: JSON.stringify({ status: 200, result: 'demo;;mock-path' }) }; },
    request: async () => ({ response: new Response('', { headers: { 'content-type': 'application/pdf' } }), buffer: Buffer.from('%PDF-1.7\nfixture') }),
  };
  const termResult = await exportProgressPdf(mock, { term: '2026,0', scope: 'term' });
  assert.match(termResult.filename, /\.pdf$/); assert.equal(termResult.buffer.subarray(0, 5).toString(), '%PDF-');
  const classResult = await exportProgressPdf(mock, {
    term: '2026,0',
    scope: '',
    kcdm: '551982',
    skbjdm: '551982-001',
    kcmc: '[24111081]计算机程序设计及应用',
    bjmc: '',
    teacher: '马仲军[助教]',
    courseName: '[24111081]计算机程序设计及应用',
    className: '示例班',
  });
  assert.match(classResult.filename, /\.pdf$/); assert.equal(classResult.buffer.subarray(0, 5).toString(), '%PDF-');
  // 文件名为「教师名_课程名_班级名.pdf」，均不含方括号内容
  assert.equal(classResult.filename, '马仲军_计算机程序设计及应用_示例班.pdf');
  // 分课程必须与原版抓包一致：look_data10319.jsp + bjdm + returnHtml，A4 横向、左右边距 5
  const classBody = bodies[1] || '';
  assert.match(classBody, /look_data10319\.jsp/);
  assert.match(classBody, /returnHtml%253D/);
  assert.match(classBody, /menucode_current%253DT2020201/);
  assert.match(classBody, /orientation=L/);
  assert.match(classBody, /left=5&right=5/);
  assert.match(classBody, /%255B24111081%255D/);
  assert.doesNotMatch(classBody, /skbjdm/);
  assert.doesNotMatch(classBody, /look\.jsp\?/);
  await assert.rejects(exportProgressPdf(mock, { term: '2026,0', scope: '' }), /kcdm/);
  assert.throws(() => requireDownload({ response: new Response('<html>login</html>'), buffer: Buffer.from('<html>login</html>') }, 'pdf'), /有效文件/);
});

test('fill only remaining hours and allocate cent-hour remainder exactly', () => {
  const totals = { lecture: 8, lab: 0, practice: 0, other: 0 };
  const result = progress.applyTotals([{ lectureHours: '8', hours: '8' }, { lectureHours: '', hours: '' }], totals);
  assert.equal(result.reduce((sum, r) => sum + Number(r.lectureHours), 0), 8);
  const thirds = progress.applyTotals(Array.from({ length: 3 }, () => ({ hours: '' })), { ...totals, lecture: 1 });
  assert.equal(thirds.reduce((sum, r) => sum + Math.round(Number(r.lectureHours) * 100), 0), 100);
  assert.match(progress.validateHours([{ lectureHours: '9' }], totals), /超过/);
});

test('fallback terms use the same 0/1 convention as the API', () => {
  assert.equal(schedule.fallbackTerms(new Date(2026, 8, 18)).current, '2026,0');
  assert.equal(schedule.fallbackTerms(new Date(2026, 2, 18)).current, '2025,1');
});

test('calendar explicitly distinguishes estimate from configured first Monday', async () => {
  const old = process.env.JWXT_CALENDAR;
  const mock = { text: async () => ({ status: 200, text: '<div>暂无课程</div>' }) };
  try {
    delete process.env.JWXT_CALENDAR;
    const guessed = await getSchedule(mock, '2025,1');
    assert.equal(guessed.calendarEstimated, true);
    const front = schedule.termStart('2025,1');
    assert.equal(`${front.getFullYear()}-${String(front.getMonth()+1).padStart(2,'0')}-${String(front.getDate()).padStart(2,'0')}`, guessed.semesterStart);
    process.env.JWXT_CALENDAR = JSON.stringify({ '2025,1': { semesterStart: '2026-02-16' } });
    const configured = await getSchedule(mock, '2025,1');
    assert.equal(configured.calendarEstimated, false); assert.equal(configured.semesterStart, '2026-02-16');
  } finally { if (old === undefined) delete process.env.JWXT_CALENDAR; else process.env.JWXT_CALENDAR = old; }
});

test('transport failure does not become an expired session', async () => {
  const session = { text: async () => { throw Object.assign(new Error('offline'), { status: 503 }); } };
  await assert.rejects(sessionAlive({ session }), { status: 503 });
  assert.equal(await sessionAlive({ session: { text: async () => ({ status: 200, text: 'kingo.guest' }) } }), false);
});

test('upstream error and invalid task page are errors, not empty data', async () => {
  await assert.rejects(getTasks({ base: 'https://example.invalid', text: async () => ({ status: 503, text: '<h1>Service unavailable</h1>' }) }, '2026,0'), { status: 502 });
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('offline', { status: 503 });
    await assert.rejects(new JwxtSession('https://example.invalid').text('/data'), { status: 502 });
  } finally { globalThis.fetch = oldFetch; }
});

test('reset invalidates already-running login poll', async () => {
  const oldText = JwxtSession.prototype.text, oldPost = JwxtSession.prototype.postForm, oldTimer = globalThis.setTimeout;
  let poll, release;
  const pending = new Promise((r) => { release = r; });
  JwxtSession.prototype.text = async () => ({ status: 200, text: 'login' });
  JwxtSession.prototype.postForm = async (path) => path.includes('LoginBar') ? pending : { status: 200, text: '{"status":200}' };
  globalThis.setTimeout = (fn, delay, ...args) => delay === 1200 ? (poll = fn, 123) : oldTimer(fn, delay, ...args);
  const flow = createLoginFlow();
  try {
    await flow.start(); const running = poll(); flow.reset(); release({ text: 'synthetic-user' }); await running;
    assert.equal(flow.state.status, 'idle'); assert.equal(flow.getSession().username, '');
  } finally { flow.reset(); JwxtSession.prototype.text = oldText; JwxtSession.prototype.postForm = oldPost; globalThis.setTimeout = oldTimer; }
});

test('unknown sid is replaced and rotation invalidates old context', () => {
  const headers = new Map(); const res = { setHeader: (k, v) => headers.set(k, v) };
  const ctx = contextFor({ headers: { cookie: `td_sid=${'a'.repeat(36)}` } }, res);
  assert.notEqual(ctx.sid, 'a'.repeat(36)); assert.match(headers.get('Set-Cookie'), /HttpOnly/);
  const oldSid = ctx.sid; rotateContext(ctx, res); assert.notEqual(ctx.sid, oldSid);
  const old = contextFor({ headers: { cookie: `td_sid=${oldSid}` } }, res);
  assert.notEqual(old.sid, oldSid); assert.equal(old.session, null); dropContext(ctx); dropContext(old);
});

test('APP_ROOT without trailing separator loads its .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-config-test-'));
  try {
    writeFileSync(join(dir, '.env'), 'JWXT_BASE=https://configured.invalid\n');
    const env = { ...process.env, APP_ROOT: dir }; delete env.JWXT_BASE;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {config} from './server/config.mjs'; console.log(config.base)"], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0); assert.equal(result.stdout.trim(), 'https://configured.invalid');
  } finally { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep)); rmSync(dir, { recursive: true, force: true }); }
});

test('malformed URL returns 400 while isolated service remains healthy', async () => {
  const probe = createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-http-test-'));
  const child = spawn(process.execPath, ['server/index.mjs'], { windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: join(dir, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((r, j) => { child.stdout.once('data', r); child.once('error', j); child.once('exit', (code) => j(new Error(`early exit ${code}`))); });
    const response = await new Promise((r, j) => {
      let data = ''; const socket = createConnection({ host: '127.0.0.1', port }, () => socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      socket.on('data', (part) => data += part); socket.on('end', () => r(data)); socket.on('error', j);
    });
    assert.match(response, /400 Bad Request/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  } finally {
    if (child.exitCode === null) { const stopped = new Promise((r) => child.once('exit', r)); child.kill(); await stopped; }
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep)); rmSync(dir, { recursive: true, force: true });
  }
});


// Small hook harness: executes the real component handlers without a browser or live API.
async function componentModule(file) {
  const result = await build({
    entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    plugins: [{ name: 'isolated-react', setup(b) {
      b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (args) => ({ path: args.path, namespace: 'review' }));
      b.onResolve({ filter: /(?:^|\/)api$/ }, () => ({ path: 'api', namespace: 'review' }));
      b.onLoad({ filter: /.*/, namespace: 'review' }, ({ path }) => ({ contents: path === 'api'
        ? `export class ApiError extends Error { constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; } } export const api = new Proxy({}, {get: (_, key) => (...args) => globalThis.__reviewApi[key](...args)}); export const isUnauthorized = e => e.status === 401; export const errorMessage = e => e.message; export const isUnimplemented = e => e.status === 501;`
        : path === 'react/jsx-runtime'
        ? `export const Fragment = 'fragment'; export const jsx = (type, props) => ({type, props}); export const jsxs = jsx;`
        : `export const memo = fn => fn; export const useState = v => globalThis.__reviewHooks.state(v); export const useRef = v => globalThis.__reviewHooks.ref(v); export const useEffect = (fn, deps) => globalThis.__reviewHooks.effect(fn,deps); export const useCallback = (fn,deps) => globalThis.__reviewHooks.memo(fn,deps); export const useMemo = (fn,deps) => globalThis.__reviewHooks.memoValue(fn,deps);` }));
    }}],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=component-test.js').toString('base64'));
}
function harness(Component, props) {
  const slots = []; let index = 0; let effects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    state(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    ref(value) { const i = index++; return slots[i] ??= { current: value }; },
    effect(fn, deps) { const i = index++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    memo(fn, deps) { const i = index++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value; },
    memoValue(fn, deps) { const i = index++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
  };
  return {
    render() { index = 0; effects = []; globalThis.__reviewHooks = hooks; const tree = Component(props); effects.forEach(fn => fn()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(t => nodes(t, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('late class A response cannot overwrite class B or its submitted identity', async () => {
  const { ProgressEntry } = await componentModule('web/src/components/ProgressEntry.tsx');
  const a = deferred(), b = deferred(); let submitted;
  const classes = ['A', 'B'].map(classCode => ({ classCode, className: classCode, params: { kcdm: classCode } }));
  globalThis.__reviewApi = {
    progressClasses: async () => ({ items: classes }),
    progressEntry: (_term, params) => params.kcdm === 'A' ? a.promise : b.promise,
    progressSave: async (body) => { submitted = body; return { data: { status: '200' } }; },
  };
  const oldWindow = globalThis.window; globalThis.window = { confirm: () => true };
  const view = harness(ProgressEntry, { term: '2026,0', onUnauthorized: () => {} });
  try {
    view.render(); await tick(); let tree = view.render();
    nodes(tree, n => n.props?.className?.startsWith('entry-class ' ) || n.props?.className === 'entry-class')[0].props.onClick();
    tree = view.render(); nodes(tree, n => n.props?.className?.startsWith('entry-class ') || n.props?.className === 'entry-class')[1].props.onClick();
    b.resolve({ meta: { classId: 'B' }, rows: [{ week: '1', content: 'B内容', hours: '2' }] }); await tick(); view.render();
    a.resolve({ meta: { classId: 'A' }, rows: [{ week: '1', content: 'A内容', hours: '2' }] }); await tick(); tree = view.render();
    assert.equal(nodes(tree, n => n.type === 'textarea')[0].props.value, 'B内容');
    nodes(tree, n => n.type === 'button' && String(n.props.children).includes('提交到教务系统'))[0].props.onClick(); await tick();
    assert.equal(submitted.meta.classId, 'B');
  } finally { view.unmount(); globalThis.window = oldWindow; }
});

test('memo saves without debounce and does not migrate another account notes', async () => {
  const { MemoPanel } = await componentModule('web/src/components/MemoPanel.tsx');
  const saved = new Map([['teacher-desk:memo:v2', '[{"id":"legacy","text":"private legacy"}]']]);
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const a = harness(MemoPanel, { userId: 'A' }); const b = harness(MemoPanel, { userId: 'B' });
  try {
    let tree = a.render(); assert.equal(nodes(tree, n => n.type === 'textarea').length, 0);
    nodes(tree, n => n.type === 'input' && n.props['aria-label'] === '新建便利贴')[0].props.onChange({ target: { value: 'A的笔记' } });
    tree = a.render(); nodes(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    a.render(); a.unmount();
    assert.equal(JSON.parse(saved.get('teacher-desk:memo:v2:A'))[0].text, 'A的笔记');
    assert.equal(nodes(b.render(), n => n.type === 'textarea').length, 0);
  } finally { a.unmount(); b.unmount(); globalThis.localStorage = oldStorage; }
});

test('term retry issues a fresh request', async () => {
  const { default: App } = await componentModule('web/src/App.tsx');
  let calls = 0;
  globalThis.__reviewApi = { health: async () => ({}), session: async () => ({ loggedIn: true, username: 'test' }), terms: async () => {
    calls++; if (calls === 1) throw new Error('offline'); return { terms: [{ value: '2026,0', label: '第一学期' }], current: '2026,0' };
  }};
  const oldWindow = globalThis.window;
  globalThis.window = { setInterval: () => 0, clearInterval: () => {} };
  const view = harness(App, {});
  try {
    view.render(); await tick(); view.render(); await tick();
    const tree = view.render(); nodes(tree, n => n.props?.title === '学期列表加载失败')[0].props.onRetry();
    view.render(); await tick(); view.render(); assert.equal(calls, 2);
  } finally { view.unmount(); globalThis.window = oldWindow; }
});

test('oversized request body settles with 413 instead of hanging', async () => {
  const server = createHttpServer(async (req, res) => {
    const body = await readJson(req);
    if (body === TOO_LARGE) {
      res.writeHead(413, { 'content-type': 'text/plain' });
      res.end('too large');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const oversized = await new Promise((resolve) => {
      let data = '';
      let done = false;
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.write(`POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${6 * 1024 * 1024}\r\nConnection: close\r\n\r\n`);
        socket.write('x'.repeat(1024));
      });
      const finish = () => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(data);
      };
      socket.on('data', (part) => {
        data += part;
        if (/413/.test(data)) finish();
      });
      socket.on('end', finish);
      socket.on('error', finish);
      setTimeout(finish, 3000).unref();
    });
    assert.match(oversized, /413/);
    const ok = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { a: 1 });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('encoded traversal cannot escape the static directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-static-test-'));
  const dist = join(dir, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html>ok</html>');
  mkdirSync(join(dir, 'dist-secret'), { recursive: true });
  writeFileSync(join(dir, 'dist-secret', 'secret.txt'), 'TOP-SECRET');
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_ROOT: dir, SESSION_DIR: join(dir, 'sessions'), WEB_DIST: dist },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((r, j) => {
      child.stdout.once('data', r);
      child.once('error', j);
      child.once('exit', (code) => j(new Error(`early exit ${code}`)));
    });
    const request = (path) =>
      new Promise((resolve, reject) => {
        let data = '';
        const socket = createConnection({ host: '127.0.0.1', port }, () =>
          socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`),
        );
        socket.on('data', (part) => { data += part; });
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
      });
    const escaped = await request('/%2f..%2fdist-secret%2fsecret.txt');
    assert.doesNotMatch(escaped, /TOP-SECRET/);
    assert.match(escaped, /404/);
    const normal = await request('/index.html');
    assert.match(normal, /ok<\/html>/);
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise((r) => child.once('exit', r));
      child.kill();
      await stopped;
    }
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('progress payload keeps knowledge/skill goals and pklb', () => {
  const payload = buildProgressPayload({ pklb: '2' }, [{ contentZ: '知识目标', contentJ: '技能目标' }]);
  assert.equal(payload.jsnr_zs, '知识目标@#@');
  assert.equal(payload.jsnr_js, '技能目标@#@');
  assert.equal(payload.pklb, '2');
});

test('xqskzs only accepts plain numbers or a JSON field', () => {
  assert.equal(parseXqskzs('20'), '20');
  assert.equal(parseXqskzs('{"status":200,"xqskzs":16}'), '16');
  assert.equal(parseXqskzs('课时总数20周'), '');
  assert.equal(parseXqskzs('<div>xqskzs=20</div>'), '');
});

test('html entities are decoded exactly once', () => {
  assert.equal(clean('A &amp; B &lt;x&gt; &quot;q&quot;'), 'A & B x "q"');
});

test('requireDownload rejects fake excel pages and accepts real signatures', () => {
  const ole2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(64)]);
  assert.equal(
    requireDownload({ response: new Response(ole2, { headers: { 'content-type': 'application/vnd.ms-excel' } }), buffer: ole2 }, 'xls').length,
    ole2.length,
  );
  const fake = Buffer.from('<html><body>系统异常，请稍后重试</body></html>');
  assert.throws(
    () => requireDownload({ response: new Response(fake, { headers: { 'content-type': 'application/vnd.ms-excel' } }), buffer: fake }, 'xls'),
    /有效文件/,
  );
  const pdf = Buffer.from(' \n%PDF-1.7\nfixture');
  assert.equal(requireDownload({ response: new Response(pdf, { headers: { 'content-type': 'application/pdf' } }), buffer: pdf }, 'pdf').length, pdf.length);
});

test('grade report keeps merged and non-numeric student rows', async () => {
  const html = `<table>
<tr><td>学号</td><td>姓名</td><td>成绩</td></tr>
<tr><td>A001</td><td>张三</td><td>90</td></tr>
<tr><td></td><td>李四</td><td>85</td></tr>
</table>`;
  const mock = { text: async () => ({ status: 200, text: html }) };
  const report = await getCourseGradesReport(mock, { term: '2026,0', kcdm: 'k', bjdm: 'b' });
  assert.equal(report.rows.length, 2);
  assert.equal(report.empty, false);
});

test('roster remark falls back to a 9-column layout and xls cells are formula-safe', async () => {
  const html = `<table>
<tr><td>序号</td><td>班级</td><td>学号</td><td>姓名</td><td>性别</td><td>学院</td><td>专业</td><td>类型</td><td>备注</td></tr>
<tr><td>1</td><td>1班</td><td>20230001</td><td>张三</td><td>男</td><td>院</td><td>专业</td><td>正常</td><td>备注A</td></tr>
</table>`;
  const mock = { text: async () => ({ status: 200, text: html }) };
  const roster = await getRoster(mock, '2026,0', 'k', 'b');
  assert.equal(roster.items[0].remark, '备注A');
  const xls = buildRosterListHtml({
    term: '2026,0',
    termLabel: '',
    kcdm: 'k',
    skbjdm: 'b',
    courseName: '',
    className: '',
    teacherCode: '',
    teacherName: '',
    teacher: '',
    items: [{ index: '1', studentId: '20230001', name: '=SUM(A1:A2)', gender: '男', type: '', major: '', remark: '@cmd' }],
  });
  assert.match(xls, /'=SUM\(A1:A2\)/);
  assert.match(xls, /'@cmd/);
});

test('next class prefers the currently running course', () => {
  const courses = [
    { name: 'A', day: 1, slot: '3-4', weeks: '1-16', parity: null, room: '', clazz: '' },
    { name: 'B', day: 1, slot: '5-6', weeks: '1-16', parity: null, room: '', clazz: '' },
  ];
  const start = new Date(2026, 8, 7);
  const now = new Date(2026, 8, 7, 10, 30);
  const next = schedule.nextCourseInstance(courses, start, 16, 1, schedule.DEFAULT_TIMES, now);
  assert.equal(next.course.name, 'A');
});

test('malformed term strings no longer fall back to the first semester', () => {
  assert.equal(schedule.termStart('2025,'), null);
  assert.equal(schedule.termStart('2025'), null);
  assert.equal(schedule.termStart('2025,x'), null);
  assert.equal(schedule.semesterLabel(2026, 2), '2026–2027学年');
});

test('hours validation skips categories the upstream did not report', () => {
  const zero = { lecture: 0, lab: 0, practice: 0, other: 0 };
  assert.equal(progress.validateHours([{ lectureHours: '999' }], zero), '');
  assert.match(progress.validateHours([{ lectureHours: '9' }], { ...zero, lecture: 8 }), /超过/);
});

test('tearing a memo persists immediately even if the panel unmounts', async () => {
  const { MemoPanel } = await componentModule('web/src/components/MemoPanel.tsx');
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  const oldWindow = globalThis.window;
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  globalThis.window = { setTimeout: () => 1, clearTimeout: () => {} };
  const view = harness(MemoPanel, { userId: 'A' });
  try {
    let tree = view.render();
    nodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === '新建便利贴')[0].props.onChange({ target: { value: '待办' } });
    tree = view.render();
    nodes(tree, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    tree = view.render();
    nodes(tree, (n) => n.type === 'button' && String(n.props.children).includes('撕下'))[0].props.onClick();
    assert.equal(JSON.parse(saved.get('teacher-desk:memo:v2:A') ?? '[]').length, 0);
  } finally {
    view.unmount();
    globalThis.localStorage = oldStorage;
    globalThis.window = oldWindow;
  }
});
