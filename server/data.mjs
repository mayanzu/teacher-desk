/*
 * 会话隔离的数据访问层（review R03/R05）。
 *
 * 路由不再直接调用底层解析函数，而是通过这里：
 *  - 班级列表、学期周数、录入表格行、学期进度等只读数据在会话内共享缓存，
 *    汇总与明细不再各自重复回源；
 *  - 编辑表单元数据始终现拉（不长期缓存可能变化的隐藏字段/令牌）；
 *  - 保存成功后只做定向失效，不再清空整个工作台。
 */
import { cached, freshEntry } from './cache.mjs';
import {
  getTerms,
  getProgressClasses,
  getProgress,
  getProgressCourses,
  getProgressXqskzs,
  getProgressRows,
  getProgressSummary,
  getProgressEntryForm,
  progressTotals,
} from './jwxt/index.mjs';
import { scheduleCalendar, fetchScheduleWeek, aggregateSchedule, defaultScheduleWeeks } from './jwxt/schedule.mjs';
import { fetchConcurrency, mapWithConcurrency } from './jwxt/concurrency.mjs';

// 学期周数、已验证表格 ID 这类元数据变化极慢，可在会话内长缓存。
export const PROGRESS_META_TTL = 6 * 60 * 60 * 1000;

const progressGridKey = (term, params) => `progressGrid:${term}:${params.kcdm || ''}:${params.bjdm || ''}`;
const progressTableKey = (term) => `progressGridTable:${term}`;

export function loadTerms(ctx, session, force = false) {
  return cached(ctx, 'terms', () => getTerms(session), force);
}

/**
 * 课表分段加载：按周读写缓存，只回源缺失/被强制刷新的周次。
 * 返回 loadedWeeks / pendingWeeks / failedWeeks，前端据此区分「未加载」和「没有课」。
 */
export async function loadScheduleView(ctx, session, term, options = {}) {
  const totalWeeks = Number(options.totalWeeks) > 0 ? Number(options.totalWeeks) : 20;
  const calendar = scheduleCalendar(term, { totalWeeks });
  const requested = options.all
    ? Array.from({ length: totalWeeks }, (_, index) => index + 1)
    : Array.isArray(options.weeks) && options.weeks.length
      ? options.weeks
      : defaultScheduleWeeks(calendar);
  const weeks = [...new Set(requested)]
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= 60)
    .sort((a, b) => a - b);
  const failures = [];
  await mapWithConcurrency(weeks, fetchConcurrency(), async (week) => {
    try {
      await cached(ctx, `scheduleWeek:${term}:${week}`, () => fetchScheduleWeek(session, term, week), options.force);
    } catch (error) {
      if (error?.status === 401) throw error;
      failures.push({ week, message: error instanceof Error ? error.message : '加载失败' });
    }
  });

  const loaded = new Map();
  const collect = (limit) => {
    for (let week = 1; week <= limit; week += 1) {
      const value = freshEntry(ctx.cache, `scheduleWeek:${term}:${week}`);
      if (value) loaded.set(week, value);
    }
  };
  collect(totalWeeks);
  const view = aggregateSchedule(calendar, loaded);
  // 课表实际周数可能超过配置的 20 周，再补扫一次。
  if (view.maxWeek > totalWeeks) collect(Math.min(view.maxWeek, 60));
  const finalView = view.maxWeek > totalWeeks ? aggregateSchedule(calendar, loaded) : view;
  const total = Math.max(totalWeeks, finalView.maxWeek);
  const loadedWeeks = [...loaded.keys()].sort((a, b) => a - b);
  const pendingWeeks = [];
  for (let week = 1; week <= total; week += 1) {
    if (!loaded.has(week)) pendingWeeks.push(week);
  }
  if (options.requireAll && failures.length) {
    const first = failures[0];
    throw Object.assign(new Error(`第 ${first.week} 周课表加载失败：${first.message}`), { status: 502 });
  }
  return {
    ...finalView,
    totalWeeks: total,
    loadedWeeks,
    pendingWeeks,
    failedWeeks: failures,
    complete: pendingWeeks.length === 0 && failures.length === 0,
  };
}

