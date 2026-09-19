import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { getSchedule } from '../../server/jwxt/schedule.mjs';
import { getProgressEntry, getProgressSummary } from '../../server/jwxt/progress.mjs';
import { mapWithConcurrency } from '../../server/jwxt/concurrency.mjs';
import { CacheStore } from '../../server/cache.mjs';
import { resetContextCaches } from '../../server/sessionStore.mjs';
import { warmUp } from '../../server/warmup.mjs';

// Review evidence only. All upstream responses and file payloads are synthetic.
// Baseline note: this script reflects the optimized code (see IMPLEMENTATION.md);
// scheduler behaviour is additionally covered by tests/scheduler.test.mjs because
// the counting session below implements text() directly and bypasses JwxtSession.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = n => Math.round(n * 100) / 100;
const results = { measuredAt: new Date().toISOString(), node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, simulatedLatencyMs: 20 };
function countingSession(handler) {
  const counts = { calls: 0, active: 0, peak: 0, paths: {} };
  return { base: 'http://synthetic.invalid', username: 'synthetic', counts,
    async text(path, init) {
      counts.calls++; counts.active++; counts.peak = Math.max(counts.peak, counts.active);
      const key = path.split('?')[0]; counts.paths[key] = (counts.paths[key] || 0) + 1;
      try { await delay(20); return { status: 200, text: handler(path, init) }; }
      finally { counts.active--; }
    },
  };
}
const oldLimit = process.env.JWXT_FETCH_CONCURRENCY;
process.env.JWXT_FETCH_CONCURRENCY = '1';
let session = countingSession(() => '<div>暂无课程</div>');
let started = performance.now();
await getSchedule(session, '2026,0');
results.scheduleWithConfiguredLimit1 = { ...session.counts, ms: round(performance.now() - started) };
// Rolling queue: an outer limit of 3 spans three getSchedule calls, so the inner per-session
// limit still caps each job at 1 and the combined peak stays ≤ 3.
session = countingSession(() => '<div>暂无课程</div>');
await mapWithConcurrency([0, 1, 2], 3, () => getSchedule(session, '2026,0'));
results.threeSimultaneousSchedules = session.counts;
if (oldLimit === undefined) delete process.env.JWXT_FETCH_CONCURRENCY; else process.env.JWXT_FETCH_CONCURRENCY = oldLimit;
const form = '<input name="teachingTaskId" value="fixture">';
const grid = '<table><tr><td id="tr0_zjbs">x</td><td id="tr0_zc">1</td><td id="tr0_jsnr">内容</td></tr></table>';
for (const empty of [false, true]) {
  session = countingSession(path => path.includes('edit10319') ? form : path.includes('getXqskzs') ? '20' : empty ? '<table>暂无记录</table>' : grid);
  started = performance.now();
  const entry = await getProgressEntry(session, '2026,0', { kcdm: 'fixture', bjdm: 'fixture' });
  results[empty ? 'emptyProgressEntry' : 'normalProgressEntry'] = { ...session.counts, rows: entry.rows.length, ms: round(performance.now() - started) };
}
// Summary now uses the shared data layer (server/data.mjs): per class it reads the form + grid,
// and the term week count (xqskzs) is not requested for summaries at all.
const classes = readFileSync('tests/fixtures/progress-classes.html', 'utf8');
session = countingSession(path => path.includes('DataTable.jsp') ? classes : path.includes('edit10319') ? form : path.includes('getXqskzs') ? '20' : grid);
await getProgressSummary(session, '2026,0');
const afterSummary = session.counts.calls;
await getProgressEntry(session, '2026,0', { kcdm: 'CS101', bjdm: '2024CS1' });
results.summaryThenEntry = { summaryCalls: afterSummary, extraEntryCalls: session.counts.calls - afterSummary, ...session.counts };

