import { describe, expect, it } from 'vitest';
import { SAMPLE_TABLE } from '../data/sample';
import { parseExportTable } from './parser';

describe('parseExportTable', () => {
  it('parses the教务处 Markdown table', () => {
    const result = parseExportTable(SAMPLE_TABLE);
    expect(result.teacher).toBe('马仲军');
    expect(result.department).toBe('智慧交通现代产业学院');
    expect(result.courses).toHaveLength(7);
    expect(result.courses.some((course) => course.day === 5 && course.slot === '3-4')).toBe(true);
    expect(result.courses.find((course) => course.name === '计算机组成原理实验')?.parity).toBe('odd');
  });

  it('rejects text without weekday headers', () => {
    expect(() => parseExportTable('计算机组成原理 [1-8]周 1-2节 19 F楼404 测试班')).toThrow();
  });
});
