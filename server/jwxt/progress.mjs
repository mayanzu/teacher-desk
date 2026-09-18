import { parseTable, clean, parseTerm, gbkFormEncode } from './common.mjs';

export async function getProgress(session, term) {
  const { xn, xq } = parseTerm(term);
  const res = await session.text('/ahsljw/wjstgdfw/jxap.ckjxjdb_data.jsp', {
    method: 'POST',
    referer: `${session.base}/ahsljw/wjstgdfw/jxap.ckjxjdb.html?menucode=T2020203`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `xn=${xn}&xn1=${xn}&xq=${xq}&xq_m=${xq}&kchj=1&gs=1&kcmc=&skbjdm=&ysh=&xysh=&bjmc=&kcmctxt=`,
  });
  const rows = parseTable(res.text);
  const items = rows
    .filter((row) => /^\d+$/.test((row[0] || '').trim()) && row.length >= 15)
    .map((row) => ({
      week: row[0] ?? '',
      weekday: row[1] ?? '',
      date: row[2] ?? '',
      periodOfDay: row[3] ?? '',
      period: row[4] ?? '',
      lectureHours: row[5] ?? '',
      practiceHours: row[6] ?? '',
      labHours: row[7] ?? '',
      otherHours: row[8] ?? '',
      classCode: row[9] ?? '',
      classNames: row[10] ?? '',
      teacher: row[11] ?? '',
      room: row[13] ?? '',
      content: row[14] ?? '',
      remark: row[15] ?? '',
    }));
  return { items, total: items.length };
}

// 原版「成绩登记册」菜单下的三个页签：环节成绩 / 毕业设计(论文)成绩 / 补考成绩
function parseDoAddArgs(html) {
  const list = [];
  const re = /doAdd\(\s*([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  let m;
  while ((m = re.exec(html))) {
    const args = [];
    let current = '';
    let quote = null;
    for (const ch of m[1]) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ',') {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    args.push(current.trim());
    list.push({
      kcdm: args[0] || '',
      jsxs: args[1] || '',
      syxs: args[2] || '',
      sjxs: args[3] || '',
      ldxs: args[4] || '',
      qtxs: args[5] || '',
      bjdm: args[6] || '',
      kcmc: args[7] || '',
      bjmc: args[8] || '',
      skbjdm: args[9] || '',
      pklb: args[10] || '',
      jsdm: args[11] || '',
      jsxm: args[12] || '',
      lsjs: args[13] || '',
    });
  }
  return list;
}

const SKFS_LABELS = { '0': '讲授', '1': '实验', '2': '实践', '3': '其它', '4': '体育', '5': '其他' };

function parseGridRows(html) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html))) {
    const start = tr[1].match(/id=["'](tr\d+)_zjbs["']/i);
    if (!start) continue;
    const prefix = start[1];
    const cellRe = new RegExp(`<t[dh]\\b[^>]*id=["']${prefix}_([A-Za-z0-9_]+)["'][^>]*>([\\s\\S]*?)</t[dh]>`, 'gi');
    const fields = {};
    let cell;
    while ((cell = cellRe.exec(tr[1]))) {
      const html = cell[2];
      const input = html.match(/<input\b[^>]*value=["']([^"']*)["']/i);
      const area = html.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/i);
      const selected = html.match(/<option\b[^>]*selected[^>]*value=["']([^"']*)["']/i);
      fields[cell[1]] = input ? clean(input[1]) : area ? clean(area[1]) : selected ? clean(selected[1]) : clean(html);
    }
    const input = (key) => fields[`${key}_input`] || '';
    const display = (key) => fields[key] || '';
    rows.push({
      subId: fields.teachingTaskJxjcbSubId || '',
      index: fields.jlxh || '',
      week: fields.zc || '',
      parity: fields.dszM || '',
      weekList: fields.zcxl || '',
      weekday: fields.xinqi || '',
      date: fields.riqiYMD || '',
      hours: fields.xs || '',
      periodOfDay: fields.sd || '',
      periodCode: fields.jc || '',
      periodList: fields.jcxl || '',
      period: fields.xjxl || '',
      lectureHours: input('jsxs') || display('jsxs'),
      practiceHours: input('sjxs') || display('sjxs'),
      labHours: input('syxs') || display('syxs'),
      otherHours: input('qtxs') || display('qtxs'),
      classCode: display('skbjdm'),
      content: input('jsnr') || display('jsnr'),
      contentZ: input('jsnr_z') || display('jsnr_z'),
      contentJ: input('jsnr_j') || display('jsnr_j'),
      requirement: input('yq') || display('yq'),
      homework: input('zy') || display('zy'),
      remark: input('bz') || display('bz'),
      mode: SKFS_LABELS[display('skfsM')] || display('skfsDesc') || '',
      modeCode: display('skfsM') || '',
      raw: fields,
    });
  }
  return rows;
}

