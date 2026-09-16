import { memo } from 'react';
import { MapPin, Users } from 'lucide-react';
import type { Course } from '../types/schedule';

interface LessonCardProps {
  course: Course;
  start: string;
  end: string;
  live: boolean;
  past: boolean;
  extraCount: number;
  onClick: () => void;
}

export const LessonCard = memo(function LessonCard({ course, start, end, live, past, extraCount, onClick }: LessonCardProps) {
  const label = [course.name, `${start} 至 ${end}`, course.room, extraCount > 0 ? `另有 ${extraCount} 个课次` : '']
    .filter(Boolean)
    .join('，');
  return (
    <button
      className={'lesson' + (live ? ' is-live' : '') + (past ? ' is-past' : '')}
      data-course-color={Array.from(course.name.trim()).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 6, 0)}
      type="button"
      onClick={onClick}
      aria-label={label}
    >
      {live && <span className="l-live">进行中</span>}
      {extraCount > 0 && <span className="lesson-more">+{extraCount}</span>}
      <span className="l-top">
        <span className="l-dot" aria-hidden="true" />
        <span className="l-time">{start}–{end}</span>
      </span>
      <span className="l-name">{course.name}</span>
      <span className="l-line"><MapPin aria-hidden="true" /><span>{course.room || '教室待定'}</span></span>
      <span className="l-line is-muted"><Users aria-hidden="true" /><span>{course.clazz || '班级待定'}{course.count ? ` · ${course.count} 人` : ''}</span></span>
    </button>
  );
});
