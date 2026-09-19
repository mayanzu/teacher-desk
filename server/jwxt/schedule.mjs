import { clean, parseTerm, parseWeekLessonBlock, DEFAULT_TIMES, requirePage } from './common.mjs';
import { fetchConcurrency, mapWithConcurrency } from './concurrency.mjs';

/**
 * 校历/作息解析：与课表周次解耦，可单独用于计算默认显示周。
 */
export function scheduleCalendar(term, { totalWeeks = 20 } = {}) {
  const { xn, xq } = parseTerm(term);
  let calendar;
  try { calendar = JSON.parse(process.env.JWXT_CALENDAR || '{}')[term]; }
  catch { throw new Error('JWXT_CALENDAR 必须是有效 JSON'); }
  const configuredDate = calendar?.semesterStart;
  if (configuredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(configuredDate) ||
      !Number.isFinite(Date.parse(configuredDate)) || new Date(configuredDate).toISOString().slice(0, 10) !== configuredDate ||
      new Date(configuredDate).getUTCDay() !== 1)) {
    throw new Error('校历 semesterStart 必须是有效的首周周一日期（YYYY-MM-DD）');
  }
  const times = { ...DEFAULT_TIMES, ...calendar?.times };
  if (Object.values(times).some((pair) => !Array.isArray(pair) || pair.length !== 2 ||
      pair.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) throw new Error('校历作息时间格式无效');
  const semesterStart = configuredDate || guessSemesterStart(xn, xq);
  return {
    xn,
    xq,
    term,
    totalWeeks,
    semesterStart,
    calendarEstimated: !configuredDate,
    timesEstimated: Object.keys(DEFAULT_TIMES).some((slot) => !calendar?.times?.[slot]),
    times,
  };
}

export function guessSemesterStart(xn, xq) {
  const year = xq === 0 ? xn : xn + 1;
  const month = xq === 0 ? 8 : 1;
  const date = new Date(Date.UTC(year, month, 1));
  const day = date.getUTCDay();
  // 取该日期所在周的周一（与前端 termStart 保持一致）
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** 默认展示周：已开学取当前周；未开学或已结束（超出总周数）回到第 1 周（与前端 currentWeekFrom 一致）。 */
export function defaultScheduleWeek(calendar, now = new Date()) {
  const start = Date.parse(`${calendar.semesterStart}T00:00:00Z`);
  if (!Number.isFinite(start)) return 1;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((today - start) / 86400000);
  if (diffDays < 0) return 1;
  const week = Math.floor(diffDays / 7) + 1;
  if (week > calendar.totalWeeks) return 1;
  return week;
}

/** 当前周 ±1，用于首个分段请求（review R02）。 */
export function defaultScheduleWeeks(calendar, now = new Date()) {
  const week = defaultScheduleWeek(calendar, now);
  const weeks = new Set([week]);
  if (week > 1) weeks.add(week - 1);
  if (week < calendar.totalWeeks) weeks.add(week + 1);
  return [...weeks].sort((a, b) => a - b);
}

/**
 * 拉取并解析单周课表。同一门课会在多个周页面重复出现，聚合时再按业务键去重。
 */
export async function fetchScheduleWeek(session, term, week) {
  const { xn, xq } = parseTerm(term);
  const res = await session.text(`/ahsljw/frame/desk/showLessonScheduleInfosV14.action?xn=${xn}&xq=${xq}&jxz=${week}`, { method: 'GET' });
  requirePage(res, /weeklesson|weekly0|星期|暂无|没有|无课/i, '课表');
  const blocks = res.text.match(/<div(?=[^>]*class="[^"]*weeklesson)[^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi) || [];
  const courses = [];
  let teacher = '';
  for (const block of blocks) {
    const course = parseWeekLessonBlock(block);
    if (!course) continue;
    if (!teacher) {
      const t = block.match(/任课教师\s*[：:]\s*(?:<b>)?([^<\n|｜]{1,40})/)?.[1];
      if (t) teacher = clean(t);
    }
    courses.push(course);
  }
  return { week, courses, teacher };
}

/** 把已加载周次聚合成与旧接口兼容的课表数据。 */
export function aggregateSchedule(calendar, weeks) {
  const loadedWeeks = [...weeks.keys()].filter((week) => Number.isInteger(week) && week > 0).sort((a, b) => a - b);
  const seen = new Map();
  let teacher = '';
  for (const week of loadedWeeks) {
    const record = weeks.get(week);
    if (!record) continue;
    if (!teacher && record.teacher) teacher = record.teacher;
    for (const course of record.courses || []) {
      const key = [course.day, course.slot, course.name, course.weeks, course.parity, course.room, course.clazz].join('|');
      if (!seen.has(key)) seen.set(key, course);
    }
  }
  const courses = [...seen.values()];
  const maxWeek = courses.reduce((max, course) => {
    const nums = course.weeks.match(/\d+/g) || [];
    return Math.max(max, ...nums.map(Number), 0);
  }, 0);
  return {
    xn: calendar.xn,
    xq: calendar.xq,
    term: calendar.term,
    teacher,
    courses,
    maxWeek,
    totalWeeks: Math.max(calendar.totalWeeks, maxWeek),
    semesterStart: calendar.semesterStart,
    calendarEstimated: calendar.calendarEstimated,
    timesEstimated: calendar.timesEstimated,
    times: calendar.times,
  };
}

/**
 * 整学期课表：滚动队列拉取全部周次，全部成功才返回（保持旧接口的“完整”语义）。
 * 后台分段加载走 loadScheduleView（server/data.mjs），命中同一份按周缓存。
 */
export async function getSchedule(session, term, { totalWeeks = 20 } = {}) {
  const calendar = scheduleCalendar(term, { totalWeeks });
  const weeks = new Map();
  const numbers = Array.from({ length: totalWeeks }, (_, index) => index + 1);
  await mapWithConcurrency(numbers, fetchConcurrency(), async (week) => {
    weeks.set(week, await fetchScheduleWeek(session, term, week));
  });
  return {
    ...aggregateSchedule(calendar, weeks),
    loadedWeeks: numbers,
    pendingWeeks: [],
    failedWeeks: [],
  };
}
