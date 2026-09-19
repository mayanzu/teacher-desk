import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, globalConcurrency, maxQueueSize } from '../server/jwxt/scheduler.mjs';
import { JwxtSession } from '../server/session.mjs';
import { fetchScheduleWeek } from '../server/jwxt/schedule.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tracker() {
  const state = { active: 0, peak: 0 };
  return {
    state,
    async run(ms = 10) {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      try { await sleep(ms); } finally { state.active -= 1; }
    },
  };
}

test('调度器：每会话与全局并发上限都被遵守', async () => {
  const scheduler = createScheduler({ perSessionLimit: 2, globalLimit: 3, maxQueue: 50 });
  const a = {}, b = {};
  const global = tracker();
  const perSession = new Map();
  const track = (session) => async () => {
    if (!perSession.has(session)) perSession.set(session, tracker());
    return Promise.all([global.run(15), perSession.get(session).run(15)]);
  };
  await Promise.all([
    ...Array.from({ length: 4 }, () => scheduler.run(a, track(a))),
    ...Array.from({ length: 3 }, () => scheduler.run(b, track(b))),
  ]);
  assert.ok(global.state.peak <= 3, `全局峰值应 ≤3（实际 ${global.state.peak}）`);
  assert.ok(global.state.peak >= 2, '应真的并发');
  assert.ok(perSession.get(a).state.peak <= 2, `会话 A 峰值应 ≤2（实际 ${perSession.get(a).state.peak}）`);
  assert.ok(perSession.get(b).state.peak <= 2, '会话 B 峰值应 ≤2');
});

test('调度器：优先级高的先派发，队列排满明确报 503', async () => {
  const scheduler = createScheduler({ perSessionLimit: 1, globalLimit: 1, maxQueue: 1 });
  const session = {};
  const order = [];
  let releaseFirst;
  const blocker = scheduler.run(session, async () => {
    order.push('blocker');
    await new Promise((resolve) => { releaseFirst = resolve; });
  });
  await sleep(5);
  const queued = scheduler.run(session, async () => { order.push('queued'); });
  await assert.rejects(scheduler.run(session, async () => { order.push('overflow'); }), { status: 503 });
  releaseFirst();
  await Promise.all([blocker, queued]);
  assert.deepEqual(order, ['blocker', 'queued']);
});

test('调度器：排队期间取消不会占用额度', async () => {
  const scheduler = createScheduler({ perSessionLimit: 1, globalLimit: 1, maxQueue: 10 });
  const session = {};
  let release;
  const running = scheduler.run(session, () => new Promise((resolve) => { release = resolve; }));
  await sleep(5);
  const controller = new AbortController();
  const queued = scheduler.run(session, async () => 'should-not-run', { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, (error) => error.name === 'AbortError');
  release();
  await running;
  // 释放后额度可用，后续任务正常执行
  assert.equal(await scheduler.run(session, async () => 'ok'), 'ok');
});

test('环境变量：全局并发与队列上限', () => {
  assert.equal(globalConcurrency({}), 8);
  assert.equal(globalConcurrency({ JWXT_GLOBAL_CONCURRENCY: '2' }), 2);
  assert.equal(globalConcurrency({ JWXT_GLOBAL_CONCURRENCY: '0' }), 8);
  assert.equal(maxQueueSize({}), 64);
  assert.equal(maxQueueSize({ JWXT_MAX_QUEUE: '3' }), 3);
});

test('真实 fetch：JWXT_FETCH_CONCURRENCY=1 时课表周请求峰值并发为 1（R01 验收）', async () => {
  const oldFetch = globalThis.fetch;
  const oldConcurrency = process.env.JWXT_FETCH_CONCURRENCY;
  process.env.JWXT_FETCH_CONCURRENCY = '1';
  let active = 0;
  let peak = 0;
  const html = '<div class="weeklesson"><ul>'
    + '<li>课程名称：测试课</li><li>上课时间：星期一 [1-2节][1-16周]</li><li>上课地点：A101</li>'
    + '</ul></div>';
  globalThis.fetch = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(6);
    active -= 1;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  try {
    const session = new JwxtSession('https://example.invalid');
    const weeks = [1, 2, 3, 4, 5];
    const results = await Promise.all(weeks.map((week) => fetchScheduleWeek(session, '2026,0', week)));
    assert.equal(results.length, 5);
    assert.equal(results[0].courses.length, 1);
    assert.equal(peak, 1, `配置为 1 时真实 fetch 峰值必须为 1（实际 ${peak}）`);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldConcurrency === undefined) delete process.env.JWXT_FETCH_CONCURRENCY;
    else process.env.JWXT_FETCH_CONCURRENCY = oldConcurrency;
  }
});

test('真实 fetch：默认并发上限约束跨模块叠加的请求', async () => {
  const oldFetch = globalThis.fetch;
  const oldConcurrency = process.env.JWXT_FETCH_CONCURRENCY;
  process.env.JWXT_FETCH_CONCURRENCY = '3';
  let active = 0;
  let peak = 0;
  const html = '<div class="weeklesson"><ul>'
    + '<li>课程名称：测试课</li><li>上课时间：星期二 [3-4节][1-16周]</li><li>上课地点：B202</li>'
    + '</ul></div>';
  globalThis.fetch = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(8);
    active -= 1;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  try {
    const session = new JwxtSession('https://example.invalid');
    await Promise.all(Array.from({ length: 8 }, (_, index) => fetchScheduleWeek(session, '2026,0', index + 1)));
    assert.ok(peak <= 3, `默认上限 3（实际峰值 ${peak}）`);
    assert.ok(peak >= 2, '应真的并发');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldConcurrency === undefined) delete process.env.JWXT_FETCH_CONCURRENCY;
    else process.env.JWXT_FETCH_CONCURRENCY = oldConcurrency;
  }
});
