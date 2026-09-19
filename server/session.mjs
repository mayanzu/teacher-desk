import { config } from './config.mjs';
import { scheduleRequest } from './jwxt/scheduler.mjs';
import { addCount, addTiming, currentScope } from './perf.mjs';

function decode(buffer, headers) {
  const contentType = (headers.get('content-type') || '').toLowerCase();
  const charset = contentType.match(/charset=([\w-]+)/)?.[1] || (contentType.includes('json') ? 'utf-8' : 'gbk');
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

function requestTimeoutMs() {
  const raw = Number(process.env.JWXT_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30000;
}

function abortLike(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

export class JwxtSession {
  constructor(base = config.base) {
    this.base = base.replace(/\/+$/, '');
    this.origin = new URL(this.base).origin;
    this.host = new URL(this.base).host;
    this.cookies = new Map();
    this.username = '';
    this.landingUrl = '';
    this.referer = `${this.base}/ahsljw/frame/homes.action`;
  }

  resolve(path) {
    let url = new URL(path, this.base);
    // 站点部分跳转使用 http，同主机时统一升级为 https
    if (url.host === this.host && url.protocol === 'http:' && this.base.startsWith('https')) {
      url = new URL(url.toString().replace(/^http:/, 'https:'));
    }
    if (url.origin !== this.origin) throw new Error(`拒绝请求非同源地址：${url.origin}`);
    return url.toString();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  storeCookies(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const cookieValue = pair.slice(index + 1).trim();
      if (cookieValue) this.cookies.set(name, cookieValue);
      else this.cookies.delete(name);
    }
  }

  /**
   * 实际的上游 fetch。调度器在这里生效（同一会话 + 同一教务源全局上限 + 优先级），
   * 额度覆盖到响应体读完，避免收到响应头就释放。
   */
  async request(path, init = {}) {
    const url = this.resolve(path);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TeacherDesk/0.1',
      Referer: init.referer || this.referer,
      ...(init.headers || {}),
    };
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    const { priority, referer, ...fetchInit } = init;
    void referer;
    const scope = currentScope();
    const externalSignal = init.signal || scope?.signal || null;
    return scheduleRequest(this, async () => {
      const signal = externalSignal || AbortSignal.timeout(requestTimeoutMs());
      const startedAt = performance.now();
      let response;
      try {
        response = await fetch(url, { ...fetchInit, signal, headers, redirect: fetchInit.redirect || 'manual' });
      } catch (error) {
        if (abortLike(error)) {
          if (externalSignal?.aborted) throw Object.assign(new Error('请求已取消'), { status: 499, name: 'AbortError' });
          throw Object.assign(new Error('教务系统响应超时，请稍后重试'), { status: 504 });
        }
        throw Object.assign(new Error('教务系统暂时无法连接，请稍后重试'), { status: 503 });
      }
      addTiming('upstream', performance.now() - startedAt);
      addCount('upstreamRequests');
      if (!response.ok) {
        const auth = response.status === 401 || /cas\/login/i.test(response.headers.get('location') || '');
        throw Object.assign(new Error(auth ? '登录已过期，请重新扫码' : `教务系统响应异常（HTTP ${response.status}）`), { status: auth ? 401 : 502 });
      }
      this.storeCookies(response);
      const buffer = Buffer.from(await response.arrayBuffer());
      addCount('upstreamBytes', buffer.length);
      return { response, url, buffer };
    }, { priority, signal: externalSignal });
  }

  async text(path, init = {}) {
    const { response, buffer, url } = await this.request(path, init);
    const text = decode(buffer, response.headers);
    if (!/cas\/(login|logon)\.action/.test(url) && /<form[^>]+action=["'][^"']*(?:login|logon)\.action|^\s*(?:会话已过期|登录超时)/i.test(text)) {
      throw Object.assign(new Error('登录已过期，请重新扫码'), { status: 401 });
    }
    return { status: response.status, headers: response.headers, url, text };
  }

  async json(path, init = {}) {
    const result = await this.text(path, init);
    try {
      return { ...result, data: JSON.parse(result.text) };
    } catch {
      return { ...result, data: null };
    }
  }

  async postForm(path, data, init = {}) {
    return this.text(path, {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(init.headers || {}) },
      body: new URLSearchParams(data).toString(),
    });
  }

  serialize() {
    return JSON.stringify({
      base: this.base,
      username: this.username,
      landingUrl: this.landingUrl,
      cookies: [...this.cookies.entries()],
    });
  }

  static deserialize(raw) {
    const data = JSON.parse(raw);
    const session = new JwxtSession(data.base);
    for (const [name, value] of data.cookies || []) session.cookies.set(name, value);
    session.username = data.username || '';
    session.landingUrl = data.landingUrl || '';
    return session;
  }
}
