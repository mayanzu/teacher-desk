import { useEffect, useRef } from 'react';
import { CalendarDays, Clock3, MapPin, Users, XIcon } from './Icons';
import { DAY_FULL_LABELS, courseTime, weeksLabel, type ScheduleTimes } from '../lib/schedule';
import type { Course } from '../types';

interface CourseDialogProps {
  courses: Course[] | null;
  times?: ScheduleTimes | null;
  onClose: () => void;
}

export function CourseDialog({ courses, times, onClose }: CourseDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = Boolean(courses && courses.length);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const first = courses?.[0];

  return (
    <dialog
      ref={ref}
      className="sheet course-sheet"
      aria-labelledby="courseSheetTitle"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="sheet-head">
        <span className="sheet-dot" aria-hidden="true" />
        <div>
          <h2 id="courseSheetTitle">{first?.name || '课程详情'}</h2>
          <p>{first ? `${DAY_FULL_LABELS[first.day] || ''} · 第 ${first.slot} 节` : ''}</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭详情" onClick={onClose}>
          <XIcon />
        </button>
      </div>
      <div className="sheet-list">
        {(courses ?? []).map((course, index) => {
          const [start, end] = courseTime(course, times);
          return (
            <div className="sheet-row" key={`${course.name}-${course.day}-${course.slot}-${index}`}>
              <Clock3 aria-hidden="true" />
              <div>
                <strong>{course.name}</strong>
                <p className="sheet-row-meta">
                  <Clock3 aria-hidden="true" />
                  <span>
                    {start}–{end} · 第 {course.slot} 节
                  </span>
                </p>
                <p className="sheet-row-meta">
                  <CalendarDays aria-hidden="true" />
                  <span>
                    {DAY_FULL_LABELS[course.day] || ''} · {weeksLabel(course)}
                  </span>
                </p>
                <p className="sheet-row-meta">
                  <MapPin aria-hidden="true" />
                  <span>{course.room || '教室待定'}</span>
                </p>
                <p className="sheet-row-meta">
                  <Users aria-hidden="true" />
                  <span>
                    {course.clazz || '班级待定'}
                    {course.count ? ` · ${course.count} 人` : ''}
                  </span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sheet-foot">
        <button className="kbtn primary" type="button" onClick={onClose}>
          知道了
        </button>
      </div>
    </dialog>
  );
}
