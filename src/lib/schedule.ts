import { addDays, addWeeks, differenceInMilliseconds, setHours, setMinutes, setSeconds, startOfWeek } from 'date-fns';
import { semesterDate } from './date';
import type { BuildingTimes, Course, CourseInstance, ScheduleTimes } from '../types/schedule';

export function parseWeeks(text: string, totalWeeks: number): Set<number> {
  const result = new Set<number>();
  String(text)
    .split(',')
    .forEach((part) => {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return;
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;
      for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) {
        if (week >= 1 && week <= totalWeeks) result.add(week);
      }
    });
  return result;
}

export function isCourseActive(course: Course, week: number, totalWeeks: number): boolean {
  if (!parseWeeks(course.weeks, totalWeeks).has(week)) return false;
  if (course.parity === 'odd' && week % 2 === 0) return false;
  if (course.parity === 'even' && week % 2 === 1) return false;
  return true;
}

export function courseTime(course: Course, times: ScheduleTimes, buildingTimes: BuildingTimes): [string, string] {
  const buildingSlot = course.bld ? buildingTimes[course.bld]?.[course.slot] : undefined;
  return buildingSlot || times[course.slot] || ['--:--', '--:--'];
}

function timeParts(value: string): [number, number] {
  const [hour, minute] = value.split(':').map(Number);
  return [Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0];
}

export function courseInstance(
  course: Course,
  week: number,
  semesterStart: string,
  times: ScheduleTimes,
  buildingTimes: BuildingTimes,
): CourseInstance {
  const [startTime, endTime] = courseTime(course, times, buildingTimes);
  const monday = addWeeks(startOfWeek(semesterDate(semesterStart), { weekStartsOn: 1 }), week - 1);
  const day = addDays(monday, course.day - 1);
  const [startHour, startMinute] = timeParts(startTime);
  const [endHour, endMinute] = timeParts(endTime);
  return {
    course,
    week,
    start: setSeconds(setMinutes(setHours(day, startHour), startMinute), 0),
    end: setSeconds(setMinutes(setHours(day, endHour), endMinute), 0),
  };
}

export function nextCourseInstance(
  courses: Course[],
  semesterStart: string,
  totalWeeks: number,
  currentWeek: number,
  times: ScheduleTimes,
  buildingTimes: BuildingTimes,
  now = new Date(),
): CourseInstance | null {
  const startWeek = Math.max(1, currentWeek);
  const candidates: CourseInstance[] = [];
  for (let week = startWeek; week <= totalWeeks; week += 1) {
    courses
      .filter((course) => isCourseActive(course, week, totalWeeks))
      .forEach((course) => {
        const instance = courseInstance(course, week, semesterStart, times, buildingTimes);
        if (differenceInMilliseconds(instance.end, now) > 0) candidates.push(instance);
      });
    if (candidates.length) break;
  }
  candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  return candidates.find((item) => item.start.getTime() > now.getTime()) ?? candidates[0] ?? null;
}

export function coursesForCell(courses: Course[], day: number, slot: string, week: number, totalWeeks: number): Course[] {
  return courses.filter(
    (course) => course.day === day && course.slot === slot && isCourseActive(course, week, totalWeeks),
  );
}
