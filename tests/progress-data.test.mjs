import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheStore } from '../server/cache.mjs';
import { loadProgressSummary, loadProgressEntry, invalidateProgressAfterSave } from '../server/data.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCtx() {
  return {
    cache: new CacheStore({ max: 200, maxBytes: 8 * 1024 * 1024 }),
    exports: new CacheStore({ max: 20, maxBytes: 8 * 1024 * 1024 }),
    inflight: new Map(),
    generation: 0,
    session: null,
  };
}

function countingSession(handler) {
  const state = { calls: 0, byPath: new Map() };
  const paths = [];
  return {
    state,
    paths,
    base: 'https://example.invalid',
    async text(path, init) {
      state.calls += 1;
      paths.push(path);
      const key = path.split('?')[0];
      state.byPath.set(key, (state.byPath.get(key) || 0) + 1);
      await sleep(2);
      return handler(path, init, state);
    },
  };
}

/** 教学班列表页（1 + N 个班），字段与 tests/fixtures/progress-classes.html 一致 */
function classesPage(count) {
  const rows = [];
  const adds = [];
  for (let i = 1; i <= count; i += 1) {
    const code = `CS10${i}`;
    const classCode = `2024CS${i}`;
    const className = `2024计算机${i}班`;
    rows.push(
      `  <tr>\n    <td>${i}</td><td>[${code}]课程${i}</td><td>4</td><td>64</td><td></td><td></td>\n    <td>${className}</td><td></td><td></td><td>张三[001]</td><td></td><td>已审核</td>\n    <td></td><td></td><td></td><td>2026-01-01</td>\n  </tr>`,
    );
    adds.push(
      `  doAdd('${code}','32','0','0','0','0','${classCode}','[${code}]课程${i}','${className}','${classCode}','0','T001','张三[001]','');`,
    );
  }
  return `<html><body>\n<table id="progressList">\n  <tr>\n    <th>序号</th><th>课程名称</th><th>学分</th><th>学时</th><th>x1</th><th>x2</th>\n    <th>上课班级</th><th>x3</th><th>x4</th><th>任课教师</th><th>x5</th><th>审核状态</th>\n    <th>x6</th><th>x7</th><th>x8</th><th>录入时间</th>\n  </tr>\n${rows.join('\n')}\n</table>\n<script>\n${adds.join('\n')}\n</script>\n</body></html>`;
}

const formPage = (classCode) =>
  `<html><body><form><input type="hidden" name="jxjcb.test" value="1">`
  + `<input type="hidden" name="teachingTaskId" value="${classCode}"></form></body></html>`;

/** 有数据的录入表格：只保留汇总需要的 周次/内容 两个字段 */
function gridRows(text) {
  return `<table><tr><td id="tr1_zjbs">1</td><td id="tr1_zc">1</td><td id="tr1_jsnr">${text}</td></tr></table>`;
}

/** 有结构、有明确空标记、且不是“空白小页”的合法空表 */
function emptyGrid() {
  const header = '<tr>' + ['周次', '日期', '节次', '授课内容', '备注', '讲授课时', '实践课时', '其它']
    .map((label) => `<th>${label}</th>`).join('') + '</tr>';
  const note = '暂无记录，请先确认课程安排是否已经下达；如果确实没有安排，可以直接返回教学班列表查看其它班级。'
    + '如果认为该教学班应该有进度安排，请稍后刷新重试，或联系教务处确认课程任务数据是否完整。';
  return `<html><body><table>${header}<tr><td colspan="8">${note}</td></tr></table></body></html>`;
}

test('教学进度汇总复用班级/表格缓存：N 个班 1 + 2N 次请求，重复访问不再回源', async () => {
  const ctx = createCtx();
  const session = countingSession((path, init) => {
    if (path.startsWith('/ahsljw/taglib/DataTable.jsp')) return { status: 200, text: classesPage(3) };
    if (path.includes('edit10319.jsp')) {
      const code = new URL(`https://x/${path}`).searchParams.get('kcdm') || 'CS101';
      return { status: 200, text: formPage(code) };
    }
    if (path.includes('DataTable_utf8.jsp')) {
      const body = String(init?.body || '');
      const code = /teachingTaskId=([^&]+)/.exec(body)?.[1] || 'CS101';
      return { status: 200, text: gridRows(`${code}-第1周内容`) };
    }
    if (path.includes('getXqskzs')) return { status: 200, text: '18' };
    return { status: 200, text: '<html>无</html>' };
  });

  const summary = await loadProgressSummary(ctx, session, '2026,0');
  assert.equal(summary.items.length, 3);
  assert.equal(session.state.calls, 7, `应 1 次列表 + 每个班 2 次（表单+表格），实际 ${session.state.calls}`);
  assert.equal(session.state.byPath.get('/ahsljw/taglib/DataTable_utf8.jsp'), 3);
  assert.equal(session.state.byPath.get('/ahsljw/wjstgdfw/jxap.lrjxjdb.edit10319.jsp'), 3);

  // 汇总再次访问：命中会话缓存
  const again = await loadProgressSummary(ctx, session, '2026,0');
  assert.deepEqual(again, summary);
  assert.equal(session.state.calls, 7, '重复汇总不应回源');

  // 汇总拉过的表格行，打开编辑明细时复用（表单元数据仍现拉）
  const before = session.state.calls;
  const entry = await loadProgressEntry(ctx, session, '2026,0', { kcdm: 'CS101', bjdm: '2024CS1' });
  assert.equal(entry.rows.length, 1);
  assert.ok(entry.meta['jxjcb.test'], '编辑表单元数据仍然现拉');
  const added = session.state.calls - before;
  assert.equal(added, 2, `编辑明细只应补 1 次表单 + 1 次学期周数（实际 ${added}）`);
  assert.equal(session.state.byPath.get('/ahsljw/taglib/DataTable_utf8.jsp'), 3, '表格不应重复拉取');
  assert.equal(session.state.byPath.get('/ahsljw/jw/common/getXqskzs.action'), 1, '学期周数按学期共享一次');

  ctx.cache.destroy();
  ctx.exports.destroy();
});

