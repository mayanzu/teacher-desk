import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const JWXT_ORIGIN = new URL(process.env.JWXT_ORIGIN || 'https://jwxt.slu.edu.cn:4060').origin;
const UPSTREAM_USER_AGENT =
  process.env.UPSTREAM_USER_AGENT || 'Mozilla/5.0 TeacherTimetableSync/2.0';
const SESSION_TTL_MS = 5 * 60 * 1000;
const RESULT_TTL_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;
const UPSTREAM_TIMEOUT_MS = 10 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 200);
const MAX_SESSIONS_PER_IP = 3;
const MAX_CONCURRENT_UPSTREAM = Number(process.env.MAX_CONCURRENT_UPSTREAM || 8);
const MAX_UPSTREAM_WAITERS = 100;
const RATE_LIMITS = {
  start: { windowMs: 60 * 1000, max: 6 },
  status: { windowMs: 60 * 1000, max: 60 },
};
const RATE_WINDOW_MAX_MS = Math.max(RATE_LIMITS.start.windowMs, RATE_LIMITS.status.windowMs);

const sessions = new Map();
const rateBuckets = new Map();
const upstreamWaiters = [];
let activeUpstream = 0;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function fail(res, status, error, message = '上游服务暂不可用，请稍后重试') {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[slu-sync]', detail);
  json(res, status, { status: 'error', message });
}

function randomHex(bytes = 24) {
  return randomBytes(bytes).toString('hex');
}

function qrCodeValue() {
  return 'smdljwxt' + randomHex(16);
}

function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function allowRate(key, limit) {
  const now = Date.now();
  const times = (rateBuckets.get(key) || []).filter((ts) => now - ts < limit.windowMs);
  if (times.length >= limit.max) {
    rateBuckets.set(key, times);
    return false;
  }
  times.push(now);
  rateBuckets.set(key, times);
  return true;
}

function pruneRateBuckets() {
  const now = Date.now();
  for (const [key, times] of rateBuckets) {
    const recent = times.filter((ts) => now - ts < RATE_WINDOW_MAX_MS);
    if (recent.length) rateBuckets.set(key, recent);
    else rateBuckets.delete(key);
  }
}

function isSameOriginRequest(req) {
  const source = req.headers.origin || req.headers.referer;
  if (!source) return true;
  try {
    return new URL(source).host === req.headers.host;
  } catch {
    return false;
  }
}

function updateCookies(response, jar) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const cookieValue = pair.slice(index + 1).trim();
    if (cookieValue) jar.set(name, cookieValue);
    else jar.delete(name);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => name + '=' + value).join('; ');
}

function resolveUpstreamUrl(target) {
  let url;
  try {
    url = new URL(target.startsWith('http') ? target : new URL(target, JWXT_ORIGIN).toString());
  } catch {
    throw new Error('上游地址格式不合法');
  }
  if (url.origin !== JWXT_ORIGIN) throw new Error('禁止访问教务系统以外的地址');
  return url.toString();
}

async function withUpstreamSlot(fn) {
  if (activeUpstream >= MAX_CONCURRENT_UPSTREAM) {
    if (upstreamWaiters.length >= MAX_UPSTREAM_WAITERS) throw new Error('上游请求排队已满');
    await new Promise((resolve) => upstreamWaiters.push(resolve));
  }
  activeUpstream += 1;
  try {
    return await fn();
  } finally {
    activeUpstream -= 1;
    const next = upstreamWaiters.shift();
    if (next) next();
  }
}

async function request(session, path, options = {}) {
  return withUpstreamSlot(async () => {
    let url = resolveUpstreamUrl(path);
    const { headers: extraHeaders, ...rest } = options;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = new URL(url);
      const headers = {
        'User-Agent': UPSTREAM_USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(extraHeaders || {}),
      };
      if (parsed.origin === JWXT_ORIGIN && session.cookies.size) {
        headers.Cookie = cookieHeader(session.cookies);
      }
      const response = await fetch(url, {
        ...rest,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (parsed.origin === JWXT_ORIGIN) updateCookies(response, session.cookies);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return response;
        await response.body?.cancel().catch(() => {});
        url = resolveUpstreamUrl(new URL(location, url).toString());
        continue;
      }
      return response;
    }
    throw new Error('上游跳转次数过多');
  });
}

