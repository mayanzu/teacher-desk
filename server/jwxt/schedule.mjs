import { clean, parseTerm, parseWeekLessonBlock, DEFAULT_TIMES, requirePage } from './common.mjs';

export async function getSchedule(session, term, { totalWeeks = 20 } = {}) {
  const { xn, xq } = parseTerm(term);
  const seen = new Map();
  let teacher = session.username ? '' : '';
  const batches = [];
  for (let start = 1; start <= totalWeeks; start += 5) batches.push(start);
  for (const start of batches) {
    const weeks = Array.from({ length: Math.min(5, totalWeeks - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(
      weeks.map((week) =>
        session.text(`/ahsljw/frame/desk/showLessonScheduleInfosV14.action?xn=${xn}&xq=${xq}&jxz=${week}`, { method: 'GET' }),
      ),
    );
    for (const res of results) {
      requirePage(res, /weeklesson|weekly0|星期|暂无|没有|无课/i, '课表');
      const blocks = res.text.match(/<div(?=[^>]*class="[^"]*weeklesson)[^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi) || [];
      for (const block of blocks) {
        const course = parseWeekLessonBlock(block);
        if (!course) continue;
        const key = [course.day, course.slot, course.name, course.weeks, course.parity, course.room, course.clazz].join('|');
        if (seen.has(key)) continue;
        if (!teacher) {
          const t = block.match(/任课教师\s*[：:]\s*(?:<b>)?([^<\n|｜]{1,40})/)?.[1];
          if (t) teacher = clean(t);
        }
        seen.set(key, course);
      }
    }
  }
  const courses = [...seen.values()];
  const maxWeek = courses.reduce((max, course) => {
    const nums = course.weeks.match(/\d+/g) || [];
    return Math.max(max, ...nums.map(Number), 0);
  }, 0);
  const total = Math.max(totalWeeks, maxWeek);
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
  return { xn, xq, term, teacher, courses, maxWeek, totalWeeks: total, semesterStart, calendarEstimated: !configuredDate, timesEstimated: Object.keys(DEFAULT_TIMES).some((slot) => !calendar?.times?.[slot]), times };
}

function guessSemesterStart(xn, xq) {
  const year = xq === 0 ? xn : xn + 1;
  const month = xq === 0 ? 8 : 1;
  const date = new Date(Date.UTC(year, month, 1));
  const day = date.getUTCDay();
  // 取该日期所在周的周一（与前端 termStart 保持一致）
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
