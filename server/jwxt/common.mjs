import iconv from 'iconv-lite';


const DAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

const UNRESERVED = /[A-Za-z0-9*\-._]/;

export function gbkFormEncode(data) {
  return Object.entries(data)
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}

function encode(value) {
  const buffer = iconv.encode(String(value ?? ''), 'gbk');
  let out = '';
  for (const byte of buffer) {
    const char = String.fromCharCode(byte);
    if (UNRESERVED.test(char)) out += char;
    else if (byte === 0x20) out += '+';
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const value = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function clean(value) {
  return decodeEntities(
    String(value ?? '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/&nbsp;|&#160;|&ensp;|&emsp;|&#8194;|&#8195;/gi, ' ')
      .replace(/[\u00a0\u3000]/g, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferBuildingFromRoom(room) {
  if (/^A楼|^A区/.test(room)) return 'A';
  if (/^[DEHK]楼|^[DEHK]区/.test(room)) return 'DEHK';
  if (/^[BCFG]楼|^[BCFG]区/.test(room)) return 'BCFG';
  if (/康养|实验实训楼/.test(room)) return 'KHY';
  return undefined;
}

function normWeeks(raw) {
  return clean(raw)
    .replace(/[第周]/g, '')
    .replace(/[—–~至]/g, '-')
    .replace(/[，、;；]/g, ',')
    .replace(/\s+/g, '')
    .replace(/^,+|,+$/g, '');
}

export function parseWeekLessonBlock(block) {
  const fields = new Map();
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(block))) {
    const text = clean(m[1]);
    const sep = text.search(/[：:]/);
    if (sep < 0) continue;
    fields.set(text.slice(0, sep).trim(), text.slice(sep + 1).trim());
  }
  const idMatch = block.match(/id=["']weekly0(\d+)_(\d+)["']/i);
  const timeText = fields.get('上课时间') || '';
  let day = idMatch ? Number(idMatch[1]) : 0;
  let slot = '';
  const timeMatch = timeText.match(/([一二三四五六日天])\s*\[(\d+)\s*[-—–~至]\s*(\d+)\s*节\]/);
  if (timeMatch) {
    day = DAY[timeMatch[1]] || day;
    slot = `${Number(timeMatch[2])}-${Number(timeMatch[3])}`;
  } else if (idMatch) {
    const period = Number(idMatch[2]);
    const start = period % 2 === 1 ? period : period - 1;
    slot = `${start}-${start + 1}`;
  }
  const weeks = normWeeks(timeText.match(/\[([^\]]+?)周\]/)?.[1] || '');
  const name = clean(fields.get('课程名称') || '');
  if (!name || !day || !slot || !weeks) return null;
  const room = clean(fields.get('上课地点') || '');
  const parity = /单/.test(timeText) ? 'odd' : /双/.test(timeText) ? 'even' : null;
  return {
    name,
    day,
    slot,
    weeks,
    parity,
    room,
    bld: inferBuildingFromRoom(room),
    clazz: clean(fields.get('合班信息') || ''),
    count: null,
  };
}

export function parseTable(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(body))) {
    const cells = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRe.exec(tr[1]))) cells.push(clean(cell[1]));
    if (cells.some((value) => value !== '')) rows.push(cells);
  }
  return rows;
}

export function parseTerm(term) {
  const [xn, xq] = String(term || '').split(',');
  return { xn: Number(xn) || new Date().getFullYear(), xq: Number(xq) || 0 };
}

export const DEFAULT_TIMES = {
  '1-2': ['08:15', '09:50'],
  '3-4': ['10:05', '11:40'],
  '5-6': ['13:35', '15:10'],
  '7-8': ['15:20', '16:55'],
  '9-10': ['18:00', '19:35'],
  '11-12': ['19:40', '21:15'],
};


export function doubleEncode(value) {
  return encodeURIComponent(encodeURIComponent(String(value ?? '')));
}
export function safeFileName(value, fallback) {
  return String(value ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

function headText(bytes, length = 2000) {
  const head = Buffer.from(bytes.subarray(0, length));
  return `${head.toString('utf8')}\n${iconv.decode(head, 'gbk')}`;
}

function looksLikeExcel(bytes, type, head) {
  const sig = bytes.subarray(0, 4);
  const ole2 = sig[0] === 0xd0 && sig[1] === 0xcf && sig[2] === 0x11 && sig[3] === 0xe0;
  const zip = sig[0] === 0x50 && sig[1] === 0x4b;
  const htmlLike = /<table|<html|<\?xml/i.test(head) && /excel|spreadsheet|octet-stream|html/i.test(type);
  return ole2 || zip || htmlLike;
}

export function requireDownload(result, format) {
  const bytes = result.buffer;
  const type = result.response.headers.get('content-type') || '';
  const head = headText(bytes);
  const loginLike = /登录|登陆|login|统一身份|Service unavailable|系统异常|请稍后|错误/i.test(head);
  const valid = format === 'pdf'
    ? /^\s*%PDF-/.test(bytes.subarray(0, 32).toString('latin1'))
    : looksLikeExcel(bytes, type, head);
  if (!result.response.ok || !valid || loginLike) {
    throw Object.assign(new Error('教务导出失败，未收到有效文件'), { status: 502 });
  }
  return bytes;
}

/**
 * HTML/Excel 导出用的文本单元格：把可能被表格软件当作公式执行的内容转为文本
 * （CSV 由 csvCell 处理，这里用于 .xls/HTML 导出）。
 */
export function formulaSafeText(value) {
  const text = clean(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function requirePage(result, marker, description) {
  if (result.status !== 200 || !marker.test(result.text) || /<title>[^<]*(?:错误|异常|error)/i.test(result.text)) {
    throw Object.assign(new Error(`${description}响应异常，请稍后重试`), { status: 502 });
  }
}

/**
 * CSV 单元格：转义引号并把可能被表格软件当作公式执行的内容转为文本。
 * 仅对“像公式”的值加前导单引号，纯数字（含负号）保持原样。
 */
export function csvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  const numeric = /^-?\d+(?:\.\d+)?$/.test(text);
  if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * 学号等纯数字串：使用 ="123" 形式让表格软件按文本读取，
 * 保留前导零，并避免超过 15 位时被科学计数法截断精度。
 */
export function csvTextNumber(value) {
  const text = String(value ?? '');
  return /^0\d+$|^\d{15,}$/.test(text) ? `"=""${text}"""` : csvCell(text);
}