test('已验证表格上的合法空表不再遍历其余候选（含 5 次表格探测降到 1 次）', async () => {
  const ctx = createCtx();
  const emptyCalls = [];
  const session = countingSession((path, init) => {
    if (path.startsWith('/ahsljw/taglib/DataTable.jsp')) return { status: 200, text: classesPage(2) };
    if (path.includes('edit10319.jsp')) {
      const code = new URL(`https://x/${path}`).searchParams.get('kcdm') || 'CS101';
      return { status: 200, text: formPage(code) };
    }
    if (path.includes('DataTable_utf8.jsp')) {
      const tableId = new URL(`https://x/${path}`).searchParams.get('tableId');
      const body = String(init?.body || '');
      const code = /teachingTaskId=([^&]+)/.exec(body)?.[1] || '';
      if (code === 'CS101' && tableId === '5529052') return { status: 200, text: gridRows('第一周内容') };
      emptyCalls.push(`${code}:${tableId}`);
      return { status: 200, text: emptyGrid() };
    }
    if (path.includes('getXqskzs')) return { status: 200, text: '18' };
    return { status: 200, text: '<html>无</html>' };
  });

  const first = await loadProgressEntry(ctx, session, '2026,0', { kcdm: 'CS101', bjdm: '2024CS1' });
  assert.equal(first.rows.length, 1);
  const callsAfterFirst = session.state.byPath.get('/ahsljw/taglib/DataTable_utf8.jsp');

  const second = await loadProgressEntry(ctx, session, '2026,0', { kcdm: 'CS102', bjdm: '2024CS2' });
  assert.equal(second.rows.length, 0, '第二个班是合法空表');
  const addedGridCalls = session.state.byPath.get('/ahsljw/taglib/DataTable_utf8.jsp') - callsAfterFirst;
  assert.equal(addedGridCalls, 1, `已验证表格命中后空表只应 1 次探测（实际 ${addedGridCalls}）`);
  assert.deepEqual(emptyCalls, ['CS102:5529052']);

  ctx.cache.destroy();
  ctx.exports.destroy();
});

test('保存后定向失效：进度数据清掉，课表/任务/成绩缓存保留', () => {
  const ctx = createCtx();
  const now = Date.now();
  ctx.cache.set('progressSummary:2026,0', { at: now, value: { items: [] } });
  ctx.cache.set('progress:2026,0', { at: now, value: { items: [] } });
  ctx.cache.set('progressGrid:2026,0:CS101:2024CS1', { at: now, value: { rows: [] } });
  ctx.cache.set('progressClasses:2026,0', { at: now, value: { items: [] } });
  ctx.cache.set('scheduleWeek:2026,0:1', { at: now, value: { courses: [] } });
  ctx.cache.set('tasks:2026,0', { at: now, value: { items: [] } });
  ctx.cache.set('courseGradeClasses:2026,0', { at: now, value: { items: [] } });
  ctx.cache.set('progressSummary:2025,1', { at: now, value: { items: [] } });
  ctx.exports.set('exportProgressPdf:{"term":"2026,0","kcdm":"CS101"}', { at: now, value: { filename: 'a.pdf', buffer: Buffer.from('x') } });
  ctx.exports.set('exportCourseGradesPdf:{"term":"2026,0","kcdm":"CS101"}', { at: now, value: { filename: 'b.pdf', buffer: Buffer.from('y') } });
  ctx.inflight.set('progressSummary:2026,0', Promise.resolve());
  ctx.inflight.set('scheduleWeek:2026,0:1', Promise.resolve());

  invalidateProgressAfterSave(ctx, '2026,0');

  assert.equal(ctx.cache.get('progressSummary:2026,0'), undefined);
  assert.equal(ctx.cache.get('progress:2026,0'), undefined);
  assert.equal(ctx.cache.get('progressGrid:2026,0:CS101:2024CS1'), undefined);
  assert.equal(ctx.cache.get('progressClasses:2026,0'), undefined);
  assert.ok(ctx.cache.get('scheduleWeek:2026,0:1'), '课表缓存必须保留');
  assert.ok(ctx.cache.get('tasks:2026,0'), '教学任务缓存必须保留');
  assert.ok(ctx.cache.get('courseGradeClasses:2026,0'), '成绩列表缓存必须保留');
  assert.ok(ctx.cache.get('progressSummary:2025,1'), '其它学期不受影响');
  assert.equal(ctx.exports.get('exportProgressPdf:{"term":"2026,0","kcdm":"CS101"}'), undefined);
  assert.ok(ctx.exports.get('exportCourseGradesPdf:{"term":"2026,0","kcdm":"CS101"}'), '成绩导出不受进度保存影响');
  assert.equal(ctx.inflight.has('progressSummary:2026,0'), false);
  assert.equal(ctx.inflight.has('scheduleWeek:2026,0:1'), true);

  ctx.cache.destroy();
  ctx.exports.destroy();
});
