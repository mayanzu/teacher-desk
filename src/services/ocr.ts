import { createWorker } from 'tesseract.js';
import { inferBuildingFromRoom } from '../lib/parser';
import type { OcrWord, ParsedCourse, ParsedSchedule } from '../types/schedule';

const WEEKDAY_KEYS: Record<string, number> = {
  周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7,
  星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

interface GridRow {
  y: number;
  slotLabel: string;
  cells: string[];
}

interface OcrResultData {
  words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }> }>;
}

export type ProgressCallback = (progress: number, message: string) => void;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weekOfWord(text: string): number[] {
  const normalized = text.trim().toLowerCase().replace(/星期/g, '周');
  if (WEEKDAY_KEYS[normalized]) return [WEEKDAY_KEYS[normalized]];
  const days: number[] = [];
  const matches = normalized.match(/周?[一二三四五六日天]/g) ?? [];
  matches.forEach((match) => {
    const key = match.length === 1 ? `周${match}` : match;
    if (WEEKDAY_KEYS[key]) days.push(WEEKDAY_KEYS[key]);
  });
  return days;
}

function getWords(data: unknown): OcrWord[] {
  const result = data as OcrResultData;
  const output: OcrWord[] = [];
  const push = (word: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }) => {
    const text = word.text.trim().replace(/\s+/g, '');
    if (!text) return;
    output.push({ text, x: word.bbox.x0, y: word.bbox.y0, x2: word.bbox.x1, y2: word.bbox.y1 });
  };
  if (result.words?.length) result.words.forEach(push);
  else result.blocks?.forEach((block) => block.paragraphs?.forEach((paragraph) => paragraph.lines?.forEach((line) => line.words?.forEach(push))));
  return output.sort((a, b) => a.y - b.y || a.x - b.x);
}

function normalizeSlot(label: string, index: number): string {
  const text = label.replace(/\s+/g, '');
  const range = text.match(/^(\d+)\s*[-—–~至]\s*(\d+)$/);
  if (range) return `${Number(range[1])}-${Number(range[2])}`;
  const single = text.match(/^(\d+)$/);
  if (single) return `${single[1]}-${single[1]}`;
  const first = text.match(/^第?(\d+)/);
  if (first) {
    const value = Number(first[1]);
    return `${value}-${value + 1}`;
  }
  const value = (index + 1) * 2 - 1;
  return `${value}-${value + 1}`;
}

function parseGrid(words: OcrWord[]): { rows: GridRow[]; days: number[] } {
  if (!words.length) throw new Error('未识别到文字，请换一张更清晰的照片');
  const medianHeight = median(words.map((word) => word.y2 - word.y));
  const threshold = Math.max(9, medianHeight * 0.62);
  const rowClusters: OcrWord[][] = [];
  words.forEach((word) => {
    const last = rowClusters.at(-1);
    if (!last) {
      rowClusters.push([word]);
      return;
    }
    const previous = last.at(-1)!;
    const gap = (word.y + word.y2) / 2 - (previous.y + previous.y2) / 2;
    if (gap < threshold) last.push(word);
    else rowClusters.push([word]);
  });

  let header: { index: number; count: number } | null = null;
  for (let index = 0; index < rowClusters.length; index += 1) {
    const row = rowClusters[index];
    const count = row.reduce((sum, word) => sum + weekOfWord(word.text).length, 0);
    if (count >= 2 && (!header || count > header.count)) header = { index, count };
  }
  if (!header) throw new Error('未检测到「星期」表头，请拍摄完整表格');

  const headerWords = rowClusters[header.index]
    .map((word) => ({ word, days: weekOfWord(word.text) }))
    .filter((item) => item.days.length)
    .sort((a, b) => a.word.x - b.word.x);
  const columns: Array<{ day: number; x0: number; x1: number }> = [];
  headerWords.forEach(({ word, days }) => {
    if (days.length === 1) {
      columns.push({ day: days[0], x0: word.x, x1: word.x2 });
      return;
    }
    const width = Math.max(1, word.x2 - word.x);
    days.forEach((day, index) => columns.push({
      day,
      x0: word.x + (width * index) / days.length,
      x1: word.x + (width * (index + 1)) / days.length,
    }));
  });
  const uniqueColumns = columns
    .sort((a, b) => a.x0 - b.x0 || a.day - b.day)
    .filter((column, index, list) => index === 0 || column.day !== list[index - 1].day);
  if (!uniqueColumns.length) throw new Error('未解析出星期列，请重拍');
  const firstColumnX = uniqueColumns[0].x0;
  const rows: GridRow[] = [];

  rowClusters.forEach((row, rowIndex) => {
    if (rowIndex <= header!.index) return;
    const slotLabel = row
      .filter((word) => word.x2 <= firstColumnX + 8)
      .sort((a, b) => a.x - b.x)
      .map((word) => word.text)
      .join('')
      .replace(/\d{1,2}:\d{2}(\s*[-—–~至]\s*\d{1,2}:\d{2})?/g, '')
      .trim();
    const cells = uniqueColumns.map((column) => row
      .filter((word) => word.x2 > column.x0 - 5 && word.x < column.x1 + 5 && word.x2 > firstColumnX + 8)
      .sort((a, b) => a.x - b.x)
      .map((word) => word.text)
      .join(''));
    rows.push({ y: Math.min(...row.map((word) => word.y)), slotLabel, cells });
  });
  const days = uniqueColumns.map((column) => column.day);
  return { rows, days };
}

