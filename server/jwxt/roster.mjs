import { parseTable, clean, parseTerm, gbkFormEncode } from './common.mjs';

export async function getRoster(session, term, kcdm, skbjdm) {
  const { xn, xq } = parseTerm(term);
  const qry = `/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt.jsp?xn=${xn}&xq_m=${xq}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`;
  const body = gbkFormEncode({
    xn,
    xq,
    kcdm,
    skbjdm,
    pxfs: 'axh',
    radio: 'on',
    btnQry: '检索',
    menucode_current: 'T30101',
  });
  const res = await session.text('/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt_data.jsp', {
    method: 'POST',
    referer: `${session.base}${qry}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const rows = parseTable(res.text);
  const headerIndex = rows.findIndex((row) => row.includes('学号'));
  if (headerIndex < 0) {
    throw new Error('点名册数据获取失败（登录态可能已过期，请重新扫码）');
  }
  const items = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const studentId = String(row[2] ?? '').trim();
    const name = String(row[3] ?? '').trim();
    if (!name) continue;
    if (!/^\d{6,}$/.test(studentId)) continue;
    items.push({
      index: row[0] ?? '',
      className: row[1] ?? '',
      studentId,
      name,
      gender: row[4] ?? '',
      college: row[5] ?? '',
      major: row[6] ?? '',
      type: row[7] ?? '',
      remark: row[9] ?? '',
    });
  }
  return { items };
}

export function buildRosterCsv(items) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['序号', '行政班级', '学号', '姓名', '性别', '学院', '专业', '修读性质', '备注'];
  const lines = items.map((item) =>
    [item.index, item.className, item.studentId, item.name, item.gender, item.college, item.major, item.type, item.remark].map(escape).join(','),
  );
  return `\uFEFF${header.map(escape).join(',')}\r\n${lines.join('\r\n')}`;
}

let printCssCache = null;

async function getPrintCss(session) {
  if (printCssCache === null) {
    try {
      const res = await session.text('/ahsljw/css/Print.css', {
        method: 'GET',
        referer: `${session.base}/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt.jsp`,
      });
      printCssCache = res.status === 200 ? res.text : '';
    } catch {
      printCssCache = '';
    }
  }
  return printCssCache;
}

export async function getRosterPrintHtml(session, term, kcdm, skbjdm) {
  const { xn, xq } = parseTerm(term);
  const qry = `/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt.jsp?xn=${xn}&xq_m=${xq}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`;
  const res = await session.text('/ahsljw/wjstgdfw/cjlr.dycddjc.fkcaskbjdyskdmc_rpt_data.jsp', {
    method: 'POST',
    referer: `${session.base}${qry}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: gbkFormEncode({
      xn,
      xq,
      kcdm,
      skbjdm,
      pxfs: 'axh',
      radio: 'on',
      btnQry: '检索',
      menucode_current: 'T30101',
    }),
  });
  if (!res.text.includes('点名册')) {
    throw new Error('点名册打印页获取失败（登录态可能已过期，请重新扫码）');
  }
  const css = await getPrintCss(session);
  let html = res.text
    .replace(
      /<link[^>]*Print\.css[^>]*>/gi,
      `<style>\n${css}\n@page { size: A4 landscape; margin: 8mm; }\n</style>`,
    )
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/charset=GBK/gi, 'charset=utf-8');

  // 原版信息行用 float 排版，Excel 不支持会堆成一列；改成 2 行 3 列表格
  const start = html.indexOf('<div group="group"');
  const tableIndex = start >= 0 ? html.indexOf('<table', start) : -1;
  if (start >= 0 && tableIndex > start) {
    const block = html.slice(start, tableIndex).replace(/^<div[^>]*>/, '').replace(/<\/div>\s*$/, '');
    const cells = [...block.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)]
      .map((match) => match[1].replace(/<[^>]*>/g, '').trim())
      .filter(Boolean);
    if (cells.length) {
      const rows = [];
      for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
      const infoTable = `<table style="width:100%;border:none;table-layout:fixed;font-size:9pt;margin:0;">${rows
        .map(
          (row) =>
            `<tr>${row
              .map((text) => `<td style="border:none;text-align:left;width:33.33%;padding-left:4px;">${text}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</table>`;
      html = html.slice(0, start) + infoTable + html.slice(tableIndex);
    }
  }

  return html;
}

