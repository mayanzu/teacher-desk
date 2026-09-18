import type { Course, CourseInstance, Term } from '../types';

export const DAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const DAY_FULL_LABELS = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7];
export type ScheduleTimes = Record<string, [string, string]>;

const BASE_SLOTS = ['1-2', '3-4', '5-6', '7-8'];
const NIGHT_SLOTS = ['9-10', '11-12'];

/** 作息时间兜底表，仅在接口未返回 times 时使用。 */
export const DEFAULT_TIMES: ScheduleTimes = {
  '1-2': ['08:15', '09:50'],
  '3-4': ['10:05', '11:40'],
  '5-6': ['13:35', '15:10'],
  '7-8': ['15:20', '16:55'],
  '9-10': ['18:00', '19:35'],
  '11-12': ['19:40', '21:15'],
};

export function slotPeriod(slot: string): string {
  const start = Number(String(slot).split('-')[0]);
  if (!Number.isFinite(start)) return '';
  if (start <= 4) return '上午';
  if (start <= 8) return '下午';
  return '晚上';
}

function normalizeWeeks(weeks: string): string {
  return String(weeks ?? '')
    .replace(/[第周\s]/g, '')
    .replace(/[—–~至]/g, '-')
    .replace(/[，、;；]/g, ',')
    .replace(/^,+|,+$/g, '');
}

export function weekInRanges(weeks: string, week: number): boolean {
  const text = normalizeWeeks(weeks);
  if (!text) return false;
  return text.split(',').some((part) => {
    if (!part) return false;
    const [rawStart, rawEnd] = part.split('-');
    const start = Number(rawStart);
    if (!Number.isFinite(start)) return false;
    if (rawEnd === undefined || rawEnd === '') return week === start;
    const end = Number(rawEnd);
    if (!Number.isFinite(end)) return week === start;
    return week >= start && week <= end;
  });
}

export function isCourseActive(course: Course, week: number): boolean {
  if (!weekInRanges(course.weeks, week)) return false;
  if (course.parity === 'odd') return week % 2 === 1;
  if (course.parity === 'even') return week % 2 === 0;
  return true;
}

export function parityLabel(parity: Course['parity']): string {
  if (parity === 'odd') return '单周';
  if (parity === 'even') return '双周';
  return '每周';
}

export function weeksLabel(course: Course): string {
  const weeks = String(course.weeks ?? '').trim();
  return `第${weeks}周 · ${parityLabel(course.parity)}`;
}

export function courseColor(name: string): number {
  return Array.from(String(name ?? '').trim()).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 6, 0);
}

export function activeSlots(courses: Course[]): string[] {
  const present = new Set(courses.map((course) => course.slot));
  return [...BASE_SLOTS, ...NIGHT_SLOTS.filter((slot) => present.has(slot))];
}

export function activeDays(courses: Course[]): number[] {
  const present = new Set(courses.map((course) => course.day));
  return WEEK_DAYS.filter((day) => day <= 5 || present.has(day));
}

function mondayOf(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - (day - 1));
  return copy;
}

export function termStart(term: string): Date | null {
  const [rawYear, rawTerm] = String(term ?? '').split(',');
  const year = Number(rawYear);
  const index = Number(rawTerm);
  if (!Number.isFinite(year) || year < 2000 || !Number.isFinite(index)) return null;
  // 0 = 第一学期（当年 9 月），1 = 第二学期（次年 2 月）
  const anchor = index === 0 ? new Date(year, 8, 1) : new Date(year + 1, 1, 20);
  return mondayOf(anchor);
}

