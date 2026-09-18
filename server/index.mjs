import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { config } from './config.mjs';
import { contextFor, persistSession, dropContext, sweepSessions } from './sessionStore.mjs';
import { getSchedule, getTasks, getTerms, getProgress, getGrades, getProgressClasses, getProgressEntry, buildProgressPayload, saveProgressEntry, getProgressCopyTerms, getProgressCopyClasses, copyProgressFromClass, getProgressSummary, buildProgressCsv, getRoster, buildRosterCsv, buildRosterReportHtml, buildRosterListHtml, getRosterPrintHtml, getCourseGradeClasses, getCourseGradesReport, exportCourseGradesPdf, exportCourseGradesExcel, exportProgressPdf } from './jwxt/index.mjs';

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

async function sessionAlive(ctx) {
  if (!ctx.session) return false;
  try {
    // SetMainInfo.jsp 会输出当前登录账号；未登录时为 kingo.guest
    const info = await ctx.session.text('/ahsljw/frame/home/js/SetMainInfo.jsp', { method: 'GET' });
    if (info.status === 200) {
      if (/kingo\.guest/i.test(info.text)) return false;
      if (/_loginid\s*=\s*'[^']+'/.test(info.text)) return true;
    }
    if (!ctx.session.landingUrl) return false;
    const res = await ctx.session.text(ctx.session.landingUrl, { method: 'GET' });
    if (res.status !== 200) return false;
    if (/cas\/login\.action|未登录|登录超时|重新登录|会话已过期/i.test(res.text)) return false;
    return true;
  } catch {
    return false;
  }
}

const CACHE_TTL = 5 * 60 * 1000;

async function cached(ctx, key, fn) {
  const hit = ctx.cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  const value = await fn();
  ctx.cache.set(key, { at: Date.now(), value });
  return value;
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

function serveStatic(res, pathname) {
  if (!existsSync(WEB_DIST)) return false;
  if (pathname.startsWith('/api/')) return false;
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let filePath = join(WEB_DIST, relative);
  if (!filePath.startsWith(WEB_DIST)) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(WEB_DIST, 'index.html');
    if (!existsSync(filePath)) return false;
  }
  const body = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
  res.end(body);
  return true;
}

