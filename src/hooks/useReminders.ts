import { useEffect, useRef } from 'react';
import { currentWeekNumber } from '../lib/date';
import { isCourseActive, courseInstance } from '../lib/schedule';
import type { BuildingTimes, Course, ScheduleMeta, ScheduleTimes } from '../types/schedule';

interface ReminderOptions {
  enabled: boolean;
  courses: Course[];
  meta: ScheduleMeta;
  times: ScheduleTimes;
  buildingTimes: BuildingTimes;
  minutes?: number;
  onWarning: (message: string) => void;
}

export function useReminders({
  enabled,
  courses,
  meta,
  times,
  buildingTimes,
  minutes = 15,
  onWarning,
}: ReminderOptions) {
  const notified = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const check = () => {
      const now = new Date();
      const currentWeek = currentWeekNumber(meta.semesterStart, meta.totalWeeks, now);
      const weekPrefix = `${currentWeek}-`;
      notified.current.forEach((key) => {
        if (!key.startsWith(weekPrefix)) notified.current.delete(key);
      });
      courses.forEach((course) => {
        if (!isCourseActive(course, currentWeek, meta.totalWeeks)) return;
        const instance = courseInstance(course, currentWeek, meta.semesterStart, times, buildingTimes);
        const delta = instance.start.getTime() - now.getTime();
        if (delta <= 0 || delta > minutes * 60_000) return;
        const identity = course.id || `${course.day}-${course.slot}-${course.name}-${course.room}-${course.clazz}`;
        const key = weekPrefix + identity;
        if (notified.current.has(key)) return;
        try {
          new Notification(`即将开课：${course.name} ${instance.start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`, {
            body: `${course.room} · ${course.clazz} · ${Math.ceil(delta / 60_000)} 分钟后`,
          });
          notified.current.add(key);
        } catch (error) {
          onWarning(`提醒发送失败：${String(error)}`);
        }
      });
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [buildingTimes, courses, enabled, meta, minutes, onWarning, times]);
}
