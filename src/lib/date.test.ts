import { describe, expect, it } from 'vitest';
import { currentWeekNumber, formatWeekRange } from './date';

describe('date helpers', () => {
  it('calculates the teaching week from Monday boundaries', () => {
    expect(currentWeekNumber('2026-08-31', 20, new Date('2026-09-15T10:00:00'))).toBe(3);
  });

  it('clamps dates outside the semester', () => {
    expect(currentWeekNumber('2026-08-31', 20, new Date('2025-01-01T00:00:00'))).toBe(1);
  });

  it('formats a weekly range', () => {
    expect(formatWeekRange('2026-08-31', 3)).toBe('9/14 – 9/20');
  });

  it('falls back to the default semester start for invalid input', () => {
    const week = currentWeekNumber('', 20, new Date('2026-09-15T10:00:00'));
    expect(Number.isNaN(week)).toBe(false);
    expect(week).toBe(3);
  });

  it('clamps weeks after the semester end', () => {
    expect(currentWeekNumber('2026-08-31', 20, new Date('2030-01-01T00:00:00'))).toBe(20);
  });
});
