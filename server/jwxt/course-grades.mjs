import { clean, parseTerm } from './common.mjs';

const COURSE_GRADE_LIST_TABLE = '5013';
const COURSE_GRADE_LIST_PAGE = 'cjlr.ckxscj.fkcaxzbjckcj.html?menucode=T30304';
const COURSE_GRADE_REPORT_PAGE = 'cjlr.ckxscj.fkcaxzbjckcj_rpt.jsp';

const COURSE_GRADE_FILES = {
  originalSingle: 'cjlr.ckxscj.fkcaxzbjckcj_rptOrigina_data.jsp',
  originalTwo: 'cjlr.ckxscj.fkcaxzbjckcj_rptOriginatwo_data.jsp',
  effective: 'cjlr.ckxscj.fkcaxzbjckcj_rptEffecy_data.jsp',
};

function courseGradeReportFile(flag, dyfs) {
  if (String(flag) === '2') return COURSE_GRADE_FILES.effective;
  return String(dyfs) === 'sl' ? COURSE_GRADE_FILES.originalTwo : COURSE_GRADE_FILES.originalSingle;
}

function courseGradeReportQuery({ xn, xq, kcdm, bjdm, bjmc, flag, dyfs, qmzhC }) {
  return new URLSearchParams({
    xn: String(xn),
    xq: String(xq),
    kcdm: String(kcdm ?? ''),
    bjdm: String(bjdm ?? ''),
    flag: String(flag ?? '1'),
    gbflag: '1',
    bjmc: String(bjmc ?? ''),
    dyfs: String(dyfs ?? 'dl'),
    qmzhC: String(qmzhC ?? 'zhC'),
  }).toString();
}

