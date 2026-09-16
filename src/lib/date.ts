import { addWeeks, differenceInMilliseconds, format, parseISO, startOfWeek } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { DEFAULT_META } from '../data/defaults';

const WEEK_MS = 604_800_000;

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

export function semesterDate(value: string): Date {
  const parsed = parseISO(`${value}T00:00:00`);
  if (isValidDate(parsed)) return parsed;
  const fallback = parseISO(`${DEFAULT_META.semesterStart}T00:00:00`);
  return isValidDate(fallback) ? fallback : new Date();
}

export function currentWeekNumber(semesterStart: string, totalWeeks: number, now = new Date()): number {
  const start = startOfWeek(semesterDate(semesterStart), { weekStartsOn: 1 });
  const current = startOfWeek(now, { weekStartsOn: 1 });
  const week = Math.floor(differenceInMilliseconds(current, start) / WEEK_MS) + 1;
  if (!Number.isFinite(week)) return 1;
  return Math.min(totalWeeks, Math.max(1, week));
}

export function weekMonday(semesterStart: string, week: number): Date {
  return addWeeks(startOfWeek(semesterDate(semesterStart), { weekStartsOn: 1 }), week - 1);
}

export function formatMonthDay(date: Date): string {
  return format(date, 'M/d', { locale: zhCN });
}

export function formatDate(date: Date): string {
  return format(date, 'M月d日 EEEE', { locale: zhCN });
}

export function formatClock(date: Date): string {
  return format(date, 'HH:mm:ss');
}

export function formatWeekRange(semesterStart: string, week: number): string {
  const monday = weekMonday(semesterStart, week);
  const sunday = addWeeks(monday, 1);
  sunday.setDate(sunday.getDate() - 1);
  return `${formatMonthDay(monday)} – ${formatMonthDay(sunday)}`;
}
