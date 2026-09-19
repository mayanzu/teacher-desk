import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);

// gzip 结果按输入 Buffer 记忆（review R09/R12）：导出缓存命中、静态文件重复 200 时
// 不再对同一份字节反复压缩。WeakMap 让原始 Buffer 被淘汰后压缩结果也可回收。
const gzipCache = new WeakMap();

function gzipMemo(bytes) {
  let pending = gzipCache.get(bytes);
  if (!pending) {
    pending = compress(bytes, { level: 4 })
      .then((compressed) => (compressed.length < bytes.length ? compressed : null))
      .catch(() => null);
    gzipCache.set(bytes, pending);
  }
  return pending;
}

export function acceptsGzip(header = '') {
  const choices = String(header).toLowerCase().split(',').map(part => {
    const [name, ...params] = part.trim().split(';');
    const quality = params.find(param => /^\s*q\s*=/.test(param));
    return [name.trim(), quality ? Number(quality.split('=')[1]) : 1];
  });
  const selected = choices.find(([name]) => name === 'gzip') ?? choices.find(([name]) => name === '*');
  return Boolean(selected && selected[1] > 0 && selected[1] <= 1);
}

// zlib runs asynchronously; small responses and already-compressed files skip compression.
export async function sendBody(req, res, body, headers = {}, compressible = true, status = 200) {
  let bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const outgoing = { ...headers };
  if (compressible) {
    outgoing.Vary = [...new Set(String(res.getHeader('Vary') || '').split(/,\s*/).filter(Boolean).concat('Accept-Encoding'))].join(', ');
    if (bytes.length >= 1024 && acceptsGzip(req.headers['accept-encoding'])) {
      const compressed = await gzipMemo(bytes);
      if (compressed) {
        bytes = compressed;
        outgoing['Content-Encoding'] = 'gzip';
      }
    }
  }
  if (res.destroyed) return;
  res.writeHead(status, { ...outgoing, 'Content-Length': bytes.length });
  res.end(bytes);
}
