/*
 * 服务端会话保活（解决「几天~几周不用就要重新扫码」）。
 *
 * 前端心跳只在页面打开且可见时发请求（web/src/App.tsx），关掉页面后上游没有任何流量，
 * 教务系统按自己的闲置超时把会话判死。这里在服务端定时打一次轻量探活
 * （SetMainInfo.jsp，与 ensureSession 同一个探测），刷新上游闲置计时：
 *
 *  - 只保活 config.keepAliveMaxIdleMs（默认 30 天）内有过真实访问的会话；
 *    超窗后停止保活，lastSeen 冻结，7 天后由 sweepSessions 正常回收。
 *  - 只有「确认掉线」（sessionAlive 返回 false：kingo.guest / 跳登录页 / 401）
 *    才 dropContext；网络抖动、上游 5xx 一律不清理、留给下一轮，避免误杀。
 *  - 复用统一调度器且低优先级（与 warmup 同待遇），不与用户请求抢额度。
 *  - JWXT_KEEPALIVE_MS=0 关闭；启动时先恢复持久化会话，重启不打断保活。
 */
import { config } from './config.mjs';
import { createScope, logScope, runWithScope } from './perf.mjs';
import { fetchConcurrency, mapWithConcurrency } from './jwxt/concurrency.mjs';
import { sessionAlive } from './sessionHealth.mjs';
import { dropContext, loggedInContexts, restorePersistedSessions, touchAlive } from './sessionStore.mjs';

// 探活失败日志节流：教务长时间不可用时，避免每个周期为同一会话刷一行
const ERROR_LOG_INTERVAL = 30 * 60 * 1000;
const errorLogged = new WeakMap();

function logProbeError(ctx, error) {
  const message = error instanceof Error ? error.message : String(error);
  const last = errorLogged.get(ctx);
  if (last && last.message === message && Date.now() - last.at < ERROR_LOG_INTERVAL) return;
  errorLogged.set(ctx, { message, at: Date.now() });
  console.warn(`[keepalive] ${ctx.sid} 探活失败（保留会话，下轮重试）：${message}`);
}

/**
 * 执行一轮保活：对窗口内的已登录会话逐个探活。
 * targets/maxIdleMs 可注入，便于测试；默认遍历全部已登录上下文。
 * 返回 { probed, dropped }。
 */
export async function keepAliveTick(options = {}) {
  const now = Date.now();
  const windowMs = options.maxIdleMs ?? config.keepAliveMaxIdleMs;
  const targets = (options.targets ?? loggedInContexts())
    .filter((ctx) => ctx.session && now - (ctx.lastUserSeen ?? now) < windowMs);
  if (!targets.length) return { probed: 0, dropped: 0 };

  let probed = 0;
  let dropped = 0;
  const scope = createScope({ label: 'keepalive', priority: 'low', background: true });
  try {
    await runWithScope(scope, async () => {
      // worker 内部吞掉所有错误（记录后继续），mapWithConcurrency 不会因此中断派发
      await mapWithConcurrency(targets, fetchConcurrency(), async (ctx) => {
        if (!ctx.session) return;
        // 扫码登录进行中/成功待轮换：dropContext 里的 loginFlow.reset() 会打断正在进行的登录，
        // 这一轮直接跳过（状态 drained 到 idle/error 后下一轮照常探活）。
        const loginStatus = ctx.loginFlow?.state?.status;
        if (loginStatus && loginStatus !== 'idle' && loginStatus !== 'error') return;
        probed += 1;
        try {
          const alive = await sessionAlive(ctx);
          if (!ctx.session) return;
          if (!alive) {
            // 确认掉线：清理本地登录态，前端下次轮询 /api/session 自动回到登录页
            dropContext(ctx);
            dropped += 1;
            console.warn(`[keepalive] ${ctx.sid} 登录态已失效，已清理（下次访问需重新扫码）`);
            return;
          }
          touchAlive(ctx);
        } catch (error) {
          logProbeError(ctx, error);
        }
      });
    });
  } finally {
    logScope(scope);
  }
  return { probed, dropped };
}

/**
 * 启动定时保活，返回停止函数。
 * JWXT_KEEPALIVE_MS=0 时不启动（也跳过会话恢复，行为与改造前一致）。
 */
export function startKeepAlive() {
  const interval = config.keepAliveMs;
  if (interval <= 0) {
    console.log('[keepalive] 会话保活未启动（JWXT_KEEPALIVE_MS=0）');
    return () => {};
  }
  const restored = restorePersistedSessions();
  if (restored > 0) console.log(`[keepalive] 已恢复 ${restored} 个持久化会话，跨重启继续保活`);
  console.log(
    `[keepalive] 已启动：每 ${interval / 1000} 秒探活一次；`
    + `${config.keepAliveMaxIdleMs / (24 * 60 * 60 * 1000)} 天无真实访问后停止保活`,
  );
  const timer = setInterval(() => {
    void keepAliveTick().catch((error) => {
      console.warn(`[keepalive] 保活轮次失败：${error instanceof Error ? error.message : error}`);
    });
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}
