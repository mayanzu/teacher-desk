/*
 * 读取 JSON 请求体，带大小上限，且保证 Promise 一定会落定：
 *  - 超过上限时返回 TOO_LARGE，调用方应回 413；
 *  - 连接中断、请求关闭也会 resolve(null)，不会悬挂。
 */
export const TOO_LARGE = Symbol('request body too large');

export const DEFAULT_BODY_LIMIT = 4 * 1024 * 1024;

export function readJson(req, limit = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve) => {
    const declared = Number(req.headers?.['content-length'] || 0);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      resolve(TOO_LARGE);
      return;
    }
    let body = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > limit) {
        body = '';
        finish(TOO_LARGE);
      }
    });
    req.on('end', () => {
      try {
        finish(JSON.parse(body || '{}'));
      } catch {
        finish(null);
      }
    });
    req.on('error', () => finish(null));
    req.on('aborted', () => finish(null));
    req.on('close', () => finish(null));
  });
}