export function loadProgressClasses(ctx, session, term, force = false) {
  return cached(ctx, `progressClasses:${term}`, () => getProgressClasses(session, term), force);
}

export function loadProgressXqskzs(ctx, session, term, force = false) {
  // 空结果可能是上游偶发失败，不进 6 小时缓存；失败时回退空字符串（与旧行为一致）。
  return cached(ctx, `progressXqskzs:${term}`, async () => {
    const value = await getProgressXqskzs(session, term);
    if (!value) throw Object.assign(new Error('学期周数暂时不可用'), { status: 502 });
    return value;
  }, force, { ttl: PROGRESS_META_TTL }).catch(() => '');
}

function rememberGridTable(ctx, term, tableId) {
  if (!tableId) return;
  ctx.cache.set(progressTableKey(term), { at: Date.now(), value: tableId });
}

function verifiedGridTable(ctx, term) {
  const entry = ctx.cache.map.get(progressTableKey(term));
  if (!entry) return '';
  return Date.now() - entry.at < PROGRESS_META_TTL ? entry.value : '';
}

/** 表格行缓存：汇总拉过的数据，随后打开编辑明细可直接复用（表单元数据仍现拉）。 */
export function loadProgressRows(ctx, session, term, params, { meta, force = false } = {}) {
  return cached(ctx, progressGridKey(term, params), async () => {
    const result = await getProgressRows(session, term, params, { meta, verifiedTable: verifiedGridTable(ctx, term) });
    if (result.rows.length && result.gridTable) rememberGridTable(ctx, term, result.gridTable);
    return result;
  }, force);
}

export function loadProgressSummary(ctx, session, term, force = false) {
  return cached(ctx, `progressSummary:${term}`, () => getProgressSummary(session, term, {
    loadClasses: () => loadProgressClasses(ctx, session, term),
    loadRows: (item) => loadProgressRows(ctx, session, term, item.params),
    loadProgress: () => cached(ctx, `progress:${term}`, () => getProgress(session, term)),
    loadCourses: () => cached(ctx, `progressCourses:${term}`, () => getProgressCourses(session, term)),
  }), force);
}

export async function loadProgressEntry(ctx, session, term, params, { force = false } = {}) {
  const form = await getProgressEntryForm(session, term, params);
  const { rows, gridTable } = await loadProgressRows(ctx, session, term, params, { meta: form.meta, force });
  const xqskzs = await loadProgressXqskzs(ctx, session, term, force);
  return {
    meta: form.meta,
    formFields: form.formFields,
    rows,
    gridTable,
    xqskzs,
    totals: progressTotals(params),
    xn: form.xn,
    xq: form.xq,
  };
}

/** 保存成功后只失效该学期/班级相关的进度数据与导出，不动课表/任务/成绩（review R05）。 */
export function invalidateProgressAfterSave(ctx, term) {
  ctx.cache.invalidate((key) => (
    key === `progressSummary:${term}` ||
    key === `progress:${term}` ||
    key === `progressClasses:${term}` ||
    key === `progressCourses:${term}` ||
    key === `progressXqskzs:${term}` ||
    key.startsWith(`progressGrid:${term}:`)
  ));
  ctx.exports.invalidate((key) => key.startsWith('exportProgressPdf:') && key.includes(term));
  // 在飞的旧汇总/明细不能在保存后才写回缓存。
  for (const key of [...ctx.inflight.keys()]) {
    if (key === `progressSummary:${term}` || key === `progress:${term}` || key === `progressClasses:${term}` || key.startsWith(`progressGrid:${term}:`)) {
      ctx.inflight.delete(key);
    }
  }
}

/** 不做请求，只看缓存里是否已有本学期课表教师（点名册页眉回退用，review R18）。 */
export function peekScheduleTeacher(ctx, term) {
  const prefix = `scheduleWeek:${term}:`;
  let teacher = '';
  let newest = 0;
  for (const [key, entry] of ctx.cache.entries()) {
    if (!key.startsWith(prefix)) continue;
    const value = entry.value?.teacher;
    if (value && entry.at >= newest) {
      newest = entry.at;
      teacher = value;
    }
  }
  return teacher;
}
