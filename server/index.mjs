import { sessionAlive } from './sessionHealth.mjs';
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { sendBody } from './response.mjs';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { readJson, TOO_LARGE } from './readJson.mjs';
import { config } from './config.mjs';
import { cacheTtlFor } from './cacheTtl.mjs';
import { fetchConcurrency, mapWithConcurrency } from './jwxt/concurrency.mjs';
import { contextFor, persistSession, rotateContext, dropContext, sweepSessions } from './sessionStore.mjs';
import { getSchedule, getTasks, getTerms, getProgress, getGrades, getProgressClasses, getProgressEntry, buildProgressPayload, saveProgressEntry, getProgressCopyTerms, getProgressCopyClasses, copyProgressFromClass, getProgressSummary, buildProgressCsv, getRoster, buildRosterCsv, buildRosterListHtml, getCourseGradeClasses, getCourseGradesReport, exportCourseGradesPdf, exportCourseGradesExcel, exportProgressPdf } from './jwxt/index.mjs';

function courseGradeParams(url, term) {
  return {
    term,
    kcdm: url.searchParams.get('kcdm') || '',
    bjdm: url.searchParams.get('bjdm') || '',
    bjmc: url.searchParams.get('bjmc') || '',
    flag: url.searchParams.get('flag') || '1',
    dyfs: url.searchParams.get('dyfs') || 'dl',
    qmzhC: url.searchParams.get('qmzhC') || 'zhC',
    fileName: url.searchParams.get('fileName') || '',
    title: url.searchParams.get('title') || '',
    courseName: url.searchParams.get('courseName') || '',
    className: url.searchParams.get('className') || '',
  };
}

// 缓存上限；每个键的 TTL 按数据变化频率分层（见 cacheTtl.mjs）
const CACHE_MAX = 200;
// 导出（PDF/Excel）结果单独放一小块缓存：单次回源最贵（进度 PDF 2 次往返、成绩 PDF 4 次），
// 但结果是几百 KB 的 buffer，不能按条数 200 塞进主缓存，否则最坏会占上百 MB。
const EXPORT_MAX = 20;
const EXPORT_TTL = Number(process.env.JWXT_EXPORT_TTL_MS) > 0 ? Number(process.env.JWXT_EXPORT_TTL_MS) : 5 * 60 * 1000;

async function cached(ctx, key, fn, force = false, options = {}) {
  const store = options.store || ctx.cache;
  const ttl = options.ttl || cacheTtlFor(key);
  const limit = options.max || CACHE_MAX;
  const now = Date.now();
  const hit = store.get(key);
  if (hit && !force && now - hit.at < ttl) {
    // 触发 LRU：把命中的键移到队尾
    store.delete(key);
    store.set(key, hit);
    return hit.value;
  }
  if (hit) store.delete(key);
  // 合并同一会话内对相同键的并发请求，避免重复打上游；
  // 但 ?refresh=1（force）必须真的回源，不能复用刷新前就发出的那次请求。
  if (!force && ctx.inflight.has(key)) return ctx.inflight.get(key);
  const pending = (async () => {
    try {
      const value = await fn();
      // 被 force 重发顶替时，旧请求的结果不再写缓存，避免慢的旧结果覆盖新值
      if (ctx.inflight.get(key) === pending) {
        store.set(key, { at: Date.now(), value });
        while (store.size > limit) {
          const oldest = store.keys().next().value;
          if (oldest === undefined) break;
          store.delete(oldest);
        }
      }
      return value;
    } finally {
      // 只有自己仍是当前在飞请求时才注销，避免删掉后来者（force 重发）的登记
      if (ctx.inflight.get(key) === pending) ctx.inflight.delete(key);
    }
  })();
  ctx.inflight.set(key, pending);
  return pending;
}

// 登录限流：按来源 IP 限制 /api/login/start 的频率，避免匿名请求刷接口。
const LOGIN_WINDOW = 5 * 60 * 1000;
const LOGIN_MAX = 10;
const loginHits = new Map();

