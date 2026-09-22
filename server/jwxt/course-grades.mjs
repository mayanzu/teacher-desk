import { clean, parseTerm, requireDownload, doubleEncode, safeFileName, requirePage, headText } from './common.mjs';

const COURSE_GRADE_LIST_TABLE = '5013';
// 学号：连续的数字/字母串；用于把表头行与数据行区分开
const STUDENT_ID_RE = /^[0-9A-Za-z]{4,}$/;const COURSE_GRADE_LIST_PAGE = 'cjlr.ckxscj.fkcaxzbjckcj.html?menucode=T30304';
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

// ===== 学校专属报表页（教务按 G_SCHOOL_CODE 分流，如 109591 的成绩页含最新 40-0 分数段） =====
const SCHOOL_CODE_RE = /G_SCHOOL_CODE\s*=\s*['"]?([A-Za-z0-9_]+)/;
const SCHOOL_CODE_RETRY_MS = 60_000;
const SCHOOL_CODE_TIMEOUT_MS = 5_000;
const schoolCodeCache = new Map(); // base -> { code, permanent, at }
const reportFileChoice = new Map(); // `${base}|${flag}|${dyfs}|exp|view` -> 已验证可用的文件名

const pageMissing = (error) => /HTTP\s*404/.test(String(error?.message ?? ''));

/** 学校代码来自 SetRootPath.jsp：成功解析即长期缓存；失败只冷却重试，期间按通用页走。 */
async function schoolCode(session) {
  const now = Date.now();
  const hit = schoolCodeCache.get(session.base);
  if (hit && (hit.permanent || now - hit.at < SCHOOL_CODE_RETRY_MS)) return hit.code;
  try {
    const res = await session.text('/ahsljw/custom/js/SetRootPath.jsp', {
      method: 'GET',
      referer: `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_REPORT_PAGE}`,
      signal: AbortSignal.timeout(SCHOOL_CODE_TIMEOUT_MS),
    });
    const code = res.text.match(SCHOOL_CODE_RE)?.[1] ?? '';
    schoolCodeCache.set(session.base, { code, permanent: true, at: now });
    return code;
  } catch {
    schoolCodeCache.set(session.base, { code: '', permanent: false, at: now });
    return '';
  }
}

/**
 * 成绩报表页：学校专属页优先（含最新分数段统计），404 回退通用页并缓存结论。
 * nameOnly=true 时只为解析可用文件名（PDF pageurl 用），已验证过的文件不再取回内容；
 * binary=true 时按 buffer 取回（Excel 导出用）。
 */
async function loadCourseGradePage(session, { flag, dyfs, exp = false, qs, nameOnly = false, binary = false }) {
  const generic = courseGradeReportFile(flag, dyfs);
  const genericFile = exp ? generic.replace('_data.jsp', '_data_exp.jsp') : generic;
  const key = `${session.base}|${flag}|${dyfs}|${exp ? 'exp' : 'view'}`;
  const decided = reportFileChoice.get(key);
  const code = decided ? '' : await schoolCode(session);
  const schoolFile = !decided && code ? genericFile.replace('_data', `${code}_data`) : null;
  const candidates = [];
  for (const file of [decided, schoolFile, genericFile]) {
    if (file && !candidates.includes(file)) candidates.push(file);
  }
  const referer = `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_REPORT_PAGE}`;
  for (let index = 0; index < candidates.length; index += 1) {
    const file = candidates[index];
    // 已验证过的文件（或通用页兜底）在 nameOnly 模式下无需再取回内容
    if (nameOnly && (file === decided || file === genericFile)) {
      reportFileChoice.set(key, file);
      return { file };
    }
    try {
      const path = `/ahsljw/wjstgdfw/${file}?${qs}`;
      const res = binary
        ? await session.request(path, { method: 'GET', referer })
        : await session.text(path, { method: 'GET', referer });
      reportFileChoice.set(key, file);
      return { file, res };
    } catch (error) {
      if (!pageMissing(error)) throw error;
      reportFileChoice.delete(key); // 结论过期（页面被下线）→ 重新决策
      if (index === candidates.length - 1) throw error;
    }
  }
  throw Object.assign(new Error('成绩页面结构异常，请稍后重试'), { status: 502 });
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
  requirePage(res, /doPrint\s*\(|暂无|无记录|没有/, '课程成绩列表');
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
  const { res } = await loadCourseGradePage(session, { flag, dyfs, qs });
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
    const idColumn = tableGrid[headerIndex].findIndex((cell) => cell.text === '学号');
    // 数据起始行：学号列“像学号”或为空（学号列 rowspan 合并时，后续数据行学号为空）。
    // 这样既能排除第二行表头（如「类别/成绩」落在学号列），又能保留合并单元格的数据行。
    const idOf = (row) => String(row[idColumn]?.text ?? '').replace(/\s+/g, '');
    const dataStart = tableGrid.findIndex((row, index) => {
      if (index <= headerIndex) return false;
      const id = idOf(row);
      return id === '' || STUDENT_ID_RE.test(id);
    });
    const end = dataStart < 0 ? tableGrid.length : dataStart;
    header = tableGrid.slice(headerIndex, end);
    for (let index = end; index < tableGrid.length; index += 1) {
      const row = tableGrid[index];
      if (!row.some((cell) => cell.text !== '')) continue;
      const id = idOf(row);
      if (id !== '' && !STUDENT_ID_RE.test(id)) continue;
      rows.push(row.map((cell) => cell.text));
    }
    break;
  }

  if (!header.length && !(tables.length === 0 && /没有检索到记录/.test(res.text))) {
    throw Object.assign(new Error('成绩页面结构异常，请稍后重试'), { status: 502 });
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

const FILENAME_BUDGET_DEFAULT = 800;

function settleWithin(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    promise.then(finish, () => finish(fallback));
  });
}

/** 文件名用的教师姓名：可选的短预算查询，失败/超时返回空字符串（review R08）。 */
async function filenameTeacher(session, params) {
  if (params.teacher) return String(params.teacher);
  const budget = Number(process.env.JWXT_FILENAME_BUDGET_MS) > 0 ? Number(process.env.JWXT_FILENAME_BUDGET_MS) : FILENAME_BUDGET_DEFAULT;
  return settleWithin(
    (async () => {
      const report = await getCourseGradesReport(session, params);
      const cell = report.meta.find((text) => text.startsWith('任课教师'));
      if (!cell) return '';
      return cell.replace(/^任课教师[:：]\s*/, '').replace(/^\[[^\]]*\]\s*/, '').trim();
    })(),
    budget,
    '',
  );
}

