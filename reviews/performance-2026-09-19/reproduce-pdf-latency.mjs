import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { exportCourseGradesPdf } from '../../server/jwxt/course-grades.mjs';

// Synthetic phase timing; no network, real account, or school PDF generation.
// Baseline note: reflects the optimized export path (see IMPLEMENTATION.md R08/R17):
// the optional filename metadata query now overlaps the PDF download and is capped
// by a short budget (JWXT_FILENAME_BUDGET_MS, default 800ms), so a slow metadata
// page can no longer delay a file that is already generated.
const start = performance.now();

async function scenario(name, { generateMs, downloadMs, metadataMs }) {
  const trace = [];
  const stage = async (label, ms, result) => {
    const entry = { stage: label, simulatedDelayMs: ms, startMs: Math.round(performance.now() - start), endMs: null };
    trace.push(entry);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Very large synthetic delays must not hold the process open after the export returned.
      if (ms > 5000) timer.unref?.();
    });
    entry.endMs = Math.round(performance.now() - start);
    return result;
  };
  const buffer = Buffer.from('%PDF-1.7\nsynthetic fixture');
  const session = {
    base: 'http://synthetic.invalid',
    text: async path => path.includes('method=topdf')
      ? stage('upstream_generate_pdf', generateMs, { text: JSON.stringify({ status: 200, result: 'fixture;;fixture-path' }) })
      : stage('optional_filename_metadata', metadataMs, { text: readFileSync('tests/fixtures/course-grades-report.html', 'utf8') }),
    request: async () => stage('upstream_download_pdf', downloadMs, { response: new Response(buffer, { headers: { 'Content-Type': 'application/pdf' } }), buffer }),
  };
  const scenarioStart = performance.now();
  const result = await exportCourseGradesPdf(session, { term: '2024,0', kcdm: 'CS101', bjdm: 'fixture', className: '示例班', courseName: '示例课程', flag: '1', dyfs: 'dl' });
  const functionReturnMs = Math.round(performance.now() - scenarioStart);
  const metadata = trace.find((item) => item.stage === 'optional_filename_metadata');
  const download = trace.find((item) => item.stage === 'upstream_download_pdf');
  const generate = trace.find((item) => item.stage === 'upstream_generate_pdf');
  return {
    name,
    trace,
    functionReturnMs,
    serialTotalMs: generateMs + downloadMs + metadataMs,
    metadataOverlapsDownload: Boolean(metadata && download && metadata.startMs < download.endMs),
    metadataPendingAtReturn: Boolean(metadata && metadata.endMs === null),
    generateStartedMs: generate?.startMs ?? null,
    explanation: 'metadata starts after PDF generation and runs in parallel with the download; a slow metadata page is capped by the filename budget instead of blocking the finished file.',
  };
}

const results = {
  measuredAt: new Date().toISOString(),
  synthetic: true,
  scenarios: [
    await scenario('normal metadata', { generateMs: 200, downloadMs: 100, metadataMs: 300 }),
    await scenario('30s metadata (budget caps the wait)', { generateMs: 200, downloadMs: 100, metadataMs: 30000 }),
  ],
};
writeFileSync('reviews/performance-2026-09-19/pdf-latency-measurements.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
