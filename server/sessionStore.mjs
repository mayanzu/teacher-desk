/*
 * 按浏览器隔离的多用户会话存储。
 * 每个浏览器分配一个 HttpOnly Cookie（td_sid），后端为每个 sid 维护独立：
 *   - JwxtSession（各自的教务登录态）
 *   - 扫码登录流程
 *   - 数据缓存
 * 会话按 sid 持久化到 SESSION_DIR/<sid>.json，重启后可恢复，互不干扰。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.mjs';
import { JwxtSession } from './session.mjs';
import { createLoginFlow } from './login.mjs';

const COOKIE = 'td_sid';
const SID_RE = /^[a-f0-9]{36}$/;
const IDLE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天未活动即回收
const MAX_AGE = Math.floor(IDLE_TTL / 1000);

const contexts = new Map(); // sid -> ctx

const sidFile = (sid) => join(config.sessionDir, `${sid}.json`);

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
  return { sid, session: null, loginFlow: createLoginFlow(), cache: new Map(), lastSeen: Date.now() };
}

function loadPersisted(sid) {
  const file = sidFile(sid);
  if (!existsSync(file)) return null;
  try {
    return JwxtSession.deserialize(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 从请求 Cookie 解析/分配 sid，返回该浏览器的上下文。 */
export function contextFor(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies[COOKIE];
  let assign = false;
  if (!sid || !SID_RE.test(sid)) {
    sid = randomBytes(18).toString('hex');
    assign = true;
  }
  let ctx = contexts.get(sid);
  if (!ctx) {
    ctx = createContext(sid);
    const persisted = loadPersisted(sid);
    if (persisted) ctx.session = persisted;
    contexts.set(sid, ctx);
  }
  ctx.lastSeen = Date.now();
  if (assign) {
    res.setHeader('Set-Cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`);
  }
  return ctx;
}

/** 登录成功后把该 sid 的会话写入磁盘。 */
export function persistSession(ctx) {
  try {
    mkdirSync(config.sessionDir, { recursive: true });
    if (ctx.session) writeFileSync(sidFile(ctx.sid), ctx.session.serialize(), 'utf8');
    else rmSync(sidFile(ctx.sid), { force: true });
  } catch {
    /* best effort */
  }
}

/** 退出/过期：清空该 sid 的会话、登录流程与缓存。 */
export function dropContext(ctx) {
  ctx.session = null;
  try {
    ctx.loginFlow.reset();
  } catch {
    /* ignore */
  }
  ctx.cache.clear();
  try {
    rmSync(sidFile(ctx.sid), { force: true });
  } catch {
    /* ignore */
  }
}

/** 回收长时间未活动的会话（内存 + 磁盘）。 */
export function sweepSessions() {
  const now = Date.now();
  for (const [sid, ctx] of contexts) {
    if (now - ctx.lastSeen > IDLE_TTL) {
      try {
        ctx.loginFlow.stop?.();
      } catch {
        /* ignore */
      }
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
      if (!name.endsWith('.json')) continue;
      const file = join(config.sessionDir, name);
      try {
        if (now - statSync(file).mtimeMs > IDLE_TTL) rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
