import { memo, useEffect, useMemo, useState } from 'react';
import { api, readApiCache, errorMessage, isUnauthorized } from '../api';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Users } from './Icons';
import { CourseDialog } from './CourseDialog';
import { HeroSection } from './HeroSection';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import {
  DAY_LABELS,
  DEFAULT_TIMES,
  activeDays,
  activeSlots,
  courseColor,
  courseInstancePhase,
  courseTime,
  currentWeekFrom,
  formatMonthDay,
  isCourseActive,
  parseSemesterStart,
  slotPeriod,
  termStart,
  todayIndex,
  weekMondayFrom,
  weeksLabel,
  type ScheduleTimes,
} from '../lib/schedule';
import { useNow } from '../lib/useNow';
import type { Course, ScheduleData } from '../types';

interface WeekScheduleProps {
  userId: string;
  term: string;
  onUnauthorized: () => void;
}

type CoursePhase = 'upcoming' | 'live' | 'past' | 'unknown';

interface LessonCardProps {
  course: Course;
  start: string;
  end: string;
  phase: CoursePhase;
  extraCount: number;
  onClick: () => void;
}

const LessonCard = memo(function LessonCard({ course, start, end, phase, extraCount, onClick }: LessonCardProps) {
  const live = phase === 'live';
  const past = phase === 'past';
  return (
    <button
      className={'lesson' + (live ? ' is-live' : '') + (past ? ' is-past' : '')}
      type="button"
      data-course-color={courseColor(course.name)}
      onClick={onClick}
      aria-label={`${course.name}，${start} 至 ${end}，${course.room || '教室待定'}，${course.clazz || '班级待定'}，${weeksLabel(course)}`}
    >
      {extraCount > 0 && <span className="lesson-more">+{extraCount}</span>}
      <span className="l-top">
        <span className="l-dot" aria-hidden="true" />
        <span className="l-time">
          {start}–{end}
        </span>
        {live && <span className="l-state is-live">进行中</span>}
        {past && <span className="l-state is-past">已结束</span>}
      </span>
      <span className="l-name">{course.name}</span>
      <span className="l-line">
        <MapPin aria-hidden="true" />
        <span>{course.room || '教室待定'}</span>
      </span>
      <span className="l-line">
        <Users aria-hidden="true" />
        <span>
          {course.clazz || '班级待定'}
          {course.count ? ` · ${course.count}人` : ''}
        </span>
      </span>
      <span className="l-line is-muted">
        <CalendarDays aria-hidden="true" />
        <span>{weeksLabel(course)}</span>
      </span>
    </button>
  );
});

