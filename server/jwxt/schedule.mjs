import { clean, parseTerm, parseWeekLessonBlock, DEFAULT_TIMES } from './common.mjs';

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
  const semesterStart = guessSemesterStart(xn, xq);
  return { xn, xq, term, teacher, courses, maxWeek, totalWeeks: total, semesterStart, times: DEFAULT_TIMES };
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