export function parseSemesterStart(value?: string | null): Date | null {
  const match = String(value ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  return mondayOf(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function currentWeekFrom(start: Date | null, totalWeeks: number, now: Date = new Date()): number | null {
  if (!start || totalWeeks <= 0) return null;
  const diff = Math.round((mondayOf(now).getTime() - start.getTime()) / 604800000) + 1;
  if (diff < 1 || diff > totalWeeks) return null;
  return diff;
}

export function weekMondayFrom(start: Date | null, week: number): Date | null {
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + (week - 1) * 7);
}

export function weekMonday(term: string, week: number): Date | null {
  const start = termStart(term);
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + (week - 1) * 7);
}

export function currentWeek(term: string, totalWeeks: number, now: Date = new Date()): number | null {
  const start = termStart(term);
  if (!start || totalWeeks <= 0) return null;
  const diff = Math.round((mondayOf(now).getTime() - start.getTime()) / 604800000) + 1;
  if (diff < 1 || diff > totalWeeks) return null;
  return diff;
}

export function fallbackTerms(now: Date = new Date()): { terms: Term[]; current: string } {
  const month = now.getMonth() + 1;
  const startYear = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const terms: Term[] = [];
  for (let offset = 0; offset < 2; offset += 1) {
    const year = startYear - offset;
    terms.push({ value: `${year},1`, label: `${year}—${year + 1}学年 第一学期` });
    terms.push({ value: `${year},2`, label: `${year}—${year + 1}学年 第二学期` });
  }
  return { terms, current: month >= 8 ? `${startYear},1` : `${startYear},2` };
}

export function todayIndex(now: Date = new Date()): number {
  return now.getDay() || 7;
}

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatHourMinute(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function timeParts(value: string): [number, number] {
  const [hour, minute] = String(value).split(':').map(Number);
  return [Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0];
}

export function courseTime(course: Course, times?: ScheduleTimes | null): [string, string] {
  const slot = String(course.slot ?? '');
  return times?.[slot] ?? DEFAULT_TIMES[slot] ?? ['--:--', '--:--'];
}

export function courseInstance(course: Course, week: number, semesterStart: Date, times?: ScheduleTimes | null): CourseInstance {
  const [startTime, endTime] = courseTime(course, times);
  const base = new Date(
    semesterStart.getFullYear(),
    semesterStart.getMonth(),
    semesterStart.getDate() + (week - 1) * 7 + (course.day - 1),
  );
  const [startHour, startMinute] = timeParts(startTime);
  const [endHour, endMinute] = timeParts(endTime);
  const start = new Date(base);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(base);
  end.setHours(endHour, endMinute, 0, 0);
  return { course, week, start, end };
}

export type InstancePhase = 'upcoming' | 'live' | 'past' | 'unknown';

export function courseInstancePhase(
  course: Course,
  week: number,
  semesterStart: Date | null,
  times: ScheduleTimes | null | undefined,
  now: Date,
): InstancePhase {
  if (!semesterStart) return 'unknown';
  const [startTime] = courseTime(course, times);
  if (startTime === '--:--') return 'unknown';
  const instance = courseInstance(course, week, semesterStart, times);
  if (now.getTime() < instance.start.getTime()) return 'upcoming';
  if (now.getTime() <= instance.end.getTime()) return 'live';
  return 'past';
}

/** 当前时间之后（或正在进行）的最近一节课程；扫描到 totalWeeks 为止，找不到返回 null。 */
export function nextCourseInstance(
  courses: Course[],
  semesterStart: Date | null,
  totalWeeks: number,
  currentWeekNumber: number | null,
  times: ScheduleTimes | null | undefined,
  now: Date = new Date(),
): CourseInstance | null {
  if (!semesterStart || totalWeeks <= 0) return null;
  const startWeek = Math.max(1, currentWeekNumber ?? 1);
  const candidates: CourseInstance[] = [];
  for (let week = startWeek; week <= totalWeeks; week += 1) {
    courses.forEach((course) => {
      if (!isCourseActive(course, week)) return;
      const [startTime] = courseTime(course, times);
      if (startTime === '--:--') return;
      const instance = courseInstance(course, week, semesterStart, times);
      if (instance.end.getTime() - now.getTime() > 0) candidates.push(instance);
    });
    if (candidates.length) break;
  }
  candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  return candidates.find((item) => item.start.getTime() > now.getTime()) ?? candidates[0] ?? null;
}

export interface CountdownParts {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
}

export function countdownParts(milliseconds: number): CountdownParts {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(total / 86400);
  const hours = String(Math.floor((total % 86400) / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return { days, hours, minutes, seconds };
}

export function formatWeekRange(semesterStart: Date | null, week: number): string {
  const monday = weekMondayFrom(semesterStart, week);
  if (!monday) return '';
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return `${formatMonthDay(monday)} – ${formatMonthDay(sunday)}`;
}

export type SemesterPhase = 'unknown' | 'before' | 'during' | 'after';

export function semesterPhase(semesterStart: Date | null, totalWeeks: number, now: Date = new Date()): SemesterPhase {
  if (!semesterStart || totalWeeks <= 0) return 'unknown';
  const nowMonday = mondayOf(now).getTime();
  const startMs = semesterStart.getTime();
  const endMs = new Date(
    semesterStart.getFullYear(),
    semesterStart.getMonth(),
    semesterStart.getDate() + totalWeeks * 7,
  ).getTime();
  if (nowMonday < startMs) return 'before';
  if (nowMonday >= endMs) return 'after';
  return 'during';
}

export function daysUntil(target: Date | null, now: Date = new Date()): number | null {
  if (!target) return null;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((to - from) / 86400000);
}

export function semesterLabel(xn?: number, xq?: number): string {
  if (!Number.isFinite(xn) || !xn) return '';
  const year = Number(xn);
  const half = xq === 1 ? '第二' : '第一';
  return `${year}–${year + 1}学年 ${half}学期`;
}
