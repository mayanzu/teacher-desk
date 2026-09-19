import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);

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
export async function sendBody(req, res, body, headers = {}, compressible = true) {
  let bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const outgoing = { ...headers };
  if (compressible) {
    outgoing.Vary = [...new Set(String(res.getHeader('Vary') || '').split(/,\s*/).filter(Boolean).concat('Accept-Encoding'))].join(', ');
    if (bytes.length >= 1024 && acceptsGzip(req.headers['accept-encoding'])) {
      const compressed = await compress(bytes, { level: 4 });
      if (compressed.length < bytes.length) {
        bytes = compressed;
        outgoing['Content-Encoding'] = 'gzip';
      }
    }
  }
  if (res.destroyed) return;
  res.writeHead(200, { ...outgoing, 'Content-Length': bytes.length });
  res.end(bytes);
}
