import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function defaultRoot() {
  try {
    return fileURLToPath(new URL('../', import.meta.url));
  } catch {
    // CJS/SEA 打包后 import.meta.url 不可用；调用方应显式设置 APP_ROOT
    return process.cwd();
  }
}

const root = process.env.APP_ROOT || defaultRoot();

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnvFile(join(root, '.env'));

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEPALIVE_MS_DEFAULT = 5 * 60 * 1000;
const KEEPALIVE_MAX_IDLE_DAYS_DEFAULT = 30;

/**
 * 服务端会话保活心跳间隔（毫秒）：0 表示关闭。
 * 之所以要它：前端心跳只在页面打开且可见时发请求，关掉页面后上游没有任何流量，
 * 教务按自己的闲置超时把会话判死——这就是「长时间不用要重新扫码」的主因。
 * 空值/非法值回退默认 5 分钟（非 0，即默认开启）。
 */
export function parseKeepAliveMs(raw) {
  if (raw === undefined || raw === null || raw === '') return KEEPALIVE_MS_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return KEEPALIVE_MS_DEFAULT;
  return Math.floor(value);
}

/** 保活窗口（毫秒）：多少天内有过真实访问（打开页面）才继续保活；非法/非正数回退默认 30 天。 */
export function parseKeepAliveMaxIdleMs(raw) {
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return KEEPALIVE_MAX_IDLE_DAYS_DEFAULT * DAY_MS;
  return Math.floor(days * DAY_MS);
}

export const config = {
  base: (process.env.JWXT_BASE || 'https://jwxt.slu.edu.cn:4060').replace(/\/+$/, ''),
  insecureTls: process.env.JWXT_INSECURE_TLS === '1',
  port: num(process.env.PORT, 8790),
  qrTimeoutMs: num(process.env.JWXT_QR_TIMEOUT_MS, 5 * 60 * 1000),
  pollMs: num(process.env.JWXT_POLL_MS, 2000),
  sessionDir: process.env.SESSION_DIR || join(root, '.sessions'),
  // 服务端会话保活：间隔 0 = 关闭；窗口决定「多久没打开页面就停止保活」（见 keepAlive.mjs）
  keepAliveMs: parseKeepAliveMs(process.env.JWXT_KEEPALIVE_MS),
  keepAliveMaxIdleMs: parseKeepAliveMaxIdleMs(process.env.JWXT_KEEPALIVE_MAX_IDLE_DAYS),
  root,
};

if (config.insecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[warn] 已关闭 TLS 证书校验（JWXT_INSECURE_TLS=1），仅限本地调试。');
}
