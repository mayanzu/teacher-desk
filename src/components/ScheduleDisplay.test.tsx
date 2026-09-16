import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleSection } from './ScheduleSection';
import { NextClassPanel } from './NextClassPanel';
import { LessonCard } from './LessonCard';
import { DEFAULT_META, DEFAULT_TIMES } from '../data/defaults';
import type { Course } from '../types/schedule';

const course: Course = { name: '计算机组成原理', day: 4, slot: '5-6', weeks: '1-20', parity: null, room: 'D楼208', clazz: '网络工程班' };
const now = new Date(2026, 8, 16, 10);

describe('schedule display behavior', () => {
  it('offers import instead of an empty grid, and restores week navigation with courses', () => {
    const onImport = vi.fn();
    const onToday = vi.fn();
    const props = { meta: DEFAULT_META, courses: [], viewWeek: 3, now, times: DEFAULT_TIMES, buildingTimes: {}, onWeekChange: vi.fn(), onToday, onSelectCourses: vi.fn(), onImport };
    const { rerender } = render(<ScheduleSection {...props} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByLabelText('选择教学周')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '导入课表' }));
    expect(onImport).toHaveBeenCalledOnce();
    rerender(<ScheduleSection {...props} courses={[course]} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '当前周' })).toBeDisabled();
    rerender(<ScheduleSection {...props} courses={[course]} viewWeek={4} />);
    fireEvent.click(screen.getByRole('button', { name: '回到本周' }));
    expect(onToday).toHaveBeenCalledOnce();
  });

  it('shows the actual next occurrence date and time, with no countdown when none exists', () => {
    const props = { now, todayCount: 0, weekCount: 1, weekRange: '9/14–9/20' };
    const { rerender } = render(<NextClassPanel {...props} next={{ course, week: 4, start: new Date(2026, 8, 24, 13, 30), end: new Date(2026, 8, 24, 15, 5) }} />);
    expect(screen.getByText('9月24日 周四 · 13:30–15:05')).toBeInTheDocument();
    rerender(<NextClassPanel {...props} next={null} />);
    expect(screen.queryByText('距离开课')).not.toBeInTheDocument();
  });

  it('shows the remaining time instead of 00:00:00 while a class is in progress', () => {
    const props = { todayCount: 1, weekCount: 1, weekRange: '9/14–9/20' };
    render(<NextClassPanel {...props} now={new Date(2026, 8, 16, 14, 0)} next={{ course, week: 4, start: new Date(2026, 8, 16, 13, 30), end: new Date(2026, 8, 16, 15, 5) }} />);
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('剩余 01:05:00')).toBeInTheDocument();
    expect(screen.queryByText('距离开课')).not.toBeInTheDocument();
  });

  it('keeps course color when the same course moves to another day', () => {
    const props = { start: '13:30', end: '15:05', live: false, past: false, extraCount: 0, onClick: vi.fn() };
    const { rerender } = render(<LessonCard {...props} course={course} />);
    const color = screen.getByRole('button').getAttribute('data-course-color');
    rerender(<LessonCard {...props} course={{ ...course, day: 1 }} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-course-color', color);
  });
});

