import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTasks } from '../server/jwxt/tasks.mjs';
import { getSchedule } from '../server/jwxt/schedule.mjs';
import { getProgressClasses, getProgressSummary, buildProgressCsv } from '../server/jwxt/progress.mjs';
import { getCourseGradesReport } from '../server/jwxt/course-grades.mjs';
import { buildRosterCsv } from '../server/jwxt/roster.mjs';
import { csvCell, csvTextNumber } from '../server/jwxt/common.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(fixtures, name), 'utf8');
const htmlSession = (html) => ({ base: 'https://example.invalid', text: async () => ({ status: 200, text: html }) });

test('tasks page fixture maps course, class and hours', async () => {
  const { items, headers } = await getTasks(htmlSession(fixture('tasks.html')), '2026,0');
  assert.equal(items.length, 1);
  assert.equal(items[0].courseCode, 'CS101');
  assert.equal(items[0].courseName, '程序设计与算法');
  assert.equal(items[0].hours, '64');
  assert.equal(items[0].classNames, '2024计算机1班');
  assert.ok(headers.some((cell) => /课程/.test(cell)));
});

test('schedule fixture parses weeks, parity, room and teacher', async () => {
  const data = await getSchedule(htmlSession(fixture('schedule.html')), '2026,0');
  assert.equal(data.courses.length, 2);
  const english = data.courses.find((course) => course.name === '大学英语');
  assert.deepEqual(
    { day: english.day, slot: english.slot, weeks: english.weeks, parity: english.parity, room: english.room },
    { day: 3, slot: '3-4', weeks: '2-16', parity: 'even', room: 'B楼202' },
  );
  assert.equal(data.teacher, '张三');
  assert.equal(data.maxWeek, 16);
});

test('progress class list fixture yields params for submission', async () => {
  const { items } = await getProgressClasses(htmlSession(fixture('progress-classes.html')), '2026,0');
  assert.equal(items.length, 1);
  assert.equal(items[0].params.kcdm, 'CS101');
  assert.equal(items[0].params.bjdm, '2024CS1');
  assert.equal(items[0].classCode, '2024CS1');
  assert.equal(items[0].className, '2024计算机1班');
});

test('course grade report fixture keeps header and student rows', async () => {
  const report = await getCourseGradesReport(htmlSession(fixture('course-grades.html')), {
    term: '2026,0',
    kcdm: 'CS101',
    bjdm: '2024CS1',
    bjmc: '2024计算机1班',
    flag: '1',
    dyfs: 'dl',
  });
  assert.equal(report.header[0][0].text, '学号');
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0][0], '2024001');
  assert.equal(report.empty, false);
});

test('progress summary reports per-class failure without dropping the rest', async () => {
  const session = {
    base: 'https://example.invalid',
    text: async (path) => {
      if (path.startsWith('/ahsljw/taglib/DataTable.jsp')) return { status: 200, text: fixture('progress-classes.html') };
      return { status: 200, text: '<html>没有表单</html>' };
    },
  };
  const summary = await getProgressSummary(session, '2026,0');
  assert.deepEqual(summary.items, []);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0].className, '2024计算机1班');
});

test('progress summary still aborts when a class read is unauthorized', async () => {
  const session = {
    base: 'https://example.invalid',
    text: async (path) => {
      if (path.startsWith('/ahsljw/taglib/DataTable.jsp')) return { status: 200, text: fixture('progress-classes.html') };
      throw Object.assign(new Error('登录已过期，请重新扫码'), { status: 401 });
    },
  };
  await assert.rejects(getProgressSummary(session, '2026,0'), { status: 401 });
});

test('CSV export neutralizes formulas and preserves numeric text', () => {
  assert.match(csvCell('=1+1'), /^"'=1\+1"$/);
  assert.equal(csvCell('-12'), '"-12"');
  assert.equal(csvTextNumber('001234'), '"=""001234"""');
  assert.equal(csvTextNumber('1234567890123456789'), '"=""1234567890123456789"""');
  assert.equal(csvTextNumber('2024001'), '"2024001"');

  const roster = buildRosterCsv([
    { index: '1', className: '1班', studentId: '0012', name: '=cmd', gender: '男', college: '院', major: '专业', type: '正常', remark: '@x' },
  ]);
  assert.match(roster, /"=""0012"""/);
  assert.match(roster, /"'=cmd"/);
  assert.match(roster, /"'@x"/);

  const progress = buildProgressCsv([{ week: '1', date: '2026-01-01', period: '1-2', classNames: '1班', room: 'A101', content: '+SUM(A1)' }]);
  assert.match(progress, /"'\+SUM\(A1\)"/);
});