function loginAllowed(ip) {
  const now = Date.now();
  const hits = (loginHits.get(ip) || []).filter((at) => now - at < LOGIN_WINDOW);
  if (hits.length >= LOGIN_MAX) {
    loginHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  loginHits.set(ip, hits);
  if (loginHits.size > 1000) {
    const oldest = loginHits.keys().next().value;
    if (oldest !== undefined) loginHits.delete(oldest);
  }
  return true;
}

// 写请求的 Origin 校验：同源（含 localhost 不同端口）或缺失 Origin 时放行。
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const target = req.headers.host || '';
  if (host === target) return true;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
  return local.test(host) && local.test(target);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/*
 * 二进制下载。
 * 前端 fetch 带 Accept: application/json 时改发 { filename, contentType, base64 }，
 * 由前端还原成 Blob 下载：IDM 等下载管理器看不到文件响应，不会再出现「IDM 一份 + 浏览器空文件」的双下载。
 * 直接访问（浏览器地址栏/普通链接）仍返回附件流。
 */
async function sendDownload(req, res, filename, buffer, contentType) {
  if (/\bapplication\/json\b/.test(String(req.headers.accept || ''))) {
    const body = JSON.stringify({ filename, contentType, base64: buffer.toString('base64') });
    return sendBody(req, res, body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const WEB_DIST = process.env.WEB_DIST || join(config.root, 'web', 'dist');

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname.startsWith('/api/')) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    json(res, 400, { error: '无效的请求地址' });
    return true;
  }
  const relativePath = normalize(decoded).replace(/^([/\\])+/, '');
  const resolved = resolve(WEB_DIST, relativePath);
  const inside = relative(WEB_DIST, resolved);
  if (inside.startsWith('..') || isAbsolute(inside)) return false;
  // normalize 会把 "//../" 折叠掉（Linux 上尤其明显），必须在归一化前按路径段拒绝 ..
  if (decoded.split(/[/\\]+/).includes('..')) return false;
  let filePath = resolved;
  const fileStat = async (path) => {
    try { return await stat(path); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
  };
  let info = await fileStat(filePath);
  if (!info?.isFile()) {
    filePath = join(WEB_DIST, 'index.html');
    info = await fileStat(filePath);
    if (!info?.isFile()) return false;
  }
  const cacheControl = filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Vary', [res.getHeader('Vary'), 'Accept-Encoding'].filter(Boolean).join(', '));
  if (String(req.headers['if-none-match'] || '').split(/,\s*/).some(tag => tag === '*' || tag.replace(/^W\//, '') === etag.slice(2))) {
    res.writeHead(304);
    res.end();
    return true;
  }
  const contentType = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end();
    return true;
  }
  await sendBody(req, res, await readFile(filePath), { 'Content-Type': contentType }, /^(text\/|application\/(json|manifest)|image\/svg)/.test(contentType));
  return true;
}

function allowCors(req, res) {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
}

function clearCache(ctx) {
  ctx.cache.clear();
  ctx.exports.clear();
  ctx.inflight.clear();
}

async function ensureSession(ctx) {
  if (!ctx.session) throw Object.assign(new Error('未登录，请先扫码'), { status: 401 });
  if (!(await sessionAlive(ctx))) {
    dropContext(ctx);
    throw Object.assign(new Error('登录已过期，请重新扫码'), { status: 401 });
  }
  return ctx.session;
}

const server = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); }
  catch { return json(res, 400, { error: '无效的请求地址' }); }
  allowCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'POST' && !originAllowed(req)) {
    return json(res, 403, { error: '请求来源不被允许' });
  }
  let ctx = null;
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });

    // 每个浏览器一个独立会话上下文（Cookie: td_sid）
    if (url.pathname.startsWith('/api/')) ctx = contextFor(req, res);

    // ?refresh=1：跳过缓存直接回源（手动刷新用；分层 TTL 下需要这个出口）
    const refreshRequested = url.searchParams.get('refresh') === '1';
    const cache = (key, fn) => cached(ctx, key, fn, refreshRequested);
    // 导出结果（PDF/Excel/点名册报告）走单独的小缓存：回源最贵、结果最大
    const cacheExport = (key, fn) => cached(ctx, key, fn, refreshRequested, { store: ctx.exports, ttl: EXPORT_TTL, max: EXPORT_MAX });

    if (url.pathname === '/api/session' && req.method === 'GET') {
      const alive = await sessionAlive(ctx);
      return json(res, 200, { loggedIn: alive, username: alive && ctx.session ? ctx.session.username : '' });
    }

    if (url.pathname === '/api/login/start' && req.method === 'POST') {
      if (!ctx) return json(res, 400, { error: '无效的会话，请刷新页面重试' });
      if (!loginAllowed(req.socket?.remoteAddress || 'unknown')) {
        return json(res, 429, { error: '二维码生成过于频繁，请稍后再试' });
      }
      return json(res, 200, await ctx.loginFlow.start());
    }

    if (url.pathname === '/api/login/status' && req.method === 'GET') {
      const { status, message, username } = ctx.loginFlow.state;
      if (status === 'success') {
        const flowSession = ctx.loginFlow.getSession();
        if (ctx.session !== flowSession) {
          ctx.session = flowSession;
          rotateContext(ctx, res);
          persistSession(ctx);
          clearCache(ctx);
        }
      }
      return json(res, 200, { status, message, username });
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      dropContext(ctx);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/terms' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const terms = await cache('terms', () => getTerms(s));
      return json(res, 200, { terms, current: terms[0]?.value || '' });
    }

    if (url.pathname === '/api/schedule' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`schedule:${term}`, () => getSchedule(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`tasks:${term}`, () => getTasks(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/copy-terms' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      if (!term || !kcdm) return json(res, 400, { error: '缺少 term / kcdm 参数' });
      const data = await getProgressCopyTerms(s, term, kcdm, skbjdm);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/copy-classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      const xnxq = url.searchParams.get('xnxq') || '';
      if (!term || !kcdm || !xnxq) return json(res, 400, { error: '缺少 term / kcdm / xnxq 参数' });
      const data = await getProgressCopyClasses(s, term, kcdm, skbjdm, xnxq);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/copy' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const kcdm = url.searchParams.get('kcdm') || '';
      const source = url.searchParams.get('source') || '';
      const xnxq = url.searchParams.get('xnxq') || '';
      if (!kcdm || !source || !xnxq) return json(res, 400, { error: '缺少 kcdm / source / xnxq 参数' });
      const data = await copyProgressFromClass(s, xnxq, kcdm, source);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`progressClasses:${term}`, () => getProgressClasses(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/entry' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const params = {
        kcdm: url.searchParams.get('kcdm') || '',
        bjdm: url.searchParams.get('bjdm') || '',
        kcmc: url.searchParams.get('kcmc') || '',
        bjmc: url.searchParams.get('bjmc') || '',
        pklb: url.searchParams.get('pklb') || '',
        jsdm: url.searchParams.get('jsdm') || '',
        jsxm: url.searchParams.get('jsxm') || '',
        lsjs: url.searchParams.get('lsjs') || '',
        jsxs: url.searchParams.get('jsxs') || '0',
        syxs: url.searchParams.get('syxs') || '0',
        sjxs: url.searchParams.get('sjxs') || '0',
        ldxs: url.searchParams.get('ldxs') || '0',
        qtxs: url.searchParams.get('qtxs') || '0',
      };
      const data = await getProgressEntry(s, term, params);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/entry' && req.method === 'POST') {
      const s = await ensureSession(ctx);
      const body = await readJson(req);
      if (body === TOO_LARGE) return json(res, 413, { error: '请求体过大' });
      if (!body || !/^\d{4},[01]$/.test(body.term) || !body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta) || !Array.isArray(body.rows) || body.rows.length > 500 || body.rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        return json(res, 400, { error: '请求体需要 term / meta / rows' });
      }
      if (body.confirm !== undefined && typeof body.confirm !== 'boolean') return json(res, 400, { error: 'confirm 必须为布尔值' });
      if (body.confirm !== true) {
        return json(res, 200, {
          preview: true,
          payload: buildProgressPayload(body.meta, body.rows, body.formFields || {}, body.tjflag || '1', body.xqskzs || ''),
          note: '预览模式：确认无误后携带 confirm:true 才会真正提交',
        });
      }
      const result = await saveProgressEntry(s, body.term, body.meta, body.rows, body.formFields || {}, body.tjflag || '1', body.xqskzs || '');
      clearCache(ctx);
      return json(res, 200, result);
    }

    if (url.pathname === '/api/progress/export/pdf' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const params = {
        term,
        scope: url.searchParams.get('scope') || '',
        kcdm: url.searchParams.get('kcdm') || '',
        bjdm: url.searchParams.get('bjdm') || '',
        skbjdm: url.searchParams.get('skbjdm') || '',
        bjmc: url.searchParams.get('bjmc') || '',
        teacher: url.searchParams.get('teacher') || '',
        kcmc: url.searchParams.get('kcmc') || '',
        courseName: url.searchParams.get('courseName') || '',
        className: url.searchParams.get('className') || '',
      };
      // 同一份 PDF 的重复下载（连点两次、预览后又下载）不再重复打上游
      const { filename, buffer } = await cacheExport(`exportProgressPdf:${JSON.stringify(params)}`, () => exportProgressPdf(s, params));
      await sendDownload(req, res, filename, buffer, 'application/pdf');
      return;
    }

    if (url.pathname === '/api/progress/summary' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`progressSummary:${term}`, () => getProgressSummary(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/export' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const className = url.searchParams.get('class') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      let rows;
      if (kcdm && skbjdm) {
        const entry = await getProgressEntry(s, term, {
          kcdm,
          bjdm: skbjdm,
          kcmc: '',
          bjmc: '',
          pklb: '0',
          jsdm: '',
          jsxm: '',
          lsjs: '',
        });
        rows = entry.rows.map((row) => ({
          week: row.week,
          date: row.date,
          period: row.period,
          classNames: className || skbjdm,
          room: row.raw?.skddM || '',
          content: row.content,
        }));
      } else {
        const data = await cache(`progress:${term}`, () => getProgress(s, term));
        rows = data.items.filter(
          (row) =>
            (skbjdm ? row.classCode === skbjdm : true) && (className ? row.classNames === className : true),
        );
      }
      const csv = buildProgressCsv(rows);
      const filename = `${className || '全部班级'}-教学进度表.csv`;
      await sendDownload(req, res, filename, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8');
      return;
    }

    if (url.pathname === '/api/roster/classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`progressClasses:${term}`, () => getProgressClasses(s, term));
      return json(res, 200, {
        items: (data.items ?? []).map((item) => ({
          kcdm: item.params.kcdm,
          skbjdm: item.classCode,
          courseName: item.courseRaw,
          className: item.className,
        })),
      });
    }

    if (url.pathname === '/api/roster' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      if (!term || !kcdm || !skbjdm) return json(res, 400, { error: '缺少 term / kcdm / skbjdm 参数' });
      const data = await cache(`roster:${JSON.stringify([term, kcdm, skbjdm])}`, () => getRoster(s, term, kcdm, skbjdm));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/roster/export' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      if (!term || !kcdm || !skbjdm) return json(res, 400, { error: '缺少 term / kcdm / skbjdm 参数' });
      const data = await cache(`roster:${JSON.stringify([term, kcdm, skbjdm])}`, () => getRoster(s, term, kcdm, skbjdm));
      const csv = buildRosterCsv(data.items ?? []);
      const filename = `点名册-${skbjdm}.csv`;
      await sendDownload(req, res, filename, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8');
      return;
    }

    if (url.pathname === '/api/roster/report' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      const asHtml = url.searchParams.get('format') === 'html';
      if (!term || !kcdm || !skbjdm) return json(res, 400, { error: '缺少 term / kcdm / skbjdm 参数' });
      // Only fetch fields used by buildRosterListHtml; optional metadata may fail independently.
      const [data, schedule, classes, terms] = await mapWithConcurrency([
        () => cache(`roster:${JSON.stringify([term, kcdm, skbjdm])}`, () => getRoster(s, term, kcdm, skbjdm)),
        () => cache(`schedule:${term}`, () => getSchedule(s, term)).catch(() => ({})),
        () => cache(`progressClasses:${term}`, () => getProgressClasses(s, term)).catch(() => ({})),
        () => cache('terms', () => getTerms(s)).catch(() => []),
      ], fetchConcurrency(), (load) => load());
      const match = (classes.items ?? []).find((item) => item.params?.kcdm === kcdm && item.classCode === skbjdm);
      const courseName = match?.courseRaw || '';
      const className = match?.className || '';
      const jsxm = match?.params?.jsxm || '';
      const teacherCode = jsxm.match(/\[([^\]]+)\]/)?.[1] || match?.params?.jsdm || '';
      const teacherName = jsxm.replace(/\[[^\]]*\]/, '').trim();
      const teacher = schedule.teacher || '';
      const termLabel = terms.find((item) => item.value === term)?.label || '';
      const format = url.searchParams.get('format') || 'xls';
      const printMode = format === 'print';
      const html = buildRosterListHtml({
        term,
        termLabel,
        kcdm,
        skbjdm,
        courseName,
        className,
        teacherCode,
        teacherName,
        teacher,
        items: data.items ?? [],
        autoPrint: printMode,
      });
      const body = Buffer.from(html, 'utf8');
      if (printMode) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        res.end(body);
        return;
      }
      const filename = `点名册-${className || skbjdm}.${asHtml ? 'html' : 'xls'}`;
      await sendDownload(req, res, filename, body, asHtml ? 'text/html; charset=utf-8' : 'application/vnd.ms-excel; charset=utf-8');
      return;
    }

    if (url.pathname === '/api/progress' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`progress:${term}`, () => getProgress(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/grades' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`grades:${term}`, () => getGrades(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/course-grades/classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cache(`courseGradeClasses:${term}`, () => getCourseGradeClasses(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/course-grades' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const params = courseGradeParams(url, term);
      if (!params.kcdm || !params.bjdm) return json(res, 400, { error: '缺少 kcdm / bjdm 参数' });
      const data = await getCourseGradesReport(s, params);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/course-grades/export/pdf' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const params = courseGradeParams(url, term);
      if (!params.kcdm || !params.bjdm) return json(res, 400, { error: '缺少 kcdm / bjdm 参数' });
      const { filename, buffer } = await cacheExport(`exportCourseGradesPdf:${JSON.stringify(params)}`, () => exportCourseGradesPdf(s, params));
      await sendDownload(req, res, filename, buffer, 'application/pdf');
      return;
    }

    if (url.pathname === '/api/course-grades/export/excel' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const params = courseGradeParams(url, term);
      if (!params.kcdm || !params.bjdm) return json(res, 400, { error: '缺少 kcdm / bjdm 参数' });
      const { filename, buffer } = await cacheExport(`exportCourseGradesExcel:${JSON.stringify(params)}`, () => exportCourseGradesExcel(s, params));
      await sendDownload(req, res, filename, buffer, 'application/vnd.ms-excel');
      return;
    }

    if (await serveStatic(req, res, url.pathname)) return;

    json(res, 404, { error: 'not found' });
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(error); return; }
    const status = error?.status || 500;
    if (status >= 500) console.error('[api]', error);
    if (error?.status === 401 && ctx) dropContext(ctx);
    json(res, status, { error: error instanceof Error ? error.message : 'internal error' });
  }
});

server.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  console.log(`[api] http://${process.env.HOST || '127.0.0.1'}:${config.port}`);
  sweepSessions();
  setInterval(sweepSessions, 60 * 60 * 1000).unref();
});

server.on('error', (error) => {
  console.error(`[api] 启动失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
