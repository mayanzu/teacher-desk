import { addDays } from 'date-fns';
import { memo, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DAY_NAMES } from '../data/defaults';
import { currentWeekNumber, formatMonthDay, weekMonday } from '../lib/date';
import { courseInstance, courseTime, isCourseActive } from '../lib/schedule';
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
  onImport: () => void;
  onSelectCourses: (courses: Course[]) => void;
}

export const ScheduleSection = memo(function ScheduleSection({
  meta,
  courses,
  viewWeek,
  now,
  times,
  buildingTimes,
  onWeekChange,
  onToday,
  onImport,
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

  const courseSlots = useMemo(() => new Set(courses.map((course) => course.slot)), [courses]);
  const slots = useMemo(() => {
    const base = ['1-2', '3-4', '5-6', '7-8'];
    const night = ['9-10', '11-12'].filter((slot) => courseSlots.has(slot));
    return [...base, ...night];
  }, [courseSlots]);

  const days = useMemo(() => {
    const present = new Set(courses.map((course) => course.day));
    return [1, 2, 3, 4, 5, ...(present.has(6) ? [6] : []), ...(present.has(7) ? [7] : [])];
  }, [courses]);

  const activeByCell = useMemo(() => {
    const map = new Map<string, Course[]>();
    courses.forEach((course) => {
      if (!isCourseActive(course, viewWeek, meta.totalWeeks)) return;
      const key = `${course.day}|${course.slot}`;
      const list = map.get(key);
      if (list) list.push(course);
      else map.set(key, [course]);
    });
    return map;
  }, [courses, meta.totalWeeks, viewWeek]);

  const weekCount = useMemo(() => {
    let total = 0;
    activeByCell.forEach((list) => { total += list.length; });
    return total;
  }, [activeByCell]);

  const grid = useMemo(() => slots.map((slot) => ({
    slot,
    cells: days.map((day) => {
      const cellCourses = activeByCell.get(`${day}|${slot}`) ?? [];
      if (!cellCourses.length) return null;
      const first = cellCourses[0];
      return {
        courses: cellCourses,
        instance: courseInstance(first, viewWeek, meta.semesterStart, times, buildingTimes),
        time: courseTime(first, times, buildingTimes),
      };
    }),
  })), [activeByCell, buildingTimes, days, meta.semesterStart, slots, times, viewWeek]);

  const monday = weekMonday(meta.semesterStart, viewWeek);
  const range = `${formatMonthDay(monday)} – ${formatMonthDay(addDays(monday, 6))}`;

  return (
    <section className="section" id="schedule" aria-labelledby="scheduleTitle">
      <div className="section-heading reveal is-in">
        <div>
          <h2 id="scheduleTitle">第 {viewWeek} 周课表</h2>
          <p className="sub">{range} · 共 {weekCount} 个课次</p>
        </div>
        <div className="week-nav" hidden={!courses.length}>
          <div className="segmented">
            <button className="icon-button" type="button" aria-label="上一周" disabled={viewWeek <= 1} onClick={() => onWeekChange(viewWeek - 1)}><ChevronLeft /></button>
            <select className="week-select" aria-label="选择教学周" value={viewWeek} onChange={(event) => onWeekChange(Number(event.target.value))}>{Array.from({ length: meta.totalWeeks }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 周{index + 1 === currentWeek ? " · 本周" : ""}</option>)}</select>
            <button className="icon-button" type="button" aria-label="下一周" disabled={viewWeek >= meta.totalWeeks} onClick={() => onWeekChange(viewWeek + 1)}><ChevronRight /></button>
          </div>
          <button className="status-pill" type="button" disabled={currentWeek === viewWeek} onClick={onToday}>{currentWeek === viewWeek ? '当前周' : '回到本周'}</button>
        </div>
      </div>

      <div className="panel-card reveal is-in">
        {weekCount === 0 && <div className="schedule-empty" role="status"><strong>{courses.length ? '这一周没有课程安排' : '你的课表，从这里开始'}</strong><p>{courses.length ? '可切换周次查看其他教学安排。' : '点击顶部「导入课表」，选择扫码或粘贴导入。'}</p>{!courses.length && <button className="button primary" type="button" onClick={onImport}>导入课表</button>}</div>}
        {weekCount > 0 && <><p className="visually-hidden" id="gridHint">左右滑动查看完整一周 · 点按课程可查看详情</p><div className="gridwrap" tabIndex={0} role="region" aria-label="每周课表，可左右滚动" aria-describedby="gridHint">
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
              {grid.map(({ slot, cells }) => (
                <tr key={slot}>
                  <th className="cell-time" scope="row">
                    <b>第 {slot} 节</b>
                    <span>{/^(1|3)/.test(slot) ? '上午' : /^(5|7)/.test(slot) ? '下午' : '晚上'}</span>
                  </th>
                  {cells.map((cell, index) => {
                    const day = days[index];
                    const isTodayColumn = day === today && viewWeek === currentWeek;
                    if (!cell) {
                      return <td key={day} className={'gc' + (isTodayColumn ? ' is-today-col' : '')} />;
                    }
                    const [start, end] = cell.time;
                    const live = now >= cell.instance.start && now <= cell.instance.end && viewWeek === currentWeek;
                    const past = now > cell.instance.end && viewWeek === currentWeek;
                    return (
                      <td key={day} className={'gc has-class' + (isTodayColumn ? ' is-today-col' : '')}>
                        <LessonCard course={cell.courses[0]} start={start} end={end} live={live} past={past} extraCount={cell.courses.length - 1} onClick={() => onSelectCourses(cell.courses)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="grid-hint">左右滑动查看完整一周 · 点按课程可查看详情</p></>}
      </div>
    </section>
  );
});
