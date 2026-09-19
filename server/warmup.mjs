/*
 * 登录后的后台预热（review R04）：
 *  - 绑定会话代际：退出/换账号（resetContextCaches）会 abort 排队和在飞的预取请求；
 *  - 低优先级：让位给用户正在看的请求（scheduler 按 scope.priority 派发）；
 *  - 失败有限重试，不会因为一次失败被永久跳过；
 *  - 只预热有 UI 消费者的数据集（成绩登记册没有入口，已移除）。
 */
import { cached } from './cache.mjs';
import { createScope, runWithScope, logScope } from './perf.mjs';
import { fetchConcurrency, mapWithConcurrency } from './jwxt/concurrency.mjs';
import { getTasks, getCourseGradeClasses } from './jwxt/index.mjs';
import { loadTerms, loadScheduleView, loadProgressClasses } from './data.mjs';

export const WARMUP_ATTEMPTS = Number(process.env.JWXT_WARMUP_ATTEMPTS) > 0 ? Number(process.env.JWXT_WARMUP_ATTEMPTS) : 3;

const warmed = new WeakMap();

/** 会话代际变化后重新预热；失败允许有限重试。 */
export function shouldWarmUp(ctx, session) {
  const record = warmed.get(session);
  if (!record || record.generation !== ctx.generation) return true;
  if (record.running) return false;
  return record.attempts < WARMUP_ATTEMPTS;
}

/**
 * 顺序：先拿学期列表定出当前学期，再并发预热该学期下的课表（当前周 ±1）、
 * 教学任务、成绩列表与进度列表。单个数据集失败只记日志、不影响其它数据集。
 */
export async function warmUp(ctx, session) {
  const generation = ctx.generation;
  const alive = () => ctx.session === session && ctx.generation === generation;
  const previous = warmed.get(session);
  const record = previous?.generation === generation ? previous : { generation, attempts: 0 };
  record.running = true;
  record.attempts += 1;
  warmed.set(session, record);

  // 退出/换账号时 resetContextCaches 会 abort 这个 controller，取消排队和在飞的预取请求。
  const controller = new AbortController();
  ctx.backgroundAbort = controller;
  const scope = createScope({ label: 'warmup', priority: 'low', background: true, signal: controller.signal });
  await runWithScope(scope, async () => {
    let failed = 0;
    const cancelled = (error) => error?.name === 'AbortError' || error?.status === 499 || controller.signal.aborted;
    const job = async (name, run) => {
      if (!alive()) return;
      try {
        await run();
      } catch (error) {
        if (cancelled(error)) return;
        failed += 1;
        console.warn(`[warmup] ${name} 预热失败：${error?.message || error}`);
      }
    };
    try {
      const terms = await loadTerms(ctx, session);
      if (!alive()) return;
      const term = terms?.[0]?.value;
      if (!term) return;
      const jobs = [
        ['schedule', () => loadScheduleView(ctx, session, term)],
        ['tasks', () => cached(ctx, `tasks:${term}`, () => getTasks(session, term))],
        ['courseGradeClasses', () => cached(ctx, `courseGradeClasses:${term}`, () => getCourseGradeClasses(session, term))],
        ['progressClasses', () => loadProgressClasses(ctx, session, term)],
      ];
      await mapWithConcurrency(jobs, fetchConcurrency(), ([name, run]) => job(name, run));
      if (alive() && failed === 0) record.attempts = WARMUP_ATTEMPTS;
    } catch (error) {
      if (!cancelled(error)) console.warn(`[warmup] 预热中止：${error?.message || error}`);
    } finally {
      record.running = false;
      if (ctx.backgroundAbort === controller) ctx.backgroundAbort = null;
      logScope(scope);
    }
  });
}