export function buildRosterListHtml({
  term,
  termLabel,
  kcdm,
  skbjdm,
  courseName,
  className,
  teacherCode,
  teacherName,
  teacher,
  items = [],
  autoPrint = false,
}) {
  const { xn, xq } = parseTerm(term);
  const termText = clean(termLabel) || `${xn}-${xn + 1}学年 第${xq + 1}学期`;
  const courseText = clean(courseName).replace(/^\[[^\]]*\]\s*/, '') || `[${kcdm}]`;
  const teacherText = clean(teacherName) || clean(teacher).replace(/\[[^\]]*\]/g, '').trim();

  const rows = items
    .map(
      (item, index) => `<tr>
<td class="c">${clean(item.index) || index + 1}</td>
<td class="c">${clean(item.studentId)}</td>
<td class="c">${clean(item.name)}</td>
<td class="c">${clean(item.gender)}</td>
<td class="c">${clean(item.type)}</td>
<td class="c">${clean(item.major)}</td>
<td class="c">${clean(item.remark)}</td>
</tr>`,
    )
    .join('');

  return `\uFEFF<!DOCTYPE html>
<html lang="zh-CN" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8">
<title>安徽三联学院学生名单</title>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>学生名单</x:Name><x:WorksheetOptions><x:Print><x:ValidPrinterInfo/>
<x:PaperSizeIndex>9</x:PaperSizeIndex><x:HorizontalResolution>600</x:HorizontalResolution>
</x:Print></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
@page { size: A4 portrait; margin: 12mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "SimSun", "宋体", "Microsoft YaHei", sans-serif; color: #000; font-size: 10.5pt; }
h1 { margin: 0 0 2px; font-size: 16pt; font-weight: 700; text-align: center; letter-spacing: 4px; }
.term { margin: 0 0 10px; text-align: center; font-size: 10pt; }
.meta { margin: 0 0 8px; font-size: 10pt; }
.meta table { width: 100%; border-collapse: collapse; }
.meta td { border: none; padding: 0 22px 0 0; text-align: left; white-space: nowrap; }
table { border-collapse: collapse; margin: 0 auto; }
thead th { font-weight: 700; text-align: center; vertical-align: middle; padding: 6px 6px; border: 1px solid #000; white-space: nowrap; }
tbody td { padding: 4px 6px; border: 1px solid #000; text-align: center; vertical-align: middle; white-space: nowrap; }
tbody tr { page-break-inside: avoid; }
thead { display: table-header-group; }
@media print { .no-print { display: none; } }
</style>
</head>
<body>
<h1>安徽三联学院学生名单</h1>
<p class="term">${termText}</p>
<div class="meta"><table>
<colgroup><col width="190"><col width="230"><col width="230"><col width="52"></colgroup>
<tr>
<td>课程：${clean(courseText)}</td>
<td>上课班级：${clean(className) || clean(skbjdm)}</td>
<td>任课教师：${teacherText}</td>
<td style="text-align:right;">共 ${items.length} 人</td>
</tr>
</table></div>
<table>
<colgroup><col width="48"><col width="104"><col width="64"><col width="44"><col width="70"><col width="140"><col width="232"></colgroup>
<thead>
<tr><th>序号</th><th>学号</th><th>姓名</th><th>性别</th><th>修读性质</th><th>专业</th><th>备注</th></tr>
</thead>
<tbody>${rows}</tbody>
</table>
${autoPrint ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 200); });</script>' : ''}
</body>
</html>`;
}

