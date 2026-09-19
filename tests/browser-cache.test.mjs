import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['web/src/api.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { api, clearApiCache, readApiCache, preloadTerm } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function mockFetch(run, mock) {
  const old = globalThis.fetch;
  clearApiCache();
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = old; clearApiCache(); }
}

test('tab revisits use cached data and simultaneous requests are coalesced', async () => {
  let calls = 0;
  await mockFetch(async () => {
    const [a, b] = await Promise.all([api.schedule('2026,0'), api.schedule('2026,0')]);
    a.courses.push('local edit');
    assert.deepEqual(b.courses, []);
    assert.deepEqual((await api.schedule('2026,0')).courses, []);
    assert.equal(calls, 1);
    assert.ok(readApiCache('schedule', '2026,0'));
    assert.equal(readApiCache('schedule', '2025,0'), undefined);
    await api.schedule('2025,0');
    assert.equal(calls, 2);
  }, async () => { calls++; return Response.json({ courses: [] }); });
});

test('forced refresh wins against a slower earlier request', async () => {
  const old = deferred();
  await mockFetch(async () => {
    const first = api.schedule('2026,0');
    await tick();
    await api.schedule('2026,0', { refresh: true });
    old.resolve(Response.json({ version: 'old' }));
    await first;
    assert.equal((await api.schedule('2026,0')).version, 'new');
  }, async path => path.includes('refresh=1') ? Response.json({ version: 'new' }) : old.promise);
});

test('logout and save prevent in-flight data from restoring invalidated cache', async () => {
  const old = deferred();
  await mockFetch(async () => {
    const first = api.schedule('2026,0');
    await tick();
    await api.logout();
    old.resolve(Response.json({ courses: [] }));
    await first;
    assert.equal(readApiCache('schedule', '2026,0'), undefined);
    await api.progressClasses('2026,0');
    await api.progressSave({ confirm: true });
    assert.equal(readApiCache('progress/classes', '2026,0'), undefined);
  }, async (path, init) => {
    if (path.startsWith('/api/schedule')) return old.promise;
    return Response.json(init?.method === 'POST' ? { data: { status: 200 } } : { items: [] });
  });
});

test('preload warms every visible tab with at most two browser requests', async () => {
  let active = 0, peak = 0;
  const paths = [];
  await mockFetch(async () => {
    let unauthorized = false;
    const stop = preloadTerm('2026,0', () => { unauthorized = true; });
    for (let i = 0; i < 30 && paths.length < 6; i++) await tick();
    await tick();
    assert.equal(paths.length, 6);
    assert.ok(peak <= 2);
    assert.equal(unauthorized, false);
    for (const endpoint of ['schedule', 'tasks', 'progress/classes', 'course-grades/classes', 'roster/classes', 'progress/summary']) {
      assert.ok(readApiCache(endpoint, '2026,0'), endpoint);
    }
    await api.feature('tasks', '2026,0');
    assert.equal(paths.length, 6);
    stop();
  }, async path => {
    paths.push(path); peak = Math.max(peak, ++active);
    await tick(); active--;
    return Response.json({ items: [] });
  });
});

test('failed requests are retried and expired data stays readable during revalidation', async () => {
  let calls = 0;
  const oldNow = Date.now;
  let time = oldNow();
  Date.now = () => time;
  try {
    await mockFetch(async () => {
      await assert.rejects(api.schedule('2026,0'));
      await api.schedule('2026,0');
      time += 6 * 60_000;
      assert.ok(readApiCache('schedule', '2026,0'));
      await api.schedule('2026,0');
      assert.equal(calls, 3);
    }, async () => ++calls === 1 ? Response.json({ error: 'offline' }, { status: 503 }) : Response.json({ courses: [] }));
  } finally { Date.now = oldNow; }
});
