import { describe, expect, it } from 'vitest';
import { SAMPLE_TABLE } from '../data/sample';
import { parseExportTable, parseHtmlTable, parseKingoSoftScheduleHtml, parseScheduleText } from './parser';

describe('parseExportTable', () => {
  it('parses the教务处 Markdown table', () => {
    const result = parseExportTable(SAMPLE_TABLE);
    expect(result.teacher).toBe('示例教师');
    expect(result.department).toBe('示例学院');
    expect(result.courses).toHaveLength(7);
    expect(result.courses.some((course) => course.day === 5 && course.slot === '3-4')).toBe(true);
    expect(result.courses.find((course) => course.name === '示例课程C实验')?.parity).toBe('odd');
  });

  it('recovers a plain-text clipboard table with unknown day columns', () => {
    const source = `部门：示例学院教师：示例教师职称：
星期一\t星期二\t星期三\t星期四\t星期五\t星期六
上
午\t一\t
数据结构与算法课程设计 [16-17]周 1-2节 30 D楼304 示例一班
数据结构与算法课程设计 [16-17]周 1-2节 30 D楼304 示例一班
离散数学 [2-17]周 3-4节 30 D楼208 示例一班
下
午\t三\t
数据结构与算法 [2-17]周 5-6节 30 H楼505 示例一班`;
    const result = parseScheduleText(source);
    expect(result.source).toBe('plain');
    expect(result.teacher).toBe('示例教师');
    expect(result.department).toBe('示例学院');
    expect(result.courses).toHaveLength(4);
    expect(result.warnings[0]).toContain('丢失了表格列位置');
  });

  it('parses the numeric period structure used by KingoSoft HTML', () => {
    const html = `<table>
      <tr><td>时段</td><td>节次</td><td>一<br>09-14</td><td>二<br>09-15</td><td>三<br>09-16</td></tr>
      <tr><td rowspan="2">上午</td><td>1(08:10-08:55)</td><td>离散数学 [2-17]周 1-2节 30 D楼208 示例一班</td><td></td><td></td></tr>
      <tr><td>2(09:00-09:45)</td><td></td><td>数据结构与算法 [2-17]周 1-2节 30 H楼505 示例一班</td><td></td></tr>
    </table>`;
    const result = parseHtmlTable(html);
    expect(result.source).toBe('html');
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].slot).toBe('1-2');
    expect(result.courses[0].room).toBe('D楼208');
    expect(result.courses[0].clazz).toBe('示例一班');
    expect(result.courses[1].day).toBe(2);
  });

  it('parses the hidden weeklesson details used by the real schedule page', () => {
    const html = `<div id="weekly02_1" class="weeklesson"><ul>
      <li>课程名称：<b>示例课程A</b></li>
      <li>上课时间：<b>[2-17周] 二[1-2节]</b></li>
      <li>上课地点：<b>A楼101</b></li>
      <li>合班信息：<b>示例一班</b></li>
    </ul></div>`;
    const result = parseKingoSoftScheduleHtml(html);
    expect(result.source).toBe('kingosoft');
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]).toMatchObject({
      name: '示例课程A', day: 2, slot: '1-2', weeks: '2-17', room: 'A楼101', clazz: '示例一班',
    });
  });

  it('uses the weekday parsed from the header instead of column order', () => {
    const source = [
      '| | 节次 | 星期二 | 星期四 |',
      '| | 1-2 | A课 [1-2]周 1-2节 1 A楼101 示例一班 | B课 [1-2]周 1-2节 1 A楼101 示例一班 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses.map((course) => course.day).sort()).toEqual([2, 4]);
    expect(result.courses.find((course) => course.name === 'A课')?.day).toBe(2);
    expect(result.courses.find((course) => course.name === 'B课')?.day).toBe(4);
  });

  it('keeps department and teacher when they sit outside the pasted HTML table', () => {
    const html = `<div>部门：示例学院教师：[041103]示例教师职称：讲师</div>
      <table>
        <tr><td>节次</td><td>星期一</td><td>星期二</td></tr>
        <tr><td>1-2</td><td>示例课程A [2-17]周 1-2节 30 A楼101 示例一班</td><td></td></tr>
      </table>`;
    const result = parseScheduleText(html);
    expect(result.source).toBe('html');
    expect(result.teacher).toBe('[041103]示例教师');
    expect(result.department).toBe('示例学院');
    expect(result.courses).toHaveLength(1);
  });

  it('reads the real weeklesson markup with "(单)" parity and a clean teacher name', () => {
    const html = `<div id="weekly02_7" class="weeklesson"><ul>
      <li>课程名称：<b>示例课程C实验</b></li>
      <li>任课教师：<b>示例教师</b></li>
      <li>上课时间：<b>[7-17周](单) 二[7-8节]</b></li>
      <li>上课地点：<b>D楼408</b></li>
      <li class="last_jcli">合班信息：<b>示例一班</b></li>
    </ul></div>`;
    const result = parseKingoSoftScheduleHtml(html);
    expect(result.teacher).toBe('示例教师');
    expect(result.teacher).not.toContain('<');
    expect(result.courses[0]).toMatchObject({ day: 2, slot: '7-8', weeks: '7-17', parity: 'odd' });
  });

  it('rejects text without weekday headers', () => {
    expect(() => parseExportTable('示例课程A [1-8]周 1-2节 30 A楼101 示例班级')).toThrow();
  });

  it('accepts "(单)" parity and weeks written inside the brackets', () => {
    const source = [
      '| | 星期一 | 星期二 |',
      '| 1-2 | 高数 [7-17]周(单) 1-2节 30 A楼101 示例一班 | 英语 [2-17周] 1-2节 30 A楼102 示例二班 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0]).toMatchObject({ weeks: '7-17', parity: 'odd' });
    expect(result.courses[1]).toMatchObject({ weeks: '2-17', parity: null });
  });

  it('strips the "第" prefix and normalizes full-width separators in weeks', () => {
    const source = [
      '| | 星期一 |',
      '| 1-2 | 高数 [第1-4，6、8-9]周 1-2节 30 A楼101 示例一班 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].weeks).toBe('1-4,6,8-9');
  });

  it('splits multiple courses separated by an ASCII semicolon', () => {
    const source = [
      '| | 星期一 |',
      '| 1-2 | A课 [1-2]周 1-2节 1 A楼101 一班; B课 [1-2]周 1-2节 1 A楼102 二班 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses.map((course) => course.name).sort()).toEqual(['A课', 'B课']);
  });

  it('does not treat a time cell as a period', () => {
    const source = [
      '| 时间 | 节次 | 星期一 |',
      '| 08:10-08:55 | 1-2 | 高数 [1-16]周 1-2节 30 A楼101 示例一班 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]).toMatchObject({ slot: '1-2', day: 1 });
  });

  it('recognizes a class number that does not end with 班', () => {
    const source = [
      '| | 星期一 |',
      '| 1-2 | 高数 [1-16]周 1-2节 30 A楼101 软件2101 |',
    ].join('\n');
    const result = parseExportTable(source);
    expect(result.courses[0]).toMatchObject({ room: 'A楼101', clazz: '软件2101' });
  });

  it('keeps a "|" inside a cell from breaking the column structure', () => {
    const html = `<table>
      <tr><td>节次</td><td>星期一</td></tr>
      <tr><td>1-2</td><td>组合|课程 [1-2]周 1-2节 1 A楼101 示例一班</td></tr>
    </table>`;
    const result = parseHtmlTable(html);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].day).toBe(1);
    expect(result.courses[0].name).toContain('组合');
  });

  it('parses weeklesson-only clipboard HTML through parseScheduleText', () => {
    const html = `<div id="weekly02_1" class="weeklesson"><ul>
      <li>课程名称：A课</li>
      <li>上课时间：[1-8周] 二[1-2节]</li>
      <li>上课地点：A楼101</li>
      <li>合班信息：示例一班</li>
    </ul></div>`;
    const result = parseScheduleText(html);
    expect(result.source).toBe('kingosoft');
    expect(result.courses).toHaveLength(1);
  });
});
