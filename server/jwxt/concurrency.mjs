/**
 * 上游请求并发控制。
 *
 * 教务系统的每个页面都要 1~2s（高峰期更久），串行拉取会让耗时随数据条数线性增长：
 * 教学进度汇总原来是「1 + 教学班数」次串行往返，6 个班就是 7 次排队 ≈ 9~10s。
 * 这里提供一个统一的上限，默认 3，可用 JWXT_FETCH_CONCURRENCY 调整，
 * 设为 1 即恢复完全串行的行为（万一教务侧不喜欢并发）。
 */

export const DEFAULT_FETCH_CONCURRENCY = 3;

export function fetchConcurrency(env = process.env) {
  const raw = Number(env?.JWXT_FETCH_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_FETCH_CONCURRENCY;
}

/**
 * 按并发上限执行任务，返回结果**与输入同序**。
 * 任一任务抛错时立刻停止派发新任务（在飞的任务自然结束），最后抛出第一个错误。
 *
 * 在 `limit = 1` 时退化为普通的顺序 for-await，行为与改造前一致。
 */
export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const size = Math.min(Math.max(1, Math.floor(Number(limit)) || 1), list.length);
  const results = new Array(list.length);
  let cursor = 0;
  let failure = null;

  const run = async () => {
    while (!failure) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      try {
        results[index] = await worker(list[index], index);
      } catch (error) {
        if (!failure) failure = error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: size }, run));
  if (failure) throw failure;
  return results;
}