async function readText(response, maxBytes = MAX_BODY_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('上游响应内容过大');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function postForm(session, path, data) {
  return request(session, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(data).toString(),
  });
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const ttl = session.status === 'success' ? RESULT_TTL_MS : SESSION_TTL_MS;
    if (now - session.updatedAt > ttl) sessions.delete(id);
  }
}

function countSessionsByIp(ip) {
  let count = 0;
  for (const session of sessions.values()) if (session.ip === ip) count += 1;
  return count;
}

async function startSession(ip) {
  const session = {
    id: randomHex(24),
    qrCode: qrCodeValue(),
    cookies: new Map(),
    status: 'waiting',
    message: '等待手机扫码',
    updatedAt: Date.now(),
    polling: null,
    ip,
  };
  const response = await request(session, '/ahsljw/cas/login.action', { method: 'GET' });
  if (!response.ok) throw new Error('无法打开教务系统登录页');
  sessions.set(session.id, session);
  return session;
}

function stripTags(value, max = 60) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function extractPageInfo(text) {
  const teacher = stripTags(
    text.match(/任课教师\s*[：:]\s*(?:<b>)?([^<\s|｜]{1,40})/)?.[1] ||
      text.match(/教师\s*[：:]\s*(?:<b>)?([^<\s|｜]{1,40})/)?.[1] ||
      '',
  );
  const semesterLabel = text.match(/\d{4}-\d{4}学年(?:第[一二]学期)?/)?.[0] || '';
  const year = Number(semesterLabel.match(/^(\d{4})-/)?.[1] || new Date().getFullYear());
  const term = semesterLabel.includes('第二学期') ? 1 : 0;
  return { teacher, semesterLabel, year, term };
}

async function completeLogin(session, username) {
  const loginResponse = await postForm(session, '/ahsljw/cas/logon.action', {
    username,
    password: session.qrCode,
    loginmethod: 'xiqueer',
  });
  const loginText = await readText(loginResponse);
  let loginData;
  try {
    loginData = JSON.parse(loginText);
  } catch {
    throw new Error('教务系统登录响应格式异常');
  }
  if (String(loginData.status) !== '200') {
    throw new Error(loginData.message || '扫码登录失败');
  }
  const homeUrl = resolveUpstreamUrl(loginData.result);
  const homeResponse = await request(session, homeUrl, {
    method: 'GET',
    headers: { Referer: JWXT_ORIGIN + '/ahsljw/cas/login.action' },
  });
  const homeText = await readText(homeResponse);
  const pageInfo = extractPageInfo(homeText);
  const uniqueDetails = new Map();
  let fallbackTable = '';
  for (let batchStart = 1; batchStart <= 30; batchStart += 5) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(5, 30 - batchStart + 1) }, async (_, offset) => {
        const week = batchStart + offset;
        const scheduleUrl = new URL(
          '/ahsljw/frame/desk/showLessonScheduleInfosV14.action',
          JWXT_ORIGIN,
        );
        scheduleUrl.searchParams.set('xn', String(pageInfo.year));
        scheduleUrl.searchParams.set('xq', String(pageInfo.term));
        scheduleUrl.searchParams.set('jxz', String(week));
        const response = await request(session, scheduleUrl.toString(), {
          method: 'GET',
          headers: { Referer: homeUrl },
        });
        return readText(response);
      }),
    );
    for (const html of batch) {
      const blocks =
        html.match(
          /<div(?=[^>]*id="weekly0\d+_\d+")(?=[^>]*class="[^"]*weeklesson)[^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi,
        ) || [];
      for (const block of blocks) {
        const normalized = block.replace(/\s+/g, ' ').trim();
        if (!uniqueDetails.has(normalized)) uniqueDetails.set(normalized, block);
      }
      if (!fallbackTable && /\[[^\]]+\]周/.test(html)) {
        fallbackTable = html.match(/<table[\s\S]*?<\/table>/i)?.[0] || '';
      }
    }
  }
  // 仅回传抓取到的课表课程区块（或课表表格）供前端 parseScheduleHtml 解析，不返回完整教务页面
  const htmls = uniqueDetails.size
    ? [`<div>${[...uniqueDetails.values()].join('')}</div>`]
    : fallbackTable
      ? [fallbackTable]
      : [];
  if (!htmls.length)
    throw new Error('本学期没有查询到课程，请确认当前账号是任课教师且课表已经发布');
  return { htmls, teacher: pageInfo.teacher, semesterLabel: pageInfo.semesterLabel };
}

