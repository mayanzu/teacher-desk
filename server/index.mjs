import { sessionAlive } from './sessionHealth.mjs';
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { acceptsGzip, sendBody } from './response.mjs';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { readJson, TOO_LARGE } from './readJson.mjs';
import { config } from './config.mjs';
import { cached, sweepAllCaches } from './cache.mjs';
import { createScope, currentScope, logScope, runWithScope, withPriority } from './perf.mjs';
import { fetchConcurrency, mapWithConcurrency } from './jwxt/concurrency.mjs';
import { shouldWarmUp, warmUp } from './warmup.mjs';
import { contextFor, persistSession, rotateContext, dropContext, resetContextCaches, sweepSessions } from './sessionStore.mjs';
import { getTasks, getTerms, getProgress, getGrades, buildProgressPayload, saveProgressEntry, getProgressCopyTerms, getProgressCopyClasses, copyProgressFromClass, buildProgressCsv, getRoster, buildRosterCsv, buildRosterListHtml, getCourseGradeClasses, getCourseGradesReport, exportCourseGradesPdf, exportCourseGradesExcel, exportProgressPdf } from './jwxt/index.mjs';
import { buildRosterPdf, resolveRosterFont } from './jwxt/rosterPdf.mjs';
import { loadTerms, loadScheduleView, loadProgressClasses, loadProgressSummary, loadProgressEntry, invalidateProgressAfterSave, peekScheduleTeacher } from './data.mjs';

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
    // 前端已从成绩明细里拿到教师名时直接带过来，省掉服务端的可选元数据查询（review R08）
    teacher: url.searchParams.get('teacher') || '',
  };
}

// 导出（PDF/Excel/点名册）结果单独放一块缓存：单次回源最贵（进度 PDF 2 次往返、成绩 PDF 4 次），
// 但结果是几百 KB 的 buffer，不能按查询缓存塞，字节预算见 server/cache.mjs。
const EXPORT_TTL = Number(process.env.JWXT_EXPORT_TTL_MS) > 0 ? Number(process.env.JWXT_EXPORT_TTL_MS) : 5 * 60 * 1000;
const EXPORT_MAX = 20;

// 预热开关：JWXT_WARMUP=0 可关掉（比如上游压力大时）
const WARMUP = process.env.JWXT_WARMUP !== '0';

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

/**
 * 可选的 Server-Timing 响应头（review R16）：JWXT_SERVER_TIMING=1 时带上
 * total/queue/upstream 阶段耗时，方便在浏览器 Network 面板直接看。
 */
function applyServerTiming(res) {
  if (process.env.JWXT_SERVER_TIMING !== '1') return;
  const scope = currentScope();
  if (!scope) return;
  const parts = [`total;dur=${Math.round(performance.now() - scope.startedAt)}`];
  if (scope.timings.upstream) parts.push(`upstream;dur=${Math.round(scope.timings.upstream)}`);
  if (scope.timings.queue) parts.push(`queue;dur=${Math.round(scope.timings.queue)}`);
  res.setHeader('Server-Timing', parts.join(', '));
}

/**
 * 统一 JSON 响应：达到阈值且客户端接受 gzip 时压缩（review R11），
 * 小响应与错误响应原样返回；no-store 语义不变。
 */
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  applyServerTiming(res);
  void sendBody(
    res.req,
    res,
    body,
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    true,
    status,
  ).catch((error) => {
    if (!res.destroyed) res.destroy(error);
  });
}

/*
 * 二进制下载。
 * 前端 fetch 带 Accept: application/json 时改发 { filename, contentType, base64 }，
 * 由前端还原成 Blob 下载：IDM 等下载管理器看不到文件响应，不会再出现「IDM 一份 + 浏览器空文件」的双下载。
 * 直接访问（浏览器地址栏/普通链接）仍返回附件流。
 *
 * 同一份导出缓存 Buffer 的 JSON 编码结果按 Buffer 记忆（review R09）：
 * 重复下载命中导出缓存时不再重复 Base64 编码，gzip 由 response.mjs 同样按 Buffer 记忆。
 */
const downloadJsonVariants = new WeakMap();

function preparedDownloadJson(filename, contentType, buffer) {
  let variants = downloadJsonVariants.get(buffer);
  if (!variants) {
    variants = new Map();
    downloadJsonVariants.set(buffer, variants);
  }
  const key = `${filename}\u0000${contentType}`;
  let body = variants.get(key);
  if (!body) {
    body = Buffer.from(JSON.stringify({ filename, contentType, base64: buffer.toString('base64') }), 'utf8');
    if (variants.size >= 4) variants.clear();
    variants.set(key, body);
  }
  return body;
}