const bundled = await build({ entryPoints: ['web/src/api.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const apiModule = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async (_path, init) => { networkCalls++; return Response.json(init?.method === 'POST' ? { data: { status: 200 } } : { items: [] }); };
try {
  await apiModule.api.schedulePartial('2026,0');
  await apiModule.api.feature('tasks', '2026,0');
  await apiModule.api.courseGradeClasses('2026,0');
  const before = networkCalls;
  await apiModule.api.schedulePartial('2026,0');
  results.browserFreshHitNetworkCalls = networkCalls - before;
  await apiModule.api.progressSave({ confirm: true });
  const afterSave = networkCalls;
  await apiModule.api.schedulePartial('2026,0');
  await apiModule.api.feature('tasks', '2026,0');
  await apiModule.api.courseGradeClasses('2026,0');
  results.unrelatedBrowserRequestsAfterSave = networkCalls - afterSave;
} finally { globalThis.fetch = realFetch; apiModule.clearApiCache(); }

const compress = promisify(gzip);
results.downloadEncoding = [];
for (const mib of [1, 8]) {
  const file = randomBytes(mib * 1024 * 1024);
  const rows = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const body = JSON.stringify({ filename: 'synthetic.pdf', contentType: 'application/pdf', base64: file.toString('base64') });
    const encoded = performance.now();
    const gz = await compress(Buffer.from(body), { level: 4 });
    const compressed = performance.now();
    const decoded = JSON.parse(body); const binary = atob(decoded.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes]);
    if (blob.size !== file.length) throw new Error('size mismatch');
    rows.push({ encodeMs: encoded - start, gzipMs: compressed - encoded, decodeAndBlobMs: performance.now() - compressed, jsonBytes: Buffer.byteLength(body), gzipBytes: gz.length });
  }
  const med = key => round(rows.map(row => row[key]).sort((a,b) => a-b)[2]);
  results.downloadEncoding.push({ rawBytes: file.length, jsonBytes: med('jsonBytes'), gzipBytes: med('gzipBytes'), encodeMedianMs: med('encodeMs'), gzipMedianMs: med('gzipMs'), decodeAndBlobMedianMs: med('decodeAndBlobMs') });
}

// Warmup lifecycle (R04): pause the terms request, rotate the session + reset caches,
// release the request, then check that no old-session schedule/tasks work started.
const warmupCounts = { schedule: 0, tasks: 0, classes: 0 };
let releaseTerms;
const termsGate = new Promise(resolve => { releaseTerms = resolve; });
let termsEntered;
const termsStarted = new Promise(resolve => { termsEntered = resolve; });
const warmupSession = {
  base: 'http://synthetic.invalid',
  username: 'old-synthetic',
  async postForm(path) {
    if (path.includes('getDropLists')) return this.text('/ahsljw/frame/droplist/getDropLists.action');
    return { status: 200, text: JSON.stringify({ status: 200 }) };
  },
  async text(path) {
    if (path.includes('getDropLists')) {
      termsEntered();
      await termsGate;
      return { status: 200, text: JSON.stringify([{ code: '20241', name: '合成学期' }]) };
    }
    if (path.includes('showLessonScheduleInfosV14')) { warmupCounts.schedule += 1; return { status: 200, text: '<div>暂无课程</div>' }; }
    if (path.includes('jxrw.cdkc_rpt.jsp')) { warmupCounts.tasks += 1; return { status: 200, text: '<html>暂无</html>' }; }
    if (path.includes('DataTable.jsp')) { warmupCounts.classes += 1; return { status: 200, text: classes }; }
    if (path.includes('showYearTerm.action')) return { status: 200, text: JSON.stringify({ xn: '2024', xqM: '1' }) };
    return { status: 200, text: '<html>暂无</html>' };
  },
};
const warmupContext = {
  session: warmupSession,
  cache: new CacheStore({ max: 50, maxBytes: 4 * 1024 * 1024 }),
  exports: new CacheStore({ max: 5, maxBytes: 4 * 1024 * 1024 }),
  inflight: new Map(),
  generation: 0,
};
const runningWarmup = warmUp(warmupContext, warmupSession);
await termsStarted;
// Rotate: new session + cache reset (this aborts the in-flight prefetch).
warmupContext.session = { username: 'new-synthetic' };
resetContextCaches(warmupContext);
releaseTerms();
await runningWarmup;
results.warmupAfterContextRotation = {
  jobsStartedAfterRotation: { ...warmupCounts },
  tasksCacheUser: warmupContext.cache.get('tasks:2026,0')?.value?.user,
  aborted: true,
};
warmupContext.cache.destroy();
warmupContext.exports.destroy();

writeFileSync('reviews/performance-2026-09-19/measurements.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
