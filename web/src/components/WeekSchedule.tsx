import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { api, readApiCache, readApiCacheEntry, errorMessage, isUnauthorized } from '../api';
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
import { QUERY_TTL_MS } from '../lib/queryCache';
import { useRefreshRequest, useRefreshConsumer } from '../lib/useRefreshRequest';
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
  const initial =
    readApiCache<ScheduleData>('schedule', term) ?? readApiCache<ScheduleData>('schedule/partial', term) ?? null;
  const [data, setData] = useState<ScheduleData | null>(initial);
  const [loadedTerm, setLoadedTerm] = useState(initial ? term : '');
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [viewWeek, setViewWeek] = useState(() => currentWeekFrom(parseSemesterStart(initial?.semesterStart) ?? termStart(term), initial?.totalWeeks || initial?.maxWeek || 20) ?? 1);
  const [selected, setSelected] = useState<Course[] | null>(null);
  const now = useNow(30000);
  const { token: refreshToken, requestRefresh } = useRefreshRequest(term);
  const { forceFor } = useRefreshConsumer();
  const appliedTerm = useRef('');

  useEffect(() => {
    let cancelled = false;
    const force = forceFor(refreshToken);
    const fullEntry = readApiCacheEntry<ScheduleData>('schedule', term);
    const partialEntry = readApiCacheEntry<ScheduleData>('schedule/partial', term);
    const snapshot = fullEntry?.value ?? partialEntry?.value ?? null;
    const freshFull = Boolean(fullEntry && Date.now() - fullEntry.at < QUERY_TTL_MS);
    const freshPartial = Boolean(
      partialEntry && Date.now() - partialEntry.at < QUERY_TTL_MS && (partialEntry.value.pendingWeeks?.length ?? 0) === 0,
    );

    const apply = (payload: ScheduleData) => {
      setData(payload);
      setLoadedTerm(term);
      if (appliedTerm.current !== term) {
        appliedTerm.current = term;
        const total = payload.totalWeeks || payload.maxWeek || 20;
        const start = parseSemesterStart(payload.semesterStart) ?? termStart(term);
        setViewWeek(currentWeekFrom(start, total) ?? 1);
      }
    };

    const sameTerm = appliedTerm.current === term;
    if (snapshot) {
      apply(snapshot);
      setLoading(false);
    } else if (!sameTerm) {
      // 切到没有缓存的学期：清掉旧学期数据，避免串味
      setData(null);
      setLoadedTerm('');
      setLoading(true);
    }
    setSelected(null);
    setError('');
    setWarning('');
    if (!force && (freshFull || freshPartial)) {
      // 新鲜缓存：0 个网络请求（review R06 验收）
      return () => { cancelled = true; };
    }

    void (async () => {
      try {
        // 1) 快速路径：当前周 ±1，先让首屏可用
        const first = await api.schedulePartial(term, { refresh: force });
        if (cancelled) return;
        apply(first);
        setLoading(false);
        // 2) 后台补齐其余周次（低优先级），补齐失败只提示、不隐藏已显示内容
        const pending = first.pendingWeeks ?? [];
        if (pending.length) {
          try {
            const rest = await api.schedulePartial(term, { weeks: pending, prefetch: true });
            if (!cancelled) apply(rest);
          } catch (err) {
            if (!cancelled && !isUnauthorized(err)) {
              setWarning(`其余周次暂未加载完（${errorMessage(err)}），当前显示的是已加载部分。`);
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          onUnauthorized();
          return;
        }
        setLoading(false);
        if (snapshot || data) setWarning(`刷新失败（${errorMessage(err)}），正在显示缓存内容。`);
        else setError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [term, refreshToken, onUnauthorized, forceFor]);

  const courses = data?.courses ?? [];
  const times: ScheduleTimes | null = data?.times ?? null;
  const totalWeeks = Math.max(1, data?.totalWeeks || data?.maxWeek || 20);
  const today = todayIndex(now);
  const termStartDate = parseSemesterStart(data?.semesterStart) ?? termStart(term);
  const current = currentWeekFrom(termStartDate, totalWeeks, now);
  const pendingWeeks = data?.pendingWeeks ?? [];
  const failedWeeks = data?.failedWeeks ?? [];

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

  if (loading || (!ready && !error && !warning)) {
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
          <ErrorState title="课表加载失败" message={error} onRetry={requestRefresh} />
        </div>
      </section>
    );
  }

  return (
    <>
      {warning && (
        <p className="notice-bar is-warn" role="status">
          <b>注意</b>
          {warning}
          <button className="kbtn ghost" type="button" onClick={requestRefresh}>
            重试
          </button>
        </p>
      )}
      {data?.calendarEstimated !== false || data?.timesEstimated !== false ? (
        <p className="notice-bar" role="status">
          {data?.calendarEstimated !== false ? '教学周和日期按估算开学日计算，请按学校校历核对。' : '已使用配置的学校校历。'}
          {data?.timesEstimated !== false && '作息使用默认时间，开课提醒仅供参考。'}
        </p>
      ) : null}
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

        {pendingWeeks.length > 0 && (
          <p className="notice-bar" role="status">
            正在后台补齐其余 {pendingWeeks.length} 个教学周，当前显示的是已加载部分（已加载 {data?.loadedWeeks?.length ?? 0} 周）。
          </p>
        )}
        {failedWeeks.length > 0 && (
          <p className="notice-bar is-warn" role="status">
            <b>部分周次未加载</b>
            第 {failedWeeks.map((item) => item.week).join('、')} 周暂时读取失败，其余内容不受影响。
            <button className="kbtn ghost" type="button" onClick={requestRefresh}>
              重试
            </button>
          </p>
        )}

        <div className="panel-card">
          {courses.length === 0 && pendingWeeks.length > 0 && (
            <LoadingState message={`已加载 ${data?.loadedWeeks?.length ?? 0} 周，正在读取剩余教学周…`} />
          )}

          {courses.length === 0 && pendingWeeks.length === 0 && (
            <EmptyState
              title="本学期还没有课表数据"
              message="教务系统未返回任何课程记录。"
              hint="可在顶部切换到其他学期试试，或稍后重新加载。"
              action={
                <button className="kbtn ghost" type="button" onClick={requestRefresh}>
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
