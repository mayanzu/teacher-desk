import { CalendarDays, Clock3, MapPin, Users, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { DAY_NAMES } from '../data/defaults';
import { courseInstance } from '../lib/schedule';
import type { BuildingTimes, Course, ScheduleMeta, ScheduleTimes } from '../types/schedule';

interface CourseDetailDialogProps {
  open: boolean;
  courses: Course[];
  meta: ScheduleMeta;
  times: ScheduleTimes;
  buildingTimes: BuildingTimes;
  onClose: () => void;
}

export function CourseDetailDialog({ open, courses, meta, times, buildingTimes, onClose }: CourseDetailDialogProps) {
  const ref = useDialog(open, onClose);
  const first = courses[0];
  return (
    <dialog ref={ref} className="sheet" aria-labelledby="sheetTitle">
      <div className="sheet-head">
        <span className="sheet-dot" aria-hidden="true" />
        <div>
          <h2 id="sheetTitle">{first?.name || '课程'}</h2>
          <p>{first ? DAY_NAMES[first.day] + ' · 第 ' + first.slot + ' 节' : ''}</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭详情" onClick={onClose}><X /></button>
      </div>
      <div className="sheet-list">
        {courses.map((course, index) => {
          const instance = courseInstance(course, 1, meta.semesterStart, times, buildingTimes);
          const start = instance.start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
          const end = instance.end.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
          return (
            <div className="sheet-row" key={`${course.name}-${index}`}>
              <Clock3 aria-hidden="true" />
              <div>
                <strong>{start}–{end}</strong>
                <p className="sheet-row-meta"><CalendarDays />{course.weeks} 周{course.parity === 'odd' ? ' · 单周' : course.parity === 'even' ? ' · 双周' : ''}</p>
                <p className="sheet-row-meta"><MapPin />{course.room || '教室待定'}</p>
                <p className="sheet-row-meta"><Users />{course.clazz || '班级待定'}{course.count ? ` · ${course.count} 人` : ''}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sheet-foot">
        <button className="button primary" type="button" onClick={onClose}>好</button>
      </div>
    </dialog>
  );
}
