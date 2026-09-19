import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { acceptsGzip, sendBody } from '../server/response.mjs';
import { sessionAlive } from '../server/sessionHealth.mjs';

test('gzip negotiation honors explicit refusal and wildcard', () => {
  assert.equal(acceptsGzip('br, gzip;q=0, *;q=1'), false);
  assert.equal(acceptsGzip('*;q=0.5'), true);
  assert.equal(acceptsGzip('gzip;q=bad'), false);
  assert.equal(acceptsGzip('GZIP; q=1'), true);
  assert.equal(acceptsGzip(), false);
});

test('compressed JSON download preserves every byte and reduces wire size', async () => {
  const file = randomBytes(256 * 1024);
  const body = JSON.stringify({ filename: '成绩.pdf', contentType: 'application/pdf', base64: file.toString('base64') });
  const server = createServer((req, res) => {
    res.setHeader('Vary', 'Origin');
    void sendBody(req, res, body, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const encoding of ['gzip', 'gzip;q=0']) {
      const result = await new Promise((resolve, reject) => {
        get(`http://127.0.0.1:${server.address().port}`, { headers: { 'Accept-Encoding': encoding } }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ headers: res.headers, bytes: Buffer.concat(chunks) }));
          res.on('error', reject);
        }).on('error', reject);
      });
      assert.match(result.headers.vary, /Origin/);
      assert.match(result.headers.vary, /Accept-Encoding/);
      assert.equal(Number(result.headers['content-length']), result.bytes.length);
      const compressed = encoding === 'gzip';
      assert.equal(result.headers['content-encoding'], compressed ? 'gzip' : undefined);
      if (compressed) assert.ok(result.bytes.length < Buffer.byteLength(body) * 0.8);
      const decoded = JSON.parse((compressed ? gunzipSync(result.bytes) : result.bytes).toString());
      assert.deepEqual(Buffer.from(decoded.base64, 'base64'), file);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('concurrent session checks share a probe; 记忆期内复用结论、关掉记忆后重新校验', async () => {
  const before = process.env.JWXT_SESSION_PROBE_TTL_MS;
  try {
    // 默认（记忆 45 秒）：并发只探一次，且记忆期内不再重复探测上游
    delete process.env.JWXT_SESSION_PROBE_TTL_MS;
    let calls = 0;
    const ctx = { session: { text: async () => { calls++; return { status: 200, text: "_loginid='teacher'" }; } } };
    assert.deepEqual(await Promise.all([sessionAlive(ctx), sessionAlive(ctx), sessionAlive(ctx)]), [true, true, true]);
    assert.equal(calls, 1, '并发探测只打一次上游');
    assert.equal(await sessionAlive(ctx), true);
    assert.equal(calls, 1, '记忆期内复用结论，不再探测上游');

    // JWXT_SESSION_PROBE_TTL_MS=0：恢复「每次请求都重新校验」
    process.env.JWXT_SESSION_PROBE_TTL_MS = '0';
    assert.equal(await sessionAlive(ctx), true);
    assert.equal(calls, 2, '关掉记忆后每次都重新校验');

    // 关掉记忆时，会话在中途被清空 → 结果按最新状态判定
    const pending = sessionAlive(ctx);
    ctx.session = null;
    assert.equal(await pending, false);

    // 关掉记忆时，掉线仍能被发现（不因为记忆机制而漏判）
    process.env.JWXT_SESSION_PROBE_TTL_MS = '0';
    const expired = { session: { text: async () => ({ status: 200, text: 'kingo.guest' }) } };
    assert.equal(await sessionAlive(expired), false);
  } finally {
    if (before === undefined) delete process.env.JWXT_SESSION_PROBE_TTL_MS;
    else process.env.JWXT_SESSION_PROBE_TTL_MS = before;
  }
});

test('failed authentication probe can be retried', async () => {
  let calls = 0;
  const ctx = { session: { text: async () => {
    if (++calls === 1) throw new Error('offline');
    return { status: 200, text: 'kingo.guest' };
  } } };
  await assert.rejects(sessionAlive(ctx), /offline/);
  assert.equal(await sessionAlive(ctx), false);
  assert.equal(calls, 2);
});
