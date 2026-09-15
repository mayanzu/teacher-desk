import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const JWXT_ORIGIN = 'https://jwxt.slu.edu.cn:4060';
const SESSION_TTL_MS = 5 * 60 * 1000;
const RESULT_TTL_MS = 60 * 1000;
const sessions = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function randomHex(bytes = 24) {
  return randomBytes(bytes).toString('hex');
}

function qrCodeValue() {
  return 'smdljwxt' + randomHex(16);
}

function updateCookies(response, jar) {
  const values = typeof response.headers.getSetCookie === 'function'
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

async function request(session, path, options = {}) {
  const url = path.startsWith('http') ? path : new URL(path, JWXT_ORIGIN).toString();
  const headers = {
    'User-Agent': 'Mozilla/5.0 TeacherTimetableSync/2.0',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(options.headers || {}),
  };
  if (session.cookies.size) headers.Cookie = cookieHeader(session.cookies);
  const response = await fetch(url, { ...options, headers, redirect: options.redirect || 'follow' });
  updateCookies(response, session.cookies);
  return response;
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

async function startSession() {
  const session = {
    id: randomHex(24),
    qrCode: qrCodeValue(),
    cookies: new Map(),
    status: 'waiting',
    message: '等待手机扫码',
    updatedAt: Date.now(),
    polling: null,
  };
  const response = await request(session, '/ahsljw/cas/login.action', { method: 'GET' });
  if (!response.ok) throw new Error('无法打开教务系统登录页');
  sessions.set(session.id, session);
  return session;
}

function extractPageInfo(text) {
  const teacher = text.match(/\[[^\]]+\]\s*([^\s<]+)/)?.[1] || '';
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
  const loginText = await loginResponse.text();
  let loginData;
  try {
    loginData = JSON.parse(loginText);
  } catch {
    throw new Error('教务系统登录响应格式异常');
  }
  if (String(loginData.status) !== '200') {
    throw new Error(loginData.message || '扫码登录失败');
  }
  const homeUrl = new URL(loginData.result, JWXT_ORIGIN).toString();
  const homeResponse = await request(session, homeUrl, { method: 'GET', headers: { Referer: JWXT_ORIGIN + '/ahsljw/cas/login.action' } });
  const homeText = await homeResponse.text();
  const pageInfo = extractPageInfo(homeText);
  const uniqueDetails = new Map();
  let fallbackTable = '';
  for (let batchStart = 1; batchStart <= 30; batchStart += 5) {
    const batch = await Promise.all(Array.from({ length: Math.min(5, 30 - batchStart + 1) }, async (_, offset) => {
      const week = batchStart + offset;
      const scheduleUrl = new URL('/ahsljw/frame/desk/showLessonScheduleInfosV14.action', JWXT_ORIGIN);
      scheduleUrl.searchParams.set('xn', String(pageInfo.year));
      scheduleUrl.searchParams.set('xq', String(pageInfo.term));
      scheduleUrl.searchParams.set('jxz', String(week));
      const response = await request(session, scheduleUrl.toString(), { method: 'GET', headers: { Referer: homeUrl } });
      return response.text();
    }));
    for (const html of batch) {
      const blocks = html.match(/<div(?=[^>]*id="weekly0\d+_\d+")(?=[^>]*class="[^"]*weeklesson)[^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi) || [];
      for (const block of blocks) {
        const normalized = block.replace(/\s+/g, ' ').trim();
        if (!uniqueDetails.has(normalized)) uniqueDetails.set(normalized, block);
      }
      if (!fallbackTable && /\[[^\]]+\]周/.test(html)) {
        fallbackTable = html.match(/<table[\s\S]*?<\/table>/i)?.[0] || '';
      }
    }
  }
  const htmls = uniqueDetails.size
    ? [`<div>${[...uniqueDetails.values()].join('')}</div>`]
    : fallbackTable ? [fallbackTable] : [];
  if (!htmls.length) throw new Error('本学期没有查询到课程，请确认当前账号是任课教师且课表已经发布');
  return { htmls, teacher: pageInfo.teacher, semesterLabel: pageInfo.semesterLabel };
}

async function pollSession(session) {
  const response = await postForm(session, '/ahsljw/frame/LoginBar.jsp', {
    operate: 'query',
    qrCode: session.qrCode,
  });
  const username = (await response.text()).trim();
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
  try {
    const session = await startSession();
    json(res, 200, {
      status: 'waiting',
      session: session.id,
      qrCode: session.qrCode,
      expiresIn: Math.floor(SESSION_TTL_MS / 1000),
    });
  } catch (error) {
    json(res, 502, { status: 'error', message: error instanceof Error ? error.message : '无法连接教务系统' });
  }
}

async function handleStatus(req, res, url) {
  cleanupSessions();
  const id = url.searchParams.get('session') || '';
  const session = sessions.get(id);
  if (!session) return json(res, 404, { status: 'expired', message: '扫码会话已过期，请刷新二维码' });
  if (session.status === 'success' && session.result) return json(res, 200, { status: 'success', ...session.result });
  if (session.polling) return json(res, 200, { status: 'waiting', message: '正在确认扫码结果' });
  session.polling = pollSession(session)
    .then((result) => result)
    .catch((error) => {
      session.status = 'error';
      session.message = error instanceof Error ? error.message : '扫码同步失败';
      session.updatedAt = Date.now();
      return { status: 'error', message: session.message };
    })
    .finally(() => { session.polling = null; });
  const result = await session.polling;
  json(res, result.status === 'error' ? 502 : 200, result);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/slu/qr/start') return await handleStart(req, res);
    if (req.method === 'GET' && url.pathname === '/api/slu/qr/status') return await handleStatus(req, res, url);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' });
    json(res, 404, { status: 'error', message: 'not found' });
  } catch (error) {
    json(res, 500, { status: 'error', message: error instanceof Error ? error.message : 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('SLU sync server listening on ' + PORT);
});
