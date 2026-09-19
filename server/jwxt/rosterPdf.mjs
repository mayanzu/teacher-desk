import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { clean, parseTerm } from './common.mjs';

/**
 * 点名册 PDF：本机直接排版，内容和「打印预览」（buildRosterListHtml）一致 ——
 * 完整名单、没有教务报表页的页眉/翻页/边框，中文用中文字体渲染。
 *
 * 之所以不走教务的 frame/pdf?method=topdf：那个是把报表页转 PDF，
 * 只会出当前那一页、还带着页面的页眉和边框。
 */

// 打印预览里 <colgroup> 的列宽，等比例缩放到 A4 纵向的可用宽度
const COLUMNS = [
  { label: '序号', width: 48 },
  { label: '学号', width: 104 },
  { label: '姓名', width: 64 },
  { label: '性别', width: 44 },
  { label: '修读性质', width: 70 },
  { label: '专业', width: 140 },
  { label: '备注', width: 232 },
];

const PAGE = { width: 595.28, height: 841.89, margin: 34 }; // A4 纵向，页边距约 12mm

// 能用的中文字体（按优先级自动挑一个；都找不到时由调用方决定怎么报错）。
// 只列单文件 TTF/OTF：pdfkit 读不了 .ttc 字体集合；DroidSansFallback 缺数字，
// 只有中文字形而没数字，所以排在最后。前两个是文鼎简中宋体/楷体（含拉丁与数字）。
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/arphic-gbsn00lp/gbsn00lp.ttf',
  '/usr/share/fonts/truetype/arphic-gkai00mp/gkai00mp.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
];

/** ROSTER_PDF_FONT 优先；配了但文件不存在时返回 null（宁可明确失败，也不要静默画成方框） */
export function resolveRosterFont(env = process.env) {
  const configured = String(env.ROSTER_PDF_FONT || '').trim();
  if (configured) return existsSync(configured) ? configured : null;
  return FONT_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

export async function buildRosterPdf({
  term,
  termLabel,
  kcdm,
  skbjdm,
  courseName,
  className,
  teacherName,
  teacher,
  items = [],
  fontPath,
}) {
  const { xn, xq } = parseTerm(term || '');
  const termText = clean(termLabel) || (Number.isFinite(xn) ? `${xn}-${xn + 1}学年 第${xq + 1}学期` : '');
  const courseText = clean(courseName).replace(/^\[[^\]]*\]\s*/, '') || `[${kcdm}]`;
  const teacherText = clean(teacherName) || clean(teacher).replace(/\[[^\]]*\]/g, '').trim();
  const classText = clean(className) || clean(skbjdm);

  const contentWidth = PAGE.width - PAGE.margin * 2;
  const scale = contentWidth / COLUMNS.reduce((sum, column) => sum + column.width, 0);
  const columns = COLUMNS.map((column) => ({ ...column, width: column.width * scale }));
  const left = PAGE.margin;
  const bottomLimit = PAGE.height - PAGE.margin - 24; // 给页脚留位置
  const headerHeight = 18;
  const rowHeight = 16;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: { Title: '安徽三联学院学生名单', Creator: 'teacher-desk' },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.registerFont('cjk', fontPath);
  const font = (size) => doc.font('cjk').fontSize(size);

  const drawTableHeader = () => {
    const top = doc.y;
    let x = left;
    doc.lineWidth(0.5).strokeColor('#000000');
    for (const column of columns) {
      doc.rect(x, top, column.width, headerHeight).stroke();
      font(9.5).fillColor('#000000');
      // 显式给 y，画完再把游标收回本行底部（doc.text 会推进 doc.y）
      doc.text(column.label, x + 2, top + 5, { width: column.width - 4, align: 'center', lineBreak: false, ellipsis: true });
      x += column.width;
    }
    doc.y = top + headerHeight;
  };

  // 标题 + 学期 + 课程/班级/教师/人数（与打印预览一致）
  font(16).fillColor('#000000');
  doc.text('安徽三联学院学生名单', left, PAGE.margin, { width: contentWidth, align: 'center', characterSpacing: 2 });
  if (termText) {
    font(10);
    doc.text(termText, left, doc.y + 2, { width: contentWidth, align: 'center' });
  }
  doc.y += 6;
  const infoY = doc.y;
  font(9.5);
  doc.text(`课程：${courseText}    上课班级：${classText}${teacherText ? `    任课教师：${teacherText}` : ''}`, left, infoY, {
    width: contentWidth - 60,
    lineBreak: false,
    ellipsis: true,
  });
  doc.text(`共 ${items.length} 人`, left, infoY, { width: contentWidth, align: 'right', lineBreak: false });
  doc.y = infoY + 16;

  drawTableHeader();

  items.forEach((item, index) => {
    if (doc.y + rowHeight > bottomLimit) {
      doc.addPage();
      drawTableHeader();
    }
    const cells = [
      String(item.index || index + 1),
      item.studentId,
      item.name,
      item.gender,
      item.type,
      item.major,
      item.remark,
    ].map((value) => clean(value));
    const top = doc.y;
    let x = left;
    doc.lineWidth(0.5).strokeColor('#000000');
    for (const [position, column] of columns.entries()) {
      doc.rect(x, top, column.width, rowHeight).stroke();
      font(9).fillColor('#000000');
      doc.text(cells[position] || '', x + 2, top + 4, { width: column.width - 4, align: 'center', lineBreak: false, ellipsis: true });
      x += column.width;
    }
    doc.y = top + rowHeight;
  });

  // 页脚：第 x 页 / 共 y 页（写在页边距里，需要先把下边距归零，否则 pdfkit 会自动翻页）
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    doc.page.margins.bottom = 0;
    font(8.5).fillColor('#444444');
    doc.text(`第 ${page - range.start + 1} 页 / 共 ${range.count} 页`, left, PAGE.height - PAGE.margin + 9, {
      width: contentWidth,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return finished;
}