async function sendDownload(req, res, filename, buffer, contentType) {
  applyServerTiming(res);
  if (/\bapplication\/json\b/.test(String(req.headers.accept || ''))) {
    const body = preparedDownloadJson(filename, contentType, buffer);
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

const COMPRESSIBLE_MIME = /^(text\/|application\/(json|manifest)|image\/svg)/;

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
  // 构建期生成的 .gz 优先（review R12）：同一个 hash 资源的重复 200 不再实时压缩。
  if (acceptsGzip(req.headers['accept-encoding'])) {
    const gzInfo = await fileStat(`${filePath}.gz`);
    if (gzInfo?.isFile() && gzInfo.mtimeMs >= info.mtimeMs) {
      const gzBody = await readFile(`${filePath}.gz`);
      res.setHeader('Content-Encoding', 'gzip');
      await sendBody(req, res, gzBody, { 'Content-Type': contentType }, false);
      return true;
    }
  }
  await sendBody(req, res, await readFile(filePath), { 'Content-Type': contentType }, COMPRESSIBLE_MIME.test(contentType));
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

async function ensureSession(ctx) {
  if (!ctx.session) throw Object.assign(new Error('未登录，请先扫码'), { status: 401 });
  // 鉴权探测高优先级，避免被后台预取拖慢（review R01）
  if (!(await withPriority('high', () => sessionAlive(ctx)))) {
    dropContext(ctx);
    throw Object.assign(new Error('登录已过期，请重新扫码'), { status: 401 });
  }
  return ctx.session;
}

async function handleRequest(req, res, scope) {
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); }
  catch { return json(res, 400, { error: '无效的请求地址' }); }
  scope.route = url.pathname;
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

    // 数据预热：老师一登录（或恢复登录态后第一次请求）就在后台把常用数据拉进缓存。
    // 任务绑定 ctx.generation，退出/换账号/清缓存后不再继续写回旧数据。
    if (ctx?.session && WARMUP && shouldWarmUp(ctx, ctx.session)) {
      void warmUp(ctx, ctx.session);
    }

    // ?refresh=1：跳过缓存直接回源（手动刷新用；分层 TTL 下需要这个出口）
    const refreshRequested = url.searchParams.get('refresh') === '1';
    const cache = (key, fn) => cached(ctx, key, fn, refreshRequested);
    // 导出结果（PDF/Excel/点名册报告）走单独的小缓存：回源最贵、结果最大
    const cacheExport = (key, fn) => cached(ctx, key, fn, refreshRequested, { store: ctx.exports, ttl: EXPORT_TTL, max: EXPORT_MAX });

    // 点名册报表数据（名单 + 课程/班级/任课教师/学期名），PDF 导出与打印预览共用。
    // 教学班字段已含教师时不再拉课表；确实缺失时只看缓存里的教师信息（review R18）。
    const loadRosterReport = async (s, term, kcdm, skbjdm) => {
      const [data, classes, terms] = await mapWithConcurrency([
        () => cache(`roster:${JSON.stringify([term, kcdm, skbjdm])}`, () => getRoster(s, term, kcdm, skbjdm)),
        // 教学班/学期名只是页眉元数据，失败不阻塞名单（review R18）
        () => loadProgressClasses(ctx, s, term).catch(() => ({ items: [] })),
        () => loadTerms(ctx, s).catch(() => []),
      ], fetchConcurrency(), (load) => load());
      const match = (classes.items ?? []).find((item) => item.params?.kcdm === kcdm && item.classCode === skbjdm);
      const jsxm = match?.params?.jsxm || '';
      const teacherName = jsxm.replace(/\[[^\]]*\]/, '').trim();
      const teacherCode = jsxm.match(/\[([^\]]+)\]/)?.[1] || match?.params?.jsdm || '';
      const teacher = teacherName ? '' : peekScheduleTeacher(ctx, term);
      return {
        items: data.items ?? [],
        courseName: match?.courseRaw || '',
        className: match?.className || '',
        teacherCode,
        teacherName,
        teacher,
        termLabel: terms.find((item) => item.value === term)?.label || '',
      };
    };

    if (url.pathname === '/api/session' && req.method === 'GET') {
      const alive = await withPriority('high', () => sessionAlive(ctx));
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
      const terms = await loadTerms(ctx, s, refreshRequested);
      return json(res, 200, { terms, current: terms[0]?.value || '' });
    }

    if (url.pathname === '/api/schedule' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await loadScheduleView(ctx, s, term, { all: true, force: refreshRequested, requireAll: true });
      return json(res, 200, data);
    }

    // 分段课表：优先当前周 ±1，返回 loadedWeeks / pendingWeeks / failedWeeks；
    // prefetch=1 表示后台补齐，用低优先级，把额度让给用户正在看的内容（review R02/R04）。
    if (url.pathname === '/api/schedule/partial' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const weeksParam = url.searchParams.get('weeks') || '';
      const weeks = weeksParam
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((week) => Number.isInteger(week) && week >= 1 && week <= 60)
        .slice(0, 60);
      const prefetch = url.searchParams.get('prefetch') === '1';
      const data = await withPriority(prefetch ? 'low' : 'normal', () =>
        loadScheduleView(ctx, s, term, { weeks, force: refreshRequested }));
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
      const key = `progressCopyTerms:${JSON.stringify([term, kcdm, skbjdm])}`;
      const data = await cache(key, () => getProgressCopyTerms(s, term, kcdm, skbjdm));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/progress/copy-classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      const xnxq = url.searchParams.get('xnxq') || '';
      if (!term || !kcdm || !xnxq) return json(res, 400, { error: '缺少 term / kcdm / xnxq 参数' });
      const key = `progressCopyClasses:${JSON.stringify([term, kcdm, skbjdm, xnxq])}`;
      const data = await cache(key, () => getProgressCopyClasses(s, term, kcdm, skbjdm, xnxq));
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
      const data = await loadProgressClasses(ctx, s, term, refreshRequested);
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
      const data = await loadProgressEntry(ctx, s, term, params, { force: refreshRequested });
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
      // 只在没有明确失败信号时做定向失效：进度汇总/明细/导出，保留课表、教学任务、成绩等无关缓存（review R05）
      const businessStatus = result?.data ? String(result.data.status ?? '') : '';
      const failed = Boolean(result?.data) && Boolean(businessStatus) && businessStatus !== '200';
      if (!failed) invalidateProgressAfterSave(ctx, body.term);
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
      const data = await loadProgressSummary(ctx, s, term, refreshRequested);
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
        const entry = await loadProgressEntry(ctx, s, term, {
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
      const data = await loadProgressClasses(ctx, s, term);
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

    if (url.pathname === '/api/roster/export/pdf' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      if (!term || !kcdm || !skbjdm) return json(res, 400, { error: '缺少 term / kcdm / skbjdm 参数' });
      // 本机排版出 PDF：内容和打印预览一致（完整名单、没有教务报表页的页眉和翻页）
      const fontPath = resolveRosterFont();
      if (!fontPath) {
        return json(res, 500, {
          error:
            '服务器上没有可用的中文字体，无法生成点名册 PDF：请安装中文字体（如 fonts-arphic-gbsn00lp、fonts-wqy-zenhei），或用 ROSTER_PDF_FONT 指定一个 TTF/OTF 字体文件路径；也可以先导出 CSV。',
        });
      }
      const report = await loadRosterReport(s, term, kcdm, skbjdm);
      const buffer = await cacheExport(`exportRosterPdf:${JSON.stringify([term, kcdm, skbjdm])}`, () =>
        buildRosterPdf({ term, kcdm, skbjdm, ...report, fontPath }),
      );
      await sendDownload(req, res, `点名册-${skbjdm}.pdf`, buffer, 'application/pdf');
      return;
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
      const report = await loadRosterReport(s, term, kcdm, skbjdm);
      const format = url.searchParams.get('format') || 'xls';
      const printMode = format === 'print';
      const html = buildRosterListHtml({
        term,
        ...report,
        kcdm,
        skbjdm,
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
      const filename = `点名册-${report.className || skbjdm}.${asHtml ? 'html' : 'xls'}`;
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
      // 展开成绩明细：按参数缓存在会话内，近期再展开同一班级不再回源（review R17 同类等待）
      const key = `courseGrades:${JSON.stringify([term, params.kcdm, params.bjdm, params.flag, params.dyfs, params.qmzhC])}`;
      const data = await cache(key, () => getCourseGradesReport(s, params));
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
}

const server = createServer((req, res) => {
  const scope = createScope({ label: req.method || 'GET' });
  let logged = false;
  const finish = () => {
    if (logged) return;
    logged = true;
    logScope(scope, res.statusCode);
  };
  res.on('finish', finish);
  res.on('close', finish);
  runWithScope(scope, () => handleRequest(req, res, scope)).catch((error) => {
    console.error('[api]', error);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    else if (!res.destroyed) res.destroy(error);
  });
});

server.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  console.log(`[api] http://${process.env.HOST || '127.0.0.1'}:${config.port}`);
  sweepSessions();
  setInterval(sweepSessions, 60 * 60 * 1000).unref();
  // 过期缓存主动释放（review R07）：TTL 不再只决定命中，也决定回收。
  setInterval(() => sweepAllCaches(), 5 * 60 * 1000).unref();
});

server.on('error', (error) => {
  console.error(`[api] 启动失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
