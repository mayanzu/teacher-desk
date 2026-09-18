import type { ReactNode } from 'react';
import { useNow } from '../lib/useNow';
import {
  DAY_LABELS,
  daysUntil,
  formatMonthDay,
  formatWeekRange,
  isCourseActive,
  nextCourseInstance,
  semesterLabel,
  semesterPhase,
  todayIndex,
  type ScheduleTimes,
} from '../lib/schedule';
import { MemoPanel } from './MemoPanel';
import { NextClassPanel } from './NextClassPanel';
import type { Course } from '../types';

interface HeroSectionProps {
  teacher: string;
  xn?: number;
  xq?: number;
  courses: Course[];
  times?: ScheduleTimes | null;
  semesterStart: Date | null;
  totalWeeks: number;
  current: number | null;
  viewWeek: number;
  viewWeekCount: number;
}

export function HeroSection({
  teacher,
  xn,
  xq,
  courses,
  times,
  semesterStart,
  totalWeeks,
  current,
  viewWeek,
  viewWeekCount,
}: HeroSectionProps) {
  const now = useNow(1000);
  const next = nextCourseInstance(courses, semesterStart, totalWeeks, current, times, now);
  const today = todayIndex(now);
  const phase = semesterPhase(semesterStart, totalWeeks, now);
  const weekRange = current !== null ? formatWeekRange(semesterStart, current) : formatWeekRange(semesterStart, viewWeek);

  const todayCount =
    current === null ? 0 : courses.filter((course) => course.day === today && isCourseActive(course, current)).length;
  const courseCount = new Set(courses.map((course) => course.name)).size;

  let title: ReactNode = '课表';
  let description = '尚未确定学期起始日期，暂时无法推算教学周。';
  if (current !== null) {
    title = (
      <>
        第 <span>{current}</span> 周
      </>
    );
    description = weekRange;
  } else if (semesterStart && phase === 'before') {
    const remain = daysUntil(semesterStart, now);
    title = '未开学';
    description = `学期将于 ${formatMonthDay(semesterStart)} 开始${remain && remain > 0 ? `（还有 ${remain} 天）` : ''}`;
  } else if (semesterStart && phase === 'after') {
    title = '已结课';
    description = `本学期共 ${totalWeeks} 周，课程已全部结束。`;
  }

  const termLabel = semesterLabel(xn, xq) || '安排每一周，从容上好每一课';

  return (
    <section
      className={'hero comic-dashboard' + (courses.length === 0 ? ' is-empty' : '')}
      id="top"
      aria-labelledby="heroTitle"
    >
      <div className="hero-copy">
        <p className="comic-kicker">TEACHING PLANNER / 教学手账</p>
        <p className="eyebrow">{termLabel}</p>
        <h1 id="heroTitle">{title}</h1>
        <p className="hero-description">{description}</p>

        <div className="hero-tags">
          {teacher && (
            <span className="teacher-chip">
              <span className="teacher-avatar" aria-hidden="true">
                {[...teacher][0]}
              </span>
              <span className="teacher-info">
                <span className="tc-label">任课教师</span>
                <span className="tc-name">{teacher}</span>
              </span>
            </span>
          )}
          <span className="hero-fact">
            <b>{courseCount}</b> 门课程
          </span>
          <span className="hero-fact">
            <b>{totalWeeks}</b> 教学周
          </span>
        </div>
      </div>

      {courses.length > 0 && (
        <NextClassPanel
          next={next}
          now={now}
          todayLabel={DAY_LABELS[today]}
          todayCount={todayCount}
          viewWeek={viewWeek}
          viewWeekCount={viewWeekCount}
          weekRange={formatWeekRange(semesterStart, viewWeek)}
          current={current}
          totalWeeks={totalWeeks}
        />
      )}

      <MemoPanel />
    </section>
  );
}
