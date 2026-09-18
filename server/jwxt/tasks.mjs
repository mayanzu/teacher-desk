import { parseTable, parseTerm } from './common.mjs';

export async function getTasks(session, term) {
  const { xn, xq } = parseTerm(term);
  const res = await session.text('/ahsljw/wjstgdfw/jxrw.cdkc_rpt.jsp', {
    method: 'POST',
    referer: `${session.base}/ahsljw/wjstgdfw/jxrw.cdkc.html?menucode=T20101`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `sel_xnxq=${xn},${xq}&sel_xnxqh=${xn},${xq}&xn1=${xn}&xq=${xq}&bhcx=`,
  });
  const rows = parseTable(res.text);
  const headerIndex = rows.findIndex((row) => row.some((c) => /课程/.test(c)) && row.some((c) => /学时|学分/.test(c)));
  if (headerIndex < 0) return { items: [], headers: [] };
  const headers = rows[headerIndex];
  const items = rows
    .slice(headerIndex + 1)
    .filter((row) => /^\d+$/.test((row[0] || '').trim()))
    .map((row) => {
      const cell = (index) => String(row[index] ?? '').trim();
      const courseRaw = cell(2);
      const match = courseRaw.match(/^\[([^\]]+)\]\s*(.*)$/);
      return {
        courseCode: match?.[1] || '',
        courseName: (match?.[2] || courseRaw).trim(),
        department: cell(1),
        credit: cell(3),
        hours: cell(4),
        weeks: cell(11),
        parity: cell(12),
        mode: cell(13),
        exam: cell(14),
        classNo: cell(15),
        students: cell(17),
        classNames: cell(18),
      };
    });
  return { items, headers };
}

