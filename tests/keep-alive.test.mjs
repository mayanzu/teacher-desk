import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在 import 服务端模块之前设置：config 只在模块加载时读一次环境变量
const dir = mkdtempSync(join(tmpdir(), 'teacher-desk-keepalive-'));
process.env.SESSION_DIR = join(dir, 'sessions');
// 关掉探测记忆：测试要能逐轮断言真实打上游的次数
process.env.JWXT_SESSION_PROBE_TTL_MS = '0';

const { config, parseKeepAliveMaxIdleMs, parseKeepAliveMs } = await import('../server/config.mjs');
const { keepAliveTick } = await import('../server/keepAlive.mjs');
const { JwxtSession } = await import('../server/session.mjs');
const { contextFor, dropContext, loggedInContexts, restorePersistedSessions } = await import('../server/sessionStore.mjs');

const DAY_MS = 24 * 60 * 60 * 1000;

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function mockRes() {
  const headers = new Map();
  return { headers, setHeader: (key, value) => headers.set(key, value) };
}

/** 已登录上下文；mode 决定上游探活结果（alive / dead / error），calls.n 统计打上游次数。 */
function loggedInCtx(mode = 'alive') {
  const ctx = contextFor({ headers: {} }, mockRes());
  const calls = { n: 0 };
  ctx.session = {
    username: 'teacher',
    landingUrl: '',
    text: async () => {
      calls.n += 1;
      if (mode === 'error') throw new Error('上游抖动');
      return { status: 200, text: mode === 'dead' ? 'kingo.guest' : "_loginid = 'teacher';" };
    },
  };
  return { ctx, calls };
}

test('保活探活：存活顺延空闲计时，确认掉线才清理，抖动不误杀', async () => {
  const alive = loggedInCtx('alive');
  const dead = loggedInCtx('dead');
  const broken = loggedInCtx('error');
  const inFlight = loggedInCtx('dead'); // 正在扫码登录的会话：不探、不清理
  inFlight.ctx.loginFlow.state.status = 'waiting';
  const anon = contextFor({ headers: {} }, mockRes()); // 无登录态，不参与保活
  const stale = Date.now() - 60_000;
  for (const { ctx } of [alive, dead, broken, inFlight]) ctx.lastSeen = stale;

  const result = await keepAliveTick({ targets: [alive.ctx, dead.ctx, broken.ctx, inFlight.ctx, anon] });

  assert.equal(result.probed, 3, '匿名上下文与登录中的会话被跳过');
  assert.equal(result.dropped, 1);
  assert.equal(alive.calls.n, 1, '存活会话每轮只探一次');
  assert.ok(alive.ctx.session, '存活 → 会话保留');
  assert.ok(alive.ctx.lastSeen > stale, '存活 → 顺延空闲计时（防止被 sweepSessions 回收）');
  assert.equal(dead.ctx.session, null, '确认掉线 → 清理登录态');
  assert.ok(broken.ctx.session, '网络抖动 → 不清理，留给下一轮');
  assert.equal(broken.ctx.lastSeen, stale, '网络抖动 → 不顺延空闲计时');
  assert.ok(inFlight.ctx.session, '扫码登录进行中不被保活清理打断');
  assert.equal(inFlight.calls.n, 0, '扫码登录进行中不打上游');
  for (const { ctx } of [alive, dead, broken, inFlight]) dropContext(ctx);
  dropContext(anon);
});

test('超过保活窗口（默认 30 天）没有真实访问的会话不再探活', async () => {
  const { ctx, calls } = loggedInCtx('alive');
  ctx.lastUserSeen = Date.now() - 31 * DAY_MS;
  const stale = ctx.lastSeen;

  const result = await keepAliveTick({ targets: [ctx] });

  assert.deepEqual(result, { probed: 0, dropped: 0 });
  assert.equal(calls.n, 0, '超窗 → 不打上游');
  assert.ok(ctx.session, '超窗 → 不主动清理，由 sweepSessions 按闲置回收');
  assert.equal(ctx.lastSeen, stale, '超窗 → 不顺延');
  dropContext(ctx);
});

test('启动恢复：7 天内的持久化会话回内存，空闲计时续接文件 mtime', () => {
  mkdirSync(config.sessionDir, { recursive: true });
  const session = new JwxtSession();
  session.username = 'teacher';
  session.landingUrl = '/ahsljw/frame/homes.action';
  session.cookies.set('JSESSIONID', 'restored');

  const sid = 'b'.repeat(36);
  const file = join(config.sessionDir, `${sid}.json`);
  writeFileSync(file, session.serialize(), 'utf8');
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  utimesSync(file, new Date(twoHoursAgo), new Date(twoHoursAgo));

  // 超过 7 天的文件不恢复（与 loadPersisted 的回收口径一致）
  const staleSid = 'c'.repeat(36);
  const staleFile = join(config.sessionDir, `${staleSid}.json`);
  writeFileSync(staleFile, session.serialize(), 'utf8');
  const eightDaysAgo = Date.now() - 8 * DAY_MS;
  utimesSync(staleFile, new Date(eightDaysAgo), new Date(eightDaysAgo));

  try {
    assert.equal(restorePersistedSessions(), 1, '过期文件不恢复');
    const ctx = loggedInContexts().find((item) => item.sid === sid);
    assert.ok(ctx, '会话已回内存');
    assert.equal(ctx.session.username, 'teacher');
    assert.ok(Math.abs(ctx.lastUserSeen - twoHoursAgo) < 5000, '保活窗口续接文件 mtime');
    assert.ok(Math.abs(ctx.lastSeen - twoHoursAgo) < 5000, '回收计时续接文件 mtime');
    dropContext(ctx);
  } finally {
    rmSync(staleFile, { force: true });
  }
});

test('保活参数解析：0 关闭，非法值回退默认', () => {
  assert.equal(parseKeepAliveMs(undefined), 5 * 60 * 1000, '默认 5 分钟');
  assert.equal(parseKeepAliveMs(''), 5 * 60 * 1000);
  assert.equal(parseKeepAliveMs('0'), 0, '0 = 关闭保活');
  assert.equal(parseKeepAliveMs('-1'), 5 * 60 * 1000, '负数回退默认');
  assert.equal(parseKeepAliveMs('abc'), 5 * 60 * 1000, '非法值回退默认');
  assert.equal(parseKeepAliveMs('15000'), 15000);

  assert.equal(parseKeepAliveMaxIdleMs(undefined), 30 * DAY_MS, '默认 30 天');
  assert.equal(parseKeepAliveMaxIdleMs('7'), 7 * DAY_MS);
  assert.equal(parseKeepAliveMaxIdleMs('0'), 30 * DAY_MS, '非正数回退默认');
  assert.equal(parseKeepAliveMaxIdleMs('x'), 30 * DAY_MS);

  // 本测试进程未设置这两个环境变量 → 生效值应为默认值
  assert.equal(config.keepAliveMs, 5 * 60 * 1000, '默认开启');
  assert.equal(config.keepAliveMaxIdleMs, 30 * DAY_MS);
});
