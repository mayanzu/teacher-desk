import { describe, expect, it } from 'vitest';
import { DEFAULT_COURSES, DEFAULT_META, DEFAULT_TIMES, BUILDING_TIMES } from '../data/defaults';
import { courseInstance, courseTime, isCourseActive, parseWeeks } from './schedule';

describe('schedule helpers', () => {
  it('expands comma-separated week ranges', () => {
    expect([...parseWeeks('2-4,6,8-9', 20)]).toEqual([2, 3, 4, 6, 8, 9]);
  });

  it('handles odd and even week parity', () => {
    const course = DEFAULT_COURSES.find((item) => item.name === '计算机组成原理实验')!;
    expect(isCourseActive(course, 7, 20)).toBe(true);
    expect(isCourseActive(course, 8, 20)).toBe(false);
  });

  it('uses building-specific times', () => {
    const course = DEFAULT_COURSES.find((item) => item.room.startsWith('D楼'))!;
    expect(courseTime(course, DEFAULT_TIMES, BUILDING_TIMES)).toEqual(['13:30', '15:05']);
  });

  it('places a course instance in the requested teaching week', () => {
    const course = DEFAULT_COURSES.find((item) => item.day === 4 && item.slot === '7-8')!;
    const instance = courseInstance(course, 3, DEFAULT_META.semesterStart, DEFAULT_TIMES, BUILDING_TIMES);
    expect(instance.start.getFullYear()).toBe(2026);
    expect(instance.start.getMonth()).toBe(8);
    expect(instance.start.getDate()).toBe(17);
  });

  it('exposes valid default metadata', () => {
    expect(DEFAULT_META.totalWeeks).toBe(20);
  });
});