export function WeekSchedule({ term, userId, onUnauthorized }: WeekScheduleProps) {
  const cached = readApiCache<ScheduleData>('schedule', term);
  const [data, setData] = useState<ScheduleData | null>(cached ?? null);
  const [loadedTerm, setLoadedTerm] = useState(cached ? term : '');
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [viewWeek, setViewWeek] = useState(() => currentWeekFrom(parseSemesterStart(cached?.semesterStart) ?? termStart(term), cached?.totalWeeks || cached?.maxWeek || 20) ?? 1);
  const [selected, setSelected] = useState<Course[] | null>(null);
  const now = useNow(30000);

  useEffect(() => {
    let cancelled = false;
    const snapshot = readApiCache<ScheduleData>('schedule', term);
    setLoading(!snapshot);
    setData(snapshot ?? null);
    setLoadedTerm(snapshot ? term : '');
    setError('');
    setSelected(null);
    api
      .schedule(term, { refresh: attempt > 0 })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoadedTerm(term);
        const total = payload.totalWeeks || payload.maxWeek || 20;
        const start = parseSemesterStart(payload.semesterStart) ?? termStart(term);
        setViewWeek(currentWeekFrom(start, total) ?? 1);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          onUnauthorized();
          return;
        }
        setData(null);
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, attempt, onUnauthorized]);

  const courses = data?.courses ?? [];
  const times: ScheduleTimes | null = data?.times ?? null;
  const totalWeeks = Math.max(1, data?.totalWeeks || data?.maxWeek || 20);
  const today = todayIndex(now);
  const termStartDate = parseSemesterStart(data?.semesterStart) ?? termStart(term);
  const current = currentWeekFrom(termStartDate, totalWeeks, now);

  const slots = useMemo(() => activeSlots(courses), [courses]);
  const days = useMemo(() => activeDays(courses), [courses]);

  const activeByCell = useMemo(() => {
    const map = new Map<string, Course[]>();
    courses.forEach((course) => {
      if (!isCourseActive(course, viewWeek)) return;
      const key = `${course.day}|${course.slot}`;
      const list = map.get(key);
      if (list) list.push(course);
      else map.set(key, [course]);
    });
    return map;
  }, [courses, viewWeek]);

  const weekCount = useMemo(() => {
    let total = 0;
    activeByCell.forEach((list) => {
      total += list.length;
    });
    return total;
  }, [activeByCell]);

  const monday = weekMondayFrom(termStartDate, viewWeek);
  const range = monday ? `${formatMonthDay(monday)} – ${formatMonthDay(new Date(monday.getTime() + 6 * 86400000))}` : '';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setViewWeek((week) => Math.max(1, week - 1));
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setViewWeek((week) => Math.min(totalWeeks, week + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [totalWeeks]);

  const ready = data !== null && loadedTerm === term;

  if (loading || (!ready && !error)) {
    return (
      <section className="section" aria-busy="true">
        <div className="panel-card">
          <LoadingState message="正在拉取本学期课表…" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="section">
        <div className="panel-card">
          <ErrorState title="课表加载失败" message={error} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      </section>
    );
  }

  return (
    <>
      {(data?.calendarEstimated !== false || data?.timesEstimated !== false) && (
        <p className="notice-bar" role="status">
          {data?.calendarEstimated !== false ? '教学周和日期按估算开学日计算，请按学校校历核对。' : '已使用配置的学校校历。'}
          {data?.timesEstimated !== false && '作息使用默认时间，开课提醒仅供参考。'}
        </p>
      )}
      <HeroSection
        userId={userId}
        teacher={data?.teacher ?? ''}
        xn={data?.xn}
        xq={data?.xq}
        courses={courses}
        times={times}
        semesterStart={termStartDate}
        totalWeeks={totalWeeks}
        current={current}
        viewWeek={viewWeek}
        viewWeekCount={weekCount}
      />

      <section className="section" id="schedule" aria-labelledby="scheduleTitle">
        <div className="section-heading">
          <div>
            <h2 id="scheduleTitle">第 {viewWeek} 周课表</h2>
            <p className="sub">
              {range ? `${range} · ` : ''}
              {data?.teacher ? `${data.teacher} · ` : ''}本周共 {weekCount} 个课次
            </p>
          </div>
          <div className="week-nav" hidden={courses.length === 0}>
            <div className="segmented">
              <button
                className="icon-button"
                type="button"
                aria-label="上一周"
                disabled={viewWeek <= 1}
                onClick={() => setViewWeek((week) => Math.max(1, week - 1))}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <select
                className="week-select"
                aria-label="选择教学周"
                value={viewWeek}
                onChange={(event) => setViewWeek(Number(event.target.value))}
              >
                {Array.from({ length: totalWeeks }, (_, index) => index + 1).map((week) => (
                  <option key={week} value={week}>
                    第 {week} 周{week === current ? ' · 本周' : ''}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                type="button"
                aria-label="下一周"
                disabled={viewWeek >= totalWeeks}
                onClick={() => setViewWeek((week) => Math.min(totalWeeks, week + 1))}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            <button
              className="status-pill"
              type="button"
              disabled={current === null || current === viewWeek}
              title={current === null ? '无法确定当前教学周' : '回到本周'}
              onClick={() => {
                if (current !== null) setViewWeek(current);
              }}
            >
              {current === viewWeek ? '当前周' : '回到本周'}
            </button>
          </div>
        </div>

        <div className="panel-card">
          {courses.length === 0 && (
            <EmptyState
              title="本学期还没有课表数据"
              message="教务系统未返回任何课程记录。"
              hint="可在顶部切换到其他学期试试，或稍后重新加载。"
              action={
                <button className="kbtn ghost" type="button" onClick={() => setAttempt((value) => value + 1)}>
                  重新加载
                </button>
              }
            />
          )}

          {courses.length > 0 && weekCount === 0 && (
            <EmptyState title="这一周没有课程安排" message="切换周次可查看其他教学周。" />
          )}

          {weekCount > 0 && (
            <>
              <p className="visually-hidden" id="gridHint">
                左右滑动查看完整一周 · 点按课程可查看详情
              </p>
              <div className="gridwrap" tabIndex={0} role="region" aria-label="每周课表，可左右滚动" aria-describedby="gridHint">
                <table className="grid">
                  <caption className="visually-hidden">
                    第 {viewWeek} 周课表{range ? `，${range}` : ''}
                  </caption>
                  <thead>
                    <tr>
                      <th className="cell-time" aria-label="节次" />
                      {days.map((day) => {
                        const isToday = day === today && viewWeek === current;
                        const dayDate = monday ? new Date(monday.getTime() + (day - 1) * 86400000) : null;
                        return (
                          <th key={day} className={'cell-day' + (isToday ? ' is-today' : '')}>
                            <b>{DAY_LABELS[day]}</b>
                            <span>
                              {dayDate ? formatMonthDay(dayDate) : ''}
                              {isToday ? ' · 今天' : ''}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot) => {
                      const slotTime = times?.[slot] ?? DEFAULT_TIMES[slot];
                      return (
                        <tr key={slot}>
                          <th className="cell-time" scope="row">
                            <b>第 {slot} 节</b>
                            <span>
                              {slotPeriod(slot)}
                              {slotTime ? ` · ${slotTime[0]}–${slotTime[1]}` : ''}
                            </span>
                          </th>
                          {days.map((day) => {
                            const cellCourses = activeByCell.get(`${day}|${slot}`) ?? [];
                            const isTodayColumn = day === today && viewWeek === current;
                            if (cellCourses.length === 0) {
                              return <td key={day} className={'gc' + (isTodayColumn ? ' is-today-col' : '')} />;
                            }
                            const primary = cellCourses[0];
                            const [start, end] = courseTime(primary, times);
                            const phase = courseInstancePhase(primary, viewWeek, termStartDate, times, now);
                            return (
                              <td key={day} className={'gc has-class' + (isTodayColumn ? ' is-today-col' : '')}>
                                <LessonCard
                                  course={primary}
                                  start={start}
                                  end={end}
                                  phase={phase}
                                  extraCount={cellCourses.length - 1}
                                  onClick={() => setSelected(cellCourses)}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="legend" aria-hidden="true">
                <span className="legend-item">
                  <span className="legend-dot is-live" /> 进行中
                </span>
                <span className="legend-item">
                  <span className="legend-dot is-past" /> 已结束
                </span>
                <span className="legend-hint">左右滑动查看完整一周 · 点按课程可查看详情 · 键盘 ← → 可切换周次</span>
              </div>
            </>
          )}
        </div>

        <CourseDialog courses={selected} times={times} onClose={() => setSelected(null)} />
      </section>
    </>
  );
}