export async function exportCourseGradesPdf(session, params) {
  const { xn, xq } = parseTerm(params.term);
  const flag = String(params.flag ?? '1');
  const dyfs = String(params.dyfs ?? 'dl');
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
  // pageurl 用教务同款报表页：本校（109591）是学校专属页，含最新 40-0 分数段统计
  const { file } = await loadCourseGradePage(session, { flag, dyfs, qs, nameOnly: true });
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
  // 文件名只需要教师姓名（可选字段）：与 PDF 下载并行、设短预算。
  // PDF 已经生成/下载完成后，不能再为一个可选字段阻塞一次完整上游超时（review R08/R17）。
  const metadata = filenameTeacher(session, params);
  const dl = await session.request(
    `/ahsljw/frame/pdf?method=download&title=${doubleEncode(fileName)}&fileSavePath=${encodeURIComponent(fileSavePath)}`,
    { method: 'GET', referer: `${session.base}/ahsljw/frame/pdf?method=topdf` },
  );

  // 文件名：[教师姓名]_[课程名]_[班级名]_原始成绩.pdf
  const teacher = (await metadata) || '';
  const parts = [
    teacher,
    params.courseName,
    params.className || params.bjmc,
    flag === '2' ? '有效成绩' : '原始成绩',
  ].filter(Boolean);
  const filename = parts.length > 1 ? `${parts.join('_')}.pdf` : `${safeFileName(params.fileName, '成绩')}.pdf`;
  return { filename, buffer: requireDownload(dl, 'pdf') };
}

export async function exportCourseGradesExcel(session, params) {
  const { xn, xq } = parseTerm(params.term);
  const flag = String(params.flag ?? '1') === '2' ? '2' : '1';
  const dyfs = String(params.dyfs ?? 'dl');
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
  let res;
  try {
    // 教务页面「导出」按钮现走 _data_exp.jsp（学校专属页含 40-0 分数段），旧 excel.action 已弃用
    ({ res } = await loadCourseGradePage(session, { flag, dyfs, exp: true, qs, binary: true }));
  } catch (error) {
    if (!pageMissing(error)) throw error;
    const legacy = `exptype=kcxzbjcj&xn=${xn}&xq=${xq}&kcdm=${encodeURIComponent(params.kcdm ?? '')}&bjdm=${encodeURIComponent(params.bjdm ?? '')}&flag=${flag}`;
    res = await session.request(`/ahsljw/jw/output/excel.action?${legacy}`, {
      method: 'GET',
      referer: `${session.base}/ahsljw/wjstgdfw/${COURSE_GRADE_REPORT_PAGE}`,
    });
  }
  const buffer = requireDownload(res, 'xls');
  if (/没有检索到记录/.test(headText(buffer))) {
    throw Object.assign(new Error('该班级暂无成绩记录'), { status: 404 });
  }
  return { filename: `${safeFileName(params.fileName, '成绩')}.xls`, buffer };
}

