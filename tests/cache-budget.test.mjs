import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheStore, estimateSize, freshEntry, MAX_CACHED_OBJECT_BYTES, cached } from '../server/cache.mjs';

const entry = (value) => ({ at: Date.now(), value });

test('estimateSize 区分字符串/数组/Buffer，量级合理', () => {
  assert.ok(estimateSize('a'.repeat(1000)) >= 2000);
  assert.ok(estimateSize(Buffer.alloc(4096)) >= 4096);
  assert.ok(estimateSize({ a: 1, b: [1, 2, 3] }) > 0);
  assert.ok(estimateSize(null) > 0);
});

test('条数上限按最近最少使用淘汰', () => {
  const store = new CacheStore({ max: 2, maxBytes: 1024 * 1024 });
  store.set('a', entry(1));
  store.set('b', entry(2));
  store.get('a'); // 触碰 a，b 变为最旧
  store.set('c', entry(3));
  assert.equal(store.get('b'), undefined);
  assert.equal(store.get('a'), 1);
  assert.equal(store.get('c'), 3);
  store.destroy();
});

test('字节预算生效：超预算时释放内存', () => {
  const store = new CacheStore({ max: 100, maxBytes: 3000 });
  store.set('a', entry('x'.repeat(800)));
  store.set('b', entry('y'.repeat(800)));
  assert.ok(store.bytes <= 3000, `实际 ${store.bytes}`);
  store.set('c', entry('z'.repeat(800)));
  assert.ok(store.bytes <= 3000);
  assert.ok(store.size <= 2, '应至少淘汰一项');
  store.destroy();
});

test('单对象超过准入上限时不入缓存，调用方按未命中处理', () => {
  const store = new CacheStore({ max: 10, maxBytes: MAX_CACHED_OBJECT_BYTES * 2 });
  const oversized = Buffer.alloc(MAX_CACHED_OBJECT_BYTES + 1024);
  assert.equal(store.set('big', entry(oversized)), false);
  assert.equal(store.get('big'), undefined);
  assert.equal(store.size, 0);
  store.destroy();
});

test('sweep 只清过期项，freshEntry 对过期项返回 undefined', () => {
  const store = new CacheStore({ max: 10, maxBytes: 1024 * 1024 });
  const now = Date.now();
  store.set('old', { at: now - 60_000, value: 'old' });
  store.set('fresh', { at: now, value: 'fresh' });
  assert.equal(freshEntry(store, 'old', 1000, now), undefined);
  assert.equal(freshEntry(store, 'fresh', 1000, now), 'fresh');
  const removed = store.sweep(() => 1000, now);
  assert.equal(removed, 1);
  assert.equal(store.size, 1);
  store.destroy();
});

test('cached：inflight 被定向失效清除后，旧结果不写回缓存', async () => {
  const ctx = {
    cache: new CacheStore({ max: 10, maxBytes: 1024 * 1024 }),
    exports: new CacheStore({ max: 10, maxBytes: 1024 * 1024 }),
    inflight: new Map(),
    generation: 0,
  };
  let resolve;
  const pending = cached(ctx, 'progressSummary:2026,0', () => new Promise((r) => { resolve = r; }));
  // 模拟保存后的定向失效：清掉 inflight，旧的汇总不能在保存后才写回
  ctx.inflight.delete('progressSummary:2026,0');
  resolve({ items: [] });
  await pending;
  assert.equal(ctx.cache.get('progressSummary:2026,0'), undefined);
  ctx.cache.destroy();
  ctx.exports.destroy();
});

test('sweep 尊重条目自带 TTL：长 TTL 的导出缓存不会被默认 5 分钟误清', () => {
  const store = new CacheStore({ max: 10, maxBytes: 1024 * 1024 });
  const now = Date.now();
  store.set('exportProgressPdf:x', { at: now - 10 * 60_000, value: 'pdf', ttl: 30 * 60_000 });
  store.set('progressSummary:2026,0', { at: now - 10 * 60_000, value: 'stale' });
  assert.equal(store.sweep(() => 5 * 60_000, now), 1);
  assert.equal(store.get('exportProgressPdf:x'), 'pdf');
  assert.equal(store.get('progressSummary:2026,0'), undefined);
  store.destroy();
});