function parseCourseText(text: string) {
  let value = text.replace(/\s+/g, ' ').replace(/[|｜・·,，;；:：]+/g, ' ').trim();
  let room = '';
  let clazz = '';
  const roomMatch = value.match(/(?:[A-Za-z]\s*楼\s*\d+(?:[（(][^）)]*[）)])?|[A-Za-z][0-9]{2,4}(?:[（(][^）)]*[）)])?|[\u4e00-\u9fa5]{1,3}(?:教学楼|号楼?)\d{1,4})/);
  if (roomMatch) {
    room = roomMatch[0].replace(/\s+/g, '');
    value = value.slice(0, roomMatch.index) + ' ' + value.slice((roomMatch.index ?? 0) + roomMatch[0].length);
  }
  const classMatch = value.match(/((?:[\u4e00-\u9fa5A-Za-z]{1,12}\d{2,4}[\u4e00-\u9fa5A-Za-z\d（）()]*班)|(?:[\d\u4e00-\u9fa5A-Za-z]{1,8}级[\u4e00-\u9fa5A-Za-z\d（）() ]*?班))/);
  if (classMatch) {
    clazz = classMatch[1].trim();
    value = value.replace(classMatch[0], ' ');
  }
  return { name: value.replace(/\s+/g, ' ').trim(), room, clazz };
}

function preprocess(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1800;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        reject(new Error('无法创建图片处理画布'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let min = 255;
      let max = 0;
      for (let index = 0; index < data.length; index += 4) {
        const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        data[index] = data[index + 1] = data[index + 2] = gray;
        min = Math.min(min, gray);
        max = Math.max(max, gray);
      }
      const span = Math.max(1, max - min);
      const low = min - span * 0.08;
      const high = max + span * 0.08;
      for (let index = 0; index < data.length; index += 4) {
        const gray = Math.max(0, Math.min(255, ((data[index] - low) * 255) / (high - low)));
        data[index] = data[index + 1] = data[index + 2] = gray;
      }
      context.putImageData(imageData, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

export async function recognizeScheduleImage(
  file: File,
  onProgress: ProgressCallback,
  options: { highAccuracy?: boolean; totalWeeks?: number } = {},
): Promise<ParsedSchedule> {
  const totalWeeks = options.totalWeeks || 20;
  const canvas = await preprocess(file);
  onProgress(4, '加载中文识别模型…');
  const dataPath = options.highAccuracy ? '4.0.0' : '4.0.0_best_int';
  const worker = await createWorker('chi_sim', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text') onProgress(8 + Number(message.progress || 0) * 90, '正在识别文字…');
    },
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/',
    langPath: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/${dataPath}/`,
  });
  try {
    const result = await worker.recognize(canvas);
    const grid = parseGrid(getWords(result.data));
    const courses: ParsedCourse[] = [];
    grid.rows.forEach((row, rowIndex) => {
      const slot = normalizeSlot(row.slotLabel, rowIndex);
      row.cells.forEach((cell, dayIndex) => {
        const parsed = parseCourseText(cell);
        if (!parsed.name || /^[\s\-—–|·,，。;；:：A-Za-z0-9/.%]+$/.test(parsed.name)) return;
        courses.push({
          name: parsed.name.slice(0, 60),
          day: grid.days[dayIndex],
          slot,
          weeks: `1-${totalWeeks}`,
          parity: null,
          room: parsed.room.slice(0, 50),
          bld: inferBuildingFromRoom(parsed.room),
          clazz: parsed.clazz.slice(0, 60),
          count: null,
        });
      });
    });
    if (!courses.length) throw new Error('识别完成，但没有提取到课程，请尝试更清晰的照片');
    return { teacher: '', department: '', courses, warnings: [], maxWeek: totalWeeks };
  } finally {
    await worker.terminate();
  }
}
