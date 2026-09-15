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

  it('extracts a clean teacher name from weeklesson HTML and keeps last-parity variants', () => {
    const html = `<div><div id="weekly02_7" class="weeklesson"><ul>
      <li>课程名称：<b>计算机组成原理实验</b></li>
      <li>任课教师：<b>马仲军</b></li>
      <li>上课时间：<b>[7-17周](单) 二[7-8节]</b></li>
      <li>上课地点：<b>D楼408计算机组成结构实验室</b></li>
      <li class="last_jcli">合班信息：<b>2025级本科网络工程班</b></li>
    </ul></div></div>`;
    const payload = buildSluImportPayload({ status: 'success', htmls: [html], teacher: '', semesterLabel: '' });

    expect(payload.meta.teacher).toBe('马仲军');
    expect(payload.meta.teacher).not.toContain('<');
    expect(payload.courses[0]).toMatchObject({ name: '计算机组成原理实验', day: 2, slot: '7-8', weeks: '7-17', parity: 'odd' });
  });
});
