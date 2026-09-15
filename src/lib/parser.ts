import type { ParsedCourse, ParsedSchedule, WeekParity } from '../types/schedule';

const DAY_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const SLOT_MAP: Record<string, string> = { 一: '1-2', 二: '3-4', 三: '5-6', 四: '7-8', 五: '9-10', 六: '11-12' };

function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitRow(line: string): string[] | null {
  const raw = line.trim();
  if (!raw) return null;
  let cells: string[];
  if (raw.includes('|')) {
    cells = raw.split('|');
    if (!cells[0].trim()) cells.shift();
    if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  } else if (raw.includes('\t')) {
    cells = raw.split('\t');
  } else {
    return null;
  }
  return cells.map(cleanCell);
}

function isSeparator(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function dayFromHeader(cell: string): number {
  const text = cell.replace(/\s/g, '').replace(/星期/g, '周');
  const match = text.match(/周([一二三四五六日天])/);
  return match ? DAY_NUM[match[1]] ?? 0 : 0;
}

export function inferBuildingFromRoom(room: string): string | undefined {
  if (/^A楼|^A区/.test(room)) return 'A';
  if (/^[DEHK]楼|^[DEHK]区/.test(room)) return 'DEHK';
  if (/^[BCFG]楼|^[BCFG]区/.test(room)) return 'BCFG';
  if (/康养|实验实训楼/.test(room)) return 'KHY';
  return undefined;
}

function maxWeekIn(weeks: string): number {
  const numbers = weeks.match(/\d+/g) ?? [];
  return numbers.reduce((max, value) => Math.max(max, Number(value) || 0), 0);
}

function parseCoursePart(
  rawPart: string,
  day: number,
  slot: string,
  context: string,
  warnings: string[],
): ParsedCourse | null {
  const text = cleanCell(rawPart);
  if (!text || /^[-—–,，;；]+$/.test(text)) return null;
  const match = text.match(
    /^(.*?)\s*[［[]([^］\]]+)[］\]]\s*周\s*(?:(单周|双周)\s*)?第?\s*(\d+)\s*[-—–~至]\s*(\d+)\s*节\s*(?:(\d+)\s+)?(.*)$/,
  );
  if (!match) {
    warnings.push(`${context}：无法识别「${text.slice(0, 46)}${text.length > 46 ? '…' : ''}」`);
    return null;
  }
  const name = cleanCell(match[1]);
  const weeks = cleanCell(match[2]).replace(/[—–~至]/g, '-').replace(/\s+/g, '');
  const parity: WeekParity = match[3] === '单周' ? 'odd' : match[3] === '双周' ? 'even' : null;
  const slotText = `${match[4]}-${match[5]}`;
  const count = Number(match[6]) || null;
  let rest = cleanCell(match[7]);
  let clazz = '';
  const classMatch = rest.match(/((?:20\d{2}级|\d{4}级|[A-Za-z\u4e00-\u9fa5]{1,14}\d{2,4}[\u4e00-\u9fa5A-Za-z\d（）()]*班))$/);
  if (classMatch) {
    clazz = classMatch[1];
    rest = rest.slice(0, classMatch.index).trim();
  }
  if (slotText !== slot) warnings.push(`${context}：行内节次为 ${slotText}，已按表格列使用 ${slot}`);
  if (!name || !weeks) {
    warnings.push(`${context}：课程名或周次为空`);
    return null;
  }
  return {
    name: name.slice(0, 60),
    day,
    slot,
    weeks,
    parity,
    count,
    room: rest.slice(0, 50),
    bld: inferBuildingFromRoom(rest),
    clazz: clazz.slice(0, 60),
  };
}

export function parseExportTable(text: string): ParsedSchedule {
  const source = String(text ?? '').replace(/\r/g, '');
  const rows = source
    .split(/\n+/)
    .map(splitRow)
    .filter((row): row is string[] => Boolean(row?.length) && !isSeparator(row as string[]));
  const headerIndex = rows.findIndex((row) => row.some((cell) => dayFromHeader(cell)));
  if (headerIndex < 0) throw new Error('没有找到「星期一 / 星期二」表头，请粘贴完整的教务处课表表格');

  const dayColumns: number[] = [];
  rows[headerIndex].forEach((cell, index) => {
    if (dayFromHeader(cell)) dayColumns.push(index);
  });
  if (!dayColumns.length) throw new Error('没有识别出星期列');

  const warnings: string[] = [];
  const courses: ParsedCourse[] = [];
  const seen = new Set<string>();

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    let slotToken = '';
    let slotIndex = -1;
    for (let index = 0; index < Math.min(row.length, 6); index += 1) {
      const token = row[index].trim();
      if (/^[一二三四五六]$/.test(token)) {
        slotToken = token;
        slotIndex = index;
        break;
      }
    }
    if (!slotToken || slotIndex < 0) continue;
    const slot = SLOT_MAP[slotToken];
    const dayStart = slotIndex + 1;
    dayColumns.forEach((_, dayIndex) => {
      const day = dayIndex + 1;
      const rawCell = row[dayStart + dayIndex] ?? '';
      if (!rawCell.trim()) return;
      String(rawCell)
        .split(/<\s*br\s*\/?>|\n|；/i)
        .forEach((part) => {
          const course = parseCoursePart(part, day, slot, `周${'一二三四五六日'[day - 1]} ${slot}节`, warnings);
          if (!course) return;
          const key = [course.day, course.slot, course.name, course.weeks, course.parity, course.room, course.clazz].join('|');
          if (!seen.has(key)) {
            seen.add(key);
            courses.push(course);
          }
        });
    });
  }

  if (!courses.length) throw new Error('表格识别成功，但没有解析到课程');

  const plain = source.replace(/\s+/g, ' ');
  const department = plain.match(/部门\s*[：:]\s*([^|｜\t]+)/)?.[1] ?? '';
  const teacher = plain.match(/教师\s*[：:]\s*([^|｜\t]+)/)?.[1] ?? '';
  const maxWeek = courses.reduce((max, course) => Math.max(max, maxWeekIn(course.weeks)), 0);
  return { department: cleanCell(department), teacher: cleanCell(teacher), courses, warnings, maxWeek };
}
