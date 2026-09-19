/*
 * 请求级性能采集（review R16）。
 *
 * 用 AsyncLocalStorage 给一次 HTTP 请求（或一个后台任务）挂一个 scope，
 * 采集：上游请求数/耗时、调度排队耗时、缓存命中/未命中、各阶段耗时。
 *
 * 只记录资源类型和脱敏计数，不记录学生数据、Cookie 或请求体；
 * 默认不打印，JWXT_PERF_LOG=1 时才输出一行 [perf] 日志。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

export const PRIORITY = { high: 0, normal: 1, low: 2 };

export function createScope(extra = {}) {
  return {
    label: extra.label || 'task',
    priority: extra.priority || 'normal',
    background: Boolean(extra.background),
    signal: extra.signal || null,
    route: extra.route || '',
    timings: Object.create(null),
    counts: Object.create(null),
    startedAt: performance.now(),
    ...extra,
  };
}

export function runWithScope(scope, fn) {
  return als.run(scope, fn);
}

export function currentScope() {
  return als.getStore() || null;
}

/** 在父 scope 内临时提高/降低优先级，共享同一个采集账本。 */
export function withPriority(priority, fn) {
  const scope = als.getStore();
  if (!scope) return fn();
  return als.run({ ...scope, priority }, fn);
}

export function addTiming(name, ms) {
  const scope = als.getStore();
  if (!scope || !Number.isFinite(ms) || ms <= 0) return;
  scope.timings[name] = (scope.timings[name] || 0) + ms;
}

export function addCount(name, value = 1) {
  const scope = als.getStore();
  if (!scope) return;
  scope.counts[name] = (scope.counts[name] || 0) + value;
}

/** 输出一行脱敏性能日志；route 只保留路径形状（调用方不要传查询值）。 */
export function logScope(scope, status = 0) {
  if (!scope || process.env.JWXT_PERF_LOG !== '1') return;
  const total = Math.round(performance.now() - scope.startedAt);
  const timings = Object.entries(scope.timings).map(([key, ms]) => `${key}=${Math.round(ms)}ms`).join(' ');
  const counts = Object.entries(scope.counts).map(([key, value]) => `${key}=${value}`).join(' ');
  const route = scope.route || scope.label;
  console.log(
    `[perf] ${scope.background ? 'bg' : 'http'} ${scope.label} ${route}${status ? ` ${status}` : ''} total=${total}ms${timings ? ` ${timings}` : ''}${counts ? ` ${counts}` : ''}`,
  );
}
