import { describe, expect, it } from 'vitest';
import { BUILDING_TIMES, DEFAULT_META, DEFAULT_TIMES } from '../data/defaults';
import type { Course } from '../types/schedule';
import { courseInstance, courseTime, coursesForCell, isCourseActive, nextCourseInstance, parseWeeks } from './schedule';

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

  it('tolerates "第"/"周" prefixes and full-width separators in week text', () => {
    expect([...parseWeeks('第2-4，6、8-9周', 20)]).toEqual([2, 3, 4, 6, 8, 9]);
  });

  it('ignores malformed week segments and clamps to the semester', () => {
    expect([...parseWeeks('', 20)]).toEqual([]);
    expect([...parseWeeks('abc,,2-40', 20)]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('treats even-parity courses as inactive on odd weeks', () => {
    const course = makeCourse({ weeks: '1-16', parity: 'even' });
    expect(isCourseActive(course, 4, 20)).toBe(true);
    expect(isCourseActive(course, 5, 20)).toBe(false);
  });

  it('returns the next upcoming instance for the requested week', () => {
    const course = makeCourse({ day: 4, slot: '7-8', weeks: '1-16' });
    const next = nextCourseInstance(
      [course],
      DEFAULT_META.semesterStart,
      20,
      3,
      DEFAULT_TIMES,
      BUILDING_TIMES,
      new Date('2026-09-17T14:00:00'),
    );
    expect(next?.start.getDate()).toBe(17);
    expect(next?.start.getHours()).toBe(15);
    expect(next?.start.getMinutes()).toBe(20);
  });

  it('keeps an in-progress instance as the current next item', () => {
    const course = makeCourse({ day: 4, slot: '7-8', weeks: '1-16' });
    const next = nextCourseInstance(
      [course],
      DEFAULT_META.semesterStart,
      20,
      3,
      DEFAULT_TIMES,
      BUILDING_TIMES,
      new Date('2026-09-17T16:00:00'),
    );
    expect(next?.start.getHours()).toBe(15);
  });

  it('filters cell courses by day, slot and active week', () => {
    const active = makeCourse({ day: 2, slot: '1-2', weeks: '2-6' });
    const inactive = makeCourse({ day: 2, slot: '1-2', weeks: '8-10' });
    expect(coursesForCell([active, inactive], 2, '1-2', 3, 20)).toEqual([active]);
    expect(coursesForCell([active, inactive], 2, '1-2', 9, 20)).toEqual([inactive]);
  });
});
