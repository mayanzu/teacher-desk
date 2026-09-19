/**
 * 服务端查询缓存的 TTL 分层。
 *
 * 原来所有缓存键共用一个 5 分钟 TTL：学期列表这种几乎不变的数据也会每 5 分钟回源一次，
 * 而每次回源都是 1~2s 的上游往返（教学进度汇总还是 N 次）。按数据的变化频率分层后，
 * 重复访问基本都能直接命中缓存；手动刷新仍可用 `?refresh=1` 跳过缓存强制回源。
 *
 * 兜底 TTL 可用 JWXT_CACHE_TTL_MS 覆盖（单位毫秒）。
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** 未命中分层规则的缓存键使用的默认 TTL */
export const DEFAULT_CACHE_TTL_MS =
  Number(process.env.JWXT_CACHE_TTL_MS) > 0 ? Number(process.env.JWXT_CACHE_TTL_MS) : 5 * MINUTE;

/** 变化越慢的数据，TTL 越长；顺序敏感，先匹配先返回。模式带 `:` 是为了只匹配真实键，不做前缀误伤 */
const TTL_TIERS = [
  // 学期列表：一学期都不会变
  [/^terms$/, 12 * HOUR],
  // 课表 / 教学任务：偶有调课，半小时足够；课表按周缓存（scheduleWeek:term:week）
  [/^(scheduleWeek|schedule|tasks):/, 30 * MINUTE],
  // 成绩：录入后基本不动
  [/^(grades|courseGradeClasses|courseGrades):/, 30 * MINUTE],
  // 点名册 / 教学班名单：学生名单偶尔调整（注意 /api/roster/classes 复用进度页的 progressClasses 键，走 5 分钟档）
  [/^roster:/, 10 * MINUTE],
];

export function cacheTtlFor(key, fallback = DEFAULT_CACHE_TTL_MS) {
  const name = String(key ?? '');
  for (const [pattern, ttl] of TTL_TIERS) {
    if (pattern.test(name)) return ttl;
  }
  // 教学进度等会用到的数据保持默认（5 分钟）
  return fallback;
}