const PROGRESS_LIST_TABLE = '1004010319';
const PROGRESS_GRID_TABLE = '5529052';

function progressBody(xn, xq) {
  return `xn=${xn}&xn1=${xn}&xq=${xq}&xq_m=${xq}&xnxq=${xn},${xq}`;
}

export async function getProgressClasses(session, term) {
  const { xn, xq } = parseTerm(term);
  const ref = `${session.base}/ahsljw/wjstgdfw/jxap.lrjxjdb10319.html?menucode=T2020201`;
  const res = await session.text(`/ahsljw/taglib/DataTable.jsp?tableId=${PROGRESS_LIST_TABLE}`, {
    method: 'POST',
    referer: ref,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `${progressBody(xn, xq)}&kchj=1&hidKey=&hidOption=&rad_lrqk=0&xwly=&xwlw=&xwsh=`,
  });
  const rows = parseTable(res.text);
  const args = parseDoAddArgs(res.text);
  const headerIndex = rows.findIndex((row) => row.some((c) => /课程/.test(c)) && row.some((c) => /审核/.test(c)));
  const headers = headerIndex >= 0 ? rows[headerIndex] : [];
  const items = [];
  let argIndex = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const text = row.join(' ');
    if (!/doAdd|\[/.test(text)) continue;
    const arg = args[argIndex];
    argIndex += 1;
    if (!arg) continue;
    const cell = (index) => String(row[index] ?? '').trim();
    items.push({
      courseRaw: arg.kcmc || cell(1),
      className: cell(6) || cell(5) || arg.bjmc,
      classCode: arg.bjdm,
      credit: cell(2),
      hours: cell(3),
      audit: cell(11),
      teacher: cell(9),
      entryTime: cell(15),
      params: arg,
    });
  }
  return { items, headers, xn, xq };
}

