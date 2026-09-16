import { describe, expect, it } from 'vitest';
import { safeFilename } from './download';
import { countdownParts, initials, joinMeta } from './format';

describe('format helpers', () => {
  it('keeps legit zero values when joining metadata', () => {
    expect(joinMeta(['A楼101', 0, '示例一班', undefined, null, ''])).toBe('A楼101 · 0 · 示例一班');
  });

  it('clamps negative countdowns to zero', () => {
    expect(countdownParts(-5_000)).toMatchObject({ days: 0, hours: '00', minutes: '00', seconds: '00' });
  });

  it('takes the first code point of a name', () => {
    expect(initials('张老师')).toBe('张');
    expect(initials('')).toBe('师');
  });
});

describe('safeFilename', () => {
  it('replaces path separators and trims trailing dots', () => {
    expect(safeFilename('示例/教师:课表?.')).toBe('示例_教师_课表_');
  });

  it('falls back for reserved Windows names', () => {
    expect(safeFilename('CON')).toBe('课表');
    expect(safeFilename('')).toBe('课表');
  });
});
