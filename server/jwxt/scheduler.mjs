/*
 * 上游（教务系统）请求调度器（review R01）。
 *
 * 旧实现的问题：不同模块各自用 mapWithConcurrency 管自己的队列，课表内部还有硬编码的
 * Promise.all(5)，配置 JWXT_FETCH_CONCURRENCY=1 也管不住课表；多个浏览器请求叠加后
 * 真实并发不受任何全局约束。
 *
 * 现在把调度放到实际 fetch 周围（JwxtSession.request），提供：
 *  - 同一会话并发上限（默认 JWXT_FETCH_CONCURRENCY=3，兼容旧配置）；
 *  - 同一教务源全局上限（JWXT_GLOBAL_CONCURRENCY，默认 8）；
 *  - 优先级队列：鉴权/用户主动操作 > 普通请求 > 后台预热；
 *  - 有界队列：排满时明确返回 503，而不是无限堆积；
 *  - 取消传播：scope 的 AbortSignal 在排队或执行期间都能中断。
 *
 * 注意：额度覆盖到响应体读取完成（fetch + arrayBuffer），不能收到响应头就释放。
 * 嵌套的业务函数只负责拆任务、不再自己占用同一个信号量，避免死锁。
 */
import { currentScope, PRIORITY, addTiming, addCount } from '../perf.mjs';

function envLimit(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

export function globalConcurrency(env = process.env) {
  const raw = Number(env?.JWXT_GLOBAL_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 8;
}

export function maxQueueSize(env = process.env) {
  const raw = Number(env?.JWXT_MAX_QUEUE);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 64;
}

export function createScheduler({ perSessionLimit, globalLimit, maxQueue } = {}) {
  const sessions = new WeakMap();
  const queue = [];
  let globalActive = 0;
  let seq = 0;
  let peakGlobal = 0;
  const limitPerSession = () => (typeof perSessionLimit === 'function' ? perSessionLimit() : perSessionLimit) || 1;
  const limitGlobal = () => (typeof globalLimit === 'function' ? globalLimit() : globalLimit) || 1;
  const queueLimit = () => (typeof maxQueue === 'function' ? maxQueue() : maxQueue) || 1;

  function stateFor(session) {
    let state = sessions.get(session);
    if (!state) {
      state = { active: 0, queued: 0, peak: 0 };
      sessions.set(session, state);
    }
    return state;
  }

  function pickNext() {
    let bestIndex = -1;
    let best = null;
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      if (item.state.active >= limitPerSession()) continue;
      if (!best || item.priority < best.priority || (item.priority === best.priority && item.seq < best.seq)) {
        best = item;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  function drain() {
    while (globalActive < limitGlobal()) {
      const index = pickNext();
      if (index < 0) return;
      const item = queue.splice(index, 1)[0];
      item.state.queued -= 1;
      globalActive += 1;
      item.state.active += 1;
      item.state.peak = Math.max(item.state.peak, item.state.active);
      peakGlobal = Math.max(peakGlobal, globalActive);
      item.start();
    }
  }

  function acquire(session, priority, signal) {
    const state = stateFor(session);
    return new Promise((resolve, reject) => {
      if (queue.length >= queueLimit()) {
        reject(Object.assign(new Error('教务系统请求排队已满，请稍后重试'), { status: 503 }));
        return;
      }
      const item = { state, priority, seq: seq++, start: null, abort: null };
      const onAbort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        state.queued -= 1;
        reject(Object.assign(new Error('请求已取消'), { status: 499, name: 'AbortError' }));
      };
      if (signal) {
        if (signal.aborted) {
          reject(Object.assign(new Error('请求已取消'), { status: 499, name: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        item.abort = () => signal.removeEventListener('abort', onAbort);
      }
      item.start = () => {
        item.abort?.();
        resolve();
      };
      queue.push(item);
      state.queued += 1;
      drain();
    });
  }

  function release(state) {
    state.active -= 1;
    globalActive -= 1;
    drain();
  }

  async function run(session, task, options = {}) {
    const scope = currentScope();
    const priority = options.priority || scope?.priority || 'normal';
    const signal = options.signal || scope?.signal || null;
    const state = stateFor(session);
    const queuedAt = performance.now();
    await acquire(session, PRIORITY[priority] ?? PRIORITY.normal, signal);
    addTiming('queue', performance.now() - queuedAt);
    addCount('scheduled');
    try {
      return await task();
    } finally {
      release(state);
    }
  }

  function stats() {
    return { active: globalActive, queued: queue.length, peakGlobal };
  }

  return { run, stats, drain };
}

let defaultScheduler = null;

/** 生产环境共用的默认调度器：上限读环境变量，支持 ?refresh 等配置热更新（启动后固定）。 */
export function getScheduler() {
  if (!defaultScheduler) {
    // 延迟读取，保证测试可以先设置环境变量再实例化。
    defaultScheduler = createScheduler({
      perSessionLimit: () => {
        const raw = Number(process.env.JWXT_FETCH_CONCURRENCY);
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
      },
      globalLimit: () => globalConcurrency(),
      maxQueue: () => maxQueueSize(),
    });
  }
  return defaultScheduler;
}

/** 仅供测试重置（生产代码不要调用）。 */
export function resetDefaultScheduler() {
  defaultScheduler = null;
}

export function scheduleRequest(session, task, options = {}) {
  return getScheduler().run(session, task, options);
}
