import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['web/src/lib/exportRunner.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral' });
const { createExportRunner } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('导出等待态：点击立刻进入、成功与失败都会恢复、等待期间连点被忽略', async () => {
  const runner = createExportRunner();
  const snapshots = [];
  runner.subscribe((keys) => snapshots.push([...keys]));

  const gate = deferred();
  let calls = 0;

  const first = runner.run('self', async () => {
    calls += 1;
    await gate.promise;
  });
  assert.equal(runner.isPending('self'), true, '点下去马上进入等待态（按钮可以立刻转圈）');
  assert.deepEqual(snapshots.at(-1), ['self'], '订阅者立刻收到等待态');

  // 等待期间连点：忽略，不会重复发起导出
  assert.equal(await runner.run('self', async () => { calls += 1; }), false);
  assert.equal(calls, 1, '同一份导出只跑一次');

  gate.resolve();
  assert.equal(await first, true);
  assert.equal(runner.isPending('self'), false, '导出完成后恢复按钮');
  assert.deepEqual(snapshots.at(-1), [], '订阅者收到恢复');

  // 失败也要恢复，否则按钮永远卡在「导出中…」
  await assert.rejects(
    runner.run('self', async () => {
      throw new Error('导出失败');
    }),
    /导出失败/,
  );
  assert.equal(runner.isPending('self'), false, '失败时也必须恢复按钮');
  assert.deepEqual(snapshots.at(-1), [], '失败也会通知恢复');

  // 恢复之后可以再次导出
  assert.equal(await runner.run('self', async () => { calls += 1; }), true);
  assert.equal(calls, 2);
});

test('不同按钮各自独立：一个在导出不影响另一个', async () => {
  const runner = createExportRunner();
  const gate = deferred();
  const slow = runner.run('a', () => gate.promise);
  assert.equal(runner.isPending('a'), true);
  assert.equal(runner.isPending('b'), false);
  assert.equal(await runner.run('b', async () => {}), true, '另一个按钮照样能导出');
  gate.resolve();
  await slow;
  assert.equal(runner.isPending('a'), false);
});
