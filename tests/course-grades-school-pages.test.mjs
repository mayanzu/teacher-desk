import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getCourseGradesReport, exportCourseGradesPdf, exportCourseGradesExcel } from '../server/jwxt/course-grades.mjs';
import { requireDownload } from '../server/jwxt/common.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const REPORT = readFileSync(join(fixtures, 'course-grades-report.html'), 'utf8');
const PDF = Buffer.from('%PDF-1.7\nfixture');
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
const XLS_HTML = Buffer.from('<table><tr><td>学号</td></tr><tr><td>S0001</td></tr></table>');
const NOT_FOUND = () => Object.assign(new Error('教务系统响应异常（HTTP 404）'), { status: 502 });
const SCHOOL_CODE_JS = "var G_SCHOOL_CODE = '109591'; var G_SCHOOL_NAME = '安徽三联学院';";
const REPORT_PARAMS = { term: '2025,1', kcdm: 'CS101', bjdm: '2024CS1', bjmc: '2024计算机1班', flag: '1', dyfs: 'dl' };
const PDF_PARAMS = {
  ...REPORT_PARAMS,
  courseName: '数据结构',
  className: '2024计算机1班',
  fileName: '数据结构_2024计算机1班_原始成绩',
  title: '分课程按行政班级查看成绩',
  teacher: '马老师',
};

let seq = 0;
/** 模拟教务会话：记录所有 text/request 路径，路由表可按需覆盖（函数可抛 404）。 */
function mockSession({ schoolCodeJs = '', textRoutes = {}, requestRoutes = {} } = {}) {
  const base = `https://grades-${(seq += 1)}.test`;
  const calls = { text: [], request: [] };
  const run = (routes, path, init) => {
    for (const [match, handler] of Object.entries(routes)) {
      if (!path.includes(match)) continue;
      return typeof handler === 'function' ? handler(path, init) : handler;
    }
    return undefined;
  };
  return {
    base,
    calls,
    paths: {
      setRootPath: () => calls.text.filter((call) => call.path.includes('SetRootPath')).length,
      text: (needle) => calls.text.filter((call) => call.path.includes(needle)).length,
      request: (needle) => calls.request.filter((call) => call.path.includes(needle)).length,
    },
    async text(path, init) {
      calls.text.push({ path, init });
      if (path.includes('SetRootPath')) return { status: 200, text: schoolCodeJs };
      if (path.includes('method=topdf')) {
        return { status: 200, text: JSON.stringify({ status: 200, result: 'demo.pdf;;/tmp/demo.pdf' }) };
      }
      const routed = run(textRoutes, path, init);
      if (routed !== undefined) return routed;
      return { status: 200, text: '' };
    },
    async request(path, init) {
      calls.request.push({ path, init });
      if (path.includes('method=download')) {
        return { response: new Response(PDF, { headers: { 'content-type': 'application/pdf' } }), buffer: PDF };
      }
      const routed = run(requestRoutes, path, init);
      if (routed !== undefined) return routed;
      throw NOT_FOUND();
    },
  };
}

const xlsResult = (buffer, type = 'application/vnd.ms-excel') => ({
  response: new Response(buffer, { headers: { 'content-type': type } }),
  buffer,
});

test('视图优先请求学校专属报表页（G_SCHOOL_CODE 路由，含 40-0 分数段），学校代码只查一次', async () => {
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    textRoutes: { 'rptOrigina109591_data.jsp': { status: 200, text: REPORT } },
  });
  const report = await getCourseGradesReport(session, REPORT_PARAMS);
  assert.equal(report.rows.length, 2);
  assert.ok(session.paths.text('rptOrigina109591_data.jsp') >= 1, '应请求学校专属页');
  assert.equal(session.paths.text('fkcaxzbjckcj_rptOrigina_data.jsp'), 0, '学校页可用时不再请求通用页');

  await getCourseGradesReport(session, REPORT_PARAMS);
  assert.equal(session.paths.setRootPath(), 1, '学校代码全局只解析一次');
  assert.ok(session.paths.text('rptOrigina109591_data.jsp') >= 2, '学校页结论被缓存复用');
});

test('学校专属页 404 时回退通用页，并缓存结论（不重复探测学校页）', async () => {
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    textRoutes: {
      'rptOrigina109591_data.jsp': () => { throw NOT_FOUND(); },
      'fkcaxzbjckcj_rptOrigina_data.jsp': { status: 200, text: REPORT },
    },
  });
  const first = await getCourseGradesReport(session, REPORT_PARAMS);
  assert.equal(first.rows.length, 2);
  assert.equal(session.paths.text('rptOrigina109591_data.jsp'), 1, '首次探测学校页');

  const second = await getCourseGradesReport(session, { ...REPORT_PARAMS, kcdm: 'CS102' });
  assert.equal(second.rows.length, 2);
  assert.equal(session.paths.text('rptOrigina109591_data.jsp'), 1, '结论已缓存：不再探测学校页');
  assert.equal(session.paths.text('fkcaxzbjckcj_rptOrigina_data.jsp'), 2, '每次视图仍取通用页内容');
});

