import { ClipboardPaste, QrCode } from 'lucide-react';
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
  onOpenTeacherManager: () => void;
  onOpenAcademicSync: () => void;
  onOpenPasteImport: () => void;
}

export function HeroSection({
  meta,
  week,
  now,
  next,
  todayCount,
  weekCount,
  onOpenTeacherManager,
  onOpenAcademicSync,
  onOpenPasteImport,
}: HeroSectionProps) {
  const range = week ? formatWeekRange(meta.semesterStart, week) : '—';
  return (
    <section className="hero" id="top" aria-labelledby="pageTitle">
      <div className="hero-copy reveal is-in">
        <p className="eyebrow">{[meta.semesterLabel, meta.department, meta.teacher].filter(Boolean).join(' · ')}</p>
        <h1 id="pageTitle">第 <span>{week}</span> 周</h1>
        <p className="hero-description">{range}</p>
        <TeacherSwitcher teacher={meta.teacher} onOpen={onOpenTeacherManager} />
        <button className="paste-cta" type="button" onClick={onOpenAcademicSync}>
          <QrCode aria-hidden="true" />
          扫码同步教务课表
        </button>
        <button className="paste-secondary" type="button" onClick={onOpenPasteImport}>
          <ClipboardPaste aria-hidden="true" />
          粘贴课表作为备用
        </button>
      </div>
      <NextClassPanel next={next} now={now} todayCount={todayCount} weekCount={weekCount} weekRange={range} />
    </section>
  );
}
