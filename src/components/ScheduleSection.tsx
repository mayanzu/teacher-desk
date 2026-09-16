import { addDays } from 'date-fns';
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DAY_NAMES } from '../data/defaults';
import { currentWeekNumber, formatMonthDay, weekMonday } from '../lib/date';
import { courseInstance, courseTime, coursesForCell } from '../lib/schedule';
import type { BuildingTimes, Course, ScheduleMeta, ScheduleTimes } from '../types/schedule';
import { LessonCard } from './LessonCard';

interface ScheduleSectionProps {
  meta: ScheduleMeta;
  courses: Course[];
  viewWeek: number;
  now: Date;
  times: ScheduleTimes;
  buildingTimes: BuildingTimes;
  onWeekChange: (week: number) => void;
  onToday: () => void;
  onSelectCourses: (courses: Course[]) => void;
}

export function ScheduleSection({
  meta,
  courses,
  viewWeek,
  now,
  times,
  buildingTimes,
  onWeekChange,
  onToday,
  onSelectCourses,
}: ScheduleSectionProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector('dialog[open]')) return;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"], .gridwrap')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onWeekChange(Math.min(meta.totalWeeks, Math.max(1, viewWeek + (event.key === 'ArrowLeft' ? -1 : 1))));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [meta.totalWeeks, onWeekChange, viewWeek]);
  const currentWeek = currentWeekNumber(meta.semesterStart, meta.totalWeeks, now);
  const today = now.getDay() || 7;
  const slots = ['1-2', '3-4', '5-6', '7-8', ...(courses.some((course) => /^(9|11)-/.test(course.slot)) ? ['9-10', '11-12'] : [])];
  const days = [1, 2, 3, 4, 5, ...(courses.some((course) => course.day >= 6) ? [6] : []), ...(courses.some((course) => course.day === 7) ? [7] : [])];
  const monday = weekMonday(meta.semesterStart, viewWeek);
  const range = `${formatMonthDay(monday)} – ${formatMonthDay(addDays(monday, 6))}`;
  const weekCount = courses.filter((course) => {
    const active = coursesForCell(courses, course.day, course.slot, viewWeek, meta.totalWeeks);
    return active.some((item) => item === course);
  }).length;
  const todayCount = courses.filter((course) => course.day === today && coursesForCell(courses, course.day, course.slot, viewWeek, meta.totalWeeks).includes(course)).length;

  return (
    <section className="section" id="schedule" aria-labelledby="scheduleTitle">
      <div className="section-heading reveal is-in">
        <div>
          <h2 id="scheduleTitle">第 {viewWeek} 周课表</h2>
          <p className="sub">{range} · 共 {weekCount} 个课次</p>
        </div>
        <div className="week-nav">
          <div className="segmented">
            <button className="icon-button" type="button" aria-label="上一周" disabled={viewWeek <= 1} onClick={() => onWeekChange(viewWeek - 1)}><ChevronLeft /></button>
            <span className="week-readout">第 {viewWeek} / {meta.totalWeeks} 周</span>
            <button className="icon-button" type="button" aria-label="下一周" disabled={viewWeek >= meta.totalWeeks} onClick={() => onWeekChange(viewWeek + 1)}><ChevronRight /></button>
          </div>
          <button className="status-pill" type="button" onClick={onToday}>{currentWeek === viewWeek ? `今天 ${todayCount} 门` : '回到本周'}</button>
        </div>
      </div>

      <div className="panel-card reveal is-in">
        {weekCount === 0 && <div className="schedule-empty" role="status"><strong>{courses.length ? '这一周没有课程安排' : '你的课表，从这里开始'}</strong><p>{courses.length ? '可切换周次查看其他教学安排。' : '使用上方扫码同步或粘贴导入，添加你的第一份课表。'}</p></div>}
        <div className="gridwrap" tabIndex={0} role="region" aria-label="每周课表，可左右滚动" aria-describedby="gridHint">
          <table className="grid">
            <caption className="visually-hidden">第 {viewWeek} 周课表，{range}</caption>
            <thead>
              <tr>
                <th className="cell-time" aria-label="节次" />
                {days.map((day) => {
                  const isToday = day === today && viewWeek === currentWeek;
                  return (
                    <th key={day} className={'cell-day' + (isToday ? ' is-today' : '')}>
                      <b>{DAY_NAMES[day]}</b>
                      <span>{formatMonthDay(addDays(monday, day - 1))}{isToday ? ' · 今天' : ''}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot}>
                  <th className="cell-time" scope="row">
                    <b>第 {slot} 节</b>
                    <span>{/^(1|3)/.test(slot) ? '上午' : /^(5|7)/.test(slot) ? '下午' : '晚上'}</span>
                  </th>
                  {days.map((day) => {
                    const cellCourses = coursesForCell(courses, day, slot, viewWeek, meta.totalWeeks);
                    const isTodayColumn = day === today && viewWeek === currentWeek;
                    if (!cellCourses.length) {
                      return <td key={day} className={'gc' + (isTodayColumn ? ' is-today-col' : '')} />;
                    }
                    const first = cellCourses[0];
                    const instance = courseInstance(first, viewWeek, meta.semesterStart, times, buildingTimes);
                    const [start, end] = courseTime(first, times, buildingTimes);
                    const live = now >= instance.start && now <= instance.end && viewWeek === currentWeek;
                    const past = now > instance.end && viewWeek === currentWeek;
                    return (
                      <td key={day} className={'gc has-class' + (isTodayColumn ? ' is-today-col' : '')}>
                        <LessonCard course={first} start={start} end={end} live={live} past={past} extraCount={cellCourses.length - 1} onClick={() => onSelectCourses(cellCourses)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="grid-hint" id="gridHint">左右滑动查看完整一周 · 点按课程可查看详情</p>
      </div>
    </section>
  );
}
