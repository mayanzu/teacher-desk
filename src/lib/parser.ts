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

function slotFromText(value: string): string {
  const text = cleanCell(value).replace(/\s+/g, '');
  const chinese = text.match(/^[一二三四五六]$/);
  if (chinese) return SLOT_MAP[chinese[0]];
  const single = text.match(/^(?:第)?(\d{1,2})(?:\D|$)/);
  if (single) {
    const period = Number(single[1]);
    const start = period % 2 === 1 ? period : period - 1;
    return `${start}-${start + 1}`;
  }
  const range = text.match(/(\d+)\s*[-—–~至]\s*(\d+)/);
  if (range) {
    const first = Number(range[1]);
    const start = first % 2 === 1 ? first : first - 1;
    return `${start}-${start + 1}`;
  }
  return '';
}

function dayFromHeader(cell: string): number {
  const text = cell.replace(/\s/g, '').replace(/星期/g, '周');
  const match = text.match(/(?:周|^)([一二三四五六日天])/);
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
  const classMatch = rest.match(/([^\s]+班)$/);
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

function extractMeta(source: string) {
  const plain = source.replace(/\s+/g, ' ');
  const department =
    plain.match(/部门\s*[：:]\s*([^|｜\t\n]+?)(?=\s*(?:教师|职称|特殊身份)\s*[：:]|\s*$)/)?.[1] ??
    plain.match(/部门\s*[：:]\s*([^|｜\t]+)/)?.[1] ??
    '';
  const teacher =
    plain.match(/教师\s*[：:]\s*([^|｜\t\n]+?)(?=\s*(?:职称|特殊身份|部门)\s*[：:]|\s*$)/)?.[1] ??
    plain.match(/教师\s*[：:]\s*([^|｜\t]+)/)?.[1] ??
    '';
  return { department: cleanCell(department), teacher: cleanCell(teacher) };
}

function resultFromCourses(courses: ParsedCourse[], warnings: string[], source: string): ParsedSchedule {
  if (!courses.length) throw new Error('表格识别成功，但没有解析到课程');
  const meta = extractMeta(source);
  const maxWeek = courses.reduce((max, course) => Math.max(max, maxWeekIn(course.weeks)), 0);
  return { ...meta, courses, warnings, maxWeek, source: 'structured' };
}

export function parseExportTable(text: string): ParsedSchedule {
  const source = String(text ?? '').replace(/\r/g, '');
  const rows = source
    .split(/\n+/)
    .map(splitRow)
    .filter((row): row is string[] => Boolean(row?.length) && !isSeparator(row as string[]));
  const headerIndex = rows.findIndex((row) => row.some((cell) => dayFromHeader(cell)));
  if (headerIndex < 0) throw new Error('没有找到「星期一 / 星期二」表头');

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
    let slot = '';
    let slotIndex = -1;
    for (let index = 0; index < Math.min(row.length, 6); index += 1) {
      const candidate = slotFromText(row[index]);
      if (candidate) {
        slot = candidate;
        slotIndex = index;
        break;
      }
    }
    if (!slot || slotIndex < 0) continue;
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
  return resultFromCourses(courses, warnings, source);
}

export function parsePlainTextSchedule(text: string): ParsedSchedule {
  const source = String(text ?? '').replace(/\r/g, '');
  const lines = source.split('\n');
  const headerIndex = lines.findIndex((line) => (line.match(/(?:星期|周)[一二三四五六日天]/g) ?? []).length >= 2);
  if (headerIndex < 0) throw new Error('没有找到「星期一 / 星期二」表头，请检查粘贴内容');

  const dayTokens = lines[headerIndex].match(/(?:星期|周)[一二三四五六日天]/g) ?? [];
  const days = dayTokens.map((token) => DAY_NUM[token.replace(/^(星期|周)/, '')]).filter(Boolean);
  const usableDays = days.length ? days : [1, 2, 3, 4, 5, 6];
  const warnings = ['纯文本粘贴丢失了表格列位置，系统已按课程出现顺序暂分配到星期，请在保存前逐项核对。'];
  const courses: ParsedCourse[] = [];
  let currentSlot = '';
  let bucket: string[] = [];

  const flush = () => {
    if (!currentSlot || !bucket.length) return;
    bucket.forEach((courseText, index) => {
      const day = usableDays[index % usableDays.length];
      const context = `第 ${currentSlot} 节第 ${index + 1} 个课程`;
      const course = parseCoursePart(courseText, day, currentSlot, context, warnings);
      if (!course) return;
      if (index >= usableDays.length) warnings.push(`${context}：同一节次课程超过星期列数，已循环分配星期`);
      courses.push(course);
    });
    bucket = [];
  };

  lines.slice(headerIndex + 1).forEach((line) => {
    const raw = line.trim();
    if (!raw) return;
    const compact = raw.replace(/[\s\t]+/g, '');
    const slotMatch = compact.match(/^([上下晚午]*)([一二三四五六])$/);
    if (slotMatch && !/[［[]/.test(raw) && !raw.includes('节')) {
      flush();
      currentSlot = SLOT_MAP[slotMatch[2]];
      return;
    }
    if (!currentSlot) return;
    if (/[［[]\d/.test(raw) || raw.includes('节')) {
      bucket.push(raw);
    } else if (bucket.length) {
      bucket[bucket.length - 1] += raw;
    }
  });
  flush();

  const meta = extractMeta(source);
  const maxWeek = courses.reduce((max, course) => Math.max(max, maxWeekIn(course.weeks)), 0);
  if (!courses.length) throw new Error('识别到星期表头，但没有提取到课程');
  return { ...meta, courses, warnings, maxWeek, source: 'plain' };
}

interface PendingCell {
  remaining: number;
  text: string;
}

export function parseHtmlTable(html: string): ParsedSchedule {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const table = documentNode.querySelector('table');
  if (!table) throw new Error('剪贴板中没有可识别的 HTML 表格');
  const rows: string[][] = [];
  const pending = new Map<number, PendingCell>();

  const ensureRow = (index: number) => {
    while (rows.length <= index) rows.push([]);
    return rows[index];
  };

  Array.from(table.querySelectorAll('tr')).forEach((rowNode, rowIndex) => {
    const row = ensureRow(rowIndex);
    let column = 0;
    Array.from(rowNode.children).forEach((cellNode) => {
      while (row[column] !== undefined) column += 1;
      const cell = cellNode as HTMLTableCellElement;
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
      clone.querySelectorAll('li,div,p').forEach((node) => node.append(' '));
      const text = cleanCell((clone.textContent || '').replace(/\s*\n\s*/g, '；'));
      const colspan = Math.max(1, cell.colSpan || 1);
      const rowspan = Math.max(1, cell.rowSpan || 1);
      for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
        const targetColumn = column + columnOffset;
        row[targetColumn] = columnOffset === 0 ? text : '';
        if (rowspan > 1) pending.set(targetColumn, { remaining: rowspan - 1, text: '' });
      }
      column += colspan;
    });

    [...pending.entries()].forEach(([targetColumn, pendingCell]) => {
      if (pendingCell.remaining <= 0) return;
      const targetRow = ensureRow(rowIndex + 1);
      if (targetRow[targetColumn] === undefined) targetRow[targetColumn] = pendingCell.text;
      pendingCell.remaining -= 1;
      if (pendingCell.remaining <= 0) pending.delete(targetColumn);
    });
  });

  const markdown = rows
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row) => `| ${row.map((cell) => cell || '').join(' | ')} |`)
    .join('\n');
  const parsed = parseExportTable(markdown);
  return { ...parsed, source: 'html' };
}

