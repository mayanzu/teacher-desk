import { describe, expect, it } from 'vitest';
import { SAMPLE_TABLE } from '../data/sample';
import { parseExportTable, parseHtmlTable, parseKingoSoftScheduleHtml, parseScheduleText } from './parser';

describe('parseExportTable', () => {
  it('parses the教务处 Markdown table', () => {
    const result = parseExportTable(SAMPLE_TABLE);
    expect(result.teacher).toBe('马仲军');
    expect(result.department).toBe('智慧交通现代产业学院');
    expect(result.courses).toHaveLength(7);
    expect(result.courses.some((course) => course.day === 5 && course.slot === '3-4')).toBe(true);
    expect(result.courses.find((course) => course.name === '计算机组成原理实验')?.parity).toBe('odd');
  });

  it('recovers a plain-text clipboard table with unknown day columns', () => {
    const source = `部门：智慧交通现代产业学院教师：孙佳悦职称：
星期一\t星期二\t星期三\t星期四\t星期五\t星期六
上
午\t一\t
数据结构与算法课程设计 [16-17]周 1-2节 19 D楼304移动互联开发实验室 2025级本科网络工程班
数据结构与算法课程设计 [16-17]周 1-2节 19 D楼304移动互联开发实验室 2025级本科网络工程班
离散数学 [2-17]周 3-4节 19 D楼208(多) 2025级本科网络工程班
下
午\t三\t
数据结构与算法 [2-17]周 5-6节 19 H楼505（多） 2025级本科网络工程班`;
    const result = parseScheduleText(source);
    expect(result.source).toBe('plain');
    expect(result.teacher).toBe('孙佳悦');
    expect(result.department).toBe('智慧交通现代产业学院');
    expect(result.courses).toHaveLength(4);
    expect(result.warnings[0]).toContain('丢失了表格列位置');
  });

  it('parses the numeric period structure used by KingoSoft HTML', () => {
    const html = `<table>
      <tr><td>时段</td><td>节次</td><td>一<br>09-14</td><td>二<br>09-15</td><td>三<br>09-16</td></tr>
      <tr><td rowspan="2">上午</td><td>1(08:10-08:55)</td><td>离散数学 [2-17]周 1-2节 19 D楼208(多) 2025级本科网络工程班</td><td></td><td></td></tr>
      <tr><td>2(09:00-09:45)</td><td></td><td>数据结构与算法 [2-17]周 1-2节 19 H楼505（多） 2025级本科网络工程班</td><td></td></tr>
    </table>`;
    const result = parseHtmlTable(html);
    expect(result.source).toBe('html');
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].slot).toBe('1-2');
    expect(result.courses[0].room).toBe('D楼208(多)');
    expect(result.courses[0].clazz).toBe('2025级本科网络工程班');
    expect(result.courses[1].day).toBe(2);
  });

  it('parses the hidden weeklesson details used by the real schedule page', () => {
    const html = `<div id="weekly02_1" class="weeklesson"><ul>
      <li>课程名称：<b>计算机组成原理</b></li>
      <li>上课时间：<b>[2-17周] 二[1-2节]</b></li>
      <li>上课地点：<b>F楼404（多）</b></li>
      <li>合班信息：<b>2025级本科网络工程班</b></li>
    </ul></div>`;
    const result = parseKingoSoftScheduleHtml(html);
    expect(result.source).toBe('kingosoft');
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]).toMatchObject({
      name: '计算机组成原理', day: 2, slot: '1-2', weeks: '2-17', room: 'F楼404（多）', clazz: '2025级本科网络工程班',
    });
  });

  it('uses the weekday parsed from the header instead of column order', () => {
    const source = [
      '| | 节次 | 星期二 | 星期四 |',
      '| | 1-2 | A课 [1-2]周 1-2节 1 A楼101 2025级本科网络工程班 | B课 [1-2]周 1-2节 1 A楼101 2025级本科网络工程班 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses.map((course) => course.day).sort()).toEqual([2, 4]);
    expect(result.courses.find((course) => course.name === 'A课')?.day).toBe(2);
    expect(result.courses.find((course) => course.name === 'B课')?.day).toBe(4);
  });

  it('keeps department and teacher when they sit outside the pasted HTML table', () => {
    const html = `<div>部门：智慧交通现代产业学院教师：[041103]马仲军职称：助教</div>
      <table>
        <tr><td>节次</td><td>星期一</td><td>星期二</td></tr>
        <tr><td>1-2</td><td>计算机组成原理 [2-17]周 1-2节 19 F楼404（多） 2025级本科网络工程班</td><td></td></tr>
      </table>`;
    const result = parseScheduleText(html);
    expect(result.source).toBe('html');
    expect(result.teacher).toBe('[041103]马仲军');
    expect(result.department).toBe('智慧交通现代产业学院');
    expect(result.courses).toHaveLength(1);
  });

  it('reads the real weeklesson markup with "(单)" parity and a clean teacher name', () => {
    const html = `<div id="weekly02_7" class="weeklesson"><ul>
      <li>课程名称：<b>计算机组成原理实验</b></li>
      <li>任课教师：<b>马仲军</b></li>
      <li>上课时间：<b>[7-17周](单) 二[7-8节]</b></li>
      <li>上课地点：<b>D楼408计算机组成结构实验室</b></li>
      <li class="last_jcli">合班信息：<b>2025级本科网络工程班</b></li>
    </ul></div>`;
    const result = parseKingoSoftScheduleHtml(html);
    expect(result.teacher).toBe('马仲军');
    expect(result.courses[0]).toMatchObject({ day: 2, slot: '7-8', weeks: '7-17', parity: 'odd' });
  });

  it('rejects text without weekday headers', () => {
    expect(() => parseExportTable('计算机组成原理 [1-8]周 1-2节 19 F楼404 测试班')).toThrow();
  });
});
