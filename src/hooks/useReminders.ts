import { useEffect, useRef } from 'react';
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
      const currentWeek = Math.max(1, Math.round((now.getTime() - new Date(meta.semesterStart).getTime()) / 604_800_000) + 1);
      courses.forEach((course, index) => {
        if (!isCourseActive(course, currentWeek, meta.totalWeeks)) return;
        const instance = courseInstance(course, currentWeek, meta.semesterStart, times, buildingTimes);
        const delta = instance.start.getTime() - now.getTime();
        if (delta <= 0 || delta > minutes * 60_000) return;
        const key = `${currentWeek}-${course.day}-${course.slot}-${course.name}-${index}`;
        if (notified.current.has(key)) return;
        notified.current.add(key);
        try {
          new Notification(`即将开课：${course.name} ${instance.start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`, {
            body: `${course.room} · ${course.clazz} · ${Math.ceil(delta / 60_000)} 分钟后`,
          });
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