test('取不到学校代码时直接走通用页（与旧行为一致），学校代码成功解析即缓存', async () => {
  const session = mockSession({
    schoolCodeJs: 'var OTHER = 1;',
    textRoutes: { 'fkcaxzbjckcj_rptOrigina_data.jsp': { status: 200, text: REPORT } },
  });
  await getCourseGradesReport(session, REPORT_PARAMS);
  await getCourseGradesReport(session, REPORT_PARAMS);
  assert.equal(session.paths.setRootPath(), 1, '无学校代码也只查一次');
  assert.ok(!session.calls.text.some((call) => call.path.includes('109591')), '不应尝试学校专属页');
  assert.equal(session.paths.text('fkcaxzbjckcj_rptOrigina_data.jsp'), 2);
});

test('成绩 PDF：pageurl 使用学校专属报表页（导出与教务「导出PDF」同源，含 40-0 分数段）', async () => {
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    textRoutes: { 'rptOrigina109591_data.jsp': { status: 200, text: REPORT } },
  });
  const result = await exportCourseGradesPdf(session, PDF_PARAMS);
  assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.filename, '马老师_数据结构_2024计算机1班_原始成绩.pdf');
  const topdf = session.calls.text.find((call) => call.path.includes('method=topdf'));
  assert.ok(topdf, '应调用 topdf');
  assert.ok(String(topdf.init.body).includes('rptOrigina109591_data.jsp'), `pageurl 应为学校专属页，实际 ${topdf.init.body}`);
});

test('成绩 PDF：没有学校代码时 pageurl 回退通用报表页', async () => {
  const session = mockSession({ schoolCodeJs: '' });
  await exportCourseGradesPdf(session, PDF_PARAMS);
  const topdf = session.calls.text.find((call) => call.path.includes('method=topdf'));
  assert.ok(String(topdf.init.body).includes('fkcaxzbjckcj_rptOrigina_data.jsp'), `pageurl 应为通用页，实际 ${topdf.init.body}`);
  assert.ok(!String(topdf.init.body).includes('109591'), '无学校代码不应出现学校页');
});

test('成绩 Excel：改走教务最新 _data_exp.jsp（doExport 同源，含 40-0 分数段），不再用 excel.action', async () => {
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    requestRoutes: { 'rptOrigina109591_data_exp.jsp': xlsResult(XLS_HTML) },
  });
  const result = await exportCourseGradesExcel(session, { ...REPORT_PARAMS, fileName: '数据结构_班级_原始成绩' });
  assert.equal(result.filename, '数据结构_班级_原始成绩.xls');
  assert.equal(result.buffer, XLS_HTML);
  assert.equal(session.paths.request('rptOrigina109591_data_exp.jsp'), 1);
  assert.equal(session.paths.request('excel.action'), 0, '学校页可用时不再用旧接口');
});

test('成绩 Excel：学校专属导出页 404 时回退通用导出页', async () => {
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    requestRoutes: {
      'rptOrigina109591_data_exp.jsp': () => { throw NOT_FOUND(); },
      'fkcaxzbjckcj_rptOrigina_data_exp.jsp': xlsResult(XLS_HTML),
    },
  });
  const result = await exportCourseGradesExcel(session, REPORT_PARAMS);
  assert.equal(result.buffer, XLS_HTML);
  assert.equal(session.paths.request('fkcaxzbjckcj_rptOrigina_data_exp.jsp'), 1);
  assert.equal(session.paths.request('excel.action'), 0, '通用导出页可用时不退回旧接口');
});

test('成绩 Excel：新旧 _data_exp.jsp 都不存在时才退回旧 excel.action', async () => {
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    requestRoutes: {
      'rptOrigina109591_data_exp.jsp': () => { throw NOT_FOUND(); },
      'fkcaxzbjckcj_rptOrigina_data_exp.jsp': () => { throw NOT_FOUND(); },
      'excel.action': xlsResult(OLE2),
    },
  });
  const result = await exportCourseGradesExcel(session, REPORT_PARAMS);
  assert.equal(result.buffer, OLE2);
  assert.equal(session.paths.request('excel.action'), 1, '两级导出页都缺失才用旧接口');
});

test('成绩 Excel：教务返回「没有检索到记录」时给出明确空班级错误', async () => {
  const empty = Buffer.from('<html><body>没有检索到记录!</body></html>');
  const session = mockSession({
    schoolCodeJs: SCHOOL_CODE_JS,
    requestRoutes: { 'rptOrigina109591_data_exp.jsp': xlsResult(empty) },
  });
  await assert.rejects(exportCourseGradesExcel(session, REPORT_PARAMS), /暂无成绩记录/);
});

test('requireDownload 拒绝教务 HTML 错误页（即使 content-type 看起来合法）', () => {
  const errorPage = Buffer.from('<html><body>系统访问异常，请联系系统管理员！异常信息：xxx</body></html>');
  for (const type of ['text/html;charset=UTF-8', 'application/vnd.ms-excel']) {
    assert.throws(
      () => requireDownload({ response: new Response(errorPage, { headers: { 'content-type': type } }), buffer: errorPage }, 'xls'),
      /有效文件/,
      `content-type=${type} 时不应把错误页当作成果文件`,
    );
  }
});
