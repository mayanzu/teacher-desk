import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheStore } from '../server/cache.mjs';
import { loadScheduleView } from '../server/data.mjs';
import { aggregateSchedule, defaultScheduleWeeks, scheduleCalendar, fetchScheduleWeek } from '../server/jwxt/schedule.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCtx() {
  return {
    cache: new CacheStore({ max: 200, maxBytes: 8 * 1024 * 1024 }),
    exports: new CacheStore({ max: 20, maxBytes: 8 * 1024 * 1024 }),
    inflight: new Map(),
    generation: 0,
    session: null,
  };
}

function scheduleHtml(week, name) {
  return `<div class="weeklesson"><ul>`
    + `<li>课程名称：${name}</li><li>上课时间：星期一 [1-2节][${week}-${week}周]</li><li>上课地点：A101</li>`
    + `</ul></div>`;
}

function countingSession({ slowWeeks = new Map(), failWeeks = new Set() } = {}) {
  const state = { calls: 0, byWeek: new Map(), peak: 0, active: 0 };
  return {
    state,
    base: 'https://example.invalid',
    async text(path) {
      const week = Number(new URL(`https://x${path}`).searchParams.get('jxz'));
      state.calls += 1;
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      state.byWeek.set(week, (state.byWeek.get(week) || 0) + 1);
      try {
        await sleep(slowWeeks.get(week) ?? 4);
        if (failWeeks.has(week)) {
          throw Object.assign(new Error('课表响应异常'), { status: 502 });
        }
        return { status: 200, text: scheduleHtml(week, `第${week}周课程`) };
      } finally {
        state.active -= 1;
      }
    },
  };
}

test('分段加载：当前周先返回，慢的远周不阻塞首屏（R02 验收）', async () => {
  const ctx = createCtx();
  // 第 18 周很慢：整学期请求会被它拖住，分段请求不应等它
  const session = countingSession({ slowWeeks: new Map([[18, 400]]) });
  const started = Date.now();
  const first = await loadScheduleView(ctx, session, '2026,0', { weeks: [1, 2] });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 300, `当前周不应等待远周（实际 ${elapsed}ms）`);
  assert.deepEqual(first.loadedWeeks, [1, 2]);
  assert.ok(first.pendingWeeks.includes(18), '未加载的周次必须显式标记');
  assert.equal(first.complete, false);
  assert.equal(first.courses.length, 2);

  // 后台补齐其余周次：包含慢周，最终完整
  const second = await loadScheduleView(ctx, session, '2026,0', { weeks: first.pendingWeeks });
  assert.equal(second.complete, true);
  assert.deepEqual(second.pendingWeeks, []);
  assert.equal(second.courses.length, 20);
  assert.equal(session.state.calls, 20);
  assert.equal(session.state.byWeek.get(18), 1);

  // 已加载周次再请求：0 次回源
  const third = await loadScheduleView(ctx, session, '2026,0', { weeks: [1, 2, 18] });
  assert.equal(session.state.calls, 20, '缓存命中不应回源');
  assert.equal(third.complete, true);

  ctx.cache.destroy();
  ctx.exports.destroy();
});

test('部分周次失败显式上报；整学期接口保持“全有或全无”', async () => {
  const ctx = createCtx();
  const session = countingSession({ failWeeks: new Set([5]) });
  const partial = await loadScheduleView(ctx, session, '2026,0', { weeks: [5, 6] });
  assert.equal(partial.failedWeeks.length, 1);
  assert.equal(partial.failedWeeks[0].week, 5);
  assert.deepEqual(partial.loadedWeeks, [6]);
  assert.ok(partial.pendingWeeks.includes(5), '失败的周次同时标记为未加载');

  await assert.rejects(
    loadScheduleView(ctx, session, '2026,0', { weeks: [5], requireAll: true, force: true }),
    { status: 502 },
  );

  ctx.cache.destroy();
  ctx.exports.destroy();
});

test('默认展示周为当前周 ±1，学期外回到第 1 周', () => {
  // 2026-08-31 是周一；2026-09-16（周三）属于第 3 周
  const calendar = { semesterStart: '2026-08-31', totalWeeks: 20 };
  assert.deepEqual(defaultScheduleWeeks(calendar, new Date('2026-09-16T12:00:00')), [2, 3, 4]);
  assert.deepEqual(defaultScheduleWeeks(calendar, new Date('2026-08-20T12:00:00')), [1, 2]);
  assert.deepEqual(defaultScheduleWeeks(calendar, new Date('2027-05-01T12:00:00')), [1, 2]);
});

test('聚合按业务键跨周去重并保留教师', () => {
  const calendar = scheduleCalendar('2026,0', { totalWeeks: 20 });
  const weeks = new Map([
    [1, { week: 1, courses: [{ name: 'A', day: 1, slot: '1-2', weeks: '1-16', parity: null, room: 'A101', clazz: '1班' }], teacher: '张三' }],
    [2, { week: 2, courses: [{ name: 'A', day: 1, slot: '1-2', weeks: '1-16', parity: null, room: 'A101', clazz: '1班' }], teacher: '张三' }],
  ]);
  const view = aggregateSchedule(calendar, weeks);
  assert.equal(view.courses.length, 1);
  assert.equal(view.teacher, '张三');
  assert.equal(view.maxWeek, 16);
});

test('单周请求失败抛出错误，调用方可感知', async () => {
  const session = countingSession({ failWeeks: new Set([3]) });
  await assert.rejects(fetchScheduleWeek(session, '2026,0', 3), { status: 502 });
});
