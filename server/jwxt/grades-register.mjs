import { parseTable, parseTerm } from './common.mjs';
import { fetchConcurrency, mapWithConcurrency } from './concurrency.mjs';

const GRADE_REGISTERS = [
  {
    type: '环节成绩',
    tableId: '5023',
    page: 'cjlr.dycddjc.fhjaxzbjzcdycjdjc.html?menucode=T30103',
    header: '环节名称',
    map: (row) => ({
      name: row[0] ?? '',
      category: row[1] ?? '',
      credit: row[2] ?? '',
      weeks: row[3] ?? '',
      className: row[4] ?? '',
      group: row[5] ?? '',
      students: row[6] ?? '',
    }),
  },
  {
    type: '毕业设计（论文）成绩',
    tableId: '5027',
    page: 'cjlr.dycddjc.fbynjazydybyshjcjdjc.html?menucode=T30104',
    header: '环节名称',
    map: (row) => ({
      name: row[0] ?? '',
      category: row[1] ?? '',
      credit: row[2] ?? '',
      weeks: row[3] ?? '',
      className: row[4] ?? '',
      group: row[5] ?? '',
      students: row[6] ?? '',
    }),
  },
  {
    type: '补考成绩',
    tableId: '5031',
    page: 'cjlr.dycddjc.fkcarkjsdybkcjdjc.html?menucode=T30106',
    header: '考试轮次',
    map: (row) => ({
      name: row[1] ?? '',
      category: row[0] ?? '',
      credit: row[2] ?? '',
      weeks: row[3] ?? '',
      className: '',
      group: '',
      students: row[4] ?? '',
    }),
  },
];

export async function getGrades(session, term) {
  const { xn, xq } = parseTerm(term);
  const body = `xn=${xn}&xn1=${xn}&xq=${xq}&xq_m=${xq}&hjdm=&bjdm=&ykrs=&zuc=&kcorhj=0&sfkfcjzt=0&kchjC=0&kchj=0&hidKey=&hidOption=QRY`;
  const items = [];
  let responded = false;
  // 三张登记表彼此独立：先并发拉回，再按下标顺序解析，结果与串行时完全一致
  const responses = await mapWithConcurrency(GRADE_REGISTERS, fetchConcurrency(), (register) =>
    session.text(`/ahsljw/taglib/DataTable.jsp?tableId=${register.tableId}`, {
      method: 'POST',
      referer: `${session.base}/ahsljw/wjstgdfw/${register.page}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    }),
  );
  for (let index = 0; index < GRADE_REGISTERS.length; index += 1) {
    const register = GRADE_REGISTERS[index];
    const rows = parseTable(responses[index].text);
    const headerIndex = rows.findIndex((row) => row.includes(register.header));
    if (headerIndex < 0) throw Object.assign(new Error('成绩登记册页面结构异常'), { status: 502 });
    responded = true;
    for (const row of rows.slice(headerIndex + 1)) {
      if (!row.some((cell) => cell !== '')) continue;
      const mapped = register.map(row);
      if (!mapped.name) continue;
      items.push({ type: register.type, ...mapped });
    }
  }
  return {
    items,
    note: items.length ? '' : responded ? '该学期暂无成绩登记册记录' : '成绩登记册接口未返回数据',
  };
}

// ===== 分课程按行政班级查看成绩（主控 > 成绩录入 > 查看学生成绩 > 查看课程成绩）=====