async function pollSession(session) {
  const response = await postForm(session, '/ahsljw/frame/LoginBar.jsp', {
    operate: 'query',
    qrCode: session.qrCode,
  });
  const username = (await readText(response)).trim();
  if (!username) {
    session.updatedAt = Date.now();
    return { status: 'waiting', message: '等待手机扫码' };
  }
  const result = await completeLogin(session, username);
  session.status = 'success';
  session.result = result;
  session.updatedAt = Date.now();
  return { status: 'success', ...result };
}

async function handleStart(req, res) {
  if (!isSameOriginRequest(req))
    return json(res, 403, { status: 'error', message: '请求来源不合法' });
  const ip = clientIp(req);
  if (!allowRate('start:' + ip, RATE_LIMITS.start)) {
    return json(res, 429, { status: 'error', message: '请求过于频繁，请稍后重试' });
  }
  cleanupSessions();
  if (sessions.size >= MAX_SESSIONS) {
    return json(res, 503, { status: 'error', message: '服务繁忙，请稍后重试' });
  }
  if (countSessionsByIp(ip) >= MAX_SESSIONS_PER_IP) {
    return json(res, 429, { status: 'error', message: '活跃扫码会话过多，请稍后重试' });
  }
  try {
    const session = await startSession(ip);
    json(res, 200, {
      status: 'waiting',
      session: session.id,
      qrCode: session.qrCode,
      expiresIn: Math.floor(SESSION_TTL_MS / 1000),
    });
  } catch (error) {
    fail(res, 502, error);
  }
}

async function handleStatus(req, res, url) {
  const ip = clientIp(req);
  if (!allowRate('status:' + ip, RATE_LIMITS.status)) {
    return json(res, 429, { status: 'error', message: '请求过于频繁，请稍后重试' });
  }
  cleanupSessions();
  const id = url.searchParams.get('session') || '';
  const session = sessions.get(id);
  if (!session)
    return json(res, 404, { status: 'expired', message: '扫码会话已过期，请刷新二维码' });
  if (session.status === 'success' && session.result) {
    return json(res, 200, { status: 'success', ...session.result });
  }
  if (session.status === 'error') {
    return json(res, 502, { status: 'error', message: '上游服务暂不可用，请稍后重试' });
  }
  if (session.polling) return json(res, 200, { status: 'waiting', message: '正在确认扫码结果' });
  session.polling = pollSession(session)
    .then((result) => result)
    .catch((error) => {
      session.status = 'error';
      session.updatedAt = Date.now();
      console.error('[slu-sync]', error instanceof Error ? error.stack || error.message : error);
      return { status: 'error', message: '上游服务暂不可用，请稍后重试' };
    })
    .finally(() => {
      session.polling = null;
    });
  const result = await session.polling;
  json(res, result.status === 'error' ? 502 : 200, result);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/slu/qr/start')
      return await handleStart(req, res);
    if (req.method === 'GET' && url.pathname === '/api/slu/qr/status')
      return await handleStatus(req, res, url);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' });
    json(res, 404, { status: 'error', message: 'not found' });
  } catch (error) {
    fail(res, 500, error, '服务内部错误');
  }
});

server.on('error', (error) => console.error('[slu-sync] server error', error));

process.on('unhandledRejection', (reason) =>
  console.error('[slu-sync] unhandled rejection', reason),
);
process.on('uncaughtException', (error) => console.error('[slu-sync] uncaught exception', error));

const cleanupTimer = setInterval(() => {
  cleanupSessions();
  pruneRateBuckets();
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

server.listen(PORT, HOST, () => {
  console.log('SLU sync server listening on ' + HOST + ':' + PORT);
});