function allowCors(req, res) {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
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
  const url = new URL(req.url || '/', 'http://localhost');
  allowCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  let ctx = null;
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });

    // 每个浏览器一个独立会话上下文（Cookie: td_sid）
    if (url.pathname.startsWith('/api/')) ctx = contextFor(req, res);

    if (url.pathname === '/api/session' && req.method === 'GET') {
      const alive = await sessionAlive(ctx);
      return json(res, 200, { loggedIn: alive, username: alive && ctx.session ? ctx.session.username : '' });
    }

    if (url.pathname === '/api/login/start' && req.method === 'POST') {
      return json(res, 200, await ctx.loginFlow.start());
    }

    if (url.pathname === '/api/login/status' && req.method === 'GET') {
      const { status, message, username } = ctx.loginFlow.state;
      if (status === 'success') {
        const flowSession = ctx.loginFlow.getSession();
        if (ctx.session !== flowSession) {
          ctx.session = flowSession;
          persistSession(ctx);
          ctx.cache.clear();
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
      const terms = await cached('terms', () => getTerms(s));
      return json(res, 200, { terms, current: terms[0]?.value || '' });
    }

    if (url.pathname === '/api/schedule' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `schedule:${term}`, () => getSchedule(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `tasks:${term}`, () => getTasks(s, term));
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
      const data = await cached(ctx, `progressClasses:${term}`, () => getProgressClasses(s, term));
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
      if (!body || !body.term || !body.meta || !Array.isArray(body.rows)) {
        return json(res, 400, { error: '请求体需要 term / meta / rows' });
      }
      if (!body.confirm) {
        return json(res, 200, {
          preview: true,
          payload: buildProgressPayload(body.meta, body.rows, body.formFields || {}, body.tjflag || '1', body.xqskzs || ''),
          note: '预览模式：确认无误后携带 confirm:true 才会真正提交',
        });
      }
      const result = await saveProgressEntry(s, body.term, body.meta, body.rows, body.formFields || {}, body.tjflag || '1', body.xqskzs || '');
      ctx.cache.clear();
      return json(res, 200, result);
    }

    if (url.pathname === '/api/progress/export/pdf' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const { filename, buffer } = await exportProgressPdf(s, {
        term,
        scope: url.searchParams.get('scope') || '',
        kcdm: url.searchParams.get('kcdm') || '',
        bjdm: url.searchParams.get('bjdm') || '',
        kcmc: url.searchParams.get('kcmc') || '',
        courseName: url.searchParams.get('courseName') || '',
        className: url.searchParams.get('className') || '',
      });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(buffer);
      return;
    }

    if (url.pathname === '/api/progress/summary' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `progressSummary:${term}`, () => getProgressSummary(s, term));
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
        const data = await cached(ctx, `progress:${term}`, () => getProgress(s, term));
        rows = data.items.filter(
          (row) =>
            (skbjdm ? row.classCode === skbjdm : true) && (className ? row.classNames === className : true),
        );
      }
      const csv = buildProgressCsv(rows);
      const filename = `${className || '全部班级'}-教学进度表.csv`;
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': Buffer.byteLength(csv),
        'Cache-Control': 'no-store',
      });
      res.end(csv);
      return;
    }

    if (url.pathname === '/api/roster/classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `progressClasses:${term}`, () => getProgressClasses(s, term));
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
      const data = await getRoster(s, term, kcdm, skbjdm);
      return json(res, 200, data);
    }

    if (url.pathname === '/api/roster/export' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      if (!term || !kcdm || !skbjdm) return json(res, 400, { error: '缺少 term / kcdm / skbjdm 参数' });
      const data = await getRoster(s, term, kcdm, skbjdm);
      const csv = buildRosterCsv(data.items ?? []);
      const filename = `点名册-${skbjdm}.csv`;
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': Buffer.byteLength(csv),
        'Cache-Control': 'no-store',
      });
      res.end(csv);
      return;
    }

    if (url.pathname === '/api/roster/report' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      const kcdm = url.searchParams.get('kcdm') || '';
      const skbjdm = url.searchParams.get('skbjdm') || '';
      const asHtml = url.searchParams.get('format') === 'html';
      if (!term || !kcdm || !skbjdm) return json(res, 400, { error: '缺少 term / kcdm / skbjdm 参数' });
      const data = await getRoster(s, term, kcdm, skbjdm);
      let weeks = [];
      try {
        const entry = await getProgressEntry(s, term, { kcdm, bjdm: skbjdm, skbjdm: skbjdm });
        weeks = (entry.rows ?? []).map((row) => ({ week: row.week, date: row.date }));
      } catch {
        weeks = [];
      }
      let teacher = '';
      try {
        teacher = (await getSchedule(s, term)).teacher || '';
      } catch {
        teacher = '';
      }
      let courseName = '';
      let className = '';
      let department = '';
      let credit = '';
      let teacherCode = '';
      let teacherName = '';
      try {
        const list = await cached(ctx, `progressClasses:${term}`, () => getProgressClasses(s, term));
        const match = (list.items ?? []).find((item) => item.params?.kcdm === kcdm && item.classCode === skbjdm);
        if (match) {
          courseName = match.courseRaw || '';
          className = match.className || '';
          const jsxm = match.params?.jsxm || '';
          teacherCode = jsxm.match(/\[([^\]]+)\]/)?.[1] || match.params?.jsdm || '';
          teacherName = jsxm.replace(/\[[^\]]*\]/, '').trim();
        }
      } catch {
        courseName = '';
        className = '';
      }
      const courseCode = courseName.match(/^\[([^\]]+)\]/)?.[1] || '';
      try {
        const tasks = await cached(ctx, `tasks:${term}`, () => getTasks(s, term));
        const list = tasks.items ?? [];
        const task =
          list.find((item) => courseCode && item.courseCode === courseCode && (!className || item.classNames === className)) ||
          list.find((item) => courseCode && item.courseCode === courseCode);
        if (task) {
          department = task.department || '';
          credit = task.credit || '';
        }
      } catch {
        department = '';
        credit = '';
      }
      let termLabel = '';
      try {
        const terms = await cached('terms', () => getTerms(s));
        termLabel = terms.find((item) => item.value === term)?.label || '';
      } catch {
        termLabel = '';
      }
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
      res.writeHead(200, {
        'Content-Type': asHtml ? 'text/html; charset=utf-8' : 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    if (url.pathname === '/api/progress' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `progress:${term}`, () => getProgress(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/grades' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `grades:${term}`, () => getGrades(s, term));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/course-grades/classes' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const data = await cached(ctx, `courseGradeClasses:${term}`, () => getCourseGradeClasses(s, term));
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
      const { filename, buffer } = await exportCourseGradesPdf(s, params);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(buffer);
      return;
    }

    if (url.pathname === '/api/course-grades/export/excel' && req.method === 'GET') {
      const s = await ensureSession(ctx);
      const term = url.searchParams.get('term') || '';
      if (!term) return json(res, 400, { error: '缺少 term 参数' });
      const params = courseGradeParams(url, term);
      if (!params.kcdm || !params.bjdm) return json(res, 400, { error: '缺少 kcdm / bjdm 参数' });
      const { filename, buffer } = await exportCourseGradesExcel(s, params);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(buffer);
      return;
    }

    if (serveStatic(res, url.pathname)) return;

    json(res, 404, { error: 'not found' });
  } catch (error) {
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
