import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCourseGradesPdf } from '../server/jwxt/course-grades.mjs';

const PDF = Buffer.from('%PDF-1.7\nfixture');

/** 模拟：生成 + 下载很快，成绩明细（只用于文件名）很慢 */
function metadataSession({ reportDelayMs = 2000, reportHtml = null } = {}) {
  const calls = { topdf: 0, download: 0, report: 0 };
  return {
    calls,
    base: 'https://example.invalid',
    async text(path) {
      if (path.includes('method=topdf')) {
        calls.topdf += 1;
        return { status: 200, text: JSON.stringify({ status: 200, result: 'demo.pdf;;/tmp/demo.pdf' }) };
      }
      if (path.includes('fkcaxzbjckcj_rptOrigina_data.jsp')) {
        calls.report += 1;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, reportDelayMs);
          timer.unref?.();
        });
        return { status: 200, text: reportHtml || '<table><tr><td>暂无</td></tr></table>' };
      }
      return { status: 200, text: '' };
    },
    async request(path) {
      if (path.includes('method=download')) {
        calls.download += 1;
        return { response: new Response(PDF, { headers: { 'content-type': 'application/pdf' } }), buffer: PDF };
      }
      throw new Error(`unexpected request ${path}`);
    },
  };
}

test('成绩 PDF：文件名元数据超时不拖慢已经生成的文件（R08/R17 验收）', async () => {
  const session = metadataSession({ reportDelayMs: 3000 });
  const started = Date.now();
  const result = await exportCourseGradesPdf(session, {
    term: '2025,1',
    kcdm: 'CS101',
    bjdm: '2024CS1',
    bjmc: '2024计算机1班',
    flag: '1',
    dyfs: 'dl',
    courseName: '数据结构',
    className: '2024计算机1班',
    fileName: '数据结构_2024计算机1班_原始成绩',
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1500, `不能被可选元数据拖住（实际 ${elapsed}ms）`);
  assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.filename, '数据结构_2024计算机1班_原始成绩.pdf', '教师名缺失时用可靠回退名');
  assert.equal(session.calls.topdf, 1);
  assert.equal(session.calls.download, 1);
});

test('成绩 PDF：前端已带教师名时不再查询成绩明细', async () => {
  const session = metadataSession();
  const result = await exportCourseGradesPdf(session, {
    term: '2025,1',
    kcdm: 'CS101',
    bjdm: '2024CS1',
    bjmc: '2024计算机1班',
    flag: '1',
    dyfs: 'dl',
    courseName: '数据结构',
    className: '2024计算机1班',
    teacher: '马老师',
  });
  assert.equal(session.calls.report, 0, '已有教师名时不应查询明细');
  assert.equal(result.filename, '马老师_数据结构_2024计算机1班_原始成绩.pdf');
});

test('成绩 PDF：元数据及时返回时按「教师_课程_班级_原始成绩」命名', async () => {
  const html = '<table><tr><td>任课教师：张三</td></tr><tr><td>学号</td><td>姓名</td></tr><tr><td>S001</td><td>李四</td></tr></table>';
  const session = metadataSession({ reportDelayMs: 10, reportHtml: html });
  const result = await exportCourseGradesPdf(session, {
    term: '2025,1',
    kcdm: 'CS101',
    bjdm: '2024CS1',
    bjmc: '2024计算机1班',
    flag: '1',
    dyfs: 'dl',
    courseName: '数据结构',
    className: '2024计算机1班',
  });
  assert.equal(session.calls.report, 1);
  assert.equal(result.filename, '张三_数据结构_2024计算机1班_原始成绩.pdf');
});
