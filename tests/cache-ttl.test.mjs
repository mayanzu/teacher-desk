import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheTtlFor, DEFAULT_CACHE_TTL_MS } from '../server/cacheTtl.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

test('学期列表缓存 12 小时（一学期都不会变）', () => {
  assert.equal(cacheTtlFor('terms'), 12 * HOUR);
});

test('课表与教学任务缓存 30 分钟', () => {
  assert.equal(cacheTtlFor('schedule:2026,0'), 30 * MINUTE);
  assert.equal(cacheTtlFor('tasks:2026,0'), 30 * MINUTE);
});

test('成绩类缓存 30 分钟', () => {
  assert.equal(cacheTtlFor('grades:2026,0'), 30 * MINUTE);
  assert.equal(cacheTtlFor('courseGradeClasses:2026,0'), 30 * MINUTE);
  assert.equal(cacheTtlFor('courseGrades:2026,0:CS101:CS1'), 30 * MINUTE);
});

test('点名册缓存 10 分钟', () => {
  assert.equal(cacheTtlFor('roster:2026,0:CS101:CS1'), 10 * MINUTE);
  assert.equal(cacheTtlFor('rosterClasses:2026,0'), 10 * MINUTE);
});

test('教学进度等仍使用默认 5 分钟 TTL', () => {
  assert.equal(DEFAULT_CACHE_TTL_MS, 5 * MINUTE);
  assert.equal(cacheTtlFor('progressSummary:2026,0'), DEFAULT_CACHE_TTL_MS);
  assert.equal(cacheTtlFor('progressClasses:2026,0'), DEFAULT_CACHE_TTL_MS);
  assert.equal(cacheTtlFor('progressCopyTerms:2026,0:CS101:CS1'), DEFAULT_CACHE_TTL_MS);
  assert.equal(cacheTtlFor('未知的键'), DEFAULT_CACHE_TTL_MS);
  assert.equal(cacheTtlFor(undefined), DEFAULT_CACHE_TTL_MS);
});

test('TTL 分层只对完整匹配前缀生效，避免误伤同名开头的键', () => {
  // 'termsX' 不是学期列表键，不应拿到 12 小时
  assert.equal(cacheTtlFor('termsX:2026,0'), DEFAULT_CACHE_TTL_MS);
  // 'scheduleDraft' 同理
  assert.equal(cacheTtlFor('scheduleDraft:2026,0'), DEFAULT_CACHE_TTL_MS);
});

test('调用方可以传入自定义兜底值', () => {
  assert.equal(cacheTtlFor('progressSummary:2026,0', 1234), 1234);
});