export async function getCourseGradeClasses(session, term) {
  const { xn, xq } = parseTerm(term);
  const res = await session.text(`/ahsljw/taglib/DataTable.jsp?tableId=${COURSE_GRADE_LIST_TABLE}`, {
    method: 'POST',
    referer: `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_LIST_PAGE}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `xn=${xn}&xn1=${xn}&xq=${xq}&xq_m=${xq}&hidKey=&hidOption=QRY`,
  });
  const items = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(res.text))) {
    const args = tr[1].match(/doPrint\(\s*[^,]*,\s*'([^']*)'\s*,\s*'([^']*)'/);
    if (!args) continue;
    const cells = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRe.exec(tr[1]))) cells.push(clean(cell[1]));
    const courseRaw = cells[0] ?? '';
    const match = courseRaw.match(/^\[([^\]]+)\]\s*(.*)$/);
    items.push({
      kcdm: args[1],
      bjdm: args[2],
      courseCode: match?.[1] || '',
      courseName: (match?.[2] || courseRaw).trim(),
      credit: cells[1] ?? '',
      hours: cells[2] ?? '',
      className: cells[3] ?? '',
      students: cells[4] ?? '',
      category: cells[5] ?? '',
      mode: cells[6] ?? '',
      exam: cells[7] ?? '',
    });
  }
  return { items, xn, xq };
}

function parseTableGrid(tableHtml) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tableHtml))) {
    const cells = [];
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRe.exec(tr[1]))) {
      cells.push({
        text: clean(cell[2]),
        rowSpan: Number(cell[1].match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] || 1),
        colSpan: Number(cell[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] || 1),
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export async function getCourseGradesReport(session, params) {
  const { xn, xq } = parseTerm(params.term);
  const flag = String(params.flag ?? '1');
  const dyfs = String(params.dyfs ?? 'dl');
  const file = courseGradeReportFile(flag, dyfs);
  const qs = courseGradeReportQuery({
    xn,
    xq,
    kcdm: params.kcdm,
    bjdm: params.bjdm,
    bjmc: params.bjmc,
    flag,
    dyfs,
    qmzhC: params.qmzhC,
  });
  const res = await session.text(`/ahsljw/wjstgdfw/${file}?${qs}`, {
    method: 'GET',
    referer: `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_REPORT_PAGE}`,
  });
  const html = res.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);

  const grid = tables.length ? parseTableGrid(tables[0]) : [];
  const meta = grid.flat().map((cell) => cell.text).filter(Boolean);

  let header = [];
  const rows = [];
  for (const table of tables) {
    const tableGrid = parseTableGrid(table);
    const headerIndex = tableGrid.findIndex((row) => row.some((cell) => cell.text === '学号'));
    if (headerIndex < 0) continue;
    const dataStart = tableGrid.findIndex((row, index) => index > headerIndex && /^\d+$/.test((row[0]?.text ?? '').trim()));
    const end = dataStart < 0 ? tableGrid.length : dataStart;
    header = tableGrid.slice(headerIndex, end);
    for (let index = end; index < tableGrid.length; index += 1) {
      const row = tableGrid[index];
      if (!row.some((cell) => cell.text !== '')) continue;
      if (!/^\d+$/.test((row[0]?.text ?? '').trim())) continue;
      rows.push(row.map((cell) => cell.text));
    }
    break;
  }

  return {
    term: params.term,
    kcdm: params.kcdm,
    bjdm: params.bjdm,
    bjmc: params.bjmc,
    flag,
    dyfs,
    meta,
    header,
    rows,
    empty: rows.length === 0,
  };
}

function doubleEncode(value) {
  return encodeURIComponent(encodeURIComponent(String(value ?? '')));
}

function safeFileName(value, fallback) {
  const name = String(value ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  return name || fallback;
}

export async function exportCourseGradesPdf(session, params) {
  const { xn, xq } = parseTerm(params.term);
  const flag = String(params.flag ?? '1');
  const dyfs = String(params.dyfs ?? 'dl');
  const file = courseGradeReportFile(flag, dyfs);
  const qs = courseGradeReportQuery({
    xn,
    xq,
    kcdm: params.kcdm,
    bjdm: params.bjdm,
    bjmc: params.bjmc,
    flag,
    dyfs,
    qmzhC: params.qmzhC,
  });
  const pageurl = `wjstgdfw/${file}?${qs}`;
  const title = params.title || '分课程按行政班级查看成绩';
  const body = `pageurl=${doubleEncode(pageurl)}&pageSize=A4&orientation=P&top=0&bottom=10&left=10&right=10&title=${doubleEncode(title)}`;
  const res = await session.text('/ahsljw/frame/pdf?method=topdf', {
    method: 'POST',
    referer: `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_REPORT_PAGE}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  let data = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    data = null;
  }
  if (!data || String(data.status) !== '200' || !data.result) {
    throw new Error((data && data.message) || '原版 PDF 生成失败');
  }
  const [fileName, fileSavePath] = String(data.result).split(';;');
  const dl = await session.request(
    `/ahsljw/frame/pdf?method=download&title=${doubleEncode(fileName)}&fileSavePath=${fileSavePath}`,
    { method: 'GET', referer: `${session.base}/ahsljw/frame/pdf?method=topdf` },
  );

  // 文件名：[教师姓名]_[课程名]_[班级名]_原始成绩.pdf
  let teacher = '';
  try {
    const report = await getCourseGradesReport(session, params);
    const cell = report.meta.find((text) => text.startsWith('任课教师'));
    if (cell) teacher = cell.replace(/^任课教师[:：]\s*/, '').replace(/^\[[^\]]*\]\s*/, '').trim();
  } catch {
    teacher = '';
  }
  const parts = [
    teacher,
    params.courseName,
    params.className || params.bjmc,
    flag === '2' ? '有效成绩' : '原始成绩',
  ].filter(Boolean);
  const filename = parts.length > 1 ? `${parts.join('_')}.pdf` : `${safeFileName(params.fileName, '成绩')}.pdf`;
  return { filename, buffer: dl.buffer };
}

export async function exportCourseGradesExcel(session, params) {
  const { xn, xq } = parseTerm(params.term);
  const qs = `exptype=kcxzbjcj&xn=${xn}&xq=${xq}&kcdm=${encodeURIComponent(params.kcdm ?? '')}&bjdm=${encodeURIComponent(params.bjdm ?? '')}&flag=${String(params.flag ?? '1') === '2' ? '2' : '1'}`;
  const res = await session.request(`/ahsljw/jw/output/excel.action?${qs}`, {
    method: 'GET',
    referer: `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_REPORT_PAGE}`,
  });
  return { filename: `${safeFileName(params.fileName, '成绩')}.xls`, buffer: res.buffer };
}

