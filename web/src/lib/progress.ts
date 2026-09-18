import type { ProgressEntryRow, ProgressTotals } from '../types';

const HOUR_KEYS = ['lectureHours', 'labHours', 'practiceHours', 'otherHours'] as const;

function formatHours(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function sumHours(row: ProgressEntryRow): string {
  const total = HOUR_KEYS.reduce((sum, key) => sum + (Number(row[key]) || 0), 0);
  return total ? formatHours(total) : row.hours;
}

export function applyTotals(list: ProgressEntryRow[], totals?: ProgressTotals): ProgressEntryRow[] {
  const result = list.map((row) => ({ ...row }));
  if (totals) {
    const targets = [totals.lecture, totals.lab, totals.practice, totals.other];
    HOUR_KEYS.forEach((key, index) => {
      const empty = result.filter((row) => !row[key]);
      const used = result.reduce((sum, row) => sum + Math.round((Number(row[key]) || 0) * 100), 0);
      const remaining = Math.max(0, Math.round(targets[index]! * 100) - used);
      empty.forEach((row, i) => {
        const amount = Math.floor(remaining / empty.length) + (i < remaining % empty.length ? 1 : 0);
        row[key] = formatHours(amount / 100);
      });
    });
  }
  return result.map((row) => ({ ...row, hours: sumHours(row) }));
}
export function validateHours(rows: ProgressEntryRow[], totals?: ProgressTotals): string {
  if (!totals) return '';
  const targets = [totals.lecture, totals.lab, totals.practice, totals.other];
  for (const [index, key] of HOUR_KEYS.entries()) {
    const target = targets[index]!;
    // 教务未返回某个分类总量（0）时不据此拦截，避免误报超额。
    if (!(target > 0)) continue;
    const values = rows.map((row) => Number(row[key] || 0));
    if (values.some((n) => !Number.isFinite(n) || n < 0)) return '学时包含无效值，请核对教务原始记录。';
    if (Math.round(values.reduce((a, b) => a + b, 0) * 100) > Math.round(target * 100)) {
      return '分类学时超过课程总量，请核对复制来源或教务原始记录后重试。';
    }
  }
  return '';
}