export function buildRosterReportHtml({
  term,
  termLabel,
  kcdm,
  skbjdm,
  courseName,
  department,
  credit,
  teacherCode,
  teacherName,
  teacher,
  items = [],
  weeks = [],
}) {
  const { xn, xq } = parseTerm(term);
  const termText = clean(termLabel) || `${xn}-${xn + 1}学年 第${xq + 1}学期`;
  const courseText = courseName ? (/^\[/.test(courseName) ? courseName : `[${kcdm}]${courseName}`) : `[${kcdm}]`;
  const teacherText = teacherCode ? `[${clean(teacherCode)}]${clean(teacherName) || clean(teacher)}` : clean(teacherName) || clean(teacher);
  const weekCount = Math.max(1, Array.isArray(weeks) && weeks.length ? weeks.length : 16);
  const weekNumbers = Array.from({ length: weekCount }, (_, index) => index + 1);

  const info = [
    [`承担单位：${clean(department) || ''}`, `课程：${clean(courseText)}`, credit ? `学分：${clean(credit)}` : ''],
    [teacherText ? `任课教师：${teacherText}` : '', `上课班级：${clean(skbjdm)}`, `上课人数：${items.length}`],
  ]
    .map(
      (row) =>
        `<tr>${row
          .map((text) => `<td style="border:none;text-align:left;width:33.33%;">${text}</td>`)
          .join('')}</tr>`,
    )
    .join('\n\t\t');

  const weekWidth = (42 / weekCount).toFixed(2);
  const colgroup = `<colgroup>
<col style="width:3%"/><col style="width:11%"/><col style="width:9%"/><col style="width:5%"/><col style="width:3%"/>
<col style="width:11%"/><col style="width:8%"/><col style="width:4%"/>
${weekNumbers.map(() => `<col style="width:${weekWidth}%"/>`).join('')}
<col style="width:4%"/>
</colgroup>`;

  const head = `<tr>
\t\t\t\t<td width="3%" rowspan="2">序号</td>
\t\t\t\t<td width="11%" rowspan="2">行政班级</td>
\t\t\t\t<td width="9%" rowspan="2">学号</td>
\t\t\t\t<td width="5%" rowspan="2">姓名</td>
\t\t\t\t<td width="3%" rowspan="2">性别</td>
\t\t\t\t<td width="11%" rowspan="2">院(系)/部</td>
\t\t\t\t<td width="8%" rowspan="2">专业</td>
\t\t\t\t<td width="4%" rowspan="2">修读<br/>性质</td>
\t\t\t\t<td width="42%" colspan="${weekCount}">日期周次</td>
\t\t\t\t<td width="4%" rowspan="2">备注</td>
\t\t\t</tr>
\t\t\t<tr>${weekNumbers.map((no) => `<td>${no}</td>`).join('')}</tr>`;

  const rows = items
    .map(
      (item) => `<tr>
\t\t\t\t<td style="text-align: center;">${clean(item.index)}</td>
\t\t\t\t<td>${clean(item.className)}</td>
\t\t\t\t<td>${clean(item.studentId)}</td>
\t\t\t\t<td>${clean(item.name)}</td>
\t\t\t\t<td style="text-align: center;">${clean(item.gender)}</td>
\t\t\t\t<td>${clean(item.college)}</td>
\t\t\t\t<td>${clean(item.major)}</td>
\t\t\t\t<td style="text-align: center;">${clean(item.type)}</td>
${weekNumbers.map(() => '\t\t\t\t<td></td>').join('\n')}
\t\t\t\t<td>${clean(item.remark)}</td>
\t\t\t</tr>`,
    )
    .join('\n');

  return `\uFEFF<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>上课点名册</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "SimSun", "宋体", "Microsoft YaHei", sans-serif; color: #000; }
table { border-collapse: collapse; table-layout: fixed; }
td, th { border: 1px solid #000; padding: 0 1px; vertical-align: middle; word-break: break-all; }
th, thead td { text-align: center; font-weight: 700; }
td { text-align: left; }
thead { display: table-row-group; }
</style>
</head>
<body style="font-size:12px">
\t<div pagetitle="pagetitle" style="width:100%;font-size:20px;font-weight:bold;" align="center">
\t\t\t安徽三联学院上课点名册
\t\t\t<div style="font-size:12px;font-weight:bold;">${termText} </div>
\t</div>

\t<div group="group" style="width:100%;text-align:left;font-size:12px;font-weight:normal">
\t\t<table style="width:100%;border:none;font-size:12px;table-layout:fixed;">
\t\t${info}
\t\t</table>
\t </div>
\t <table style="clear:left;width:100%;font-size:11px;" >
\t\t ${colgroup}
\t\t <thead>
\t\t\t${head}
\t\t</thead>
\t\t<tbody>
${rows}
\t\t</tbody>
\t</table>
</body>
</html>`;
}

