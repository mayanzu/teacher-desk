import { describe, expect, it } from 'vitest';
import { buildSluImportPayload } from './slu';

describe('buildSluImportPayload', () => {
  it('builds a teacher profile from the authenticated schedule HTML', () => {
    const html = `<table>
      <tr><td colspan="5">2026-2027学年第一学期教学安排表(第3周)</td></tr>
      <tr><td>时段</td><td>节次</td><td>一<br>09-14</td><td>二<br>09-15</td><td>三<br>09-16</td></tr>
      <tr><td rowspan="2">上午</td><td>1(08:10-08:55)</td><td>数据结构与算法 [2-17]周 1-2节 19 H楼505（多） 2025级本科网络工程班</td><td></td><td></td></tr>
      <tr><td>2(09:00-09:45)</td><td></td><td>离散数学 [2-17]周 1-2节 19 D楼208(多) 2025级本科网络工程班</td><td></td></tr>
    </table>`;
    const payload = buildSluImportPayload({
      status: 'success',
      htmls: [html],
      teacher: '孙佳悦',
      semesterLabel: '2026-2027学年第一学期',
    });
    expect(payload.meta.teacher).toBe('孙佳悦');
    expect(payload.meta.semesterStart).toBe('2026-08-31');
    expect(payload.courses).toHaveLength(2);
    expect(payload.courses[1].day).toBe(2);
  });
});