function slotFromPeriod(period: number): string {
  const start = period % 2 === 1 ? period : period - 1;
  return `${start}-${start + 1}`;
}

export function parseKingoSoftScheduleHtml(html: string): ParsedSchedule {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const nodes = [...documentNode.querySelectorAll<HTMLElement>('.weeklesson')];
  if (!nodes.length) throw new Error('没有找到金智教务课程详情区块');
  const warnings: string[] = [];
  const courses: ParsedCourse[] = [];
  const seen = new Set<string>();

  nodes.forEach((node, index) => {
    const fields = new Map<string, string>();
    node.querySelectorAll('li').forEach((item) => {
      const text = cleanCell(item.textContent || '');
      const separator = text.search(/[：:]/);
      if (separator < 0) return;
      fields.set(text.slice(0, separator).trim(), text.slice(separator + 1).trim());
    });
    const name = fields.get('课程名称') || '';
    const timeText = fields.get('上课时间') || '';
    const idMatch = node.id.match(/^weekly0(\d+)_(\d+)$/);
    let day = idMatch ? Number(idMatch[1]) : 0;
    let slot = idMatch ? slotFromPeriod(Number(idMatch[2])) : '';
    const timeMatch = timeText.match(/([一二三四五六日天])\[(\d+)\s*[-—–~至]\s*(\d+)\s*节\]/);
    if (timeMatch) {
      day = DAY_NUM[timeMatch[1]] || day;
      slot = `${Number(timeMatch[2])}-${Number(timeMatch[3])}`;
    }
    const weeks = timeText.match(/\[([^\]]+?)周\]/)?.[1]?.replace(/\s+/g, '') || '';
    if (!name || !day || !slot || !weeks) {
      warnings.push(`第 ${index + 1} 个课程详情缺少必要字段`);
      return;
    }
    const parity: WeekParity = timeText.includes('单周') ? 'odd' : timeText.includes('双周') ? 'even' : null;
    const room = fields.get('上课地点') || '';
    const clazz = fields.get('合班信息') || '';
    const course: ParsedCourse = {
      name: name.slice(0, 60),
      day,
      slot,
      weeks,
      parity,
      room: room.slice(0, 50),
      bld: inferBuildingFromRoom(room),
      clazz: clazz.slice(0, 60),
      count: null,
    };
    const key = [course.day, course.slot, course.name, course.weeks, course.parity, course.room, course.clazz].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      courses.push(course);
    }
  });

  if (!courses.length) throw new Error('课程详情存在，但没有解析出完整课程');
  const meta = extractMeta(html);
  const maxWeek = courses.reduce((max, course) => Math.max(max, maxWeekIn(course.weeks)), 0);
  return { ...meta, courses, warnings, maxWeek, source: 'kingosoft' };
}

export function parseScheduleHtml(html: string): ParsedSchedule {
  if (/class=["'][^"']*weeklesson/i.test(html) || /id=["']weekly0/i.test(html)) {
    try {
      return parseKingoSoftScheduleHtml(html);
    } catch {
      // Fall back to the visible table parser.
    }
  }
  return parseHtmlTable(html);
}

export function parseScheduleText(text: string): ParsedSchedule {
  const source = String(text ?? '').trim();
  if (/<table[\s>]/i.test(source)) return parseHtmlTable(source);
  try {
    const structured = parseExportTable(source);
    if (structured.courses.length) return structured;
  } catch {
    // Fall through to plain-text reconstruction.
  }
  return parsePlainTextSchedule(source);
}
