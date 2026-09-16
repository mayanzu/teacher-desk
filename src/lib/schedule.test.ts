import { describe, expect, it } from 'vitest';
import { BUILDING_TIMES, DEFAULT_META, DEFAULT_TIMES } from '../data/defaults';
import type { Course } from '../types/schedule';
import { courseInstance, courseTime, isCourseActive, parseWeeks } from './schedule';

function makeCourse(overrides: Partial<Course>): Course {
  return {
    name: '示例课程A',
    day: 1,
    slot: '1-2',
    weeks: '1-16',
    parity: null,
    room: 'A楼101',
    bld: 'A',
    clazz: '示例一班',
    ...overrides,
  };
}

describe('schedule helpers', () => {
  it('expands comma-separated week ranges', () => {
    expect([...parseWeeks('2-4,6,8-9', 20)]).toEqual([2, 3, 4, 6, 8, 9]);
  });

  it('handles odd and even week parity', () => {
    const course = makeCourse({ name: '示例课程C实验', day: 2, slot: '7-8', weeks: '7-17', parity: 'odd', room: 'D楼408', bld: 'DEHK' });
    expect(isCourseActive(course, 7, 20)).toBe(true);
    expect(isCourseActive(course, 8, 20)).toBe(false);
  });

  it('uses building-specific times', () => {
    const course = makeCourse({ day: 4, slot: '5-6', room: 'D楼208', bld: 'DEHK' });
    expect(courseTime(course, DEFAULT_TIMES, BUILDING_TIMES)).toEqual(['13:30', '15:05']);
  });

  it('falls back to default times for slots a building does not define', () => {
    const evening = makeCourse({ bld: 'DEHK', slot: '9-10' });
    expect(courseTime(evening, DEFAULT_TIMES, BUILDING_TIMES)).toEqual(['18:00', '19:35']);
    const unknown = makeCourse({ bld: 'DEHK', slot: '13-14' });
    expect(courseTime(unknown, DEFAULT_TIMES, BUILDING_TIMES)).toEqual(['--:--', '--:--']);
  });

  it('places a course instance in the requested teaching week', () => {
    const course = makeCourse({ day: 4, slot: '7-8' });
    const instance = courseInstance(course, 3, DEFAULT_META.semesterStart, DEFAULT_TIMES, BUILDING_TIMES);
    expect(instance.start.getFullYear()).toBe(2026);
    expect(instance.start.getMonth()).toBe(8);
    expect(instance.start.getDate()).toBe(17);
  });

  it('exposes valid default metadata', () => {
    expect(DEFAULT_META.totalWeeks).toBe(20);
    expect(DEFAULT_META.semesterStart).toBe('2026-08-31');
  });
});