export async function getProgressEntry(session, term, params) {
  const { xn, xq } = parseTerm(term);
  const ref = `${session.base}/ahsljw/wjstgdfw/jxap.lrjxjdb10319.html?menucode=T2020201`;
  const query = new URLSearchParams({
    operationType: 'ADD',
    xn: String(xn),
    xq_m: String(xq),
    kcdm: params.kcdm || '',
    bjdm: params.bjdm || '',
    skbjdm: params.bjdm || '',
    bjmc: params.bjmc || '',
    kcmc: params.kcmc || '',
    pklb: params.pklb || '0',
    jsdm: params.jsdm || '',
    jsxm: params.jsxm || '',
    lsjs: params.lsjs || '',
  }).toString();

  const form = await session.text(`/ahsljw/wjstgdfw/jxap.lrjxjdb.edit10319.jsp?${query}`, { method: 'GET', referer: ref });
  const meta = {};
  for (const m of form.text.matchAll(/<input[^>]*name=["'](jxjcb\.[A-Za-z0-9_]+|teachingTaskJxjcbId|teachingTaskId|pklb|jsdm|jsxm|lsjs)["'][^>]*value=["']([^"']*)["']/gi)) {
    meta[m[1]] = m[2];
  }

  const formFields = {};
  for (const m of form.text.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    formFields[name] = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? '';
  }
  const metaBody = Object.entries(meta)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const gridBody = `${metaBody}&xn=${xn}&xq_m=${xq}`;
  const gridTables = [PROGRESS_GRID_TABLE, '5929112', '5929131', '5929365', '5929137'];
  let rows = [];
  let gridTable = gridTables[0];
  for (const tableId of gridTables) {
    const grid = await session.text(`/ahsljw/taglib/DataTable_utf8.jsp?tableId=${tableId}&hidOption=`, {
      method: 'POST',
      referer: ref,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: gridBody,
    });
    const parsed = parseGridRows(grid.text);
    if (parsed.length) {
      rows = parsed;
      gridTable = tableId;
      break;
    }
  }
  let xqskzs = '';
  try {
    const zs = await session.text('/ahsljw/jw/common/getXqskzs.action', {
      method: 'POST',
      referer: ref,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: `xn=${xn}&xq_m=${xq}`,
    });
    const match = zs.text.match(/"?(\d{1,2})"?/);
    if (match) xqskzs = match[1];
  } catch {
    /* 忽略：使用默认周数 */
  }

  const totals = {
    lecture: Number(params.jsxs) || 0,
    lab: Number(params.syxs) || 0,
    practice: Number(params.sjxs) || 0,
    labor: Number(params.ldxs) || 0,
    other: Number(params.qtxs) || 0,
  };

  return { meta, formFields, rows, gridTable, xqskzs, totals, xn, xq };
}

export function buildProgressPayload(meta, rows, formFields = {}, tjflag = '1', xqskzs = '') {
  const arr = (pick, sep = '|', empty = 'undefined') =>
    rows.map((row) => {
      const value = pick(row);
      return `${value === '' || value == null ? empty : String(value)}${sep}`;
    }).join('');
  const txt = (pick) =>
    rows
      .map((row) => {
        const value = pick(row);
        if (value === '' || value == null) return 'undefined@#@';
        return `${String(value).replace(/'/g, '#$#@').replace(/;/g, '@$*$@')}@#@`;
      })
      .join('');
  const raw = (row, key) => (row.raw ? row.raw[key] ?? '' : '');

  const cleanFields = {};
  for (const [key, value] of Object.entries(formFields)) {
    if (/^btn/i.test(key) || key === 'tr' || key === 'chk_yxsjct') continue;
    cleanFields[key] = value;
  }

  return {
    ...cleanFields,
    ...meta,
    'jxjcb.bz_n': formFields['jxjcb.bz_n'] || '',
    role: formFields.role || 'tea',
    hidOption: 'ADD',
    tjflag,
    sxflag: '',
    lrr: '',
    xsxslx: formFields.xsxslx || 'qtxs',
    trbot_id: '',
    maxxh: String(Math.max(0, rows.length - 1)),
    deleteIds: '',
    xqskzs: xqskzs || formFields.xqskzs || '',
    sjctflag: '0',
    pklb: '0',
    nskbjmc: '',
    menucode_current: '',
    btnPrint: '打印',
    btnQtjs: '其他教师',
    jlxhs: arr((r) => r.index),
    zcs: arr((r) => r.week),
    dsz_ms: arr((r) => r.parity),
    zcxls: arr((r) => r.weekList),
    xinqis: arr((r) => r.weekday),
    riqis: arr((r) => r.date),
    xss: arr((r) => r.hours),
    jcs: arr((r) => r.periodCode),
    jcxls: arr((r) => r.periodList),
    xjxls: arr((r) => r.period),
    sds: arr((r) => r.periodOfDay),
    skdd_ms: arr((r) => raw(r, 'skddM')),
    rkjsms: arr((r) => raw(r, 'rkjsM')),
    dmts: arr((r) => raw(r, 'dmt_input') || '1'),
    sjlys: arr((r) => raw(r, 'sjly'), '|', '0'),
    jsxss: arr((r) => r.lectureHours),
    sjxss: arr((r) => r.practiceHours),
    syxss: arr((r) => r.labHours),
    qtxss: arr((r) => r.otherHours),
    xzxss: arr(() => ''),
    jsnrs: txt((r) => r.content),
    jsnr_zs: txt(() => ''),
    jsnr_js: txt(() => ''),
    yqs: txt(() => ''),
    zys: txt(() => ''),
    bzs: txt(() => ''),
    sjjsnrs: arr((r) => raw(r, 'sjjsnr')),
    cdxss: arr((r) => raw(r, 'cdxs')),
    qjxss: arr((r) => raw(r, 'qjxs')),
    kkxss: arr((r) => raw(r, 'kkxs')),
    jxbzs: arr((r) => raw(r, 'jxbz')),
    sybjdms: arr((r) => raw(r, 'sybjdm')),
    syfzdms: arr((r) => raw(r, 'syfzdm')),
    syfzdm_xhs: arr((r) => raw(r, 'syfzdm_xh')),
    syxms: arr((r) => raw(r, 'syxmdm')),
    skfss: arr((r) => raw(r, 'skfsM'), '@#@', '0'),
    yskfss: arr((r) => raw(r, 'skfsM'), '@#@', '0'),
  };
}

export async function saveProgressEntry(session, term, meta, rows, formFields = {}, tjflag = '1', xqskzs = '') {
  const payload = buildProgressPayload(meta, rows, formFields, tjflag, xqskzs);
  const body = gbkFormEncode(payload);
  const ref = `${session.base}/ahsljw/wjstgdfw/jxap.lrjxjdb.edit10319.jsp?operationType=ADD`;
  const res = await session.text('/ahsljw/TeachingTaskingJxjcbAction.do', {
    method: 'POST',
    referer: ref,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  let data = null;
  const match = res.text.match(/_callBack\("([\s\S]*?)"\)/);
  if (match) {
    try {
      data = JSON.parse(match[1].replace(/\\"/g, '"').replace(/\\\//g, '/'));
    } catch {
      data = null;
    }
  }
  return { status: res.status, data, text: res.text.slice(0, 800) };
}

const COPY_QRY_REF = 'jxap.lrjxjdbbyskbj_qry.html';

async function dropList(session, referer, comboBoxName, paramValue) {
  const res = await session.text('/ahsljw/frame/droplist/getDropLists.action', {
    method: 'POST',
    referer,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: `comboBoxName=${comboBoxName}&paramValue=${encodeURIComponent(paramValue)}&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0`,
  });
  try {
    const list = JSON.parse(res.text);
    return Array.isArray(list) ? list.map((item) => ({ code: String(item.code ?? ''), name: String(item.name ?? '') })) : [];
  } catch {
    return [];
  }
}

export async function getProgressCopyTerms(session, term, kcdm, skbjdm) {
  const { xn, xq } = parseTerm(term);
  const referer = `${session.base}/ahsljw/wjstgdfw/${COPY_QRY_REF}`;
  const items = await dropList(session, referer, 'JXJDB_SKBJ_XNXQ', `xn=${xn}&xq_m=${xq}&kcdm=${kcdm}&skbjdm=${skbjdm}`);
  return { items };
}

export async function getProgressCopyClasses(session, term, kcdm, skbjdm, xnxq) {
  const { xn, xq } = parseTerm(term);
  const referer = `${session.base}/ahsljw/wjstgdfw/${COPY_QRY_REF}`;
  const items = await dropList(session, referer, 'JXJDB_SKBJ', `xnxq=${xnxq}&xn=${xn}&xq_m=${xq}&kcdm=${kcdm}&skbjdm=${skbjdm}`);
  return { items };
}

export async function copyProgressFromClass(session, xnxq, kcdm, sourceSkbjdm) {
  const xn = String(xnxq).slice(0, 4);
  const xq = String(xnxq).slice(4) || '0';
  const res = await session.text(
    `/ahsljw/EnterTeachingTaskPlanByKcAction.do?hidOption=SYNSKBJ&xn=${xn}&xq_m=${xq}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(sourceSkbjdm)}`,
    {
      method: 'POST',
      referer: `${session.base}/ahsljw/wjstgdfw/${COPY_QRY_REF}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: '',
    },
  );
  const pick = (block, tag) => block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
  const items = [];
  for (const m of res.text.matchAll(/<kcjdb>([\s\S]*?)<\/kcjdb>/g)) {
    items.push({
      content: pick(m[1], 'nr'),
      mode: pick(m[1], 'skfs'),
      lectureHours: pick(m[1], 'jsxs'),
      labHours: pick(m[1], 'syxs'),
      practiceHours: pick(m[1], 'sjxs'),
      otherHours: pick(m[1], 'qtxs'),
      requirement: pick(m[1], 'yq'),
      homework: pick(m[1], 'zy'),
      remark: pick(m[1], 'bz'),
    });
  }
  return { items };
}

export async function getProgressCourses(session, term) {
  const { xn, xq } = parseTerm(term);
  const res = await session.text('/ahsljw/wjstgdfw/jxap.ckjxjdb_data_gs3.jsp', {
    method: 'POST',
    referer: `${session.base}/ahsljw/wjstgdfw/jxap.ckjxjdb.html?menucode=T2020203`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `xn=${xn}&xn1=${xn}&xq=${xq}&xq_m=${xq}&kchj=1&gs=1&kcmc=&skbjdm=&ysh=&xysh=&bjmc=&kcmctxt=`,
  });
  const rows = parseTable(res.text);
  const headerIndex = rows.findIndex((row) => row.includes('课程') && row.some((cell) => /班级|教师/.test(cell)));
  if (headerIndex < 0) return [];
  return rows
    .slice(headerIndex + 1)
    .filter((row) => /^\d+$/.test(String(row[0] ?? '').trim()))
    .map((row) => {
      const raw = String(row[1] ?? '').trim();
      const match = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
      return {
        courseCode: match?.[1] || '',
        courseName: (match?.[2] || raw).trim(),
        teacher: String(row[2] ?? '').trim(),
        classCode: String(row[3] ?? '').trim(),
      };
    })
    .filter((item) => item.courseName);
}

export async function getProgressSummary(session, term) {
  // 当前学期：按“录入教学班”聚合，课程维度准确
  let classes = { items: [] };
  try {
    classes = await getProgressClasses(session, term);
  } catch {
    classes = { items: [] };
  }
  if (classes.items.length) {
    const items = [];
    for (const item of classes.items) {
      let entry;
      try {
        entry = await getProgressEntry(session, term, item.params);
      } catch {
        continue;
      }
      if (!entry.rows.length) continue;
      const weeks = entry.rows.map((row) => Number(row.week)).filter((n) => n > 0);
      items.push({
        kcdm: item.params.kcdm,
        skbjdm: item.classCode,
        className: item.className,
        courseName: item.courseRaw,
        count: entry.rows.length,
        minWeek: weeks.length ? Math.min(...weeks) : 0,
        maxWeek: weeks.length ? Math.max(...weeks) : 0,
        rows: entry.rows.map((row) => ({
          week: row.week,
          date: row.date,
          period: row.period,
          content: row.content,
          room: row.raw?.skddM || '',
        })),
      });
    }
    if (items.length) {
      items.sort((a, b) => b.count - a.count);
      return { items };
    }
  }

  // 历史学期：录入列表为空，改用“查看学期教学进度表”的数据，按教学班（上课班级代码）聚合
  const progress = await getProgress(session, term);
  let courseMap = new Map();
  try {
    courseMap = new Map((await getProgressCourses(session, term)).map((item) => [item.classCode, item.courseName]));
  } catch {
    courseMap = new Map();
  }
  const groups = new Map();
  for (const row of progress.items) {
    const key = row.classCode || `cls:${row.classNames || '未标注班级'}`;
    if (!groups.has(key)) groups.set(key, { classCode: row.classCode || '', className: row.classNames || '', rows: [] });
    groups.get(key).rows.push(row);
  }
  const items = [...groups.values()].map((group) => {
    const courseName = courseMap.get(group.classCode) || '';
    const weeks = group.rows.map((row) => Number(row.week)).filter((n) => n > 0);
    return {
      kcdm: '',
      skbjdm: group.classCode,
      className: group.className,
      courseName,
      courses: courseName ? [courseName] : [],
      count: group.rows.length,
      minWeek: weeks.length ? Math.min(...weeks) : 0,
      maxWeek: weeks.length ? Math.max(...weeks) : 0,
      rows: group.rows.map((row) => ({
        week: row.week,
        date: row.date,
        period: row.period,
        content: row.content,
        room: row.room,
      })),
    };
  });
  items.sort((a, b) => b.count - a.count);
  return { items };
}

export function buildProgressCsv(rows) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const header = ['周次', '日期', '节次', '上课班级', '地点', '授课内容'];
  const lines = rows.map((row) => [row.week, row.date, row.period, row.classNames, row.room, row.content].map(escape).join(','));
  return `\uFEFF${header.map(escape).join(',')}\r\n${lines.join('\r\n')}`;
}

export async function exportProgressPdf(session, params) {
  const { xn, xq } = parseTerm(params.term);
  const all = params.scope === 'term';
  let pageurl;
  let title;
  let printParams;
  if (all) {
    const qs = `xn=${xn}&xn1=${xn}&xq=${xq}&xq_m=${xq}&kchj=1&gs=1&kcmc=&skbjdm=&ysh=&xysh=&bjmc=&kcmctxt=`;
    pageurl = `wjstgdfw/jxap.ckjxjdb_data_gs2.jsp?${qs}`;
    title = '查看学期教学进度表';
    printParams = 'pageSize=A4&orientation=L&top=0&bottom=20&left=10&right=10';
  } else {
    const kcdm = String(params.kcdm || String(params.bjdm || '').split('-')[0]);
    const bjdm = String(params.bjdm || '');
    const kcmc = String(params.kcmc || '');
    pageurl = `wjstgdfw/jxap.lrjxjdb.look.jsp?xn=${xn}&xq_m=${xq}&kcdm=${kcdm}&bjdm=${bjdm}&isgly=1&kcmc=${kcmc}`;
    title = `${params.courseName || '教学进度表'}`;
    printParams = 'pageSize=A4&orientation=P&top=0&bottom=10&left=10&right=10';
  }
  const body = `pageurl=${doubleEncode(pageurl)}&${printParams}&title=${doubleEncode(title)}`;
  const res = await session.text('/ahsljw/frame/pdf?method=topdf', {
    method: 'POST',
    referer: `${session.base}/ahsljw/wjstgdfw/jxap.ckjxjdb.html?menucode=T2020203`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  let data = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    data = null;
  }
  if (!data || String(data.status) !== '200' || !data.result) {
    throw new Error((data && data.message) || '原版 PDF 生成失败');
  }
  const [fileName, fileSavePath] = String(data.result).split(';;');
  const dl = await session.request(
    `/ahsljw/frame/pdf?method=download&title=${doubleEncode(fileName)}&fileSavePath=${fileSavePath}`,
    { method: 'GET', referer: `${session.base}/ahsljw/frame/pdf?method=topdf` },
  );
  const parts = [params.courseName, params.className, all ? '学期教学进度表' : '教学进度表'].filter(Boolean);
  const filename = `${safeFileName(parts.join('_'), '教学进度表')}.pdf`;
  return { filename, buffer: dl.buffer };
}

