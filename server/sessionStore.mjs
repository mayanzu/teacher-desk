/*
 * 按浏览器隔离的多用户会话存储。
 * 每个浏览器分配一个 HttpOnly Cookie（td_sid），后端为每个 sid 维护独立：
 *   - JwxtSession（各自的教务登录态）
 *   - 扫码登录流程
 *   - 数据缓存（带字节预算，见 cache.mjs）
 * 会话按 sid 持久化到 SESSION_DIR/<sid>.json，重启后可恢复，互不干扰。
 *
 * 会话代际 generation（review R04）：登录态轮换、退出、清理缓存时递增。
 * 后台预热 / 预取任务在入队、出队、写缓存前都要校验代际，避免旧会话结果回填。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, renameSync, writeFileSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.mjs';
import { CacheStore, QUERY_CACHE_BYTES, EXPORT_CACHE_BYTES } from './cache.mjs';
import { JwxtSession } from './session.mjs';
import { createLoginFlow } from './login.mjs';

const COOKIE = 'td_sid';
const SID_RE = /^[a-f0-9]{36}$/;
const IDLE_TTL = 7 * 24 * 60 * 60 * 1000; // 已登录会话：7 天未活动即回收
const ANON_TTL = 30 * 60 * 1000; // 匿名上下文：30 分钟未活动即回收
const MAX_CONTEXTS = 500; // 内存中同时保留的会话上下文上限
const MAX_AGE = Math.floor(IDLE_TTL / 1000);
// 会话文件时间戳最多每 60 秒刷一次盘（review R13）：每个已登录请求都 utimes 会阻塞事件循环。
const TOUCH_INTERVAL = Number(process.env.JWXT_SESSION_TOUCH_MS) >= 0
  ? Number(process.env.JWXT_SESSION_TOUCH_MS)
  : 60 * 1000;

const contexts = new Map(); // sid -> ctx

const sidFile = (sid) => join(config.sessionDir, `${sid}.json`);

/** 回收最少活动的上下文；优先回收没有登录态的匿名上下文。 */
function evictOverflow() {
  while (contexts.size > MAX_CONTEXTS) {
    let victim = null;
    for (const [sid, ctx] of contexts) {
      if (ctx.session) continue;
      if (!victim || ctx.lastSeen < victim.ctx.lastSeen) victim = { sid, ctx };
    }
    if (!victim) {
      for (const [sid, ctx] of contexts) {
        if (!victim || ctx.lastSeen < victim.ctx.lastSeen) victim = { sid, ctx };
      }
    }
    if (!victim) break;
    try { victim.ctx.loginFlow.reset?.(); } catch { /* ignore */ }
    try { victim.ctx.backgroundAbort?.abort(); } catch { /* ignore */ }
    victim.ctx.cache.destroy();
    victim.ctx.exports.destroy();
    contexts.delete(victim.sid);
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function createContext(sid) {
  return {
    sid,
    session: null,
    loginFlow: createLoginFlow(),
    cache: new CacheStore({ max: 200, maxBytes: QUERY_CACHE_BYTES, name: 'query' }),
    exports: new CacheStore({ max: 20, maxBytes: EXPORT_CACHE_BYTES, name: 'exports' }),
    inflight: new Map(),
    lastSeen: Date.now(),
    lastTouch: 0,
    generation: 0,
  };
}

function loadPersisted(sid) {
  const file = sidFile(sid);
  if (!existsSync(file)) return null;
  try {
    if (Date.now() - statSync(file).mtimeMs > IDLE_TTL) return null;
    return JwxtSession.deserialize(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 会话文件时间戳节流刷盘：同 sid 每分钟最多一次，失败不影响请求。 */
function touchSessionFile(ctx) {
  if (TOUCH_INTERVAL > 0 && Date.now() - ctx.lastTouch < TOUCH_INTERVAL) return;
  ctx.lastTouch = Date.now();
  void utimes(sidFile(ctx.sid), new Date(), new Date()).catch(() => { /* not persisted yet */ });
}

/** 从请求 Cookie 解析/分配 sid，返回该浏览器的上下文。 */
export function contextFor(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies[COOKIE];
  let assign = false;
  let loaded = null;
  if (!sid || !SID_RE.test(sid)) {
    sid = randomBytes(18).toString('hex');
    assign = true;
  } else if (!contexts.has(sid)) {
    // 同一 sid 只在这里读一次磁盘；恢复失败会换新 sid。
    loaded = loadPersisted(sid);
    if (!loaded) {
      sid = randomBytes(18).toString('hex');
      assign = true;
    }
  }
  let ctx = contexts.get(sid);
  if (!ctx) {
    ctx = createContext(sid);
    if (loaded) ctx.session = loaded;
    contexts.set(sid, ctx);
    evictOverflow();
  }
  ctx.lastSeen = Date.now();
  if (ctx.session) touchSessionFile(ctx);
  if (assign) {
    setCookie(res, sid);
  }
  return ctx;
}

/** 登录成功后把该 sid 的会话写入磁盘。 */
export function persistSession(ctx) {
  try {
    mkdirSync(config.sessionDir, { recursive: true });
    if (ctx.session) {
      const file = sidFile(ctx.sid);
      writeFileSync(`${file}.tmp`, ctx.session.serialize(), { encoding: 'utf8', mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    }
    else rmSync(sidFile(ctx.sid), { force: true });
  } catch (error) {
    console.warn('[session] 会话持久化失败：', error instanceof Error ? error.message : error);
  }
}

/** 清空该会话的数据缓存并递增代际（旧后台任务据此停止写回，并被取消）。 */
export function resetContextCaches(ctx) {
  ctx.generation += 1;
  ctx.cache.clear();
  ctx.exports.clear();
  ctx.inflight.clear();
  // 后台预热/预取的进行中请求也要取消：退出后不再占用上游额度、不再下载（review R04）
  try { ctx.backgroundAbort?.abort(); } catch { /* ignore */ }
  ctx.backgroundAbort = null;
}

/** 退出/过期：清空该 sid 的会话、登录流程与缓存。 */
export function dropContext(ctx) {
  ctx.session = null;
  try {
    ctx.loginFlow.reset();
  } catch {
    /* ignore */
  }
  resetContextCaches(ctx);
  try {
    rmSync(sidFile(ctx.sid), { force: true });
  } catch {
    /* ignore */
  }
}

/** 回收长时间未活动的会话（内存 + 磁盘）与死缓存仓库。 */
export function sweepSessions() {
  const now = Date.now();
  for (const [sid, ctx] of contexts) {
    const ttl = ctx.session ? IDLE_TTL : ANON_TTL;
    if (now - ctx.lastSeen > ttl) {
      try {
        ctx.loginFlow.reset?.();
      } catch {
        /* ignore */
      }
      try { ctx.backgroundAbort?.abort(); } catch { /* ignore */ }
      ctx.cache.destroy();
      ctx.exports.destroy();
      contexts.delete(sid);
      try {
        rmSync(sidFile(sid), { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  if (!existsSync(config.sessionDir)) return;
  try {
    for (const name of readdirSync(config.sessionDir)) {
      const file = join(config.sessionDir, name);
      if (name.endsWith('.json.tmp')) {
        try {
          if (now - statSync(file).mtimeMs > 60 * 60 * 1000) rmSync(file, { force: true });
        } catch {
          /* ignore */
        }
        continue;
      }
      if (!name.endsWith('.json')) continue;
      try {
        if (!contexts.has(name.slice(0, -5)) && now - statSync(file).mtimeMs > IDLE_TTL) rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function setCookie(res, sid) {
  res.setHeader('Set-Cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
}

export function rotateContext(ctx, res) {
  const oldSid = ctx.sid;
  contexts.delete(oldSid);
  try { rmSync(sidFile(oldSid), { force: true }); } catch { /* best effort */ }
  ctx.sid = randomBytes(18).toString('hex');
  resetContextCaches(ctx);
  contexts.set(ctx.sid, ctx);
  setCookie(res, ctx.sid);
}
