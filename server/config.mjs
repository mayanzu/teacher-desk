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

export const config = {
  base: (process.env.JWXT_BASE || 'https://jwxt.slu.edu.cn:4060').replace(/\/+$/, ''),
  insecureTls: process.env.JWXT_INSECURE_TLS === '1',
  port: num(process.env.PORT, 8790),
  qrTimeoutMs: num(process.env.JWXT_QR_TIMEOUT_MS, 5 * 60 * 1000),
  pollMs: num(process.env.JWXT_POLL_MS, 2000),
  sessionDir: process.env.SESSION_DIR || join(root, '.sessions'),
  root,
};

if (config.insecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[warn] 已关闭 TLS 证书校验（JWXT_INSECURE_TLS=1），仅限本地调试。');
}
