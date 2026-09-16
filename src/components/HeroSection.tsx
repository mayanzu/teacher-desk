import { ArrowDown } from 'lucide-react';
import type { CourseInstance, ScheduleMeta } from '../types/schedule';
import { formatWeekRange } from '../lib/date';
import { TeacherSwitcher } from './TeacherSwitcher';
import { NextClassPanel } from './NextClassPanel';

interface HeroSectionProps {
  meta: ScheduleMeta;
  week: number;
  now: Date;
  next: CourseInstance | null;
  todayCount: number;
  weekCount: number;
  hasCourses: boolean;
  onOpenTeacherManager: () => void;
}

export function HeroSection({ meta, week, now, next, todayCount, weekCount, hasCourses, onOpenTeacherManager }: HeroSectionProps) {
  return (
    <section className={"hero comic-dashboard" + (!hasCourses ? " is-empty" : "")} id="top" aria-labelledby="pageTitle">
      <div className="hero-copy reveal is-in">
        <p className="comic-kicker">TEACHING PLANNER / 教学手账</p>
        <p className="eyebrow">{[meta.semesterLabel, meta.department].filter(Boolean).join(' · ') || '安排每一周，从容上好每一课'}</p>
        <h1 id="pageTitle">第 <span>{week}</span> 周</h1>
        <p className="hero-description">{formatWeekRange(meta.semesterStart, week)}</p>
        <TeacherSwitcher teacher={meta.teacher} onOpen={onOpenTeacherManager} />
        <a className="schedule-jump" href="#schedule">查看周课表 <ArrowDown aria-hidden="true" /></a>
      </div>
      {hasCourses && <NextClassPanel next={next} now={now} todayCount={todayCount} weekCount={weekCount} weekRange={formatWeekRange(meta.semesterStart, week)} />}
    </section>
  );
}

