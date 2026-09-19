import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency, fetchConcurrency, DEFAULT_FETCH_CONCURRENCY } from '../server/jwxt/concurrency.mjs';
import { getGrades } from '../server/jwxt/grades-register.mjs';
import { getProgressSummary } from '../server/jwxt/progress.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 统计并发峰值的假 session：text() 按调用次数派发，可注入延迟/错误 */
function countingSession(handler, latency = 5) {
  const state = { inFlight: 0, maxInFlight: 0, calls: 0 };
  return {
    state,
    base: 'https://example.invalid',
    async text(path, init) {
      state.calls += 1;
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        await sleep(latency);
        return handler(path, init, state);
      } finally {
        state.inFlight -= 1;
      }
    },
  };
}

/** 生成 N 个教学班的列表页（字段位置与 tests/fixtures/progress-classes.html 一致） */
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

/** 成绩登记册的假页面：表头 + 一行数据 */
function registerPage(tableId) {
  if (tableId === '5031') {
    return '<table><tr><th>考试轮次</th></tr><tr><td>补考</td><td>课程C</td><td>2</td><td>17</td><td>5</td></tr></table>';
  }
  return '<table><tr><th>环节名称</th></tr><tr><td>课程A</td><td>必修</td><td>4</td><td>1-16</td><td>班1</td><td>组1</td><td>30</td></tr></table>';
}

test('fetchConcurrency 默认 3，环境变量可调，非法值回退默认', () => {
  assert.equal(fetchConcurrency({}), DEFAULT_FETCH_CONCURRENCY);
  assert.equal(fetchConcurrency({ JWXT_FETCH_CONCURRENCY: '2' }), 2);
  assert.equal(fetchConcurrency({ JWXT_FETCH_CONCURRENCY: '1' }), 1);
  assert.equal(fetchConcurrency({ JWXT_FETCH_CONCURRENCY: '0' }), DEFAULT_FETCH_CONCURRENCY);
  assert.equal(fetchConcurrency({ JWXT_FETCH_CONCURRENCY: 'abc' }), DEFAULT_FETCH_CONCURRENCY);
});

test('mapWithConcurrency 遵守并发上限、结果与输入同序', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const results = await mapWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(8);
    inFlight -= 1;
    return item * 10;
  });

  assert.equal(maxInFlight, 3, '并发峰值为 3');
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70], '结果顺序与输入一致');
});

test('mapWithConcurrency 在 limit=1 时退化为串行（与改造前行为一致）', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await mapWithConcurrency([1, 2, 3], 1, async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(3);
    inFlight -= 1;
  });
  assert.equal(maxInFlight, 1);
});

test('mapWithConcurrency 出错后不再派发新任务，并抛出第一个错误', async () => {
  let started = 0;
  await assert.rejects(
    mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      started += 1;
      if (item === 2) throw Object.assign(new Error('登录已过期'), { status: 401 });
      await sleep(5);
      return item;
    }),
    { status: 401 },
  );
  assert.ok(started < 6, `出错后不应继续派发（实际派发 ${started} 个）`);
});

test('mapWithConcurrency 空数组直接返回，不调用 worker', async () => {
  let called = 0;
  const results = await mapWithConcurrency([], 3, async () => {
    called += 1;
  });
  assert.deepEqual(results, []);
  assert.equal(called, 0);
});

test('/api/grades 三张登记表并发拉取，结果顺序与串行一致', async () => {
  const session = countingSession((path) => ({ status: 200, text: registerPage(new URL(`http://x${path}`).searchParams.get('tableId')) }));

  const data = await getGrades(session, '2026,0');

  assert.equal(session.state.calls, 3);
  assert.ok(session.state.maxInFlight >= 2, `应为并发（峰值 ${session.state.maxInFlight}）`);
  assert.deepEqual(
    data.items.map((item) => item.type),
    ['环节成绩', '毕业设计（论文）成绩', '补考成绩'],
    '类型顺序与 GRADE_REGISTERS 一致',
  );
  assert.equal(data.items[0].name, '课程A');
  assert.equal(data.items[2].name, '课程C');
});

test('JWXT_FETCH_CONCURRENCY=1 时成绩登记表回到串行', async () => {
  process.env.JWXT_FETCH_CONCURRENCY = '1';
  try {
    const session = countingSession((path) => ({ status: 200, text: registerPage(new URL(`http://x${path}`).searchParams.get('tableId')) }));
    await getGrades(session, '2026,0');
    assert.equal(session.state.maxInFlight, 1);
  } finally {
    delete process.env.JWXT_FETCH_CONCURRENCY;
  }
});

test('教学进度汇总按并发上限拉取教学班，失败按班级顺序记录', async () => {
  const session = countingSession((path) => {
    if (path.includes('DataTable.jsp')) return { status: 200, text: classesPage(6) };
    return { status: 200, text: '<html>没有表单</html>' }; // 每个班的录入页解析失败 → 记入 failures
  });

  const summary = await getProgressSummary(session, '2026,0');

  assert.equal(session.state.calls, 7, '1 次列表 + 6 个教学班');
  assert.ok(session.state.maxInFlight <= 3, `不得超过默认并发上限（峰值 ${session.state.maxInFlight}）`);
  assert.ok(session.state.maxInFlight >= 2, `应当并发（峰值 ${session.state.maxInFlight}）`);
  assert.deepEqual(summary.items, []);
  assert.deepEqual(
    summary.failures.map((item) => item.className),
    ['2024计算机1班', '2024计算机2班', '2024计算机3班', '2024计算机4班', '2024计算机5班', '2024计算机6班'],
    'failures 顺序与教学班顺序一致（并发不能打乱输出）',
  );
});

test('教学进度汇总遇到 401 仍然整体失败（不因并发而吞掉登录失效）', async () => {
  const session = countingSession((path) => {
    if (path.includes('DataTable.jsp')) return { status: 200, text: classesPage(4) };
    throw Object.assign(new Error('登录已过期，请重新扫码'), { status: 401 });
  });

  await assert.rejects(getProgressSummary(session, '2026,0'), { status: 401 });
});
